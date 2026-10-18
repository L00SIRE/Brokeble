// Row types returned by src/repo/*. Owner A. Every module reads and writes app.* only through repo functions,
// so these shapes are the cross-module contract. The repo normalizes Postgres types in SQL: dates come back as
// "YYYY-MM-DD" (IsoDate), times as "HH:MM" (HHMM), timestamps as Date. Budgets never appear here (P1: see
// privateConstraints.ts, the only file that touches them).
import type { Category, Itinerary, LaneStage, ScoutSubmission } from "@tab/shared";

/** app.plans.state (PLAN §7). SHOWCASE is B's live-Scout showcase row only: it never transitions. */
export type PlanState =
  | "COLLECTING" | "RESEARCHING" | "VOTING" | "ORDERING" | "APPROVING" | "COMMITTING"
  | "CONFIRMED" | "CANCELLING" | "CANCELLED" | "SHOWCASE";

export type UserRow = {
  id: string;
  phone_e164: string;
  first_name: string;
  photon_user_id: string | null;
  payer_ref: string; // hmacSha256Hex(PAYER_REF_SECRET, id).slice(0, 32): the only identity the venue sees
  created_at: Date;
};

export type PlanDeadlines = { vote_at?: string; approve_at?: string }; // ISO datetimes

export type PlanRow = {
  id: string;
  ref: string; // opaque uuid: the only plan id CREAO and the venue see
  code: string;
  organizer_id: string | null;
  state: PlanState;
  version: number;
  title: string;
  area: string;
  event_date: string; // IsoDate, normalized in SQL
  time_start: string; // HHMM, normalized in SQL
  time_end: string; // HHMM
  party_target: number;
  chosen_bundle_id: string | null;
  venue_order_id: string | null;
  deadlines: PlanDeadlines;
  created_at: Date;
  updated_at: Date;
};

export type NewPlanInput = {
  code: string;
  title: string;
  area: string;
  event_date: string; // IsoDate
  time_start: string; // HHMM
  time_end: string; // HHMM
  party_target: number;
  organizer_id: string | null;
  state?: Extract<PlanState, "COLLECTING" | "SHOWCASE">; // default COLLECTING
};

export type ParticipantRow = { plan_id: string; user_id: string; lane: number; stage: LaneStage; joined_at: Date };

/** A participant joined with the public user fields every fan-out and venue call needs. */
export type MemberRow = ParticipantRow & { first_name: string; payer_ref: string };

/** The sender's own state, resolved by the router for every stage handler. */
export type MemberContext = { user: UserRow; plan: PlanRow; participant: ParticipantRow };

export type DmRouteRow = { user_id: string; space_id: string; agent_user_id: string; agent_number: string | null; updated_at: Date };

export type AssignmentRow = {
  id: string;
  user_id: string;
  photon_assignment_id: string;
  assigned_number: string;
  created_at: Date;
  released_at: Date | null;
};

export type ResearchRunKind = "scout" | "concierge" | "scout_live_demo";
export type ResearchRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "timed_out";
export const TERMINAL_RUN_STATUSES: readonly ResearchRunStatus[] = ["completed", "failed", "cancelled", "timed_out"];

/** research_runs.result keys (B C-5): `creao` = raw CREAO run, never overwrites `itinerary`. */
export type ResearchRunResult = {
  creao?: unknown;
  itinerary?: Itinerary; // concierge runs
  submission?: ScoutSubmission; // scout_live_demo runs: options stay here, never in app.options
  cached_from_run_id?: string; // seeded/cached runs: the fixture's real CREAO run id
  share_url?: string | null;
};

export type ResearchRunRow = {
  id: string;
  plan_id: string;
  kind: ResearchRunKind;
  category: Category | null;
  attempt: number;
  idempotency_key: string;
  creao_run_id: string | null;
  thread_id: string | null;
  status: ResearchRunStatus;
  source: "live" | "cached";
  started_at: Date;
  finished_at: Date | null;
  result: ResearchRunResult | null;
};

export type NewResearchRun = {
  plan_id: string;
  kind: ResearchRunKind;
  category: Category | null;
  attempt?: number;
  idempotency_key: string; // 8..128 chars, unique
  status?: ResearchRunStatus; // default "pending"
  source?: "live" | "cached";
  creao_run_id?: string | null;
  result?: ResearchRunResult | null;
};

export type RatingRow = { user_id: string; bundle_id: string; score: number };

export type HoldGateStatus = "pending" | "approved" | "declined";
export type HoldGateRow = {
  plan_id: string;
  user_id: string;
  plan_version: number;
  share_amount_cents: number;
  status: HoldGateStatus;
  asked_at: Date;
  answered_at: Date | null;
};

/** app.pay_links (migration 004). pay_url is a bearer link: never log, emit or preview it. */
export type PayLinkRow = {
  plan_id: string;
  user_id: string;
  plan_version: number;
  share_id: string;
  amount_cents: number;
  pay_url: string;
  expires_at: Date;
  updated_at: Date;
};

export type InboundSource = "photon" | "creao" | "venue";

/** outbound_messages.status: 'pending' | 'accepted' | 'blocked_inbound' | 'failed:<problemCode>'. */
export type OutboundStatus = "pending" | "accepted" | "blocked_inbound" | `failed:${string}`;
