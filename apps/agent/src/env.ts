// Agent config: PLAN §11 names, validated once at import. Modes default to mock so `pnpm dev` runs offline;
// each real mode makes the secrets it needs required, so a misconfigured deploy fails at boot, not mid-demo.
import * as z from "zod";

const secret32 = z.string().min(32);
const url = z.url();

const Env = z
  .object({
    NODE_ENV: z.string().default("development"),
    PORT: z.coerce.number().int().min(0).max(65535).default(8080),
    PUBLIC_BASE_URL: url.optional(),
    WEB_ORIGIN: url.default("http://localhost:3000"),
    DATABASE_URL: url,

    MESSAGING_MODE: z.enum(["photon", "mock"]).default("mock"),
    PHOTON_API_KEY: z.string().startsWith("pho_sk_").optional(),
    PHOTON_PROJECT_ID: z.string().startsWith("pho_prj_").optional(),
    PHOTON_API_VERSION: z.string().default("2026-07-01"),

    LLM_MODE: z.enum(["anthropic", "mock"]).default("mock"),
    ANTHROPIC_API_KEY: z.string().optional(),

    PLANNER_MODE: z.enum(["live", "cached", "mock"]).default("mock"),
    CREAO_API_KEY: z.string().startsWith("capi_").optional(),
    CREAO_SCOUT_APP_ID: z.string().optional(),
    CREAO_CONCIERGE_APP_ID: z.string().optional(),
    CREAO_HOOK_SECRET: secret32.optional(),
    TAB_AGENT_TOKEN: secret32.optional(),

    VENUE_MODE: z.enum(["live", "mock"]).default("mock"),
    VENUE_BASE_URL: url.optional(),
    TAP_KEY_ID: z.string().optional(),
    TAP_PRIVATE_KEY_PEM_B64: z.string().optional(),
    VENUE_HOOK_SECRET: z.string().min(16).optional(),
    VENUE_OPS_KEY: z.string().min(16).optional(),

    PAYER_REF_SECRET: z.string().min(16).optional(),
    CONSOLE_KEY: z.string().min(16).optional(),
    OPERATOR_KEY: z.string().min(16).optional(),
    DEMO_TIMERS: z.stringbool().default(false),
    NOTION_TOKEN: z.string().optional(),
    NOTION_PARENT_PAGE_ID: z.string().optional(),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  })
  .superRefine((e, ctx) => {
    const need = (when: boolean, keys: (keyof typeof e)[], why: string) => {
      if (!when) return;
      for (const k of keys) if (e[k] === undefined) ctx.addIssue({ code: "custom", path: [k], message: `required when ${why}` });
    };
    need(e.MESSAGING_MODE === "photon", ["PHOTON_API_KEY", "PHOTON_PROJECT_ID"], "MESSAGING_MODE=photon");
    need(e.LLM_MODE === "anthropic", ["ANTHROPIC_API_KEY"], "LLM_MODE=anthropic");
    need(e.PLANNER_MODE === "live", ["CREAO_API_KEY", "CREAO_SCOUT_APP_ID", "CREAO_CONCIERGE_APP_ID", "CREAO_HOOK_SECRET"], "PLANNER_MODE=live");
    need(e.VENUE_MODE === "live", ["VENUE_BASE_URL", "TAP_KEY_ID", "TAP_PRIVATE_KEY_PEM_B64", "VENUE_HOOK_SECRET", "VENUE_OPS_KEY"], "VENUE_MODE=live");
  });

export type Env = z.infer<typeof Env>;

/** Blank values (`KEY=` copied from .env.example) count as unset. Errors name keys only, never values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const r = Env.safeParse(cleaned);
  if (!r.success) throw new Error(`Invalid agent environment:\n${z.prettifyError(r.error)}`);
  return r.data;
}

export const env: Env = parseEnv(process.env);
export const isDevRuntime = env.NODE_ENV !== "production";
