// Tab Concierge after CONFIRMED (B plan T11). Inputs carry the chosen bundle only, never person data. Owner B.
import { ConciergeInput, Itinerary, type Bundle, type CreaoRun } from "@tab/shared";
import { enqueue } from "../dueJobs";
import { env } from "../env";
import { emit } from "../events";
import { errInfo, log } from "../log";
import { tplKey, notify } from "../notify/notify";
import { ports } from "../ports";
import { getBundle } from "../repo/bundles";
import { listMembers } from "../repo/participants";
import { getPlan } from "../repo/plans";
import * as researchRuns from "../repo/researchRuns";
import type { PlanRow, ResearchRunRow } from "../repo/types";
import { conciergeIdempotencyKey } from "./client";
import { createNotionPage } from "./notionFallback";
import { buildIcs } from "./ics";
import { B_JOB_KINDS, CONCIERGE_TIMEOUT_MS, POLL_INTERVAL_MS, bJobKeys } from "./jobs";

const info = (msg: string) => emit({ type: "system", level: "info", msg }).then(() => {}, (err) => log.warn(errInfo(err), "emit failed"));

async function chosenBundle(plan: PlanRow): Promise<Bundle | null> {
  return plan.chosen_bundle_id ? getBundle(plan.id, plan.version, plan.chosen_bundle_id) : null;
}

/**
 * A → B hook, called by confirm()'s winner. buildConciergeInput(plan, chosen bundle, member count) → insertResearchRun
 * (concierge) → startConcierge → schedule creao_poll + creao_timeout (10 min). Cap: 1 per plan. Never throws for CREAO errors.
 */
export async function startConciergeFor(planId: string): Promise<void> {
  const plan = await getPlan(planId);
  if (!plan) return;
  const bundle = await chosenBundle(plan);
  if (!bundle) {
    log.warn({ plan_id: planId }, "concierge: no chosen bundle");
    return;
  }
  const members = await listMembers(planId);
  const input = buildConciergeInput(plan, bundle, members.length);

  // Row first: the unique key makes a retried hook return the same row instead of a second run.
  const row = await researchRuns.insertResearchRun({
    plan_id: planId,
    kind: "concierge",
    category: null,
    idempotency_key: conciergeIdempotencyKey(plan.ref),
  });
  if (row.creao_run_id || row.status !== "pending") return;

  try {
    const { runId } = await ports.planner.startConcierge(input);
    await researchRuns.setCreaoRunId(row.id, runId, null);
  } catch (err) {
    log.warn({ plan_id: planId, ...errInfo(err) }, "concierge: start failed, using code fallback");
    if (await researchRuns.finishRun(row.id, "failed")) await conciergeFallback(planId);
    return;
  }
  const opts = { planId };
  await enqueue(B_JOB_KINDS.creaoPoll, bJobKeys.creaoPoll(row.id, 1), new Date(Date.now() + POLL_INTERVAL_MS), { research_run_id: row.id, n: 1 }, opts);
  await enqueue(B_JOB_KINDS.creaoTimeout, bJobKeys.creaoTimeout(row.id), new Date(Date.now() + CONCIERGE_TIMEOUT_MS), { research_run_id: row.id }, opts);
}

/** ConciergeInput.parse({plan_ref: plan.ref, itinerary: {date, area, party_size, dinner {name, address, time}, show {…}}}). */
export function buildConciergeInput(plan: PlanRow, bundle: Bundle, partySize: number): ConciergeInput {
  return ConciergeInput.parse({
    plan_ref: plan.ref,
    itinerary: {
      date: plan.event_date,
      area: plan.area,
      party_size: partySize,
      dinner: { name: bundle.dinner.data.name, address: bundle.dinner.data.address, time: bundle.dinner_time },
      show: { name: bundle.show.data.name, address: bundle.show.data.address, time: bundle.show_start },
    },
  });
}

/** Completed run without a CLI-submitted itinerary: artifact titled itinerary.json → downloadArtifact → Itinerary.safeParse; else conciergeFallback. */
export async function onConciergeCompleted(row: ResearchRunRow, run: CreaoRun): Promise<void> {
  const [fresh, plan] = await Promise.all([researchRuns.getResearchRun(row.id), getPlan(row.plan_id)]);
  if (!plan || fresh?.result?.itinerary) return; // delivered through the CLI
  const artifact = run.result?.artifacts?.find((a) => a.title.toLowerCase() === "itinerary.json");
  if (artifact && run.id) {
    try {
      const bytes = await ports.planner.downloadArtifact(run.id, artifact.id);
      const parsed = Itinerary.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
      if (parsed.success && parsed.data.plan_ref === plan.ref && parsed.data.ics.includes("BEGIN:VEVENT")) {
        await deliverItinerary(plan.id, row.id, parsed.data);
        return;
      }
      log.warn({ plan_id: plan.id }, "concierge: itinerary.json artifact invalid");
    } catch (err) {
      log.warn({ plan_id: plan.id, ...errInfo(err) }, "concierge: itinerary.json artifact unreadable");
    }
  }
  await conciergeFallback(plan.id);
}

/** Code-built Itinerary (fixed logistics strings, buildIcs, createNotionPage or null) → deliverItinerary. */
export async function conciergeFallback(planId: string): Promise<void> {
  const plan = await getPlan(planId);
  if (!plan) return;
  const run = (await researchRuns.listRunsForPlan(planId, { kind: "concierge" })).at(-1);
  if (!run || run.result?.itinerary) return; // never overwrite a CLI-submitted itinerary
  const bundle = await chosenBundle(plan);
  if (!bundle) {
    log.warn({ plan_id: planId }, "concierge fallback: no chosen bundle");
    return;
  }
  const dinner = bundle.dinner.data;
  const show = bundle.show.data;
  const stops: Itinerary["stops"] = [
    { kind: "dinner", name: dinner.name, address: dinner.address, time: bundle.dinner_time, notes: dinner.pitch },
    { kind: "show", name: show.name, address: show.address, time: bundle.show_start, notes: show.pitch },
  ];
  const title = `Dinner at ${dinner.name} → Show at ${show.name}`.slice(0, 120);
  const notion_url = await createNotionPage({ title, date: plan.event_date, stops });
  const itinerary = Itinerary.parse({
    plan_ref: plan.ref,
    title,
    date: plan.event_date,
    stops,
    logistics: {
      getting_there: "See each venue's website for directions.",
      parking: "Check each venue's website for parking options.",
      doors: "Check the show's website for the doors time.",
      dress_code: "Check each venue's website for any dress code.",
      know_before: ["Bring a photo ID.", "Check each venue's website for bag and entry policies."],
    },
    ics: buildIcs(plan.ref, plan.event_date, stops),
    notion_url,
  });
  await info("Concierge: itinerary built from code");
  await deliverItinerary(planId, run.id, itinerary);
}

/**
 * Stores the itinerary in the concierge run's result.itinerary (mergeRunResult), then for each participant
 * notify(userId, "T_ITINERARY", {itinerary_url, ics_url}, {planId, key: tplKey(planId, userId, "T_ITINERARY", version)}),
 * so each user gets it once whichever path delivered it. URLs: `${PUBLIC_BASE_URL}/p/${ref}/itinerary` and `/plan.ics`.
 */
export async function deliverItinerary(planId: string, researchRunId: string, itinerary: Itinerary): Promise<void> {
  const plan = await getPlan(planId);
  if (!plan) return;
  await researchRuns.mergeRunResult(researchRunId, { itinerary });
  const base = `${(env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, "")}/p/${plan.ref}`;
  const vars = { itinerary_url: `${base}/itinerary`, ics_url: `${base}/plan.ics` };
  const members = await listMembers(planId);
  const results = await Promise.allSettled(
    members.map((m) => notify(m.user_id, "T_ITINERARY", vars, { planId, key: tplKey(planId, m.user_id, "T_ITINERARY", plan.version) })),
  );
  for (const r of results) if (r.status === "rejected") log.warn({ plan_id: planId, ...errInfo(r.reason) }, "concierge: itinerary notify failed");
  await info("itinerary delivered");
}
