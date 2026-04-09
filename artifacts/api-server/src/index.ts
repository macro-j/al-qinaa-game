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
  userId:    string;
  socketId:  string;
  name:      string;
  online:    boolean;
  isAlive:   boolean;
  isSilenced: boolean;
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
  code:              string;
  hostId:            string;
  hostUserId:        string;
  hostName:          string;
  players:           Player[];
  started:           boolean;
  roles:             Record<string, AssignedRole>;
  nightActions:      NightActions;
  votes:             Record<string, string>; // voterName → targetName
  nightPhaseTimers?: ReturnType<typeof setTimeout>[];
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

// ─── Night Sequence ───────────────────────────────────────────────────────────

function startNightSequence(code: string) {
  const room = rooms[code];
  if (!room) return;

  room.nightPhaseTimers?.forEach(clearTimeout);
  room.nightActions = freshNightActions();
  // Reset silence flags for the new night
  for (const p of room.players) p.isSilenced = false;

  const nightScript: { delay: number; text: string; phase: string; resolve?: true }[] = [
    { delay:      0, text: "المدينة تنام.. الكل يغمض عيونه.",    phase: "night_sleep"  },
    { delay:  12000, text: "قناع الذئب يفتح عيونه.. ويتحرك.",    phase: "night_wolf"   },
    { delay:  24000, text: "قناع الظل يفتح عيونه.. ويسكت.",      phase: "night_shadow" },
    { delay:  36000, text: "قناع العرّاف يفتح عيونه.. ويحقق.",   phase: "night_seer"   },
    { delay:  48000, text: "قناع الحارس يفتح عيونه.. ويحمي.",    phase: "night_guard"  },
    { delay:  60000, text: "المدينة تصحى.. ويبدأ النهار.",        phase: "day_discussion", resolve: true },
  ];

  room.nightPhaseTimers = nightScript.map(({ delay, text, phase, resolve }) =>
    setTimeout(() => {
      if (!rooms[code]) return;
      if (resolve) resolveMorning(code);
      io.to(code).emit("playAudio",   text);
      io.to(code).emit("phaseUpdate", phase);
      logger.info({ code, phase }, "Night phase broadcast");
    }, delay),
  );
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
        hostId:     socket.id,
        hostUserId: userId,
        hostName:   name,
        players:    [{ userId, socketId: socket.id, name, online: true, isAlive: true, isSilenced: false }],
        started:    false,
        roles:      {},
        nightActions: freshNightActions(),
        votes:      {},
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
      callback: (res: { code: string; players: { socketId: string; name: string }[]; started: boolean } | { error: string }) => void,
    ) => {
      const room = rooms[code];
      if (!room) { callback({ error: "الغرفة غير موجودة، تحقق من الكود" }); return; }

      const byUid = room.players.find((p) => p.userId === userId);
      if (byUid) {
        if (byUid.offlineTimer) { clearTimeout(byUid.offlineTimer); byUid.offlineTimer = undefined; }
        byUid.socketId = socket.id;
        byUid.online   = true;
        socket.join(code);
        io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });
        logger.info({ code, name }, "Player re-entered room via joinRoom");
        callback({ code, players: onlinePlayers(room), started: room.started });
        return;
      }

      const byName = room.players.find((p) => p.name === name && p.online);
      if (byName) { callback({ error: "يوجد لاعب بهذا الاسم بالفعل" }); return; }

      room.players.push({ userId, socketId: socket.id, name, online: true, isAlive: true, isSilenced: false });
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
      if (isHost) {
        callback({ code, started: true, isHost: true, players: allPlayers(room) });
      } else {
        const myRole = room.roles[player.name] ?? { label: "قناع الضحية (المواطن)", color: "#555555" };
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
      room.nightPhaseTimers?.forEach(clearTimeout);
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
      { label: "قناع الذئب",  sublabel: "الجلاد",  color: "#D32F2F" },
      { label: "قناع الظل",   sublabel: "الكاتم",  color: "#B71C1C" },
      { label: "قناع العرّاف", sublabel: "الكاشف",  color: "#FF8F00" },
      { label: "قناع الحارس", sublabel: "الدرع",   color: "#1565C0" },
    ];

    const shuffled = [...room.players].sort(() => Math.random() - 0.5);
    const assigned = shuffled.map((p, i) => {
      const def = i < roleDefs.length
        ? roleDefs[i]
        : { label: "قناع الضحية", sublabel: "المواطن", color: "#555555" };
      const roleLabel = `${def.label} (${def.sublabel})`;
      const roleColor = def.color;
      room.roles[p.name] = { label: roleLabel, color: roleColor };
      p.isAlive   = true;
      p.isSilenced = false;
      return { socketId: p.socketId, name: p.name, roleLabel, roleColor };
    });

    room.started = true;

    // Build a map of wolf-team names for ally awareness
    const wolfTeamNames = assigned
      .filter((p) => p.roleLabel.includes("الذئب") || p.roleLabel.includes("الظل"))
      .map((p) => p.name);

    for (const ap of assigned) {
      if (ap.name === room.hostName) continue;
      const isWolfTeam = ap.roleLabel.includes("الذئب") || ap.roleLabel.includes("الظل");
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
    const hostIsWolfTeam = hostEntry && (hostEntry.roleLabel.includes("الذئب") || hostEntry.roleLabel.includes("الظل"));
    const hostWolfAllies = hostIsWolfTeam
      ? wolfTeamNames.filter((n) => n !== room.hostName)
      : [];

    io.to(room.hostId).emit("gameStarted", {
      isHost: true, code, players: assigned, wolfAllies: hostWolfAllies,
    });

    logger.info({ code, playerCount: assigned.length }, "Game started — roles distributed");

    startNightSequence(code);
  });

  // ── Submit Night Action ────────────────────────────────────────────────────
  socket.on(
    "submitNightAction",
    ({ actionType, targetName, roomCode }: { actionType: string; targetName: string; roomCode: string }) => {
      const room = rooms[roomCode];
      if (!room) return;

      logger.info({ roomCode, actionType, targetName }, "Night action received");

      if (actionType === "kill") {
        // Wolf cannot kill a fellow wolf-team member
        const targetRole = room.roles[targetName]?.label ?? "";
        const isTargetWolfTeam = targetRole.includes("الذئب") || targetRole.includes("الظل");
        if (isTargetWolfTeam) {
          logger.warn({ roomCode, targetName }, "Wolf tried to kill wolf ally — rejected");
          return;
        }
        room.nightActions.killTarget = targetName;
      } else if (actionType === "silence") {
        room.nightActions.silenceTarget = targetName;
      } else if (actionType === "protect") {
        room.nightActions.protectTarget = targetName;
      } else if (actionType === "investigate") {
        const target = room.players.find((p) => p.name === targetName);
        if (target) {
          const role = room.roles[target.name];
          socket.emit("investigateResult", {
            targetName,
            roleLabel: role?.label ?? "مجهول",
            roleColor: role?.color ?? "#555555",
          });
          logger.info({ roomCode, targetName, roleLabel: role?.label }, "Investigate result sent");
        }
      }
    },
  );

  // ── Host: Start Voting ─────────────────────────────────────────────────────
  socket.on("startVoting", ({ code }: { code: string }) => {
    const room = rooms[code];
    if (!room) return;
    if (room.hostId !== socket.id) return;
    room.votes = {};
    const alivePlayerNames = room.players.filter((p) => p.isAlive).map((p) => p.name);
    io.to(code).emit("phaseUpdate", "voting");
    io.to(code).emit("voteUpdate", { votes: {}, alivePlayerNames, totalAlive: alivePlayerNames.length });
    logger.info({ code }, "Phase → voting");
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

  // ── Host: Tally Votes & Execute ────────────────────────────────────────────
  socket.on("tallyVotesAndExecute", ({ code }: { code: string }) => {
    const room = rooms[code];
    if (!room) return;
    if (room.hostId !== socket.id) return;

    // Count votes per target
    const tally: Record<string, number> = {};
    for (const targetName of Object.values(room.votes)) {
      tally[targetName] = (tally[targetName] ?? 0) + 1;
    }

    let executedPlayerName: string | null = null;
    const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);

    if (entries.length > 0) {
      const [topTarget] = entries[0];
      const victim = room.players.find((p) => p.name === topTarget && p.isAlive);
      if (victim) {
        victim.isAlive     = false;
        executedPlayerName = victim.name;
        logger.info({ code, executedPlayerName }, "Player executed by vote");
      }
    }

    room.votes = {};

    // Emit execution result regardless of win
    io.to(code).emit("executionResult", { executedPlayerName });

    // Win condition check
    const alivePlayers  = room.players.filter((p) => p.isAlive);
    const aliveWolves   = alivePlayers.filter((p) => {
      const lbl = room.roles[p.name]?.label ?? "";
      return lbl.includes("الذئب") || lbl.includes("الظل");
    });
    const aliveCitizens = alivePlayers.filter((p) => {
      const lbl = room.roles[p.name]?.label ?? "";
      return !lbl.includes("الذئب") && !lbl.includes("الظل");
    });

    if (aliveWolves.length === 0) {
      io.to(code).emit("gameOver", { winner: "citizens", executedPlayerName });
      logger.info({ code }, "Game over — citizens win");
      return;
    }

    if (aliveWolves.length >= aliveCitizens.length) {
      io.to(code).emit("gameOver", { winner: "wolves", executedPlayerName });
      logger.info({ code }, "Game over — wolves win");
      return;
    }

    // No winner yet — continue to next night
    startNightSequence(code);
    logger.info({ code }, "No winner — starting next night after execution");
  });

  // ── Host: Next Night ───────────────────────────────────────────────────────
  socket.on("nextNight", ({ code }: { code: string }) => {
    const room = rooms[code];
    if (!room) return;
    if (room.hostId !== socket.id) return;
    startNightSequence(code);
    logger.info({ code }, "New night sequence started by host");
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────
  socket.on("disconnect", (reason) => {
    logger.info({ socketId: socket.id, reason }, "Client disconnected");

    for (const code of Object.keys(rooms)) {
      const room   = rooms[code];
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) continue;

      player.online = false;
      io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });

      player.offlineTimer = setTimeout(() => {
        if (player.online) return;

        room.players = room.players.filter((p) => p.userId !== player.userId);
        delete room.roles[player.name];

        const wasHost = room.hostUserId === player.userId;
        if (wasHost || room.players.length === 0) {
          room.nightPhaseTimers?.forEach(clearTimeout);
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
