// Agent LiveVenue (real signer + client) against the venue's real verifier, with an in-process fetch.
import { generateKeyPairSync, createPublicKey, type JsonWebKey } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CommitResult, ConsentSet } from "@tab/shared";
import { verifyTap } from "../src/tap/verify";
import { LiveVenue } from "../../agent/src/venueClient/index";
import { createSigner } from "../../agent/src/tap/signer";
import { memNonces } from "./helpers/sign";

const { privateKey } = generateKeyPairSync("ed25519");
const KEYID = "tab-agent-ed25519-1";
const keys: Record<string, JsonWebKey> = { [KEYID]: createPublicKey(privateKey).export({ format: "jwk" }) };
const signer = createSigner({ keyId: KEYID, privateKeyPemB64: Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }) as string).toString("base64") });

const consent: ConsentSet = {
  order_id: "ord_abc", total_cents: 6000,
  shares: [{ share_id: "shr_a", cybs_payment_id: "p1", amount_cents: 3000 }, { share_id: "shr_b", cybs_payment_id: "p2", amount_cents: 3000 }],
};

function harness() {
  const nonces = memNonces();
  const events: any[] = [];
  const fetchFn = (async (input: URL, init: RequestInit) => {
    const url = new URL(String(input));
    const report = await verifyTap(
      { method: String(init.method), path: url.pathname, headers: new Headers(init.headers as never), body: init.body ? Buffer.from(init.body as Buffer) : Buffer.alloc(0) },
      { now: () => Math.floor(Date.now() / 1000), authority: "venue.test", keys, nonces },
    );
    const result: CommitResult = { order_id: "ord_abc", result: report.accepted ? "captured" : "rejected", tap: report, captures: [] };
    return new Response(JSON.stringify(result), { status: report.accepted ? 200 : 401 });
  }) as unknown as typeof fetch;
  const venue = new LiveVenue({ baseUrl: "https://venue.test", signer: () => signer, emit: (e) => void events.push(e), fetch: fetchFn });
  return { venue, events };
}

const failed = (r: CommitResult) => r.tap.steps.find((s) => !s.ok)?.n;

describe("signer → client → verifier", () => {
  it("valid commit passes all six steps", async () => {
    const { venue, events } = harness();
    const r = await venue.commit("ord_abc", consent);
    expect(r.tap.accepted).toBe(true);
    expect(r.tap.steps.map((s) => s.ok)).toEqual([true, true, true, true, true, true]);
    expect(events.map((e) => e.type)).toEqual(["tap.signed", "tap.verify"]);
  });
  it.each([
    ["wrong_tag", 1],
    ["expired", 3],
    ["replay", 4],
    ["tamper", 6],
  ] as const)("%s is rejected at step %i", async (kind, step) => {
    const { venue } = harness();
    const r = await venue.commit("ord_abc", consent, kind);
    expect(r.tap.accepted).toBe(false);
    expect(failed(r)).toBe(step);
  });
  it("signed events carry no private data", async () => {
    const { venue, events } = harness();
    await venue.commit("ord_abc", consent);
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE|pem/i);
  });
});
