import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { Server as SocketServer } from "socket.io";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

// ─── Room State ───────────────────────────────────────────────────────────────

const OFFLINE_GRACE_MS = 2 * 60 * 1000; // 2 minutes before a player is truly removed

interface Player {
  socketId: string;
  name:     string;
  online:   boolean;
  offlineTimer?: ReturnType<typeof setTimeout>;
}

interface AssignedRole {
  label: string;
  color: string;
}

interface Room {
  code:      string;
  hostId:    string;   // current socket.id of the host
  hostName:  string;   // name of the host (survives reconnect)
  players:   Player[];
  started:   boolean;
  roles:     Record<string, AssignedRole>; // player name → role
}

const rooms: Record<string, Room> = {};

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/** Return only online players — used for lobby display. */
function onlinePlayers(room: Room) {
  return room.players
    .filter((p) => p.online)
    .map((p) => ({ socketId: p.socketId, name: p.name }));
}

/** Full list including offline — used for the host dashboard. */
function allPlayers(room: Room) {
  return room.players.map((p) => ({
    socketId: p.socketId,
    name:     p.name,
    online:   p.online,
    roleLabel: room.roles[p.name]?.label ?? "",
    roleColor: room.roles[p.name]?.color ?? "#555555",
  }));
}

// ─── HTTP + Socket.io Server ──────────────────────────────────────────────────

const httpServer = createServer(app);

const io = new SocketServer(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  // Generous ping/pong so mobile browsers on WiFi don't disconnect
  pingTimeout:  60_000,
  pingInterval: 25_000,
});

io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "Client connected");

  // ── Create Room ────────────────────────────────────────────────────────────
  socket.on(
    "createRoom",
    (
      { name }: { name: string },
      callback: (res: { code: string; players: { socketId: string; name: string }[] } | { error: string }) => void,
    ) => {
      let code: string;
      let tries = 0;
      do { code = generateRoomCode(); tries++; } while (rooms[code] && tries < 200);
      if (rooms[code]) { callback({ error: "تعذر إنشاء غرفة جديدة، حاول مجدداً" }); return; }

      const room: Room = {
        code, hostId: socket.id, hostName: name,
        players: [{ socketId: socket.id, name, online: true }],
        started: false, roles: {},
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
      { code, name }: { code: string; name: string },
      callback: (res: { code: string; players: { socketId: string; name: string }[]; started: boolean } | { error: string }) => void,
    ) => {
      const room = rooms[code];
      if (!room) { callback({ error: "الغرفة غير موجودة، تحقق من الكود" }); return; }

      // Don't allow duplicate names (except if this is a reconnect — handled by reconnectRoom)
      const existing = room.players.find((p) => p.name === name);
      if (existing && existing.online) {
        callback({ error: "يوجد لاعب بهذا الاسم بالفعل" }); return;
      }

      if (!existing) {
        room.players.push({ socketId: socket.id, name, online: true });
      }

      socket.join(code);
      io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });

      logger.info({ code, name }, "Player joined room");
      callback({ code, players: onlinePlayers(room), started: room.started });
    },
  );

  // ── Reconnect Room ─────────────────────────────────────────────────────────
  socket.on(
    "reconnectRoom",
    (
      { code, name }: { code: string; name: string },
      callback: (res:
        | { code: string; players: { socketId: string; name: string }[]; started: false }
        | { code: string; started: true; isHost: true;  players: ReturnType<typeof allPlayers> }
        | { code: string; started: true; isHost: false; myRole: AssignedRole }
        | { error: string }
      ) => void,
    ) => {
      const room = rooms[code];
      if (!room) { callback({ error: "انتهت صلاحية الغرفة" }); return; }

      // Find the player entry by name
      const player = room.players.find((p) => p.name === name);
      if (!player) { callback({ error: "لم يُعثر على لاعب بهذا الاسم في الغرفة" }); return; }

      // Cancel pending removal timer
      if (player.offlineTimer) {
        clearTimeout(player.offlineTimer);
        player.offlineTimer = undefined;
      }

      // Rehydrate with new socket ID
      player.socketId = socket.id;
      player.online   = true;

      // If this player was the host, update the room's hostId
      if (room.hostName === name) room.hostId = socket.id;

      socket.join(code);

      // Notify everyone else the player is back
      io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });
      logger.info({ code, name }, "Player reconnected to room");

      // Return correct state depending on game phase
      if (!room.started) {
        callback({ code, players: onlinePlayers(room), started: false });
        return;
      }

      const isHost = room.hostName === name;
      if (isHost) {
        callback({ code, started: true, isHost: true, players: allPlayers(room) });
      } else {
        const myRole = room.roles[name] ?? { label: "قناع الشعب (المواطن)", color: "#555555" };
        callback({ code, started: true, isHost: false, myRole });
      }
    },
  );

  // ── Start Game ─────────────────────────────────────────────────────────────
  socket.on("startGame", ({ code }: { code: string }) => {
    const room = rooms[code];
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (room.players.filter((p) => p.online).length < 2) return;

    const roleDefs = [
      { label: "قناع الولد", sublabel: "الجلاد",  color: "#D32F2F" },
      { label: "قناع الأكة", sublabel: "الكاتم",  color: "#B71C1C" },
      { label: "قناع الشايب", sublabel: "الكاشف", color: "#FF8F00" },
      { label: "قناع البنت", sublabel: "الدرع",   color: "#1565C0" },
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

    // Each non-host player gets only their own role
    for (const ap of assigned) {
      if (ap.name === room.hostName) continue;
      io.to(ap.socketId).emit("gameStarted", {
        isHost: false, code, myRole: { label: ap.roleLabel, color: ap.roleColor },
      });
    }

    // Host gets the full list
    io.to(room.hostId).emit("gameStarted", {
      isHost: true, code, players: assigned,
    });

    logger.info({ code, playerCount: assigned.length }, "Game started — roles distributed");
  });

  // ── Disconnect (graceful — room survives for OFFLINE_GRACE_MS) ─────────────
  socket.on("disconnect", (reason) => {
    logger.info({ socketId: socket.id, reason }, "Client disconnected");

    for (const code of Object.keys(rooms)) {
      const room = rooms[code];
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) continue;

      player.online = false;

      // Tell everyone this player went offline
      io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });

      // Schedule actual removal after grace period
      player.offlineTimer = setTimeout(() => {
        // If they reconnected in the meantime, online will be true — skip
        if (player.online) return;

        room.players = room.players.filter((p) => p.name !== player.name);
        delete room.roles[player.name];

        const wasHost = room.hostName === player.name;

        if (wasHost || room.players.length === 0) {
          // Dissolve the room entirely
          delete rooms[code];
          io.to(code).emit("roomClosed");
          logger.info({ code, reason: wasHost ? "host timed out" : "empty room" }, "Room dissolved");
        } else {
          io.to(code).emit("playersUpdated", { players: onlinePlayers(room) });
          logger.info({ code, name: player.name }, "Player removed after grace period");
        }
      }, OFFLINE_GRACE_MS);

      logger.info({ code, name: player.name }, "Player marked offline — grace timer started");
      break;
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(port, () => {
  logger.info({ port }, "Server listening with Socket.io");
});
