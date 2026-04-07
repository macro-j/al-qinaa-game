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
