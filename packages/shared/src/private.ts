// P1: privacy-restricted contract. Import "@tab/shared/private" ONLY from the allowlist in PLAN §4
// (src/delegates/**, src/decide/filter.ts, src/decide/score.ts, src/money/holdGate.ts, src/repo/privateConstraints.ts).
import * as z from "zod";
import { IsoDateTime } from "./index";

export const PrivateConstraints = z.strictObject({
  plan_id: z.uuid(),
  user_id: z.uuid(),
  target_pp_cents: z.number().int().min(500).max(100000),
  hard_max_pp_cents: z.number().int().min(500).max(100000).nullable(),
  source: z.enum(["dm", "tier", "form"]),
  confidence: z.enum(["high", "low"]),
  confirmed_at: IsoDateTime.nullable(),
});
export type PrivateConstraints = z.infer<typeof PrivateConstraints>;
