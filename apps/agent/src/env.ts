// Agent config: PLAN §11 names, validated once at import. Modes default to mock so `pnpm dev` runs offline;
// each real mode makes the secrets it needs required, so a misconfigured deploy fails at boot, not mid-demo.
import * as z from "zod";

const secret32 = z.string().min(32);
const url = z.url();

/** DEMO_TEAM is PII (phones): parse failures must never echo the value, so JSON errors are replaced, not rethrown. */
const DemoTeam = z
  .string()
  .transform((s, ctx) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "must be a JSON array of {phone_e164, first_name}" });
      return z.NEVER;
    }
  })
  .pipe(z.array(z.strictObject({ phone_e164: z.e164(), first_name: z.string().trim().min(1).max(40) })).max(8));

const Env = z
  .object({
    NODE_ENV: z.string().default("development"),
    PORT: z.coerce.number().int().min(0).max(65535).default(8080),
    PUBLIC_BASE_URL: url.optional(),
    WEB_ORIGIN: url.default("http://localhost:3000"),
    DATABASE_URL: url,
    OWNER_DATABASE_URL: url.optional(), // migrations only (postgres role); local/CI, never on Fly or Vercel
    TEST_DATABASE_URL: url.optional(), // DB-gated tests; local/CI only

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
    AGENT_API_ALLOW_TEST_REF: z.stringbool().default(false), // 1 only while building the CREAO agents

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
    DEMO_TEAM: DemoTeam.default([]),
    DEMO_CODE: z.string().regex(/^\d{4}$/).default("4821"),
    TYPING_REFRESH_MS: z.coerce.number().int().min(1000).max(60_000).default(5000),
    VOICE_ENABLED: z.stringbool().default(false),
    ELEVENLABS_API_KEY: z.string().optional(),
    ELEVENLABS_AGENT_ID: z.string().optional(),
    ELEVENLABS_PHONE_NUMBER_ID: z.string().optional(),
    ELEVENLABS_WEBHOOK_SECRET: z.string().optional(),
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
    need(e.NODE_ENV === "production", ["PAYER_REF_SECRET"], "NODE_ENV=production");
    need(e.VOICE_ENABLED, ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "ELEVENLABS_PHONE_NUMBER_ID", "ELEVENLABS_WEBHOOK_SECRET"], "VOICE_ENABLED=1");
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
