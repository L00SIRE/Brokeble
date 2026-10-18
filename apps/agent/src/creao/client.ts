// PLANNER_MODE=live: the real PlannerPort over the CREAO hackathon API (PLAN §10, B plan T4). The Integrate stage
// repoints ports/index.ts here. Base https://agent.creao.ai/api/v1, Bearer capi_ (server only, never logged).
// Verified against hackathon-context/creao.md + docs.creao.ai/pro/api-trigger. Owner B.
import { ConciergeInput as ConciergeInputSchema, CreaoRun as CreaoRunSchema, ResearchBrief as ResearchBriefSchema } from "@tab/shared";
import type { ConciergeInput, CreaoRun, ResearchBrief } from "@tab/shared";
import * as z from "zod";
import { env } from "../env";
import { log } from "../log";
import type { PlannerPort } from "../ports";

export const CREAO_BASE = "https://agent.creao.ai/api/v1";
const TIMEOUT_MS = 15_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Non-2xx CREAO response. `detail` is the first 300 chars of the body (never headers, never the key). */
export class CreaoError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`CREAO HTTP ${status}`);
    this.name = "CreaoError";
  }
}

/** Scout idempotency key: `scout-${planRef}-${category}-a${attempt}` (≤52 chars, [a-z0-9-]). */
export const scoutIdempotencyKey = (planRef: string, category: string, attempt: number): string => `scout-${planRef}-${category}-a${attempt}`;
/** Concierge idempotency key: `concierge-${planRef}-a1`. */
export const conciergeIdempotencyKey = (planRef: string): string => `concierge-${planRef}-a1`;

export type CreaoConfig = {
  apiKey?: string;
  scoutAppId?: string;
  conciergeAppId?: string;
  publicBaseUrl?: string;
  hookSecret?: string;
};

const fromEnv = (): CreaoConfig => ({
  apiKey: env.CREAO_API_KEY,
  scoutAppId: env.CREAO_SCOUT_APP_ID,
  conciergeAppId: env.CREAO_CONCIERGE_APP_ID,
  publicBaseUrl: env.PUBLIC_BASE_URL,
  hookSecret: env.CREAO_HOOK_SECRET,
});

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|\[?::1\]?$)/i;

/**
 * CREAO rejects webhook URLs on localhost/private networks at run creation, which would fail the whole start. Polling
 * is mandatory anyway (pre-execution failures send no webhook), so without a public base URL the hint is simply omitted.
 */
export function webhookUrlFor(publicBaseUrl: string | undefined, hookSecret: string | undefined): string | undefined {
  if (!publicBaseUrl || !hookSecret) return undefined;
  let u: URL;
  try {
    u = new URL(publicBaseUrl);
  } catch {
    return undefined;
  }
  if (PRIVATE_HOST.test(u.hostname)) return undefined;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}/creao/hook/${encodeURIComponent(hookSecret)}`;
}

/**
 * The real GET /runs/{id} body (verified live 2026-10-18): `{id, status, threadId, result: {text, chatText,
 * artifacts[{id,url,type,title}]} | null, errorCode: null, startedAt, completedAt, createdAt}`. CREAO sends null, not
 * absent, for result/errorCode (and possibly threadId) while running, so this wire schema accepts null everywhere
 * optional and toCreaoRun maps null to absent. Artifacts only need an id (the download key).
 */
const Str = z.string().nullish();
const CreaoRunWire = z.looseObject({
  id: Str,
  runId: Str,
  status: CreaoRunSchema.shape.status,
  threadId: Str,
  errorCode: Str,
  result: z
    .looseObject({
      text: Str,
      chatText: Str,
      artifacts: z.array(z.looseObject({ id: z.string(), title: Str, type: Str, url: Str })).nullish(),
    })
    .nullish(),
});
type CreaoRunWire = z.infer<typeof CreaoRunWire>;

const lastSegment = (id: string): string => id.slice(id.lastIndexOf("/") + 1);

/** Wire run → the shared CreaoRun: nulls dropped, id normalized (id | runId | the id we asked for). */
export function toCreaoRun(w: CreaoRunWire, requestedId: string): CreaoRun {
  const { id, runId, threadId, errorCode, result, ...rest } = w;
  const run: CreaoRun = { ...rest, id: id ?? runId ?? requestedId, status: w.status };
  if (threadId) run.threadId = threadId;
  if (errorCode) run.errorCode = errorCode;
  if (result) {
    const { text, chatText, artifacts, ...more } = result;
    run.result = {
      ...more,
      ...(text ? { text } : {}),
      ...(chatText ? { chatText } : {}),
      ...(artifacts
        ? { artifacts: artifacts.map((a) => ({ ...a, title: a.title ?? lastSegment(a.id), type: a.type ?? "", url: a.url ?? "" })) }
        : {}),
    };
  }
  return run;
}

/** Network failure or timeout (fetch rejects), as opposed to an HTTP status. */
const isTransient = (e: unknown): boolean => !(e instanceof CreaoError) || e.status >= 500;

export class CreaoPlanner implements PlannerPort {
  private readonly fetch: typeof fetch;
  private readonly cfg: CreaoConfig;

  /** `fetch` and `config` are injectable for tests (defaults: globalThis.fetch, the validated agent env). */
  constructor(o: { fetch?: typeof fetch; config?: CreaoConfig } = {}) {
    this.fetch = o.fetch ?? ((...a) => globalThis.fetch(...a));
    this.cfg = o.config ?? fromEnv();
  }

  private apiKey(): string {
    if (!this.cfg.apiKey) throw new CreaoError(0, "CREAO_API_KEY not configured");
    return this.cfg.apiKey;
  }

  /** Text-then-JSON so an empty body (cancel) is fine. Errors carry the status and a body excerpt only. */
  private async call<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
    const res = await this.fetch(CREAO_BASE + path, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${this.apiKey()}`, Accept: "application/json", ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new CreaoError(res.status, text.slice(0, 300));
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new CreaoError(res.status, "non-JSON response");
    }
  }

  /**
   * POST /runs → 202 {id}. The idempotency key makes a replay return the same run (documented: "sending the same key
   * again returns the same run"), so one retry on a network error/5xx cannot double-spend credits. 4xx (402 credits,
   * 400 input, 401 key) is never retried: research falls back to cached options.
   */
  private async startRun(appId: string | undefined, inputs: Record<string, string>, idempotencyKey: string): Promise<{ runId: string }> {
    if (!appId) throw new CreaoError(0, "CREAO app id not configured");
    const webhookUrl = webhookUrlFor(this.cfg.publicBaseUrl, this.cfg.hookSecret);
    const body = { appId, inputs, idempotencyKey, ...(webhookUrl ? { webhookUrl } : {}) };
    const post = () => this.call<{ id?: unknown; runId?: unknown }>("/runs", { method: "POST", body });
    let r: { id?: unknown; runId?: unknown };
    try {
      r = await post();
    } catch (e) {
      if (!isTransient(e)) throw e;
      log.warn({ idempotencyKey, status: e instanceof CreaoError ? e.status : null }, "creao.start.retry");
      r = await post();
    }
    const runId = typeof r.id === "string" ? r.id : typeof r.runId === "string" ? r.runId : null;
    if (!runId) throw new CreaoError(202, "start response missing id");
    return { runId };
  }

  async startScout(planRef: string, brief: ResearchBrief, attempt: number): Promise<{ runId: string }> {
    const b = ResearchBriefSchema.parse(brief); // P6 gate: strict object, enums only
    return this.startRun(
      this.cfg.scoutAppId,
      { plan_ref: planRef, category: b.category, brief: JSON.stringify(b) },
      scoutIdempotencyKey(planRef, b.category, attempt),
    );
  }

  async startConcierge(input: ConciergeInput): Promise<{ runId: string }> {
    const i = ConciergeInputSchema.parse(input);
    return this.startRun(
      this.cfg.conciergeAppId,
      { plan_ref: i.plan_ref, itinerary: JSON.stringify(i.itinerary) },
      conciergeIdempotencyKey(i.plan_ref),
    );
  }

  /** GET /runs/{id}. An unparseable shape reads as still running: the creao_timeout job always ends the run. */
  async getRun(runId: string): Promise<CreaoRun> {
    const raw = await this.call<unknown>(`/runs/${encodeURIComponent(runId)}`);
    const p = CreaoRunWire.safeParse(raw);
    if (!p.success) {
      log.warn({ runId, issues: p.error.issues.map((i) => i.path.join(".")).slice(0, 5) }, "creao.run.unparsed");
      return { id: runId, status: "running" };
    }
    return toCreaoRun(p.data, runId);
  }

  /** POST /runs/{id}/cancel. The response body is undocumented and may be empty. */
  async cancel(runId: string): Promise<void> {
    await this.call(`/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
  }

  /**
   * GET /runs/{id}/artifacts/download?artifactId= with the key → 302 to temporary storage (≤1 h). The redirect is
   * followed manually WITHOUT Authorization: the key must never reach another origin.
   */
  async downloadArtifact(runId: string, artifactId: string): Promise<Uint8Array> {
    const r1 = await this.fetch(`${CREAO_BASE}/runs/${encodeURIComponent(runId)}/artifacts/download?artifactId=${encodeURIComponent(artifactId)}`, {
      headers: { Authorization: `Bearer ${this.apiKey()}` },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const loc = r1.headers.get("location");
    if (!REDIRECTS.has(r1.status) || !loc) throw new CreaoError(r1.status, (await r1.text().catch(() => "")).slice(0, 300) || "artifact");
    const target = new URL(loc, CREAO_BASE);
    if (target.protocol !== "https:") throw new CreaoError(r1.status, "artifact redirect not https");
    const r2 = await this.fetch(target, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r2.ok) throw new CreaoError(r2.status, "artifact storage");
    return new Uint8Array(await r2.arrayBuffer());
  }
}
