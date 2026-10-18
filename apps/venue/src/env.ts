import { z } from "zod";

const schema = z.object({
  VENUE_PUBLIC_URL: z.url(),
  VENUE_PUBLIC_HOST: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  CYBS_MODE: z.enum(["live", "mock"]).default("mock"),
  CYBS_MERCHANT_ID: z.string().optional(),
  CYBS_KEY_ID: z.string().optional(),
  CYBS_SECRET_KEY: z.string().optional(),
  CYBS_RUN_ENV: z.string().default("apitest.cybersource.com"),
  TAP_KEY_DIRECTORY_JSON: z.string().min(2),
  AGENT_HOOK_URL: z.url(),
  VENUE_HOOK_SECRET: z.string().min(16),
  VENUE_OPS_KEY: z.string().min(16),
  PAY_LINK_TTL_MIN: z.coerce.number().int().positive().default(30),
}).refine(
  (e) => e.CYBS_MODE === "mock" || (e.CYBS_MERCHANT_ID && e.CYBS_KEY_ID && e.CYBS_SECRET_KEY),
  { message: "CYBS_MERCHANT_ID, CYBS_KEY_ID and CYBS_SECRET_KEY are required when CYBS_MODE=live" },
);

export type VenueEnv = z.infer<typeof schema>;

let cached: VenueEnv | undefined;

/** Lazy so `next build` and typecheck don't need runtime secrets. */
export function env(): VenueEnv {
  return (cached ??= schema.parse(process.env));
}
