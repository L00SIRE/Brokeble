// Port interfaces, verbatim from PLAN §9. Changes must be announced (foundation-owned).
import type {
  BallotParse,
  BudgetParse,
  CommitResult,
  ConciergeInput,
  ConsentSet,
  CreaoRun,
  CreateOrderRequest,
  CreateOrderResponse,
  DelegateInput,
  InboundEvent,
  OrderStatus,
  Preferences,
  PublicBundle,
  Ratings,
  ResearchBrief,
} from "@tab/shared";

export type DmAddress = { userId: string; spaceId: string; agentUserId: string };

export interface MessagingPort {                       // A. real: @photon-ai/api + socket.io-client. mock: /dev/inbound + console log
  start(onInbound: (e: InboundEvent) => Promise<void>): Promise<void>;   // subscribe(startSeq), save seq only after handler resolves
  sendText(to: DmAddress, text: string, o: { idempotencyKey: string; replyTo?: string }): Promise<{ messageId: string }>;
  setTyping(to: DmAddress, on: boolean): Promise<void>;
  markRead(messageId: string, idempotencyKey: string): Promise<void>;
  assign(handle: string, firstName: string, idempotencyKey: string): Promise<{ assignmentId: string; assignedPhoneNumber: string }>;
  release(assignmentId: string): Promise<void>;
  sendImage?(to: DmAddress, png: Uint8Array, o: { idempotencyKey: string }): Promise<{ messageId: string }>; // stretch (uploadAttachment)
}

export interface PlannerPort {                         // B. real: CREAO REST. mock: fixtures/cached-options after 5 s + fake progress
  startScout(planRef: string, brief: ResearchBrief, attempt: number): Promise<{ runId: string }>;
  startConcierge(input: ConciergeInput): Promise<{ runId: string }>;
  getRun(runId: string): Promise<CreaoRun>;
  cancel(runId: string): Promise<void>;
  downloadArtifact(runId: string, artifactId: string): Promise<Uint8Array>; // follows redirect; never forwards Bearer cross-origin
}

export interface LLMPort {                             // A (delegates) + B (ratings). real: Anthropic. mock: deterministic canned parses
  parseBudget(i: DelegateInput): Promise<BudgetParse>;          // claude-haiku-5-5
  parsePreferences(i: DelegateInput): Promise<Preferences>;     // claude-haiku-5-5
  parseBallot(i: DelegateInput, shortlist: PublicBundle[]): Promise<BallotParse>; // claude-haiku-5-5
  rateBundles(prefs: Preferences, bundles: PublicBundle[]): Promise<Ratings>;      // claude-sonnet-5-5, effort "low"
  repairScoutJson(raw: string, category: "dinner" | "show"): Promise<unknown>;    // claude-haiku-5-5; Scout text only
}

export interface VenuePort {                           // C. real: TAP-signed fetch. mock: in-memory venue with fake holds
  checkAvailability(bundleKey: string): Promise<{ available: boolean }>;           // GET  /availability/{key}  agent-browser-auth
  createOrder(req: CreateOrderRequest): Promise<CreateOrderResponse>;              // POST /orders              agent-payer-auth
  getOrder(orderId: string): Promise<OrderStatus>;                                 // GET  /orders/{id}         agent-browser-auth
  commit(orderId: string, consent: ConsentSet,
         test?: "tamper" | "replay" | "expired" | "wrong_tag"): Promise<CommitResult>; // POST /checkout/{id}   agent-payer-auth
  cancel(orderId: string, reason: string): Promise<OrderStatus>;                   // POST /orders/{id}/cancel  agent-payer-auth
}

export type TapTestKind = NonNullable<Parameters<VenuePort["commit"]>[2]>;
