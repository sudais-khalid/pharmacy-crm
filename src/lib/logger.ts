import pino from "pino";

/**
 * Structured JSON logs (one object per line) for the web server and the worker.
 * Secrets are redacted wherever they appear in logged objects.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { svc: process.env.LOG_SERVICE ?? "web" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ["password", "passwordHash", "token", "*.password", "*.passwordHash", "*.token", "headers.cookie", "headers.authorization", "req.headers.cookie", "req.headers.authorization"],
    censor: "[redacted]",
  },
});

export type Logger = typeof logger;
