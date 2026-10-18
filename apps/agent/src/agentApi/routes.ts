// /agent/* for the `tab` CLI inside CREAO runs (PLAN §8 table, B plan T2). Bearer TAB_AGENT_TOKEN (constant time),
// active-run check, 256 KiB body limit, no CORS. Logs never carry headers or bodies. Owner B.
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AgentProgress, Category, Itinerary, PlanRef, ScoutSubmission, type ValidationResult } from "@tab/shared";
import { hasKey } from "../auth";
import { B_JOB_KINDS, bJobKeys } from "../creao/jobs";
import { deliverItinerary, itineraryBookingErrors } from "../creao/concierge";
import { normArea } from "../decide/compose";
import { enqueue } from "../dueJobs";
import { env } from "../env";
import { emit } from "../events";
import { log } from "../log";
import * as optionsRepo from "../repo/options";
import * as researchRuns from "../repo/researchRuns";
import type { PlanRow, ResearchRunKind, ResearchRunRow } from "../repo/types";

/** Accepted only when AGENT_API_ALLOW_TEST_REF === true: validate runs normally, submit/progress succeed but persist nothing. */
export const TEST_PLAN_REF = "00000000-0000-4000-8000-000000000000";
export const MAX_PROGRESS_PER_RUN = 60;
export const BODY_LIMIT_BYTES = 256 * 1024;
const ACTIVE_RUN_MAX_AGE_MIN = 20;

/** Mounts GET /agent/ping and POST /agent/{progress, options/validate, options, itinerary}. */
export function mountAgentApi(app: Hono): void {
  app.use("/agent/*", bodyLimit({ maxSize: BODY_LIMIT_BYTES, onError: (c) => c.json({ ok: false, error: "too_large" }, 413) }));
  app.get("/agent/ping", handlePing);
  app.post("/agent/progress", handleProgress);
  app.post("/agent/options/validate", handleValidate);
  app.post("/agent/options", handleSubmitOptions);
  app.post("/agent/itinerary", handleSubmitItinerary);
}

/** True iff Authorization is Bearer TAB_AGENT_TOKEN (auth.ts hasKey; false when the token is unset). */
export function isAgentAuthorized(c: Context): boolean {
  return hasKey(c, env.TAB_AGENT_TOKEN);
}

export type ActiveRun = { run: ResearchRunRow; plan: PlanRow } | { test: true };

const RUN_KINDS: Record<"scout" | "concierge", readonly ResearchRunKind[]> = {
  scout: ["scout", "scout_live_demo"],
  concierge: ["concierge"],
};

/**
 * findActiveRun(planRef, runKind "scout" ⇒ [scout, scout_live_demo] | "concierge" ⇒ [concierge], scout ⇒ category, 20 min);
 * TEST_PLAN_REF with the flag ⇒ {test:true}; else null (→ 403).
 */
export async function authorizeRun(planRef: string, runKind: "scout" | "concierge", category: Category | null): Promise<ActiveRun | null> {
  if (env.AGENT_API_ALLOW_TEST_REF && planRef === TEST_PLAN_REF) return { test: true };
  if (!PlanRef.safeParse(planRef).success) return null; // a malformed uuid would otherwise reach the DB cast
  return researchRuns.findActiveRun(planRef, RUN_KINDS[runKind], runKind === "scout" ? category : null, ACTIVE_RUN_MAX_AGE_MIN);
}

/** Removes /[\u0000-\u001f\u007f]/g. */
export function stripControl(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, "");
}

/** Pitch for storage: URLs and control chars stripped, ≤140 chars. */
export function sanitizeScoutPitch(s: string): string {
  const noUrls = s.replace(/(?:https?:\/\/|www\.)\S+/gi, "");
  return stripControl(noUrls.replace(/[\t\n\r]+/g, " "))
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 140)
    .trimEnd();
}

const isHttpUrl = (u: string): boolean => /^https?:\/\//i.test(u);
const URL_FIELDS = ["url", "price_evidence_url", "hours_evidence_url", "showtime_evidence_url"] as const;
const dupKey = (o: { name: string; address: string }) => `${o.name}|${o.address}`.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * ScoutSubmission.safeParse + business checks: every option.category === body.category (=== run category when known),
 * normArea(option.area) === normArea(planArea), est_high ≥ est_low, no duplicate name|address. Errors as
 * {path: issue.path.join("."), message} (e.g. "options.3.area"). `submission` is the sanitized value when ok.
 */
export function validateSubmission(
  body: unknown,
  ctx: { planArea: string | null; runCategory: Category | null },
): { result: ValidationResult; submission: ScoutSubmission | null } {
  const parsed = ScoutSubmission.safeParse(body);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return { result: { ok: false, errors }, submission: null };
  }
  const sub = parsed.data;
  const errors: ValidationResult["errors"] = [];
  const add = (path: string, message: string) => errors.push({ path, message });

  if (ctx.runCategory && sub.category !== ctx.runCategory) add("category", `must be "${ctx.runCategory}" for this run`);
  const want = ctx.planArea === null ? null : normArea(ctx.planArea);
  const seen = new Map<string, number>();
  const options = sub.options.map((o, i) => {
    const at = `options.${i}`;
    if (o.category !== sub.category) add(`${at}.category`, `must equal the submission category "${sub.category}"`);
    if (want !== null && normArea(o.area) !== want) add(`${at}.area`, `must be "${ctx.planArea}"`);
    for (const f of URL_FIELDS) {
      const v = (o as Record<string, unknown>)[f];
      if (typeof v === "string" && !isHttpUrl(v)) add(`${at}.${f}`, "must be an http(s) URL");
    }
    const k = dupKey(o);
    const first = seen.get(k);
    if (first !== undefined) add(`${at}.name`, `duplicate of options.${first} (same name and address)`);
    else seen.set(k, i);
    const pitch = sanitizeScoutPitch(o.pitch);
    if (!pitch) add(`${at}.pitch`, "must contain text other than URLs");
    return { ...o, pitch };
  });
  if (errors.length) return { result: { ok: false, errors }, submission: null };
  return { result: { ok: true, errors: [] }, submission: { ...sub, options } };
}

// ---------- handlers ----------
const fail = (c: Context, status: 400 | 401 | 403 | 429, error: string) => c.json({ ok: false, error }, status);
const unauthorized = (c: Context) => fail(c, 401, "unauthorized");
const noActiveRun = (c: Context) => fail(c, 403, "no_active_run");

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

const field = (body: unknown, key: string): unknown =>
  typeof body === "object" && body !== null ? (body as Record<string, unknown>)[key] : undefined;
const planRefOf = (body: unknown): string => {
  const v = field(body, "plan_ref");
  return typeof v === "string" ? v : "";
};
const categoryOf = (body: unknown): Category | null => {
  const r = Category.safeParse(field(body, "category"));
  return r.success ? r.data : null;
};

const invalid = (message: string): ValidationResult => ({ ok: false, errors: [{ path: "", message }] });

/** 200 {ok:true}; auth only, no run check. */
export async function handlePing(c: Context): Promise<Response> {
  if (!isAgentAuthorized(c)) return unauthorized(c);
  log.info({}, "agent.ping");
  return c.json({ ok: true });
}

const progressCount = new Map<string, number>(); // per research_run id; single machine, resets on deploy

/** 401/403; AgentProgress.parse; stripControl(step); >60 per run → 429; emit creao.progress → 202 {ok:true}. */
export async function handleProgress(c: Context): Promise<Response> {
  if (!isAgentAuthorized(c)) return unauthorized(c);
  const p = AgentProgress.safeParse(await readJson(c));
  if (!p.success) return fail(c, 400, "invalid_body");
  const step = stripControl(p.data.step).trim();
  if (!step) return fail(c, 400, "invalid_body");
  const active = await authorizeRun(p.data.plan_ref, p.data.run_kind, p.data.category);
  if (!active) return noActiveRun(c);
  if ("test" in active) return c.json({ ok: true }, 202);
  const n = (progressCount.get(active.run.id) ?? 0) + 1;
  if (n > MAX_PROGRESS_PER_RUN) return fail(c, 429, "rate_limited");
  progressCount.set(active.run.id, n);
  await emit({ type: "creao.progress", run_id: active.run.creao_run_id, kind: active.run.kind, category: active.run.category, step });
  return c.json({ ok: true }, 202);
}

/** Shared by validate and submit: auth, JSON, active run, then validation against the run's category and the plan's area. */
async function checkSubmission(c: Context) {
  if (!isAgentAuthorized(c)) return { response: unauthorized(c) } as const;
  const body = await readJson(c);
  if (body === undefined) return { response: c.json(invalid("body must be JSON"), 422) } as const;
  const active = PlanRef.safeParse(planRefOf(body)).success ? await authorizeRun(planRefOf(body), "scout", categoryOf(body)) : undefined;
  if (active === null) return { response: noActiveRun(c) } as const;
  // A malformed plan_ref gets zod's own error below, never a 403: the token already proves the caller is the CLI.
  const { result, submission } = validateSubmission(body, {
    planArea: active && !("test" in active) ? active.plan.area : null,
    runCategory: active && !("test" in active) ? active.run.category : null,
  });
  return { active, result, submission } as const;
}

/** 200 ValidationResult (zod is the single source of truth). */
export async function handleValidate(c: Context): Promise<Response> {
  const r = await checkSubmission(c);
  return r.response ?? c.json(r.result);
}

/**
 * Invalid → 422 ValidationResult. scout_live_demo run → mergeRunResult({submission}) only. Else upsertOptions →
 * enqueue check_research_ready (bJobKeys.checkResearchReady) → 201 {ok:true, accepted:n}.
 */
export async function handleSubmitOptions(c: Context): Promise<Response> {
  const r = await checkSubmission(c);
  if (r.response) return r.response;
  if (!r.submission || !r.active) return c.json(r.result, 422); // no active run means zod failed on plan_ref
  const accepted = r.submission.options.length;
  if ("test" in r.active) return c.json({ ok: true, accepted }, 201);
  const { run, plan } = r.active;
  if (run.kind === "scout_live_demo") {
    await researchRuns.mergeRunResult(run.id, { submission: r.submission });
  } else {
    await optionsRepo.upsertOptions(plan.id, run.id, r.submission.options);
    await enqueue(B_JOB_KINDS.checkResearchReady, bJobKeys.checkResearchReady(plan.id, run.id), new Date(), { research_run_id: run.id }, { planId: plan.id });
  }
  log.info({ run_id: run.id, kind: run.kind, accepted }, "agent.options");
  return c.json({ ok: true, accepted }, 201);
}

const baseUrl = (c: Context): string => (env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin).replace(/\/+$/, "");

/** Itinerary.safeParse + ics has BEGIN:VEVENT and END:VCALENDAR → deliverItinerary → 201 {ok:true, itinerary_url, ics_url}. */
export async function handleSubmitItinerary(c: Context): Promise<Response> {
  if (!isAgentAuthorized(c)) return unauthorized(c);
  const body = await readJson(c);
  if (body === undefined) return c.json(invalid("body must be JSON"), 422);
  const parsed = Itinerary.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 422);
  }
  const it = parsed.data;
  const errors: ValidationResult["errors"] = [];
  if (!it.ics.includes("BEGIN:VEVENT")) errors.push({ path: "ics", message: "must contain at least one BEGIN:VEVENT" });
  if (!/END:VCALENDAR\s*$/.test(it.ics)) errors.push({ path: "ics", message: "must end with END:VCALENDAR" });
  if (it.notion_url !== null && !isHttpUrl(it.notion_url)) errors.push({ path: "notion_url", message: "must be an http(s) URL" });
  if (errors.length) return c.json({ ok: false, errors }, 422);

  const active = await authorizeRun(it.plan_ref, "concierge", null);
  if (!active) return noActiveRun(c);
  if (!("test" in active)) {
    // Members get this calendar for what they booked and paid for: stops must be the chosen bundle's venues.
    const booking = await itineraryBookingErrors(active.plan, it);
    if (booking.length) return c.json({ ok: false, errors: booking }, 422);
    await deliverItinerary(active.plan.id, active.run.id, it);
  }
  const base = baseUrl(c);
  return c.json({ ok: true, itinerary_url: `${base}/p/${it.plan_ref}/itinerary`, ics_url: `${base}/p/${it.plan_ref}/plan.ics` }, 201);
}
