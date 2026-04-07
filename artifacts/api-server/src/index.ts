import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { Server as SocketServer } from "socket.io";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ─── Room State ───────────────────────────────────────────────────────────────

interface Player {
  socketId: string;
  name: string;
}

interface Room {
  code: string;
  hostId: string;
  players: Player[];
}

const rooms: Record<string, Room> = {};

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// ─── HTTP + Socket.io Server ──────────────────────────────────────────────────

const httpServer = createServer(app);

const io = new SocketServer(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "Client connected");

  // Host creates a room
  socket.on(
    "createRoom",
    (
      { name }: { name: string },
      callback: (res: { code: string; players: Player[] } | { error: string }) => void,
    ) => {
      let code: string;
      let tries = 0;
      do {
        code = generateRoomCode();
        tries++;
      } while (rooms[code] && tries < 200);

      if (rooms[code]) {
        callback({ error: "تعذر إنشاء غرفة جديدة، حاول مجدداً" });
        return;
      }

      const room: Room = {
        code,
        hostId: socket.id,
        players: [{ socketId: socket.id, name }],
      };
      rooms[code] = room;
      socket.join(code);

      logger.info({ code, host: name }, "Room created");
      callback({ code, players: room.players });
    },
  );

  // Player joins an existing room
  socket.on(
    "joinRoom",
    (
      { code, name }: { code: string; name: string },
      callback: (res: { code: string; players: Player[] } | { error: string }) => void,
    ) => {
      const room = rooms[code];
      if (!room) {
        callback({ error: "الغرفة غير موجودة، تحقق من الكود" });
        return;
      }

      const player: Player = { socketId: socket.id, name };
      room.players.push(player);
      socket.join(code);

      // Broadcast updated list to everyone in the room
      io.to(code).emit("playersUpdated", { players: room.players });

      logger.info({ code, name }, "Player joined room");
      callback({ code, players: room.players });
    },
  );

  // Host starts the game — server distributes roles securely
  socket.on("startGame", ({ code }: { code: string }) => {
    const room = rooms[code];
    if (!room) return;
    if (room.hostId !== socket.id) return; // only host can start
    if (room.players.length < 2) return;

    const roleDefs = [
      { label: "قناع الولد", sublabel: "الجلاد",    color: "#D32F2F" },
      { label: "قناع الأكة", sublabel: "الكاتم",    color: "#B71C1C" },
      { label: "قناع الشايب", sublabel: "الكاشف",   color: "#FF8F00" },
      { label: "قناع البنت", sublabel: "الدرع",     color: "#1565C0" },
    ];

    // Shuffle all players and assign roles
    const shuffled = [...room.players].sort(() => Math.random() - 0.5);
    const assigned = shuffled.map((p, i) => {
      const def =
        i < roleDefs.length
          ? roleDefs[i]
          : { label: "قناع الشعب", sublabel: "المواطن", color: "#555555" };
      return {
        socketId: p.socketId,
        name: p.name,
        roleLabel: `${def.label} (${def.sublabel})`,
        roleColor: def.color,
      };
    });

    // Each non-host player receives ONLY their own role (security)
    for (const ap of assigned) {
      if (ap.socketId === room.hostId) continue;
      io.to(ap.socketId).emit("gameStarted", {
        isHost: false,
        code,
        myRole: { label: ap.roleLabel, color: ap.roleColor },
      });
    }

    // Host receives the full assignment list for the narrator dashboard
    io.to(room.hostId).emit("gameStarted", {
      isHost: true,
      code,
      players: assigned,
    });

    logger.info({ code, playerCount: assigned.length }, "Game started — roles distributed");
  });

  // Clean up on disconnect
  socket.on("disconnect", () => {
    for (const code of Object.keys(rooms)) {
      const room = rooms[code];
      const idx = room.players.findIndex((p) => p.socketId === socket.id);
      if (idx === -1) continue;

      const wasHost = room.hostId === socket.id;
      room.players.splice(idx, 1);

      if (wasHost || room.players.length === 0) {
        delete rooms[code];
        io.to(code).emit("roomClosed");
        logger.info({ code }, "Room dissolved");
      } else {
        io.to(code).emit("playersUpdated", { players: room.players });
        logger.info({ code, socketId: socket.id }, "Player left room");
      }
      break;
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(port, () => {
  logger.info({ port }, "Server listening with Socket.io");
});
