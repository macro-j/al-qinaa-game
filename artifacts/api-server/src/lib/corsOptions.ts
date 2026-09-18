import type { CorsOptions } from "cors";

const LOCAL_DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

const DEFAULT_PRODUCTION_ORIGINS = ["https://al-qinaa-game.onrender.com"];

const configuredProductionOrigins =
  process.env.CORS_ORIGIN?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];

const productionOrigins = Array.from(
  new Set([...DEFAULT_PRODUCTION_ORIGINS, ...configuredProductionOrigins]),
);

/** Shared CORS config for Express and Socket.io. */
export const corsOptions: CorsOptions = {
  origin: process.env.NODE_ENV === "production" ? productionOrigins : true,
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  exposedHeaders: ["Content-Type"],
  maxAge: 86_400,
};

export { LOCAL_DEV_ORIGINS };
