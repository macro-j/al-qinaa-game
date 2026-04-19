import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { Server as SocketServer } from "socket.io";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

// ─── Room State ───────────────────────────────────────────────────────────────

const OFFLINE_GRACE_MS = 3 * 60 * 1000;

interface Player {
  userId:      string;
  socketId:    string;
  name:        string;
  online:      boolean;
  isAlive:     boolean;
  isSilenced:  boolean;
  deathReason: "assassinated" | "executed" | null;
  offlineTimer?: ReturnType<typeof setTimeout>;
}

interface AssignedRole {
  label: string;
  color: string;
}

interface NightActions {
  killTarget:    string | null;
  protectTarget: string | null;
  silenceTarget: string | null;
}

interface Room {
  code:            string;
  hostId:          string;
  hostUserId:      string;
  hostName:        string;
  players:         Player[];
  started:         boolean;
  roles:           Record<string, AssignedRole>;
  nightActions:    NightActions;
  votes:           Record<string, string>; // voterName → targetName
  nightPhaseIndex: number; // index into NIGHT_SEQUENCE; -1 = not started
  nightTimers:     ReturnType<typeof setTimeout>[]; // single-slot: current night-phase advance timer
  dayTimers:       ReturnType<typeof setTimeout>[]; // single-slot: current day-phase advance timer
}

const rooms: Record<string, Room> = {};

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function onlinePlayers(room: Room) {
  return room.players
    .filter((p) => p.online)
    .map((p) => ({ socketId: p.socketId, name: p.name }));
}

function allPlayers(room: Room) {
  return room.players.map((p) => ({
    socketId:  p.socketId,
    name:      p.name,
    online:    p.online,
    isAlive:   p.isAlive,
    isSilenced: p.isSilenced,
    roleLabel: room.roles[p.name]?.label ?? "",
    roleColor: room.roles[p.name]?.color ?? "#555555",
  }));
}

function freshNightActions(): NightActions {
  return { killTarget: null, protectTarget: null, silenceTarget: null };
}

// ─── Morning Resolution ───────────────────────────────────────────────────────

function resolveMorning(code: string) {
  const room = rooms[code];
  if (!room) return;

  const { killTarget, protectTarget, silenceTarget } = room.nightActions;

  // Reset silence from previous night
  for (const p of room.players) p.isSilenced = false;

  let killedPlayerName:  string | null = null;
  let silencedPlayerName: string | null = null;

  if (killTarget && killTarget !== protectTarget) {
    const victim = room.players.find((p) => p.name === killTarget);
    if (victim && victim.isAlive) {
      victim.isAlive    = false;
      victim.deathReason = "assassinated";
      killedPlayerName  = victim.name;
    }
  }

  if (silenceTarget) {
    const target = room.players.find((p) => p.name === silenceTarget);
    if (target && target.isAlive) {
      target.isSilenced  = true;
      silencedPlayerName = target.name;
    }
  }

  io.to(code).emit("morningResults", { killedPlayerName, silencedPlayerName });
  room.nightActions = freshNightActions();

  logger.info({ code, killedPlayerName, silencedPlayerName }, "Morning resolved");
}

// ─── Night Sequence (Auto-Timer State Machine) ────────────────────────────────

const NIGHT_SEQUENCE = [
  "night_sleep",
  "night_wolf",
  "night_shadow",
  "night_seer",
  "night_guard",
  "day_discussion",
] as const;

// Duration each phase lasts before auto-advancing to the next (ms)
const NIGHT_PHASE_DURATIONS: Record<string, number> = {
  night_sleep:  3_000,
  night_wolf:   20_000,
  night_shadow: 20_000,
  night_seer:   20_000,
  night_guard:  20_000,
};

/** Clears pending night-advance timers for a room. */
function clearNightTimers(room: Room) {
  room.nightTimers.forEach((t) => clearTimeout(t));
  room.nightTimers = [];
}

function clearDayTimers(room: Room) {
  room.dayTimers.forEach((t) => clearTimeout(t));
  room.dayTimers = [];
}

/** Shared win-condition helper — used after night kill and after vote execution. */
function checkWinConditions(code: string): "citizens" | "wolves" | null {
  const room = rooms[code];
  if (!room) return null;

  // Roles must be distributed before any check is meaningful
  if (Object.keys(room.roles).length === 0) return null;

  const MAIN_WOLF  = "الولد";
  const isMafiaLbl = (lbl: string) => lbl === "الولد" || lbl === "الإكة";

  const alivePlayers = room.players.filter((p) => p.isAlive);

  // ── Citizen win ─────────────────────────────────────────────────────────────
  // Citizens win ONLY when الولد (the main wolf) is eliminated.
  // الإكة surviving alone does NOT keep the game going for mafia.
  const mainWolfAlive = alivePlayers.some(
    (p) => (room.roles[p.name]?.label ?? "") === MAIN_WOLF,
  );
  if (!mainWolfAlive) return "citizens";

  // ── Mafia win ───────────────────────────────────────────────────────────────
  // Mafia wins ONLY when ALL citizens are dead (safe for small playtests).
  const aliveCitizenCount = alivePlayers.filter((p) => !isMafiaLbl(room.roles[p.name]?.label ?? "")).length;
  if (aliveCitizenCount === 0) return "wolves";

  return null;
}

// ── Sequential night-phase runner ────────────────────────────────────────────
// Advances one phase at a time; cancels the current timer before moving on.
// Called recursively by the timeout and directly by submitNightAction for
// early advancement when the active role submits their action.

function runNightPhase(code: string, phaseIndex: number) {
  const room = rooms[code];
  if (!room) return;

  clearNightTimers(room); // cancel whatever timer was pending

  if (phaseIndex >= NIGHT_SEQUENCE.length) return;

  const phase = NIGHT_SEQUENCE[phaseIndex];
  room.nightPhaseIndex = phaseIndex;

  if (phase === "day_discussion") {
    // Night complete — resolve kills/silence, check win, transition to day
    resolveMorning(code);
    const winner = checkWinConditions(code);
    if (winner) {
      io.to(code).emit("gameOver", { winner, executedPlayerName: null });
      logger.info({ code, winner }, "Game over after night kill");
      return;
    }
    io.to(code).emit("phaseUpdate", "day_discussion");
    io.to(code).emit("phaseTimer", { endsAt: Date.now() + 40_000 });
    scheduleAutoVoting(code);
    logger.info({ code }, "Morning resolved → day_discussion (40 s then auto-vote)");
    return;
  }

  const phaseDuration = NIGHT_PHASE_DURATIONS[phase] ?? 20_000;
  io.to(code).emit("phaseUpdate", phase);
  io.to(code).emit("phaseTimer", { endsAt: Date.now() + phaseDuration });
  logger.info({ code, phase, phaseIndex }, "Night phase running");

  const t = setTimeout(() => {
    if (!rooms[code]) return;
    runNightPhase(code, phaseIndex + 1);
  }, phaseDuration);
  room.nightTimers = [t];
}

/** Starts / restarts the night sequence from night_sleep (index 0). */
function startNightPhase(code: string) {
  const room = rooms[code];
  if (!room) return;
  clearNightTimers(room);
  clearDayTimers(room);
  room.nightActions = freshNightActions();
  for (const p of room.players) p.isSilenced = false;
  runNightPhase(code, 0);
}

// ── Day auto-advance helpers ──────────────────────────────────────────────────

/** Called from morning resolution; schedules voting to start automatically. */
function scheduleAutoVoting(code: string) {
  const room = rooms[code];
  if (!room) return;
  clearDayTimers(room);
  const t = setTimeout(() => {
    if (!rooms[code]) return;
    triggerStartVoting(code);
  }, 40_000);
  room.dayTimers = [t];
}

/** Transitions to voting phase — used by manual host button AND auto-timer. */
function triggerStartVoting(code: string) {
  const room = rooms[code];
  if (!room) return;
  clearDayTimers(room); // prevent double-fire if host clicked early
  room.votes = {};
  const alivePlayerNames = room.players.filter((p) => p.isAlive).map((p) => p.name);
  io.to(code).emit("phaseUpdate", "voting");
  io.to(code).emit("phaseTimer", { endsAt: Date.now() + 20_000 });
  io.to(code).emit("voteUpdate", { votes: {}, alivePlayerNames, totalAlive: alivePlayerNames.length });
  logger.info({ code }, "Phase → voting");
  // Auto-tally after 20 s
  const t = setTimeout(() => {
    if (!rooms[code]) return;
    internalTallyAndExecute(code);
  }, 20_000);
  room.dayTimers = [t];
}

/** Tallies votes, marks victim, emits anonymous results — used by auto-timer AND host button. */
function internalTallyAndExecute(code: string) {
  const room = rooms[code];
  if (!room) return;
  clearDayTimers(room); // prevent double-fire if host clicked early

  const totalAlive = room.players.filter((p) => p.isAlive).length;
  const tally: Record<string, number> = {};
  for (const targetName of Object.values(room.votes)) {
    tally[targetName] = (tally[targetName] ?? 0) + 1;
  }

  let executedPlayerName: string | null = null;
  const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);

  if (entries.length > 0) {
    const [topTarget, topVotes] = entries[0];
    const hasTie         = entries.length > 1 && entries[1][1] === topVotes;
    const hasEnoughVotes = topVotes > Math.floor(totalAlive / 2);
    if (!hasTie && hasEnoughVotes) {
      const victim = room.players.find((p) => p.name === topTarget && p.isAlive);
      if (victim) {
        victim.isAlive     = false;
        victim.deathReason = "executed";
        executedPlayerName = victim.name;
        logger.info({ code, executedPlayerName }, "Player executed by vote");
      }
    } else {
      logger.info({ code, hasTie, hasEnoughVotes, topVotes, totalAlive }, "No execution — thresholds not met");
    }
  }

  room.votes = {};

  // Emit ANONYMOUS tally (counts per target, no voter names) to entire room
  io.to(code).emit("executionResult", { executedPlayerName, tally });

  const winner = checkWinConditions(code);
  if (winner) {
    io.to(code).emit("gameOver", { winner, executedPlayerName });
    logger.info({ code, winner }, "Game over after execution");
    return;
  }

  io.to(code).emit("phaseUpdate", "day_discussion");
  io.to(code).emit("phaseTimer", { endsAt: Date.now() + 40_000 });
  scheduleAutoVoting(code);
  logger.info({ code }, "No winner — returning to day_discussion");
}

// ─── HTTP + Socket.io Server ──────────────────────────────────────────────────

const httpServer = createServer(app);

const io = new SocketServer(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout:  60_000,
  pingInterval: 25_000,
});

io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "Client connected");

  // ── Create Room ────────────────────────────────────────────────────────────
  socket.on(
    "createRoom",
    (
      { name, userId }: { name: string; userId: string },
      callback: (res: { code: string; players: { socketId: string; name: string }[] } | { error: string }) => void,
    ) => {
      let code: string;
      let tries = 0;
      do { code = generateRoomCode(); tries++; } while (rooms[code] && tries < 200);
      if (rooms[code]) { callback({ error: "تعذر إنشاء غرفة جديدة، حاول مجدداً" }); return; }

      const room: Room = {
        code,
        hostId:          socket.id,
        hostUserId:      userId,
        hostName:        name,
        players:         [{ userId, socketId: socket.id, name, online: true, isAlive: true, isSilenced: false, deathReason: null }],
        started:         false,
        roles:           {},
        nightActions:    freshNightActions(),
        votes:           {},
        nightPhaseIndex: -1,
        nightTimers:     [],
        dayTimers:       [],
      };
      rooms[code] = room;
      socket.join(code);

      logger.info({ code, host: name }, "Room created");
      callback({ code, players: onlinePlayers(room) });
    },
  );

  // ── Join Room ──────────────────────────────────────────────────────────────
  socket.on(
    "joinRoom",
    (
      { code, name, userId }: { code: string; name: string; userId: string },
      callback: (res:
        | { code: string; players: { socketId: string; name: string }[]; started: boolean }
        | { code: string; started: true; isHost: true;  players: ReturnType<typeof allPlayers> }
        | { code: string; started: true; isHost: false; myRole: AssignedRole }
        | { error: string }
      ) => void,
    ) => {
      const room = rooms[code];
      if (!room) { callback({ error: "الغرفة غير موجودة، تحقق من الكود" }); return; }

      // ── Reconnect by userId (same browser) ───────────────────────────────
      const byUid = room.players.find((p) => p.userId === userId);
      if (byUid) {
        if (byUid.offlineTimer) { clearTimeout(byUid.offlineTimer); byUid.offlineTimer = undefined; }
        byUid.socketId = socket.id;
        byUid.online   = true;
        if (room.hostUserId === userId) room.hostId = socket.id;
        socket.join(code);
        io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });
        logger.info({ code, name: byUid.name }, "Player re-entered room via joinRoom (byUid)");
        if (!room.started) {
          callback({ code, players: onlinePlayers(room), started: false });
        } else {
          const alive = room.players.filter((p) => p.isAlive).map((p) => p.name);
          socket.emit("alivePlayersSync", { alivePlayerNames: alive });
          const isHost = room.hostUserId === userId;
          if (isHost) {
            callback({ code, started: true, isHost: true, players: allPlayers(room) });
          } else {
            const myRole = room.roles[byUid.name] ?? { label: "المواطن", color: "#555555" };
            callback({ code, started: true, isHost: false, myRole });
          }
        }
        return;
      }

      // ── Reconnect by name — player had an offline entry (ghost) ──────────
      const ghostByName = room.players.find((p) => p.name === name && !p.online);
      if (ghostByName) {
        if (ghostByName.offlineTimer) { clearTimeout(ghostByName.offlineTimer); ghostByName.offlineTimer = undefined; }
        ghostByName.userId   = userId;
        ghostByName.socketId = socket.id;
        ghostByName.online   = true;
        socket.join(code);
        io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });
        logger.info({ code, name }, "Ghost player reconnected by name via joinRoom");
        if (!room.started) {
          callback({ code, players: onlinePlayers(room), started: false });
        } else {
          const alive = room.players.filter((p) => p.isAlive).map((p) => p.name);
          socket.emit("alivePlayersSync", { alivePlayerNames: alive });
          const myRole = room.roles[ghostByName.name] ?? { label: "المواطن", color: "#555555" };
          callback({ code, started: true, isHost: false, myRole });
        }
        return;
      }

      // ── Reject if an ONLINE player already has this name ─────────────────
      const onlineByName = room.players.find((p) => p.name === name && p.online);
      if (onlineByName) { callback({ error: "يوجد لاعب بهذا الاسم بالفعل" }); return; }

      // ── Reject new joins mid-game ─────────────────────────────────────────
      if (room.started) { callback({ error: "اللعبة انطلقت بالفعل، لا يمكن الانضمام الآن" }); return; }

      room.players.push({ userId, socketId: socket.id, name, online: true, isAlive: true, isSilenced: false, deathReason: null });
      socket.join(code);
      io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });

      logger.info({ code, name }, "Player joined room");
      callback({ code, players: onlinePlayers(room), started: room.started });
    },
  );

  // ── Rejoin Room ────────────────────────────────────────────────────────────
  socket.on(
    "rejoinRoom",
    (
      { code, userId, name }: { code: string; userId: string; name: string },
      callback: (res:
        | { code: string; players: { socketId: string; name: string }[]; started: false }
        | { code: string; started: true; isHost: true;  players: ReturnType<typeof allPlayers> }
        | { code: string; started: true; isHost: false; myRole: AssignedRole }
        | { error: string }
      ) => void,
    ) => {
      const room = rooms[code];
      if (!room) { callback({ error: "انتهت صلاحية الغرفة" }); return; }

      const player = room.players.find((p) => p.userId === userId) ??
                     room.players.find((p) => p.name === name);
      if (!player) { callback({ error: "لم يُعثر على اللاعب في الغرفة" }); return; }

      if (player.offlineTimer) { clearTimeout(player.offlineTimer); player.offlineTimer = undefined; }
      player.socketId = socket.id;
      player.userId   = userId;
      player.online   = true;

      if (room.hostUserId === userId || room.hostName === name) {
        room.hostId      = socket.id;
        room.hostUserId  = userId;
      }

      socket.join(code);
      io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });
      logger.info({ code, name }, "Player rejoined room");

      if (!room.started) {
        callback({ code, players: onlinePlayers(room), started: false });
        return;
      }

      const isHost = room.hostUserId === userId || room.hostName === name;
      // Always emit the current alive player list to the rejoining socket
      const alive = room.players.filter((p) => p.isAlive).map((p) => p.name);
      socket.emit("alivePlayersSync", { alivePlayerNames: alive });
      if (isHost) {
        callback({ code, started: true, isHost: true, players: allPlayers(room) });
      } else {
        const myRole = room.roles[player.name] ?? { label: "المواطن", color: "#555555" };
        callback({ code, started: true, isHost: false, myRole });
      }
    },
  );

  // ── Leave Room ─────────────────────────────────────────────────────────────
  socket.on("leaveRoom", ({ code, userId }: { code: string; userId: string }) => {
    const room = rooms[code];
    if (!room) return;

    const player = room.players.find((p) => p.userId === userId);
    if (!player) return;

    if (player.offlineTimer) { clearTimeout(player.offlineTimer); player.offlineTimer = undefined; }

    const wasHost = room.hostUserId === userId;
    room.players   = room.players.filter((p) => p.userId !== userId);
    delete room.roles[player.name];

    socket.leave(code);

    if (wasHost || room.players.length === 0) {
      clearNightTimers(room);
      delete rooms[code];
      io.to(code).emit("roomClosed");
      logger.info({ code, reason: wasHost ? "host left" : "empty" }, "Room dissolved on clean leave");
    } else {
      io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });
      logger.info({ code, name: player.name }, "Player left room cleanly");
    }
  });

  // ── Start Game ─────────────────────────────────────────────────────────────
  socket.on("startGame", ({ code }: { code: string }) => {
    const room = rooms[code];
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (room.players.filter((p) => p.online).length < 2) return;

    const roleDefs = [
      { label: "الولد",   color: "#D32F2F" },
      { label: "الإكة",   color: "#B71C1C" },
      { label: "الشايب",  color: "#FF8F00" },
      { label: "البنت",   color: "#1565C0" },
    ];

    const shuffled = [...room.players].sort(() => Math.random() - 0.5);
    const assigned = shuffled.map((p, i) => {
      const def = i < roleDefs.length
        ? roleDefs[i]
        : { label: "المواطن", color: "#555555" };
      const roleLabel = def.label;
      const roleColor = def.color;
      room.roles[p.name] = { label: roleLabel, color: roleColor };
      p.isAlive    = true;
      p.isSilenced = false;
      p.deathReason = null;
      return { socketId: p.socketId, name: p.name, roleLabel, roleColor };
    });

    room.started = true;

    // Build a map of wolf-team names for ally awareness
    const isMafiaRole = (lbl: string) => lbl === "الولد" || lbl === "الإكة";
    const wolfTeamNames = assigned
      .filter((p) => isMafiaRole(p.roleLabel))
      .map((p) => p.name);

    for (const ap of assigned) {
      if (ap.name === room.hostName) continue;
      const isWolfTeam = isMafiaRole(ap.roleLabel);
      const wolfAllies = isWolfTeam
        ? wolfTeamNames.filter((n) => n !== ap.name)
        : [];
      io.to(ap.socketId).emit("gameStarted", {
        isHost: false, code, myRole: { label: ap.roleLabel, color: ap.roleColor }, wolfAllies,
      });
    }

    // Host gets the full player roster (including their own role card visible via game.players)
    // Also include wolfAllies for the host player's own role
    const hostEntry = assigned.find((p) => p.name === room.hostName);
    const hostIsWolfTeam = hostEntry && isMafiaRole(hostEntry.roleLabel);
    const hostWolfAllies = hostIsWolfTeam
      ? wolfTeamNames.filter((n) => n !== room.hostName)
      : [];

    io.to(room.hostId).emit("gameStarted", {
      isHost: true, code, players: assigned, wolfAllies: hostWolfAllies,
    });

    room.nightPhaseIndex = -1; // host will manually start first night

    // Broadcast canonical alive list to ALL clients so every player's
    // targetList is seeded from the same authoritative source, not stale lobby data.
    const allAliveNames = room.players.map((p) => p.name);
    io.to(code).emit("alivePlayersSync", { alivePlayerNames: allAliveNames });

    logger.info({ code, playerCount: assigned.length }, "Game started — roles distributed");
    // Night does NOT start automatically — host clicks 'بدء الليلة الأولى'
  });

  // ── Submit Night Action ────────────────────────────────────────────────────
  socket.on(
    "submitNightAction",
    ({ actionType, targetName, roomCode }: { actionType: string; targetName: string; roomCode: string }) => {
      const room = rooms[roomCode];
      if (!room) return;

      // Dead players cannot act
      const actor = room.players.find((p) => p.socketId === socket.id);
      if (actor && !actor.isAlive) {
        logger.warn({ roomCode, actionType }, "Dead player attempted night action — rejected");
        return;
      }

      logger.info({ roomCode, actionType, targetName }, "Night action received");

      // ── HOST BLINDNESS: nightActions are server-only state, never emitted ──
      // Only morningResults (killedPlayerName, silencedPlayerName) is broadcast.
      // investigateResult goes only to the requesting socket. ─────────────────

      const isRoleMafia = (lbl: string) => lbl === "الولد" || lbl === "الإكة";

      // Track whether this action was validly recorded (only valid actions auto-advance)
      let actionRecorded = false;

      if (actionType === "kill") {
        // Wolf cannot kill a fellow wolf-team member (server-enforced).
        // Note: wolves CAN target themselves via the kill action only if they're
        // somehow in the list — but الولد is mafia so isRoleMafia would reject it too.
        const targetRoleLabel = room.roles[targetName]?.label ?? "";
        if (isRoleMafia(targetRoleLabel)) {
          logger.warn({ roomCode, targetName }, "Wolf tried to kill wolf ally — rejected (no auto-advance)");
          socket.emit("nightActionRejected", { reason: "لا يمكنك استهداف حليفك" });
          // Do NOT auto-advance: the wolf's turn remains open so they can pick a valid target.
        } else {
          room.nightActions.killTarget = targetName;
          actionRecorded = true;
          // ── Mafia Synergy: privately notify ALL mafia members ─────────────
          room.players
            .filter((p) => isRoleMafia(room.roles[p.name]?.label ?? ""))
            .forEach((p) => {
              io.to(p.socketId).emit("mafiaActionSync", { actionType: "kill", targetName });
            });
        }

      } else if (actionType === "silence") {
        // الإكة (Shadow) — may silence ANY alive player, including themselves.
        room.nightActions.silenceTarget = targetName;
        actionRecorded = true;
        // ── Mafia Synergy: privately notify ALL mafia members ─────────────
        room.players
          .filter((p) => isRoleMafia(room.roles[p.name]?.label ?? ""))
          .forEach((p) => {
            io.to(p.socketId).emit("mafiaActionSync", { actionType: "silence", targetName });
          });

      } else if (actionType === "protect") {
        // البنت (Guard) — may protect ANY alive player, including themselves.
        room.nightActions.protectTarget = targetName;
        actionRecorded = true;

      } else if (actionType === "investigate") {
        // Emit seerResult PRIVATELY to the requesting socket BEFORE auto-advancing,
        // so the result is stored on the client before the phase changes.
        const target = room.players.find((p) => p.name === targetName);
        if (target) {
          const targetRoleLabel = room.roles[target.name]?.label ?? "";
          const isMafiaRole = targetRoleLabel === "الولد" || targetRoleLabel === "الإكة";
          // New persistent event (replaces investigateResult on the frontend)
          socket.emit("seerResult", { targetName, isMafia: isMafiaRole });
          // Keep the legacy event for backward-compat UI segments that still read it
          const verdict = isMafiaRole
            ? `نعم، ${targetName} من المافيا`
            : `لا، ${targetName} بريء`;
          socket.emit("investigateResult", {
            targetName,
            roleLabel: verdict,
            roleColor: isMafiaRole ? "#D32F2F" : "#4CAF50",
          });
          logger.info({ roomCode, targetName, isMafiaRole }, "Seer verdict sent (private)");
          actionRecorded = true;
        }
      }

      // ── Auto-advance: only if the action was validly recorded for the current phase ──
      const ACTION_PHASE_MAP: Record<string, string> = {
        kill:        "night_wolf",
        silence:     "night_shadow",
        investigate: "night_seer",
        protect:     "night_guard",
      };
      const expectedPhase = ACTION_PHASE_MAP[actionType];
      const currentPhase  = NIGHT_SEQUENCE[room.nightPhaseIndex];
      if (actionRecorded && expectedPhase && expectedPhase === currentPhase) {
        logger.info({ roomCode, actionType, currentPhase }, "Action recorded — advancing to next phase immediately");
        runNightPhase(roomCode, room.nightPhaseIndex + 1);
      }
    },
  );

  // ── Host: Start Voting (manual early trigger — clears auto-timer) ──────────
  socket.on("startVoting", ({ code }: { code: string }) => {
    const room = rooms[code];
    if (!room) return;
    if (room.hostId !== socket.id) return;
    triggerStartVoting(code); // clears day timer internally → no double-fire
  });

  // ── Submit Vote ────────────────────────────────────────────────────────────
  socket.on(
    "submitVote",
    ({ targetName, roomCode }: { targetName: string; roomCode: string }) => {
      const room = rooms[roomCode];
      if (!room) return;

      const voter = room.players.find((p) => p.socketId === socket.id);
      if (!voter || !voter.isAlive) return;

      room.votes[voter.name] = targetName;
      logger.info({ roomCode, voter: voter.name, targetName }, "Vote cast");

      const alivePlayerNames = room.players.filter((p) => p.isAlive).map((p) => p.name);
      io.to(roomCode).emit("voteUpdate", {
        votes: room.votes,
        alivePlayerNames,
        totalAlive: alivePlayerNames.length,
      });
    },
  );

  // ── Host: Tally Votes & Execute (manual early trigger — clears auto-timer) ─
  socket.on("tallyVotesAndExecute", ({ code }: { code: string }) => {
    const room = rooms[code];
    if (!room) return;
    if (room.hostId !== socket.id) return;
    internalTallyAndExecute(code); // clears day timer internally → no double-fire
  });

  // ── Host: Start / Restart Night (goes to night_sleep) ────────────────────
  socket.on("startNightPhase", ({ code }: { code: string }) => {
    const room = rooms[code];
    if (!room) return;
    if (room.hostId !== socket.id) return;
    startNightPhase(code);
    logger.info({ code }, "Night phase started by host button");
  });


  // ── Host: Kick Player (lobby only) ─────────────────────────────────────────
  socket.on("kickPlayer", ({ code, playerName }: { code: string; playerName: string }) => {
    const room = rooms[code];
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (room.started) return; // only allowed in lobby

    const target = room.players.find((p) => p.name === playerName);
    if (!target) return;

    // Tell that socket they've been kicked, then remove from room
    const targetSocket = io.sockets.sockets.get(target.socketId);
    if (targetSocket) {
      targetSocket.emit("kickedFromRoom");
      targetSocket.leave(code);
    }

    room.players = room.players.filter((p) => p.name !== playerName);
    io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });
    logger.info({ code, playerName }, "Player kicked by host");
  });

  // ── Host: Abort Game (role_reveal only) ────────────────────────────────────
  socket.on("abortGame", ({ code }: { code: string }) => {
    const room = rooms[code];
    if (!room) return;
    if (room.hostId !== socket.id) return;

    // Cancel all night timers (if any started)
    clearNightTimers(room);

    // Reset game state back to lobby
    room.started         = false;
    room.roles           = {};
    room.nightActions    = freshNightActions();
    room.nightPhaseIndex = -1;
    room.votes           = {};

    // Reset every player to alive/un-silenced (clean slate)
    for (const p of room.players) {
      p.isAlive    = true;
      p.isSilenced = false;
      p.deathReason = null;
    }

    const lobbyPlayers = onlinePlayers(room);
    io.to(code).emit("gameAborted", { players: lobbyPlayers });
    io.to(code).emit("playersUpdated", { players: lobbyPlayers });
    logger.info({ code }, "Game aborted — returned to lobby");
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────
  socket.on("disconnect", (reason) => {
    logger.info({ socketId: socket.id, reason }, "Client disconnected");

    for (const code of Object.keys(rooms)) {
      const room   = rooms[code];
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) continue;

      // ── Pre-game lobby: remove immediately (no grace period) ─────────────
      if (!room.started) {
        room.players = room.players.filter((p) => p.userId !== player.userId);
        const wasHost = room.hostUserId === player.userId;
        if (wasHost || room.players.length === 0) {
          clearNightTimers(room);
          delete rooms[code];
          io.to(code).emit("roomClosed");
          logger.info({ code, reason: wasHost ? "host disconnected in lobby" : "empty" }, "Room dissolved in lobby");
        } else {
          io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });
          logger.info({ code, name: player.name }, "Player removed from lobby on disconnect");
        }
        break;
      }

      // ── In-game: mark offline + start 3-min grace period ─────────────────
      player.online = false;
      io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });

      player.offlineTimer = setTimeout(() => {
        if (player.online) return;

        room.players = room.players.filter((p) => p.userId !== player.userId);
        delete room.roles[player.name];

        const wasHost = room.hostUserId === player.userId;
        if (wasHost || room.players.length === 0) {
          clearNightTimers(room);
          delete rooms[code];
          io.to(code).emit("roomClosed");
          logger.info({ code, reason: wasHost ? "host timed out" : "empty" }, "Room dissolved");
        } else {
          io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });
          logger.info({ code, name: player.name }, "Player removed after grace period");
        }
      }, OFFLINE_GRACE_MS);

      logger.info({ code, name: player.name }, "Player marked offline — 3-min grace started");
      break;
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(port, () => {
  logger.info({ port }, "Server listening with Socket.io");
});
