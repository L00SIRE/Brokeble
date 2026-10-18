// The real VenuePort: TAP-signed fetch to apps/venue (PLAN §9, §18; docs/plans/C-trust-commerce.md T5).
import {
  CommitResult,
  CreateOrderResponse,
  OrderStatus,
  type ConsentSet,
  type CreateOrderRequest,
  type SseEvent,
} from "@tab/shared";
import { canonicalConsent, TAG } from "@tab/shared/tap";
import type { TapTestKind, VenuePort } from "../ports/types";
import { createSigner, signer as defaultSigner, type Signer } from "../tap/signer";

export class CommitPendingError extends Error {
  constructor(public orderId: string) {
    super(`commit for ${orderId} is in flight; wait for order.captured`);
  }
}
export class VenueHttpError extends Error {
  constructor(public status: number, public body: unknown, what: string) {
    super(`venue ${what} failed: HTTP ${status}`);
  }
}

export type LiveVenueDeps = {
  baseUrl: string;
  signer: () => Promise<Signer> | Signer;
  emit: (ev: SseEvent) => Promise<unknown> | void;
  fetch: typeof fetch;
};

async function defaultDeps(): Promise<LiveVenueDeps> {
  const { env } = await import("../env");
  const { emit } = await import("../events");
  return { baseUrl: env.VENUE_BASE_URL!, signer: defaultSigner, emit, fetch };
}

const MS = { read: 30_000, money: 90_000 };

export class LiveVenue implements VenuePort {
  private deps: Promise<LiveVenueDeps>;
  constructor(deps?: Partial<LiveVenueDeps>) {
    this.deps = deps?.baseUrl && deps.signer && deps.emit && deps.fetch ? Promise.resolve(deps as LiveVenueDeps) : defaultDeps().then((d) => ({ ...d, ...deps }));
  }

  private async call(method: "GET" | "POST", path: string, body: Uint8Array | null, o: { timeout: number; tag?: string; created?: number; expires?: number }) {
    const d = await this.deps;
    const url = new URL(path, d.baseUrl);
    const sig = (await d.signer()).sign(method, url, body, o);
    const res = await d.fetch(url, {
      method,
      headers: { ...sig, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(o.timeout),
    });
    return { res, sig, url, text: await res.text() };
  }

  async checkAvailability(bundleKey: string): Promise<{ available: boolean }> {
    const { res, text } = await this.call("GET", `/availability/${encodeURIComponent(bundleKey)}`, null, { timeout: MS.read });
    if (!res.ok) throw new VenueHttpError(res.status, safe(text), "availability");
    return { available: JSON.parse(text).available === true };
  }

  async createOrder(req: CreateOrderRequest): Promise<CreateOrderResponse> {
    const body = Buffer.from(JSON.stringify(req));
    const { res, text } = await this.call("POST", "/orders", body, { timeout: MS.read });
    if (res.status !== 201) throw new VenueHttpError(res.status, safe(text), "createOrder");
    return CreateOrderResponse.parse(JSON.parse(text));
  }

  async getOrder(orderId: string): Promise<OrderStatus> {
    const { res, text } = await this.call("GET", `/orders/${encodeURIComponent(orderId)}`, null, { timeout: MS.read });
    if (!res.ok) throw new VenueHttpError(res.status, safe(text), "getOrder");
    return OrderStatus.parse(JSON.parse(text));
  }

  async cancel(orderId: string, reason: string): Promise<OrderStatus> {
    const body = Buffer.from(JSON.stringify({ reason }));
    const { res, text } = await this.call("POST", `/orders/${encodeURIComponent(orderId)}/cancel`, body, { timeout: MS.money });
    if (!res.ok) throw new VenueHttpError(res.status, safe(text), "cancel");
    return OrderStatus.parse(JSON.parse(text));
  }

  async commit(orderId: string, consent: ConsentSet, test?: TapTestKind) {
    const first = await this.commitOnce(orderId, consent, test, false);
    if (first !== "timeout") return first;
    // Network timeout: ask the venue what happened. OPEN is safe to retry once (row lock + conditional UPDATE).
    const o = await this.getOrder(orderId);
    if (o.status !== "OPEN") throw new CommitPendingError(orderId);
    const second = await this.commitOnce(orderId, consent, test, true);
    if (second === "timeout") throw new CommitPendingError(orderId);
    return second;
  }

  private async commitOnce(orderId: string, consent: ConsentSet, test: TapTestKind | undefined, _retry: boolean): Promise<CommitResult | "timeout"> {
    const d = await this.deps;
    const path = `/checkout/${encodeURIComponent(orderId)}`;
    const body = Buffer.from(canonicalConsent(consent));
    const now = Math.floor(Date.now() / 1000);
    const signOpts = test === "expired" ? { created: now - 600, expires: now - 480 } : test === "wrong_tag" ? { tag: TAG.browse } : {};
    const send = async (payload: Buffer, headersFrom: Buffer) => {
      const url = new URL(path, d.baseUrl);
      const sig = (await d.signer()).sign("POST", url, headersFrom, signOpts);
      // tamper: the headers cover `headersFrom`, but the wire carries `payload`
      const res = await d.fetch(url, {
        method: "POST", headers: { ...sig, "content-type": "application/json" }, body: new Uint8Array(payload), signal: AbortSignal.timeout(MS.money),
      });
      return { res, sig, url, text: await res.text() };
    };
    try {
      let out;
      if (test === "tamper") {
        const first = consent.shares[0];
        if (!first) throw new Error("tamper needs at least one share");
        const forged = canonicalConsent({ ...consent, shares: [{ ...first, amount_cents: first.amount_cents + 100 }, ...consent.shares.slice(1)] });
        out = await send(Buffer.from(forged), body); // original headers/digest, forged body
      } else if (test === "replay") {
        out = await replay(d, path, body, signOpts);
      } else {
        out = await send(body, body);
      }
      if (![200, 401, 409].includes(out.res.status)) throw new VenueHttpError(out.res.status, safe(out.text), "commit");
      const result = CommitResult.parse(JSON.parse(out.text));
      const sigHeader = out.sig.Signature;
      await d.emit({
        type: "tap.signed", order_id: orderId, method: "POST", path: out.url.pathname,
        signature_input: out.sig["Signature-Input"], signature_short: sigHeader.slice(0, 16) + "…",
      });
      await d.emit({ type: "tap.verify", order_id: orderId, report: result.tap });
      return result;
    } catch (e) {
      if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) return "timeout";
      if (e instanceof TypeError) return "timeout"; // fetch network failure
      throw e;
    }
  }
}

/** Sends the identical signed request twice and returns the second result (expected: rejected at step 4). */
async function replay(d: LiveVenueDeps, path: string, body: Buffer, o: object) {
  const url = new URL(path, d.baseUrl);
  const sig = (await d.signer()).sign("POST", url, body, o);
  const once = () =>
    d.fetch(url, { method: "POST", headers: { ...sig, "content-type": "application/json" }, body: new Uint8Array(body), signal: AbortSignal.timeout(MS.money) });
  const a = await once();
  await a.text();
  const b = await once();
  return { res: b, sig, url, text: await b.text() };
}

const safe = (t: string) => {
  try {
    return JSON.parse(t);
  } catch {
    return t.slice(0, 200);
  }
};

export { createSigner };
