import pino from "pino";
import { env } from "./env";

// Defence in depth: callers must not log message text, bodies or budgets (PLAN P7), but if a field slips in
// under one of these names it is censored. Paths cover top level and one level of nesting.
const SENSITIVE = [
  "text", "message_text", "body", "budget_usd", "target_pp_cents", "hard_max_pp_cents",
  "phone_e164", "from_handle", "handle", "pay_url", "url", "token", "password", "parameters",
  "authorization", "Authorization", "apiKey", "api_key", "secret",
];
export const REDACT_PATHS = [...SENSITIVE, ...SENSITIVE.map((k) => `*.${k}`), "headers.authorization", "*.headers.authorization"];

export function createLogger(destination?: pino.DestinationStream): pino.Logger {
  const opts: pino.LoggerOptions = { level: env.LOG_LEVEL, base: { app: "tab-agent" }, redact: { paths: REDACT_PATHS, censor: "[redacted]" } };
  return destination ? pino(opts, destination) : pino(opts);
}

export const log = createLogger();

/** Error fields safe to log: driver/SDK error objects can carry query parameters, so never log the object itself. */
export const errInfo = (e: unknown): { err: string; code?: string } =>
  e instanceof Error ? { err: e.message, ...("code" in e && typeof e.code === "string" ? { code: e.code } : {}) } : { err: String(e) };
