"use client";

// Operator controls (B plan T12), rendered only with ?ops=1. The operator key lives in a password field and in
// sessionStorage only. Every button POSTs /ops/* with Bearer <key>; one request at a time. The TAP tamper/replay/
// expired/wrong_tag buttons live in the TAP panel and use the same key.
import { useEffect, useRef, useState } from "react";
import { AgentError, agent, type OpsAction } from "@/lib/agent";
import { readOperatorKey, writeOperatorKey } from "@/lib/operatorKey";

const CONFIRM_MS = 3_000;
const REFUSED: Record<number, string> = { 401: "wrong operator key", 409: "plan not ready", 429: "too soon, try again in a few minutes", 503: "ops disabled on the agent" };

type Action = { id: string; label: string; run: (key: string) => Promise<{ ok: boolean }>; confirm?: boolean };
const op = (action: OpsAction, label: string, confirm = false): Action => ({ id: action, label, confirm, run: (k) => agent.ops(action, k) });
const ACTIONS: Action[] = [
  op("reset", "Reset", true),
  op("replay", "Replay"),
  op("live-scout", "Live scout"),
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
      const { ok } = await a.run(key);
      setResult(`${a.label}: ${ok ? "ok" : "not done"}`);
    } catch (e) {
      const why = e instanceof AgentError ? (REFUSED[e.status] ?? `HTTP ${e.status}`) : "network error";
      setResult(`${a.label} failed: ${why}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div role="region" aria-label="Operator controls" className="flex flex-wrap items-center gap-2 border-t border-border pt-3 font-mono text-(length:--text-console-label)">
      <label className="flex items-center gap-2 text-muted">
        <span>Operator key</span>
        <input
          type="password"
          name="operator-key"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => saveKey(e.target.value)}
          className="w-56 rounded-md border border-border bg-surface px-3 py-1 text-fg focus-visible:outline-2 focus-visible:outline-accent"
        />
      </label>
      {ACTIONS.map((a) => (
        <button
          key={a.id}
          type="button"
          disabled={!key || busy !== null}
          onClick={() => void fire(a)}
          className={`rounded-md border px-3 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${
            armed === a.id ? "border-danger bg-danger/15 text-danger" : "border-border bg-surface-2 text-fg hover:border-accent"
          }`}
        >
          {armed === a.id ? "Confirm reset" : a.label}
        </button>
      ))}
      <output aria-live="polite" className="text-muted">
        {result}
      </output>
    </div>
  );
}
