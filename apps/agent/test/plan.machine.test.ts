// plan/machine.ts: stage ordering and the conditional-UPDATE transition (unit; SQL shape via a fake tx).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const queries: { text: string; values: unknown[] }[] = [];
  let rows: unknown[] = [];
  const tx = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      // Nested fragments (tx`` / tx`, version = …`) are passed back as their text; the outer query returns `rows`.
      const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? (typeof values[i] === "object" && values[i] && "frag" in (values[i] as object) ? (values[i] as { frag: string }).frag : "$") : ""), "");
      const isOuter = text.includes("update app.plans");
      if (!isOuter) return { frag: text };
      queries.push({ text, values });
      return Promise.resolve(rows);
    },
    { array: (a: unknown[]) => a },
  );
  return {
    queries,
    setRows: (r: unknown[]) => (rows = r),
    tx,
    emit: vi.fn(async () => 1),
    begin: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
});
vi.mock("../src/db", () => ({ sql: { begin: m.begin } }));
vi.mock("../src/events", () => ({ emit: m.emit }));

import { stageAtLeast, transition } from "../src/plan/machine";

const planId = "3f1c2b8e-6a0d-4c1f-9e2a-7b5d4c3a2f10";

describe("stageAtLeast", () => {
  it("orders INVITED..CAPTURED and treats terminal stages as never ≥ anything", () => {
    expect(stageAtLeast("PREFS_DONE", "PREFS_DONE")).toBe(true);
    expect(stageAtLeast("VOTED", "PREFS_DONE")).toBe(true);
    expect(stageAtLeast("CAPTURED", "INVITED")).toBe(true);
    expect(stageAtLeast("BUDGET_LOCKED", "PREFS_DONE")).toBe(false);
    expect(stageAtLeast("DECLINED", "INVITED")).toBe(false);
    expect(stageAtLeast("RELEASED", "INVITED")).toBe(false);
    expect(stageAtLeast("HELD", "DECLINED")).toBe(false);
  });
});

describe("transition", () => {
  beforeEach(() => {
    m.queries.length = 0;
    vi.clearAllMocks();
  });

  it("winner: one guarded UPDATE, plan.state emitted in the same tx with the exact prior state, then inTx", async () => {
    m.setRows([{ id: planId, version: 3, from_state: "VOTING" }]);
    const inTx = vi.fn(async () => {});
    const t = await transition(planId, ["RESEARCHING", "VOTING"], "CANCELLED", { version: 3, inTx });
    expect(t).toEqual({ id: planId, version: 3, from_state: "VOTING" });
    expect(m.queries).toHaveLength(1);
    const q = m.queries[0]!;
    expect(q.text).toContain("for update");
    expect(q.text).toContain("and p.version = $");
    expect(q.text).not.toContain("version = p.version + 1");
    expect(q.values).toContainEqual(["RESEARCHING", "VOTING"]);
    expect(m.emit).toHaveBeenCalledWith({ type: "plan.state", plan_id: planId, from: "VOTING", to: "CANCELLED", version: 3 }, m.tx);
    expect(inTx).toHaveBeenCalledWith(m.tx, t);
  });

  it("bumpVersion adds the version increment; a single from-state is wrapped in an array", async () => {
    m.setRows([{ id: planId, version: 4, from_state: "VOTING" }]);
    await transition(planId, "VOTING", "VOTING", { bumpVersion: true });
    expect(m.queries[0]!.text).toContain("version = p.version + 1");
    expect(m.queries[0]!.values).toContainEqual(["VOTING"]);
  });

  it("loser: returns null, emits nothing, never runs inTx", async () => {
    m.setRows([]);
    const inTx = vi.fn(async () => {});
    expect(await transition(planId, "COLLECTING", "RESEARCHING", { inTx })).toBeNull();
    expect(m.emit).not.toHaveBeenCalled();
    expect(inTx).not.toHaveBeenCalled();
  });

  it("SHOWCASE never transitions", async () => {
    await expect(transition(planId, "SHOWCASE", "VOTING")).rejects.toThrow(/SHOWCASE/);
    await expect(transition(planId, "COLLECTING", "SHOWCASE")).rejects.toThrow(/SHOWCASE/);
    expect(m.begin).not.toHaveBeenCalled();
  });
});
