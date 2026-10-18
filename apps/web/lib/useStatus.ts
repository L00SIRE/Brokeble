"use client";

// Polls GET /status for a status token with the cadence in ux-flow §4.3 (see statusPhase.ts for the pure rules).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchStatus, type StatusOutcome } from "./agentRequest";
import { initialPoll, nextPollDelay, type PollEvent, type PollState, pollReducer, STOP_AFTER_MS } from "./statusPhase";

export type StatusFetcher = (token: string, opts: { signal: AbortSignal }) => Promise<StatusOutcome>;

export type StatusPoll = PollState & {
  /** True once the 15-minute window has run out; `restart()` opens a new one. */
  stopped: boolean;
  restart: () => void;
};

type Run = { key: string | null; token: string | null; poll: PollState; stopped: boolean };

export const statusEvent = (out: StatusOutcome): PollEvent =>
  out.kind === "ok" ? { type: "ok", data: out.data } : out.kind === "expired" ? { type: "expired" } : out.kind === "rate_limited" ? { type: "rate_limited" } : { type: "failed" };

const defaultFetcher: StatusFetcher = (token, opts) => fetchStatus(token, opts);

/**
 * Polls immediately, then every 2 s while the tab is visible, every 10 s after 2 minutes, and stops after 15 minutes,
 * on a 401 or once the plan is closed. Returning to the tab (from Messages) polls at once. Pass `null` to stay idle.
 */
export function useStatus(token: string | null, fetcher: StatusFetcher = defaultFetcher): StatusPoll {
  const [epoch, setEpoch] = useState(0);
  const runKey = token ? `${epoch}:${token}` : null;
  const [run, setRun] = useState<Run>({ key: null, token: null, poll: initialPoll, stopped: false });
  // Last good response per token: a restart keeps showing it instead of flashing back to "waiting".
  const last = useRef<{ token: string; poll: PollState } | null>(null);

  useEffect(() => {
    if (!token || !runKey) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inflight: AbortController | null = null;
    let current: PollState = last.current?.token === token ? { ...initialPoll, data: last.current.poll.data } : initialPoll;
    const startedAt = Date.now();
    const visible = () => document.visibilityState === "visible";

    const schedule = () => {
      clearTimeout(timer);
      const elapsed = Date.now() - startedAt;
      const delay = nextPollDelay(current, elapsed, visible());
      if (delay !== null) timer = setTimeout(poll, delay);
      else if (elapsed >= STOP_AFTER_MS) setRun((r) => (r.key === runKey ? { ...r, stopped: true } : r));
    };

    async function poll() {
      if (inflight || cancelled) return;
      inflight = new AbortController();
      const out = await fetcher(token as string, { signal: inflight.signal });
      inflight = null;
      if (cancelled) return;
      current = pollReducer(current, statusEvent(out));
      last.current = { token: token as string, poll: current };
      setRun({ key: runKey, token, poll: current, stopped: false });
      schedule();
    }

    const onVisibility = () => {
      if (!visible() || inflight || current.expired || current.data?.phase === "closed") return;
      if (Date.now() - startedAt >= STOP_AFTER_MS) return;
      clearTimeout(timer);
      void poll();
    };

    document.addEventListener("visibilitychange", onVisibility);
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      inflight?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token, runKey, fetcher]);

  const restart = useCallback(() => setEpoch((n) => n + 1), []);
  return useMemo(() => {
    if (run.key === runKey) return { ...run.poll, stopped: run.stopped, restart };
    // Restarting the same token: keep the last data visible until the first poll of the new window lands.
    const carried = run.token === token && token ? { ...initialPoll, data: run.poll.data } : initialPoll;
    return { ...carried, stopped: false, restart };
  }, [run, runKey, token, restart]);
}
