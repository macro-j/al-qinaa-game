import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { corsOptions } from "./lib/corsOptions";
import { handleStripeWebhook } from "./routes/stripeWebhook";

const app: Express = express();

// CORS must run first so browser preflight (OPTIONS) succeeds before other middleware.
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// ── Stripe webhook ──────────────────────────────────────────────────────────
// MUST be registered BEFORE express.json(): signature verification needs the
// raw request body, not a parsed object. Fulfillment is server-side and
// signature-verified, so it cannot be faked by a client.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook,
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Always return JSON for unhandled errors (never an empty body).
app.use(
  (
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    const message =
      err instanceof Error ? err.message : "Internal Server Error";
    console.error("Unhandled api-server error:", err);
    if (!res.headersSent) {
      res
        .status(500)
        .type("application/json")
        .send(
          JSON.stringify({
            error: message || "Internal Server Error",
          }),
        );
    }
  },
);

export default app;
