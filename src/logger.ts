/**
 * Shared pino logger for non-Probot paths (CLI, queue internals, LLM).
 * Prefer context.log inside Probot handlers so request IDs stay correlated.
 */
import pino from "pino";

export const logger = pino({
  name: "specsync",
  level: process.env.LOG_LEVEL || "info",
});

export type SpecSyncLogger = typeof logger;
