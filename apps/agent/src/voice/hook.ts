// POST /voice/hook: ElevenLabs post-call webhook (mounted only when VOICE_ENABLED=1). The recap sent to the user is a
// template (P4: T_VOICE_RECAP_*); ElevenLabs' summary/transcript text is never read, logged or forwarded. Owner B.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { env } from "../env";
import { errInfo, log } from "../log";
import { notify, tplKey } from "../notify/notify";
import { getParticipant } from "../repo/participants";
import { getPlan } from "../repo/plans";
import { isUuid } from "../repo/sql";
import { voiceVars } from "./call";

const TOLERANCE_S = 30 * 60; // our policy; the SDK's exact tolerance is UNVERIFIED (B plan U19)

/** Mounts POST /voice/hook → handleVoiceHook. */
export function mountVoiceHook(app: Hono): void {
  app.post("/voice/hook", handleVoiceHook);
}

/** ElevenLabs-Signature `t=<ts>,v0=<hex>`, v0 = HMAC_SHA256(secret, `${ts}.${rawBody}`), constant-time; ts older than 30 min → false. */
export function verifyElevenLabsSignature(rawBody: string, header: string | undefined, secret: string, nowS = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  const parts = new Map(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const ts = parts.get("t");
  const v0 = parts.get("v0");
  if (!ts || !/^\d+$/.test(ts) || !v0 || !/^[0-9a-f]+$/i.test(v0)) return false;
  if (nowS - Number(ts) > TOLERANCE_S || Number(ts) - nowS > TOLERANCE_S) return false;
  const want = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest();
  const got = Buffer.from(v0, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

// Only the fields we use; the `intent` path is UNVERIFIED (U19), so both a bare string and {value} are accepted.
const Intent = z.enum(["in", "out", "later"]);
const PostCall = z.looseObject({
  type: z.string(),
  data: z.looseObject({
    conversation_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    conversation_initiation_client_data: z
      .looseObject({ dynamic_variables: z.looseObject({ tab_plan_id: z.string(), tab_user_id: z.string() }) })
      .optional(),
    analysis: z
      .looseObject({ data_collection_results: z.looseObject({ intent: z.union([Intent, z.looseObject({ value: z.unknown() })]).optional() }).optional() })
      .optional(),
  }),
});

const RECAP = { in: "T_VOICE_RECAP_IN", out: "T_VOICE_RECAP_OUT", later: "T_VOICE_RECAP_LATER" } as const;

/** Verify → read the collected intent → template recap via notify (once per conversation) → 200. Anything unusable → 200, no message. */
export async function handleVoiceHook(c: Context): Promise<Response> {
  const raw = await c.req.text();
  if (!verifyElevenLabsSignature(raw, c.req.header("elevenlabs-signature"), env.ELEVENLABS_WEBHOOK_SECRET ?? "")) return c.body(null, 401);
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    return c.body(null, 400);
  }
  const ev = PostCall.safeParse(json);
  if (!ev.success || ev.data.type !== "post_call_transcription") return c.json({ ok: true });
  const d = ev.data.data;
  const vars = d.conversation_initiation_client_data?.dynamic_variables;
  const rawIntent = d.analysis?.data_collection_results?.intent;
  const intent = Intent.safeParse(typeof rawIntent === "object" && rawIntent ? rawIntent.value : rawIntent);
  if (!vars || !isUuid(vars.tab_plan_id) || !isUuid(vars.tab_user_id) || !intent.success) {
    log.warn({ conversation: d.conversation_id.slice(-6), has_vars: !!vars, has_intent: intent.success }, "voice hook: unusable payload");
    return c.json({ ok: true });
  }
  try {
    const [plan, participant] = await Promise.all([getPlan(vars.tab_plan_id), getParticipant(vars.tab_plan_id, vars.tab_user_id)]);
    if (!plan || !participant || plan.state !== "APPROVING") return c.json({ ok: true });
    const key = tplKey(plan.id, vars.tab_user_id, RECAP[intent.data], plan.version, d.conversation_id);
    if (intent.data === "out") await notify(vars.tab_user_id, "T_VOICE_RECAP_OUT", {}, { key, planId: plan.id });
    else {
      const v = await voiceVars(plan);
      if (v) await notify(vars.tab_user_id, RECAP[intent.data], v, { key, planId: plan.id });
    }
  } catch (e) {
    log.error({ ...errInfo(e), conversation: d.conversation_id.slice(-6) }, "voice hook failed");
    return c.body(null, 500); // ElevenLabs retries; notify is keyed per conversation so a retry sends once
  }
  return c.json({ ok: true });
}
