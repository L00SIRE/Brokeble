// Voice stretch (B plan "Voice stretch", gated: default NO-GO). Registered only when VOICE_ENABLED=1.
// Voice collects intent only; money moves only on a text YES. The call never mentions amounts or other people. Owner B.
import { z } from "zod";
import type { DueJob } from "../dueJobs";
import { env } from "../env";
import { errInfo, log } from "../log";
import { fmtDeadline } from "../notify/render";
import { bundleTitle } from "../plan/decision";
import { getBundle } from "../repo/bundles";
import { listMembers } from "../repo/participants";
import { getPlan } from "../repo/plans";
import type { PlanRow } from "../repo/types";
import { getUser } from "../repo/users";

export const VOICE_NUDGE_KIND = "voice_nudge";
const OUTBOUND_URL = "https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call";
const CALL_TIMEOUT_MS = 15_000;

/** Public plan wording shared by the call's dynamic variables and the recap templates. */
export async function voiceVars(plan: PlanRow): Promise<{ title: string; deadline: string } | null> {
  if (!plan.deadlines.approve_at) return null;
  const bundle = plan.chosen_bundle_id ? await getBundle(plan.id, plan.version, plan.chosen_bundle_id) : null;
  return { title: bundle ? bundleTitle(bundle) : plan.title, deadline: fmtDeadline(plan.deadlines.approve_at) };
}

const OutboundResponse = z.looseObject({ success: z.boolean().optional(), conversation_id: z.string().nullish() });

/**
 * POST /v1/convai/sip-trunk/outbound-call (header xi-api-key) {agent_id, agent_phone_number_id, to_number,
 * conversation_initiation_client_data: {dynamic_variables}} → conversation_id. `tab_plan_id`/`tab_user_id` are opaque
 * uuids that come back on the post-call webhook so /voice/hook can find the member without storing call state.
 */
export async function startOutboundCall(
  toNumberE164: string,
  vars: { first_name: string; title: string; deadline: string; tab_plan_id: string; tab_user_id: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ conversationId: string | null }> {
  const { ELEVENLABS_API_KEY: key, ELEVENLABS_AGENT_ID: agent, ELEVENLABS_PHONE_NUMBER_ID: phone } = env;
  if (!key || !agent || !phone) throw new Error("voice: ElevenLabs env is not configured");
  const res = await fetchImpl(OUTBOUND_URL, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      agent_id: agent,
      agent_phone_number_id: phone,
      to_number: toNumberE164,
      conversation_initiation_client_data: { dynamic_variables: vars },
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!res.ok) throw Object.assign(new Error(`voice: outbound call HTTP ${res.status}`), { code: `HTTP_${res.status}` });
  const body = OutboundResponse.safeParse(await res.json().catch(() => null));
  if (body.success && body.data.success === false) throw Object.assign(new Error("voice: outbound call refused"), { code: "REFUSED" });
  return { conversationId: body.success ? (body.data.conversation_id ?? null) : null };
}

/**
 * due_jobs `voice_nudge` (key voice:<planId>:<v>, payload {version}): still APPROVING at v and exactly one member left
 * who has a link but no hold → call that member. GATED members never said YES to their share, so they are never called.
 * One call per plan version (the job key); a failed call is logged and not retried (the text reping still goes out).
 */
export async function voiceNudgeJob(job: DueJob): Promise<void> {
  const version = z.object({ version: z.number().int() }).parse(job.payload).version;
  if (!job.plan_id) throw new Error("voice_nudge job without plan_id");
  const plan = await getPlan(job.plan_id);
  if (!plan || plan.state !== "APPROVING" || plan.version !== version) return;
  const members = await listMembers(plan.id);
  const open = members.filter((m) => m.stage !== "HELD" && m.stage !== "CAPTURED");
  if (open.length !== 1 || open[0]!.stage !== "LINK_SENT") return;
  const [user, vars] = await Promise.all([getUser(open[0]!.user_id), voiceVars(plan)]);
  if (!user || !vars) return;
  try {
    const { conversationId } = await startOutboundCall(user.phone_e164, {
      first_name: user.first_name,
      ...vars,
      tab_plan_id: plan.id,
      tab_user_id: user.id,
    });
    log.info({ plan_id: plan.id, conversation: conversationId?.slice(-6) ?? null }, "voice nudge placed");
  } catch (e) {
    log.warn({ ...errInfo(e), plan_id: plan.id }, "voice nudge failed");
  }
}
