// Creates a plan with its organizer already seated as a participant (ux-flow §7.1). Callers: POST /plans (join/routes.ts)
// and start-by-chat (plan/startByChat.ts). The organizer's Photon seat must already exist (/start or POST /plans). Owner A.
import { randomInt } from "node:crypto";
import type { HHMM, IsoDate } from "@tab/shared";
import { sql } from "../db";
import { jobs } from "../dueJobs";
import { env } from "../env";
import { emit } from "../events";
import { A_JOB_KINDS, aJobKeys } from "../jobs/kinds";
import { errInfo, log } from "../log";
import { upsertParticipant, updateStage } from "../repo/participants";
import { insertPlan } from "../repo/plans";
import type { PlanRow, UserRow } from "../repo/types";
import { joinUrlFor } from "./preview";

const MINUTE = 60_000;
const ORG_JOIN_STATUS_DELAY_MS = (env.DEMO_TIMERS ? 3 : 20) * MINUTE;
const MAX_CODE_ATTEMPTS = 10;

export type PlanFields = { title: string; area: string; date: IsoDate; time_start: HHMM; time_end: HHMM; party_target: number };

const isUniqueViolation = (e: unknown): boolean => typeof e === "object" && e !== null && "code" in e && e.code === "23505";

/**
 * In order: allocate a random 4-digit code (skips DEMO_CODE, retries 23505 up to 10×) → insertPlan → upsertParticipant
 * for the organizer → (JOINED only) stage JOINED. Events: one `plan.state` NEW→COLLECTING, then one `lane` with the
 * final stage. Those steps share one transaction per attempt, so a plan never exists without its organizer. Then enqueue org_join_status (failure only
 * loses the nudge) and return the plan and its join_url.
 *
 * organizerStage: startByChat passes JOINED (it sends T_BUDGET_ASK in the same turn); POST /plans passes INVITED, so
 * the organizer's first text goes through the forgiving join (welcome + budget ask) instead of being read as a budget.
 * The JOINED write is the same updateStage + `lane` emit that membership.setStage does, inside this transaction.
 */
export async function createPlanRecord(
  organizer: UserRow,
  f: PlanFields,
  o: { organizerStage: "INVITED" | "JOINED" },
): Promise<{ plan: PlanRow; join_url: string }> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = String(randomInt(10_000)).padStart(4, "0");
    if (code === env.DEMO_CODE) continue; // reserved for the seeded demo plan
    let plan: PlanRow;
    try {
      plan = (await sql.begin(async (tx) => {
        const p = await insertPlan(
          { code, title: f.title, area: f.area, event_date: f.date, time_start: f.time_start, time_end: f.time_end, party_target: f.party_target, organizer_id: organizer.id },
          tx,
        );
        // The console resets its plan-scoped panels on a plan.state for a new plan_id. Without this marker the first
        // plan.state would be COLLECTING>RESEARCHING, minutes later, and it would wipe this plan's lanes.
        await emit({ type: "plan.state", plan_id: p.id, from: "NEW", to: p.state, version: p.version }, tx);
        let { row } = await upsertParticipant(p.id, organizer.id, tx);
        if (o.organizerStage === "JOINED" && row.stage === "INVITED") row = (await updateStage(p.id, organizer.id, "JOINED", tx)) ?? row;
        await emit({ type: "lane", plan_id: p.id, lane: row.lane, first_name: organizer.first_name, stage: row.stage, amount_cents: null, cybs_id_short: null }, tx);
        return p;
      })) as PlanRow;
    } catch (e) {
      if (isUniqueViolation(e)) continue;
      throw e;
    }
    await jobs
      .enqueue(A_JOB_KINDS.orgJoinStatus, aJobKeys.orgJoinStatus(plan.id), new Date(Date.now() + ORG_JOIN_STATUS_DELAY_MS), {}, { planId: plan.id })
      .catch((e) => log.warn({ plan_id: plan.id, ...errInfo(e) }, "org_join_status enqueue failed"));
    return { plan, join_url: joinUrlFor(plan.code) };
  }
  throw new Error("plan code allocation exhausted");
}
