"use client";

import { SseEvent } from "@tab/shared";
import { useEffect, useRef, useState } from "react";
import { eventsUrl } from "./agent";

export type StreamStatus = "idle" | "connecting" | "open" | "reconnecting";

/**
 * Subscribes to GET /events?k=. On a dropped connection the browser reconnects by itself and
 * sends Last-Event-ID (the server sets `id:`), so replay needs no client code. Frames are
 * validated against SseEvent; invalid ones are dropped and counted.
 * `onEvent` receives the numeric SSE id so a reducer can skip ids it already applied.
 */
export function useEventStream(key: string | null, onEvent: (event: SseEvent, id: number) => void) {
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [invalidCount, setInvalidCount] = useState(0);
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });

  useEffect(() => {
    if (!key) return;
    setStatus("connecting");
    const es = new EventSource(eventsUrl(key));
    es.onopen = () => setStatus("open");
    es.onerror = () => setStatus("reconnecting");
    es.onmessage = (e: MessageEvent<string>) => {
      let data: unknown;
      try {
        data = JSON.parse(e.data);
      } catch {
        setInvalidCount((n) => n + 1);
        return;
      }
      const parsed = SseEvent.safeParse(data);
      if (parsed.success) handler.current(parsed.data, Number(e.lastEventId));
      else setInvalidCount((n) => n + 1);
    };
    return () => es.close();
  }, [key]);

  return { status, invalidCount };
}
