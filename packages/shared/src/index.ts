// Public cross-boundary contracts (PLAN §8). Field names are final; changes are announced and additive-only after 11 PM.
// PrivateConstraints is NOT exported here: it lives in ./private.ts behind the P1 import allowlist.
// tap.ts is NOT re-exported: it imports node:crypto and must stay out of browser bundles (use "@tab/shared/tap").
import * as z from "zod";

export * from "./pricing";
export * from "./templates";

// ---------- primitives ----------
export const Cents = z.number().int().nonnegative();
export type Cents = z.infer<typeof Cents>;
export const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export type HHMM = z.infer<typeof HHMM>;
export const IsoDate = z.iso.date();
export type IsoDate = z.infer<typeof IsoDate>;
export const IsoDateTime = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTime>;
export const PlanRef = z.uuid();
export type PlanRef = z.infer<typeof PlanRef>;
export const Category = z.enum(["dinner", "show"]);
export type Category = z.infer<typeof Category>;
export const PriceTier = z.enum(["<$25", "$25-50", "$50+"]);
export type PriceTier = z.infer<typeof PriceTier>;
export const DietaryTag = z.enum(["vegetarian", "vegan", "pescatarian", "gluten_free", "dairy_free", "nut_free", "halal", "kosher"]);
export type DietaryTag = z.infer<typeof DietaryTag>;
export const Vibe = z.enum(["casual", "lively", "quiet", "trendy", "classic", "outdoor", "late_night"]);
export type Vibe = z.infer<typeof Vibe>;

// ---------- CREAO input (P6: enums/area/date/time/party only) ----------
export const ResearchBrief = z.strictObject({
  category: Category,
  area: z.string().min(2).max(60), // organizer-set, e.g. "Westwood / Sawtelle"
  date: IsoDate,
  time_window: z.strictObject({ start: HHMM, end: HHMM }),
  party_size: z.number().int().min(2).max(8),
  dietary_tags: z.array(DietaryTag), // aggregate, sorted, deduped, no identities
  vibe: z.array(Vibe).max(3),
  price_tiers: z.tuple([z.literal("<$25"), z.literal("$25-50"), z.literal("$50+")]),
  count_per_tier: z.literal(4),
});
export type ResearchBrief = z.infer<typeof ResearchBrief>;
// sent as CREAO inputs: { plan_ref: string(uuid), category: "dinner"|"show", brief: JSON.stringify(ResearchBrief) }

// ---------- Scout output (wire, from `tab options submit` or result.text) ----------
const ScoutBase = {
  name: z.string().min(1).max(120),
  address: z.string().min(5).max(200),
  area: z.string().max(60),
  url: z.url(),
  price_tier: PriceTier,
  est_low_pp_usd: z.number().int().min(0).max(500),
  est_high_pp_usd: z.number().int().min(0).max(500),
  price_evidence_url: z.url(),
  dietary_fit: z.array(DietaryTag),
  pitch: z.string().min(1).max(140),
};
export const ScoutOption = z
  .discriminatedUnion("category", [
    z.strictObject({ category: z.literal("dinner"), ...ScoutBase, opens: HHMM, closes: HHMM, hours_evidence_url: z.url() }),
    z.strictObject({ category: z.literal("show"), ...ScoutBase, show_start: HHMM, show_end_est: HHMM, showtime_evidence_url: z.url() }),
  ])
  .refine((o) => o.est_high_pp_usd >= o.est_low_pp_usd, {
    path: ["est_high_pp_usd"],
    message: "est_high_pp_usd must be >= est_low_pp_usd",
  });
export type ScoutOption = z.infer<typeof ScoutOption>;
export const ScoutSubmission = z.strictObject({
  plan_ref: PlanRef,
  category: Category,
  options: z.array(ScoutOption).min(6).max(16), // 4 per tier requested; ≥6 accepted
});
export type ScoutSubmission = z.infer<typeof ScoutSubmission>;

// ---------- internal option / bundle ----------
export const Option = z.strictObject({
  id: z.string(), // 'opt_' + sha1(category|name|address)[0:10]
  run_id: z.string(),
  source: z.enum(["live", "cached"]),
  data: ScoutOption,
  est_high_pp_cents: Cents, // = est_high_pp_usd*100
});
export type Option = z.infer<typeof Option>;
export const Bundle = z.strictObject({
  id: z.string(), // 'bnd_' + sha1(dinnerId|showId)[0:10]
  dinner: Option,
  show: Option,
  dinner_time: HHMM,
  show_start: HHMM,
  show_end_est: HHMM,
  all_in_pp_cents: Cents, // priceBundle(); public (everyone sees the same price)
});
export type Bundle = z.infer<typeof Bundle>;
export const PublicBundle = z.strictObject({
  // what delegates, fan-out and console see
  id: z.string(),
  index: z.number().int().min(1).max(3),
  title: z.string(), // "Dinner at X → Show at Y"
  dinner_name: z.string(),
  show_name: z.string(),
  dinner_time: HHMM,
  show_start: HHMM,
  show_end_est: HHMM,
  all_in_pp_cents: Cents,
  dietary_fit: z.array(DietaryTag),
  pitch: z.string().max(280),
});
export type PublicBundle = z.infer<typeof PublicBundle>;

// ---------- delegate I/O (LLM-facing schemas: only types/enums; code validates ranges after) ----------
export const DelegateInput = z.strictObject({
  user_first_name: z.string(),
  stage: z.enum(["budget", "prefs", "ballot", "holdgate", "free"]),
  message_text: z.string().max(2000), // this person's own inbound text only
});
export type DelegateInput = z.infer<typeof DelegateInput>;
export const BudgetParse = z.strictObject({
  target_pp_cents: z.number().int(),
  hard_max_pp_cents: z.number().int().nullable(),
  confidence: z.enum(["high", "low"]),
});
export type BudgetParse = z.infer<typeof BudgetParse>;
export const Preferences = z.strictObject({
  // NO money fields
  cuisines_like: z.array(z.string()).max(5),
  cuisines_avoid: z.array(z.string()).max(5),
  dietary: z.array(DietaryTag),
  vibe: z.array(Vibe).max(3),
  earliest_start: HHMM.nullable(),
  latest_end: HHMM.nullable(),
  dealbreakers: z.array(z.string()).max(3),
});
export type Preferences = z.infer<typeof Preferences>;
export const BallotConstraint = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("end_before"), time: HHMM }),
  z.strictObject({ kind: z.literal("start_after"), time: HHMM }),
  z.strictObject({ kind: z.literal("exclude"), index: z.number().int().min(1).max(3) }),
]);
export type BallotConstraint = z.infer<typeof BallotConstraint>;
export const BallotParse = z.strictObject({
  approvals: z.array(z.number().int().min(1).max(3)),
  constraints: z.array(BallotConstraint),
  none_of_these: z.boolean(),
  intent: z.enum(["ballot", "ask_about_others", "other"]),
  confidence: z.enum(["high", "low"]),
});
export type BallotParse = z.infer<typeof BallotParse>;
export const Ratings = z.strictObject({
  ratings: z.array(z.strictObject({ index: z.number().int().min(1), score: z.number() })), // clamp [0.05,1] in code
});
export type Ratings = z.infer<typeof Ratings>;
export const Ballot = z.strictObject({
  plan_id: z.uuid(),
  user_id: z.uuid(),
  plan_version: z.number().int(),
  approvals: z.array(z.string()), // bundle ids after constraints evaluated in code
  constraints: z.array(BallotConstraint),
  source: z.enum(["digits", "delegate"]),
  at: IsoDateTime,
});
export type Ballot = z.infer<typeof Ballot>;

// ---------- venue contracts ----------
export const VenueBundle = z.strictObject({
  bundle_key: z.string(),
  date: IsoDate,
  dinner: z.strictObject({ name: z.string(), address: z.string(), time: HHMM, est_high_pp_usd: z.number().int() }),
  show: z.strictObject({ name: z.string(), address: z.string(), time: HHMM, est_high_pp_usd: z.number().int() }),
});
export type VenueBundle = z.infer<typeof VenueBundle>;
export const OrderItem = z.strictObject({
  kind: Category,
  name: z.string(),
  address: z.string(),
  time: HHMM,
  unit_price_pp_cents: Cents,
  qty: z.number().int().min(1),
});
export type OrderItem = z.infer<typeof OrderItem>;
export const CreateOrderRequest = z.strictObject({
  plan_ref: PlanRef,
  plan_version: z.number().int(),
  bundle: VenueBundle,
  party_size: z.number().int().min(2).max(8),
  payer_refs: z.array(z.string().regex(/^[0-9a-f]{32}$/)), // length === party_size
  deadline_at: IsoDateTime,
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequest>;
export const ShareStatus = z.enum([
  "PENDING", "AUTHORIZING", "AUTHORIZED", "DECLINED", "AUTH_UNKNOWN",
  "TIMEOUT_REVERSING", "CAPTURING", "CAPTURED", "REVERSING", "RELEASED", "VOID",
]);
export type ShareStatus = z.infer<typeof ShareStatus>;
export const Share = z.strictObject({
  share_id: z.string(),
  payer_ref: z.string(),
  amount_cents: Cents,
  status: ShareStatus,
  cybs_payment_id: z.string().nullable(),
  card_last4: z.string().nullable(),
});
export type Share = z.infer<typeof Share>;
export const CreateOrderResponse = z.strictObject({
  order_id: z.string(),
  total_cents: Cents,
  currency: z.literal("USD"),
  items: z.array(OrderItem),
  shares: z.array(
    z.strictObject({ share_id: z.string(), payer_ref: z.string(), amount_cents: Cents, pay_url: z.url(), expires_at: IsoDateTime }),
  ),
});
export type CreateOrderResponse = z.infer<typeof CreateOrderResponse>;
export const OrderStatus = z.strictObject({
  order_id: z.string(),
  plan_ref: PlanRef,
  plan_version: z.number().int(),
  status: z.enum(["OPEN", "COMMITTING", "CAPTURED", "CANCELLING", "CANCELLED", "NEEDS_ATTENTION"]),
  total_cents: Cents,
  shares: z.array(Share),
  updated_at: IsoDateTime,
});
export type OrderStatus = z.infer<typeof OrderStatus>;
export const ConsentSet = z.strictObject({
  // body of POST /checkout/{orderId}
  order_id: z.string(),
  total_cents: Cents,
  shares: z.array(z.strictObject({ share_id: z.string(), cybs_payment_id: z.string(), amount_cents: Cents })),
});
export type ConsentSet = z.infer<typeof ConsentSet>;
export const TapStep = z.strictObject({
  n: z.number().int().min(1).max(6),
  name: z.enum(["tag", "params", "timestamps", "nonce", "key", "signature"]),
  ok: z.boolean(),
  detail: z.string(),
});
export type TapStep = z.infer<typeof TapStep>;
export const TapVerifyReport = z.strictObject({
  route: z.string(),
  tag: z.string().nullable(),
  steps: z.array(TapStep),
  business: z.strictObject({ all_authorized: z.boolean(), sum_matches: z.boolean(), consent_matches: z.boolean() }).nullable(),
  accepted: z.boolean(),
  reason: z.string().nullable(),
  signature_base: z.string(), // shown on the TAP panel (no secrets)
});
export type TapVerifyReport = z.infer<typeof TapVerifyReport>;
export const CommitResult = z.strictObject({
  order_id: z.string(),
  result: z.enum(["captured", "rejected", "partial"]),
  tap: TapVerifyReport,
  captures: z.array(z.strictObject({ share_id: z.string(), status: ShareStatus, cybs_capture_id: z.string().nullable() })),
});
export type CommitResult = z.infer<typeof CommitResult>;
export const VenueEvent = z.strictObject({
  // venue → agent POST /venue/hook
  event_id: z.string(),
  at: IsoDateTime,
  order_id: z.string(),
  plan_ref: PlanRef,
  type: z.enum([
    "share.authorizing", "share.authorized", "share.declined", "share.auth_unknown",
    "share.released", "share.captured", "order.captured", "order.cancelled", "order.needs_attention", "tap.verified",
  ]),
  share_id: z.string().nullable(),
  payer_ref: z.string().nullable(),
  data: z.record(z.string(), z.unknown()), // e.g. {cybs_payment_id_short, card_last4} | TapVerifyReport
});
export type VenueEvent = z.infer<typeof VenueEvent>;

// ---------- inbound (normalized Photon event) ----------
export const InboundEvent = z.strictObject({
  event_id: z.string(), // Photon event.id (dedupe key)
  seq: z.number().int(), // delivery metadata.seq (cursor)
  message_id: z.string(), // pho_msg_…
  platform: z.literal("imessage"),
  from_handle: z.string(), // sentBy.handle (E.164)
  from_user_id: z.string(), // sentBy.id
  agent_user_id: z.string(), // receivedBy.id → reply senderId
  space_id: z.string(), // space.id → reply spaceId
  space_kind: z.string(), // must be "direct"
  content_type: z.string(), // "text" | "attachment" | …
  text: z.string().nullable(), // only when content.type==="text"
  parent_message_id: z.string().nullable(),
  received_at: IsoDateTime,
});
export type InboundEvent = z.infer<typeof InboundEvent>;

// ---------- CREAO ----------
export const CreaoRun = z.looseObject({
  // lenient: GET shape field names UNVERIFIED (accept id|runId)
  id: z.string().optional(),
  runId: z.string().optional(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  threadId: z.string().optional(),
  errorCode: z.string().optional(),
  result: z
    .looseObject({
      text: z.string().optional(),
      chatText: z.string().optional(),
      artifacts: z.array(z.looseObject({ id: z.string(), title: z.string(), type: z.string(), url: z.string() })).optional(),
    })
    .optional(),
});
export type CreaoRun = z.infer<typeof CreaoRun>;
export const ConciergeInput = z.strictObject({
  plan_ref: PlanRef,
  itinerary: z.strictObject({
    date: IsoDate,
    area: z.string(),
    party_size: z.number().int(),
    dinner: z.strictObject({ name: z.string(), address: z.string(), time: HHMM }),
    show: z.strictObject({ name: z.string(), address: z.string(), time: HHMM }),
  }),
});
export type ConciergeInput = z.infer<typeof ConciergeInput>;
export const Itinerary = z.strictObject({
  plan_ref: PlanRef,
  title: z.string().max(120),
  date: IsoDate,
  stops: z.array(z.strictObject({ kind: Category, name: z.string(), address: z.string(), time: HHMM, notes: z.string().max(400) })),
  logistics: z.strictObject({
    getting_there: z.string().max(600),
    parking: z.string().max(400),
    doors: z.string().max(200),
    dress_code: z.string().max(200),
    know_before: z.array(z.string().max(200)).max(6),
  }),
  ics: z.string().max(20000).startsWith("BEGIN:VCALENDAR"),
  notion_url: z.url().nullable(),
});
export type Itinerary = z.infer<typeof Itinerary>;

// ---------- /agent/* CLI API (Bearer TAB_AGENT_TOKEN) ----------
export const AgentProgress = z.strictObject({
  plan_ref: PlanRef,
  run_kind: z.enum(["scout", "concierge"]),
  category: Category.nullable(),
  step: z.string().min(1).max(140),
});
export type AgentProgress = z.infer<typeof AgentProgress>;
export const ValidationResult = z.strictObject({
  ok: z.boolean(),
  errors: z.array(z.strictObject({ path: z.string(), message: z.string() })),
});
export type ValidationResult = z.infer<typeof ValidationResult>;

// ---------- SSE (apps/agent GET /events; id = app.events.id) ----------
// PLAN names this `laneStage` (module-private); exported as LaneStage for the console.
export const LaneStage = z.enum([
  "INVITED", "JOINED", "BUDGET_LOCKED", "PREFS_DONE", "VOTED", "GATED", "LINK_SENT", "HELD", "CAPTURED", "RELEASED", "DECLINED",
]);
export type LaneStage = z.infer<typeof LaneStage>;
export const SseEvent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("plan.state"), plan_id: z.uuid(), from: z.string(), to: z.string(), version: z.number().int() }),
  z.strictObject({
    type: z.literal("lane"), plan_id: z.uuid(), lane: z.number().int(), first_name: z.string(), stage: LaneStage,
    amount_cents: Cents.nullable(), // share amount (public), never budget
    cybs_id_short: z.string().nullable(),
  }),
  z.strictObject({
    type: z.literal("creao.run"), run_id: z.string(), kind: z.string(), category: Category.nullable(),
    status: z.string(), elapsed_ms: z.number().int(), source: z.enum(["live", "cached"]), share_url: z.url().nullable(),
  }),
  z.strictObject({ type: z.literal("creao.progress"), run_id: z.string().nullable(), kind: z.string(), category: Category.nullable(), step: z.string() }),
  z.strictObject({
    type: z.literal("shortlist"), plan_id: z.uuid(), version: z.number().int(),
    from_count: z.number().int(), survived_count: z.number().int(), bundles: z.array(PublicBundle),
  }),
  z.strictObject({ type: z.literal("vote.tally"), plan_id: z.uuid(), voted: z.number().int(), total: z.number().int() }),
  z.strictObject({
    type: z.literal("tap.signed"), order_id: z.string(), method: z.string(), path: z.string(),
    signature_input: z.string(), signature_short: z.string(),
  }),
  z.strictObject({ type: z.literal("tap.verify"), order_id: z.string(), report: TapVerifyReport }),
  z.strictObject({
    type: z.literal("ledger"), order_id: z.string(), lane: z.number().int(), status: ShareStatus,
    amount_cents: Cents, cybs_id_short: z.string().nullable(),
  }),
  z.strictObject({
    type: z.literal("counters"), groups_converted: z.number().int(),
    fronted_by_individual_cents: z.literal(0), holds_released: z.number().int(),
  }),
  z.strictObject({
    type: z.literal("xray"),
    contexts: z.array(
      z.strictObject({
        name: z.string(), // "scout_input:dinner" | "fanout" | "delegate:lane-2"
        locked: z.boolean(),
        preview: z.string().nullable(), // delegates: locked=true, preview=null
      }),
    ),
  }),
  z.strictObject({
    type: z.literal("delivery"), lane: z.number().int().nullable(), message_id_short: z.string(),
    status: z.enum(["accepted", "dispatched", "delivered", "failed"]),
  }),
  z.strictObject({ type: z.literal("system"), level: z.enum(["info", "warn", "error"]), msg: z.string().max(200) }),
]);
export type SseEvent = z.infer<typeof SseEvent>;
export type SseEventType = SseEvent["type"];
