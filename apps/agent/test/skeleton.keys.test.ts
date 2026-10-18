// Exact formats of cross-module keys and ids (PLAN §3.2/§6/§8, standard-names). Both sides of each contract build them
// with these helpers, so a format drift would silently defeat a dedupe or a venue regex.
import { describe, expect, it } from "vitest";
import { CreateOrderRequest } from "@tab/shared";
import { jobKeys } from "../src/dueJobs";
import { aJobKeys } from "../src/jobs/kinds";
import { bJobKeys } from "../src/creao/jobs";
import { replyKey, tplKey } from "../src/notify/notify";
import { payerRefFor } from "../src/repo/users";
import { optionId } from "../src/repo/options";
import { bundleId } from "../src/decide/compose";
import { joinIdempotencyKey } from "../src/join/seats";
import { conciergeIdempotencyKey, scoutIdempotencyKey } from "../src/creao/client";

const planId = "3f1c2b8e-6a0d-4c1f-9e2a-7b5d4c3a2f10";
const userId = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";
const IDEMPOTENCY = /^[\x21-\x7e]{1,255}$/; // Photon idempotency-key pattern (verified, OpenAPI)

describe("notify keys", () => {
  it("tplKey and replyKey match PLAN §3.2 and Photon's key pattern", () => {
    expect(tplKey(planId, userId, "T_PICKS", 2)).toBe(`tpl:${planId}:${userId}:T_PICKS:2`);
    expect(tplKey(planId, userId, "T_VOTE_TALLY", 1, 3)).toBe(`tpl:${planId}:${userId}:T_VOTE_TALLY:1:3`);
    expect(tplKey(planId, userId, "T_DECLINED_RETRY", 1, "evt_abc")).toBe(`tpl:${planId}:${userId}:T_DECLINED_RETRY:1:evt_abc`);
    expect(replyKey("pho_msg_1", 2)).toBe("reply:pho_msg_1:2");
    expect(tplKey(planId, userId, "T_DECLINED_RETRY", 1, "evt_abc")).toMatch(IDEMPOTENCY);
  });
});

describe("due_jobs keys", () => {
  it("A keys follow the A plan T10 table; recompute 'options' is the shared cross-owner key", () => {
    expect(aJobKeys.recompute(planId, "options")).toBe(jobKeys.recomputeOptions(planId));
    expect(aJobKeys.recompute(planId, "evt_1")).toBe(`recompute:${planId}:evt_1`);
    expect(aJobKeys.stillLooking(planId)).toBe(`still:${planId}`);
    expect(aJobKeys.orgJoinStatus(planId)).toBe(`orgjoin:${planId}`);
    expect(aJobKeys.voteDeadline(planId, 2)).toBe(`vote:${planId}:2`);
    expect(aJobKeys.createOrder(planId, 2)).toBe(`order:${planId}:2`);
    expect(aJobKeys.approveReping(planId, 2)).toBe(`reping:${planId}:2`);
    expect(aJobKeys.approveDeadline(planId, 2)).toBe(`approve:${planId}:2`);
    expect(aJobKeys.commit(planId, 2, "shr_1")).toBe(`commit:${planId}:2:shr_1`);
    expect(aJobKeys.venueSweep(60_000)).toBe("sweep:2");
    expect(aJobKeys.venueSweep(89_999)).toBe("sweep:2");
  });

  it("B keys follow the B plan T5 table", () => {
    expect(bJobKeys.creaoPoll("rr_1", 3)).toBe("rr_1:3");
    expect(bJobKeys.creaoTimeout("rr_1")).toBe("rr_1");
    expect(bJobKeys.checkResearchReady(planId, "rr_1")).toBe(`${planId}:rr_1`);
  });
});

describe("ids", () => {
  it("payer_ref is 32 lowercase hex chars, deterministic per (user, secret), and accepted by CreateOrderRequest", () => {
    const ref = payerRefFor(userId, "test-secret-not-real-0123456789");
    expect(ref).toMatch(/^[0-9a-f]{32}$/);
    expect(payerRefFor(userId, "test-secret-not-real-0123456789")).toBe(ref);
    expect(payerRefFor(userId, "another-test-secret-not-real-0123")).not.toBe(ref);
    expect(CreateOrderRequest.shape.payer_refs.element.safeParse(ref).success).toBe(true);
  });

  it("option and bundle ids are 'opt_'/'bnd_' + 10 hex of sha1", () => {
    const id = optionId({ category: "dinner", name: "A", address: "1 Main St" });
    expect(id).toMatch(/^opt_[0-9a-f]{10}$/);
    expect(optionId({ category: "show", name: "A", address: "1 Main St" })).not.toBe(id);
    expect(bundleId("opt_a", "opt_b")).toMatch(/^bnd_[0-9a-f]{10}$/);
    expect(bundleId("opt_a", "opt_b")).not.toBe(bundleId("opt_b", "opt_a"));
  });

  it("join idempotency key adds :<n> only after a released seat", () => {
    expect(joinIdempotencyKey(planId, userId, 0)).toBe(`join:${planId}:${userId}`);
    expect(joinIdempotencyKey(planId, userId, 2)).toBe(`join:${planId}:${userId}:2`);
  });

  it("CREAO idempotency keys fit 8..128 chars", () => {
    for (const k of [scoutIdempotencyKey(planId, "dinner", 1), conciergeIdempotencyKey(planId)]) {
      expect(k.length).toBeGreaterThanOrEqual(8);
      expect(k.length).toBeLessThanOrEqual(128);
    }
    expect(scoutIdempotencyKey(planId, "show", 2)).toBe(`scout-${planId}-show-a2`);
  });
});
