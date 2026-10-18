"use client";

// Operator controls (B plan T12), rendered only with ?ops=1. The operator key lives in a password field and in
// sessionStorage only. Every button POSTs /ops/* with Bearer <key>; one request at a time. The TAP tamper/replay/
// expired/wrong_tag buttons live in the TAP panel and use the same key.
import { useEffect, useRef, useState } from "react";
import { AgentError, agent, type OpsAction } from "@/lib/agent";
import { readOperatorKey, writeOperatorKey } from "@/lib/operatorKey";
import { MONO } from "./Panel";

const CONFIRM_MS = 3_000;
const REFUSED: Record<number, string> = { 401: "wrong operator key", 409: "plan not ready", 429: "too soon, try again in a few minutes", 503: "ops disabled on the agent" };

type Action = { id: string; label: string; run: (key: string) => Promise<{ ok: boolean; released?: number }>; confirm?: boolean };
const op = (action: OpsAction, label: string, confirm = false): Action => ({ id: action, label, confirm, run: (k) => agent.ops(action, k) });
const ACTIONS: Action[] = [
  op("reset", "Reset", true),
  op("replay", "Replay"),
  op("live-scout", "Live scout"),
  op("release-untexted", "Release untexted"),
  op("release-seats", "Release seats"),
];

export function OpsBar() {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [result, setResult] = useState("");
  const armTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setKey(readOperatorKey());
    return () => clearTimeout(armTimer.current);
  }, []);

  const saveKey = (value: string) => {
    setKey(value);
    writeOperatorKey(value);
  };

  const fire = async (a: Action) => {
    // Destructive actions need a second click within a few seconds, so a stray tap mid-demo can't wipe the plan.
    if (a.confirm && armed !== a.id) {
      setArmed(a.id);
      clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmed(null), CONFIRM_MS);
      return;
    }
    clearTimeout(armTimer.current);
    setArmed(null);
    setBusy(a.id);
    setResult(`${a.label}…`);
    try {
      const { ok, released } = await a.run(key);
      const freed = released === undefined ? "" : `, ${released} ${released === 1 ? "seat" : "seats"} freed`;
      setResult(`${a.label}: ${ok ? `ok${freed}` : "not done"}`);
    } catch (e) {
      const why = e instanceof AgentError ? (REFUSED[e.status] ?? `HTTP ${e.status}`) : "network error";
      setResult(`${a.label} failed: ${why}`);
    } finally {
      setBusy(null);
    }
  };

  // Console scale and tokens (design-system §7): 13px mono like the footer, 44px targets, sentence-case labels, no red.
  // The armed reset gets a 2px held-edge outline (sodium on ink, ink on paper, so it keeps 3:1 on both grounds).
  return (
    <div role="region" aria-label="Operator controls" className={`${MONO} flex flex-wrap items-center gap-2 border-t border-(--c-rule) pt-3 text-[13px] text-(--c-2)`}>
      <label className="flex items-center gap-2">
        <span>Operator key</span>
        <input
          type="password"
          name="operator-key"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => saveKey(e.target.value)}
          className="min-h-11 w-56 rounded-[4px] border border-(--c-line) bg-transparent px-3 text-(--c-fg)"
        />
      </label>
      {ACTIONS.map((a) => (
        <button
          key={a.id}
          type="button"
          disabled={!key || busy !== null}
          aria-busy={busy === a.id}
          onClick={() => void fire(a)}
          className={`min-h-11 touch-manipulation rounded-[4px] border px-3 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            armed === a.id ? "border-2 border-(--c-held-edge) text-(--c-held-edge)" : "border-(--c-line) text-(--c-fg) hover:border-(--c-fg)"
          }`}
        >
          {armed === a.id ? "Confirm reset" : a.label}
        </button>
      ))}
      <output aria-live="polite">{result}</output>
    </div>
  );
}
