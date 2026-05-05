// ─────────────────────────────────────────────────────────────
// utils/logger.ts — Structured Winston logger
// ─────────────────────────────────────────────────────────────
import winston from "winston";
import { config } from "./config.js";

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp: ts, agent, ...meta }) => {
  const agentTag = agent ? ` [${agent}]` : "";
  const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : "";
  return `${ts}${agentTag} ${level}: ${message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: config.logging.level,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: "HH:mm:ss" }),
    colorize(),
    logFormat
  ),
  transports: [new winston.transports.Console()],
});

/** Create a child logger scoped to a specific agent */
export function agentLogger(agentName: string) {
  return logger.child({ agent: agentName });
}
