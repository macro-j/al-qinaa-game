import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { Server as SocketServer } from "socket.io";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

// ─── Room State ───────────────────────────────────────────────────────────────

const OFFLINE_GRACE_MS = 3 * 60 * 1000; // 3-minute grace before permanent removal

interface Player {
  userId:    string;   // stable across page refreshes (from client localStorage)
  socketId:  string;   // volatile — changes every connection
  name:      string;
  online:    boolean;
  offlineTimer?: ReturnType<typeof setTimeout>;
}

interface AssignedRole {
  label: string;
  color: string;
}

interface Room {
  code:        string;
  hostId:      string;    // current socket.id of host (kept up-to-date on rejoin)
  hostUserId:  string;    // stable userId of host
  hostName:    string;    // display name of host
  players:     Player[];
  started:     boolean;
  roles:       Record<string, AssignedRole>; // player name → role
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
    roleLabel: room.roles[p.name]?.label ?? "",
    roleColor: room.roles[p.name]?.color ?? "#555555",
  }));
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
        players:    [{ userId, socketId: socket.id, name, online: true }],
        started:    false,
        roles:      {},
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

      // Check for an existing slot by userId (returning player without page persistence)
      const byUid = room.players.find((p) => p.userId === userId);
      if (byUid) {
        // Treat as rejoin — update socketId
        if (byUid.offlineTimer) { clearTimeout(byUid.offlineTimer); byUid.offlineTimer = undefined; }
        byUid.socketId = socket.id;
        byUid.online   = true;
        socket.join(code);
        io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });
        logger.info({ code, name }, "Player re-entered room via joinRoom");
        callback({ code, players: onlinePlayers(room), started: room.started });
        return;
      }

      // Check for duplicate display name from a different user
      const byName = room.players.find((p) => p.name === name && p.online);
      if (byName) { callback({ error: "يوجد لاعب بهذا الاسم بالفعل" }); return; }

      room.players.push({ userId, socketId: socket.id, name, online: true });
      socket.join(code);
      io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });

      logger.info({ code, name }, "Player joined room");
      callback({ code, players: onlinePlayers(room), started: room.started });
    },
  );

  // ── Rejoin Room (page refresh / reconnect) ─────────────────────────────────
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

      // Find by stable userId first, fall back to name
      const player = room.players.find((p) => p.userId === userId) ??
                     room.players.find((p) => p.name === name);
      if (!player) { callback({ error: "لم يُعثر على اللاعب في الغرفة" }); return; }

      // Cancel pending removal timer
      if (player.offlineTimer) { clearTimeout(player.offlineTimer); player.offlineTimer = undefined; }

      // Rehydrate with new socket and userId
      player.socketId = socket.id;
      player.userId   = userId;
      player.online   = true;

      // Keep host metadata current
      if (room.hostUserId === userId || room.hostName === name) {
        room.hostId      = socket.id;
        room.hostUserId  = userId;
      }

      socket.join(code);
      io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });
      logger.info({ code, name }, "Player rejoined room (page refresh / reconnect)");

      if (!room.started) {
        callback({ code, players: onlinePlayers(room), started: false });
        return;
      }

      const isHost = room.hostUserId === userId || room.hostName === name;
      if (isHost) {
        callback({ code, started: true, isHost: true, players: allPlayers(room) });
      } else {
        const myRole = room.roles[player.name] ?? { label: "قناع الشعب (المواطن)", color: "#555555" };
        callback({ code, started: true, isHost: false, myRole });
      }
    },
  );

  // ── Leave Room (intentional, clean exit) ───────────────────────────────────
  socket.on("leaveRoom", ({ code, userId }: { code: string; userId: string }) => {
    const room = rooms[code];
    if (!room) return;

    const player = room.players.find((p) => p.userId === userId);
    if (!player) return;

    // Cancel any grace timer
    if (player.offlineTimer) { clearTimeout(player.offlineTimer); player.offlineTimer = undefined; }

    const wasHost = room.hostUserId === userId;
    room.players   = room.players.filter((p) => p.userId !== userId);
    delete room.roles[player.name];

    socket.leave(code);

    if (wasHost || room.players.length === 0) {
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
    if (room.hostId !== socket.id) return; // hostId is kept current on every rejoin
    if (room.players.filter((p) => p.online).length < 2) return;

    const roleDefs = [
      { label: "قناع الولد",  sublabel: "الجلاد",  color: "#D32F2F" },
      { label: "قناع الأكة",  sublabel: "الكاتم",  color: "#B71C1C" },
      { label: "قناع الشايب", sublabel: "الكاشف",  color: "#FF8F00" },
      { label: "قناع البنت",  sublabel: "الدرع",   color: "#1565C0" },
    ];

    const shuffled = [...room.players].sort(() => Math.random() - 0.5);
    const assigned = shuffled.map((p, i) => {
      const def = i < roleDefs.length
        ? roleDefs[i]
        : { label: "قناع الشعب", sublabel: "المواطن", color: "#555555" };
      const roleLabel = `${def.label} (${def.sublabel})`;
      const roleColor = def.color;
      room.roles[p.name] = { label: roleLabel, color: roleColor };
      return { socketId: p.socketId, name: p.name, roleLabel, roleColor };
    });

    room.started = true;

    for (const ap of assigned) {
      if (ap.name === room.hostName) continue;
      io.to(ap.socketId).emit("gameStarted", {
        isHost: false, code, myRole: { label: ap.roleLabel, color: ap.roleColor },
      });
    }

    io.to(room.hostId).emit("gameStarted", {
      isHost: true, code, players: assigned,
    });

    logger.info({ code, playerCount: assigned.length }, "Game started — roles distributed");
  });

  // ── Disconnect (graceful grace period) ─────────────────────────────────────
  socket.on("disconnect", (reason) => {
    logger.info({ socketId: socket.id, reason }, "Client disconnected");

    for (const code of Object.keys(rooms)) {
      const room   = rooms[code];
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) continue;

      player.online = false;
      io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });

      player.offlineTimer = setTimeout(() => {
        if (player.online) return; // rejoined in time

        room.players = room.players.filter((p) => p.userId !== player.userId);
        delete room.roles[player.name];

        const wasHost = room.hostUserId === player.userId;
        if (wasHost || room.players.length === 0) {
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
