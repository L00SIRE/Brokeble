"use client";

import { SseEvent } from "@tab/shared";
import { useEffect, useState, type Dispatch } from "react";
import { AgentError, agent, eventsUrl } from "./agent";
import type { ConsoleAction } from "./consoleReducer";

export type ConsoleStreamStatus = "idle" | "connecting" | "open" | "reconnecting" | "unauthorized";

const RETRY_MAX_MS = 5_000;

/**
 * Snapshot first, then SSE from `?last_id=<snapshot.last_id>`: nothing between the two is lost, and the reducer drops
 * any id it already applied. EventSource reconnects by itself with Last-Event-ID; if the browser gives up on it
 * (e.g. the agent restarted behind a proxy), the whole open sequence restarts. Invalid frames are dropped and counted.
 */
export function useConsoleStream(key: string | null, dispatch: Dispatch<ConsoleAction>) {
  const [status, setStatus] = useState<ConsoleStreamStatus>("idle");
  const [invalidCount, setInvalidCount] = useState(0);

  useEffect(() => {
    if (!key) return;
    let stopped = false;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const open = async (first: number) => {
      let attempt = first;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      const retry = () => {
        if (!stopped) timer = setTimeout(() => void open(attempt + 1), Math.min(500 * 2 ** attempt, RETRY_MAX_MS));
      };
      try {
        const snapshot = await agent.snapshot(key);
        if (stopped) return;
        dispatch({ type: "snapshot", snapshot, receivedAt: Date.now() });
        const source = new EventSource(`${eventsUrl(key)}&last_id=${snapshot.last_id}`);
        es = source;
        source.onopen = () => {
          attempt = 0; // healthy again: the next outage backs off from the start
          setStatus("open");
        };
        source.onerror = () => {
          setStatus("reconnecting");
          if (source.readyState === EventSource.CLOSED) {
            source.close();
            retry();
          }
        };
        source.onmessage = (e: MessageEvent<string>) => {
          let parsed: ReturnType<typeof SseEvent.safeParse> | null = null;
          try {
            parsed = SseEvent.safeParse(JSON.parse(e.data));
          } catch {
            // falls through to the invalid counter
          }
          const id = Number(e.lastEventId);
          if (parsed?.success && Number.isSafeInteger(id)) dispatch({ type: "frame", frame: { id, event: parsed.data, receivedAt: Date.now() } });
          else setInvalidCount((n) => n + 1);
        };
      } catch (err) {
        if (stopped) return;
        if (err instanceof AgentError && (err.status === 401 || err.status === 503)) return setStatus("unauthorized");
        setStatus("reconnecting");
        retry();
      }
    };

    void open(0);
    return () => {
      stopped = true;
      clearTimeout(timer);
      es?.close();
    };
  }, [key, dispatch]);

  return { status, invalidCount };
}
