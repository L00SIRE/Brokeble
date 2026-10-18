"use client";

// Scripted walkthrough of the SquadTab flow, for recording a demo video with a voiceover.
// Every event below is hardcoded on a timeline; nothing here calls the venue, the agent or Cybersource.
// The live equivalent of the payment beat is `pnpm demo` in apps/venue (real Cybersource sandbox).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Who = 0 | 1 | 2;
type Stage = "INVITED" | "JOINED" | "BUDGET_LOCKED" | "VOTED" | "LINK_SENT" | "HELD" | "CAPTURED" | "RELEASED";
type Ev =
  | { at: number; kind: "scene"; title: string }
  | { at: number; kind: "caption"; text: string }
  | { at: number; kind: "msg"; who: Who; from: "me" | "tab"; text: string }
  | { at: number; kind: "typing"; who: Who; on: boolean }
  | { at: number; kind: "lane"; who: Who; stage: Stage }
  | { at: number; kind: "pay"; who: Who; state: "open" | "typing" | "processing" | "held" | "closed" }
  | { at: number; kind: "scout"; text: string }
  | { at: number; kind: "tapStart"; route: string; plan: string }
  | { at: number; kind: "tap"; n: number; ok: boolean; detail: string }
  | { at: number; kind: "business"; ok: boolean }
  | { at: number; kind: "ledger"; who: Who; status: string; id: string }
  | { at: number; kind: "counters"; converted: number; released: number }
  | { at: number; kind: "end" };

const FRIENDS = ["Alex", "Priya", "Sam"] as const;
const S = 1000;
const TAP_NAMES = ["tag", "params", "timestamps", "nonce", "key", "signature"];

const EVENTS: Ev[] = [
  { at: 0, kind: "scene", title: "1 · Everyone texts SquadTab privately" },
  { at: 0, kind: "caption", text: "Three friends want dinner and a show on Saturday. Each one texts SquadTab in a private DM." },
  { at: 0, kind: "lane", who: 0, stage: "INVITED" }, { at: 0, kind: "lane", who: 1, stage: "INVITED" }, { at: 0, kind: "lane", who: 2, stage: "INVITED" },
  { at: 0.8 * S, kind: "msg", who: 0, from: "me", text: "planning sat w/ priya + sam. dinner + a show?" },
  { at: 1.4 * S, kind: "typing", who: 0, on: true },
  { at: 2.4 * S, kind: "msg", who: 0, from: "tab", text: "On it! I'll ask everyone privately. Your budget stays between you and me 🔒" },
  { at: 2.4 * S, kind: "lane", who: 0, stage: "JOINED" },
  { at: 3.2 * S, kind: "msg", who: 1, from: "me", text: "I'm in! keep it under $45 pls" },
  { at: 3.2 * S, kind: "lane", who: 1, stage: "JOINED" },
  { at: 3.6 * S, kind: "typing", who: 1, on: true },
  { at: 4.4 * S, kind: "msg", who: 1, from: "tab", text: "Locked 🔒 Nobody else in the group can see that." },
  { at: 4.4 * S, kind: "lane", who: 1, stage: "BUDGET_LOCKED" },
  { at: 4.9 * S, kind: "msg", who: 2, from: "me", text: "max 40. and I'm vegetarian" },
  { at: 4.9 * S, kind: "lane", who: 2, stage: "JOINED" },
  { at: 5.3 * S, kind: "typing", who: 2, on: true },
  { at: 6.1 * S, kind: "msg", who: 2, from: "tab", text: "Got it 🔒 Vegetarian noted for the whole group, budget stays private." },
  { at: 6.1 * S, kind: "lane", who: 2, stage: "BUDGET_LOCKED" },
  { at: 6.6 * S, kind: "msg", who: 0, from: "me", text: "~$50 works for me" },
  { at: 7.3 * S, kind: "msg", who: 0, from: "tab", text: "Locked 🔒" },
  { at: 7.3 * S, kind: "lane", who: 0, stage: "BUDGET_LOCKED" },

  { at: 8.5 * S, kind: "scene", title: "2 · Agents scout, a private filter decides" },
  { at: 8.5 * S, kind: "caption", text: "Scout agents find real options. A private filter keeps only bundles everyone can afford, without revealing anyone's number." },
  { at: 9 * S, kind: "scout", text: "Scouting dinner + shows near Westwood…" },
  { at: 10.5 * S, kind: "scout", text: "24 options found · checking every budget privately…" },
  { at: 12 * S, kind: "scout", text: "3 bundles fit everyone · budgets never left their owner 🔒" },
  ...([0, 1, 2] as Who[]).map((who, i) => ({
    at: 12.6 * S + i * 250, kind: "msg" as const, who, from: "tab" as const,
    text: "Top 3 for Sat:\n1) Lumen Kitchen → Blue Door Comedy · $38\n2) Saffron Room → Starlight Cinema · $36\n3) Harbor Noodle → Echo Jazz Club · $42\nReply with the ones you'd do.",
  })),
  { at: 14.4 * S, kind: "msg", who: 0, from: "me", text: "1 or 3" }, { at: 14.4 * S, kind: "lane", who: 0, stage: "VOTED" },
  { at: 14.9 * S, kind: "msg", who: 1, from: "me", text: "1!!" }, { at: 14.9 * S, kind: "lane", who: 1, stage: "VOTED" },
  { at: 15.4 * S, kind: "msg", who: 2, from: "me", text: "1 or 2" }, { at: 15.4 * S, kind: "lane", who: 2, stage: "VOTED" },
  ...([0, 1, 2] as Who[]).map((who, i) => ({
    at: 16.4 * S + i * 200, kind: "msg" as const, who, from: "tab" as const,
    text: "It's #1 🎉 Lumen Kitchen 6:30 → Blue Door Comedy 8:30. $38 all-in. Nobody pays until everyone's in.",
  })),

  { at: 18.5 * S, kind: "scene", title: "3 · Each friend holds only their own share" },
  { at: 18.5 * S, kind: "caption", text: "Each friend gets a single-use link and authorizes only their own share on the merchant's Cybersource card form. It's a hold, not a charge." },
  ...([0, 1, 2] as Who[]).flatMap((who, i) => {
    const t = 19 * S + i * 2200;
    return [
      { at: t, kind: "msg" as const, who, from: "tab" as const, text: "Hold your $38 here 👉 tab-venue.vercel.app/pay/•••" },
      { at: t, kind: "lane" as const, who, stage: "LINK_SENT" as Stage },
      { at: t + 500, kind: "pay" as const, who, state: "open" as const },
      { at: t + 1000, kind: "pay" as const, who, state: "typing" as const },
      { at: t + 1600, kind: "pay" as const, who, state: "processing" as const },
      { at: t + 2100, kind: "pay" as const, who, state: "held" as const },
      { at: t + 2100, kind: "lane" as const, who, stage: "HELD" as Stage },
      { at: t + 2100, kind: "ledger" as const, who, status: "AUTHORIZED", id: ["…33303814", "…48903813", "…93403812"][i]! },
    ];
  }),
  ...([0, 1, 2] as Who[]).map((who) => ({ at: 26.4 * S, kind: "pay" as const, who, state: "closed" as const })),
  { at: 26.6 * S, kind: "msg", who: 0, from: "tab", text: "Held ✓ 3 of 3 in. Locking it in…" },
  { at: 26.6 * S, kind: "msg", who: 1, from: "tab", text: "Held ✓ 3 of 3 in. Locking it in…" },
  { at: 26.6 * S, kind: "msg", who: 2, from: "tab", text: "Held ✓ 3 of 3 in. Locking it in…" },

  { at: 27.5 * S, kind: "scene", title: "4 · The agent commits, with proof" },
  { at: 27.5 * S, kind: "caption", text: "SquadTab's agent signs the exact consent set with the Visa Trusted Agent Protocol. The merchant rebuilds it from its own records and runs six checks." },
  { at: 28 * S, kind: "tapStart", route: "POST /checkout/ord_ggznhykcfe", plan: "Plan #1" },
  ...TAP_NAMES.map((_, i) => ({
    at: 28.8 * S + i * 650, kind: "tap" as const, n: i + 1, ok: true,
    detail: ["agent-payer-auth on POST", "created, expires, keyid, alg, nonce, tag", "valid for 119 s more", "nonce unseen", "tab-agent-ed25519-1 (mock directory)", "Ed25519 signature verified"][i]!,
  })),
  { at: 32.8 * S, kind: "business", ok: true },
  ...([0, 1, 2] as Who[]).map((who, i) => ({ at: 33.6 * S + i * 300, kind: "ledger" as const, who, status: "CAPTURED", id: ["…34103814", "…94403812", "…34303814"][i]! })),
  ...([0, 1, 2] as Who[]).map((who, i) => ({ at: 33.6 * S + i * 300, kind: "lane" as const, who, stage: "CAPTURED" as Stage })),
  { at: 34.6 * S, kind: "counters", converted: 1, released: 0 },
  ...([0, 1, 2] as Who[]).map((who) => ({ at: 34.8 * S, kind: "msg" as const, who, from: "tab" as const, text: "Everyone's in 🎉 Charged $38. See you at Lumen Kitchen, 6:30!" })),

  { at: 37 * S, kind: "scene", title: "5 · Tamper-proof" },
  { at: 37 * S, kind: "caption", text: "What if someone changes the agent's request after it's signed, even by one dollar? The signature no longer matches, and nothing is captured." },
  ...([0, 1, 2] as Who[]).flatMap((who, i) => [
    { at: 37.2 * S, kind: "lane" as const, who, stage: "HELD" as Stage },
    { at: 37.2 * S, kind: "ledger" as const, who, status: "AUTHORIZED", id: ["…94703812", "…95203812", "…34603814"][i]! },
  ]),
  { at: 37.8 * S, kind: "tapStart", route: "POST /checkout/ord_llglatyr6y", plan: "Plan #2 · tampered (+$1 on one share)" },
  ...TAP_NAMES.map((_, i) => ({
    at: 38.4 * S + i * 550, kind: "tap" as const, n: i + 1, ok: i < 5,
    detail: ["agent-payer-auth on POST", "created, expires, keyid, alg, nonce, tag", "valid for 120 s more", "nonce unseen", "tab-agent-ed25519-1 (mock directory)", "content-digest mismatch: body changed after signing"][i]!,
  })),
  { at: 42 * S, kind: "business", ok: false },

  { at: 44 * S, kind: "scene", title: "6 · One friend is out → everyone is released" },
  { at: 44 * S, kind: "caption", text: "And if anyone drops out, every hold is released. Nobody ever fronts money for the group." },
  { at: 44.6 * S, kind: "msg", who: 2, from: "me", text: "ugh, can't make it anymore 😞" },
  ...([0, 1, 2] as Who[]).flatMap((who, i) => [
    { at: 46 * S + i * 300, kind: "lane" as const, who, stage: "RELEASED" as Stage },
    { at: 46 * S + i * 300, kind: "ledger" as const, who, status: "RELEASED", id: ["…94703812", "…95203812", "…34603814"][i]! },
    { at: 46.4 * S + i * 300, kind: "msg" as const, who, from: "tab" as const, text: "Plan cancelled. Nobody was charged; your pending authorization was released." },
  ]),
  { at: 47.2 * S, kind: "counters", converted: 1, released: 3 },
  { at: 50 * S, kind: "end" },
];
const DURATION = 54 * S;

type Msg = { from: "me" | "tab"; text: string; key: number };
type View = {
  scene: string; caption: string; msgs: Msg[][]; typing: boolean[]; lanes: Stage[]; pay: (Ev & { kind: "pay" })["state"][];
  scout: string | null; tap: { route: string; plan: string; steps: { n: number; ok: boolean; detail: string }[]; business: boolean | null } | null;
  ledger: { status: string; id: string }[]; counters: { converted: number; released: number }; end: boolean;
};

function viewAt(t: number): View {
  const v: View = {
    scene: "", caption: "", msgs: [[], [], []], typing: [false, false, false], lanes: ["INVITED", "INVITED", "INVITED"],
    pay: ["closed", "closed", "closed"], scout: null, tap: null, ledger: [{ status: "—", id: "" }, { status: "—", id: "" }, { status: "—", id: "" }],
    counters: { converted: 0, released: 0 }, end: false,
  };
  EVENTS.forEach((e, key) => {
    if (e.at > t) return;
    switch (e.kind) {
      case "scene": v.scene = e.title; break;
      case "caption": v.caption = e.text; break;
      case "msg": v.msgs[e.who]!.push({ from: e.from, text: e.text, key }); if (e.from === "tab") v.typing[e.who] = false; break;
      case "typing": v.typing[e.who] = e.on; break;
      case "lane": v.lanes[e.who] = e.stage; break;
      case "pay": v.pay[e.who] = e.state; break;
      case "scout": v.scout = e.text; break;
      case "tapStart": v.tap = { route: e.route, plan: e.plan, steps: [], business: null }; break;
      case "tap": v.tap?.steps.push({ n: e.n, ok: e.ok, detail: e.detail }); break;
      case "business": if (v.tap) v.tap.business = e.ok; break;
      case "ledger": v.ledger[e.who] = { status: e.status, id: e.id }; break;
      case "counters": v.counters = { converted: e.converted, released: e.released }; break;
      case "end": v.end = true; break;
    }
  });
  return v;
}

const STAGE_TONE: Record<Stage, string> = {
  INVITED: "bg-zinc-700 text-zinc-300", JOINED: "bg-zinc-600 text-white", BUDGET_LOCKED: "bg-indigo-600 text-white", VOTED: "bg-sky-600 text-white",
  LINK_SENT: "bg-amber-500 text-black", HELD: "bg-emerald-600 text-white", CAPTURED: "bg-emerald-400 text-black", RELEASED: "bg-zinc-300 text-black",
};

export function DemoPlayer() {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [captions, setCaptions] = useState(true);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = (now: number) => {
      if (last.current !== null) setT((x) => Math.min(DURATION, x + (now - last.current!) * speed));
      last.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); last.current = null; };
  }, [playing, speed]);

  useEffect(() => { if (t >= DURATION) setPlaying(false); }, [t]);

  const restart = useCallback(() => { setT(0); setPlaying(true); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        if (t >= DURATION) restart();
        else setPlaying((p) => !p);
      }
      if (e.key === "r") restart();
      if (e.key === "c") setCaptions((c) => !c);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [restart, t]);

  const v = useMemo(() => viewAt(t), [t]);

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <span className="text-lg font-semibold">SquadTab</span>
        <span className="text-sm text-zinc-400">nobody pays until everyone&apos;s in</span>
        <span className="ml-auto rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">Scripted walkthrough</span>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_380px]">
        <section aria-label="Friends' phones">
          <p className="mb-3 min-h-6 text-sm font-medium text-zinc-300" aria-live="polite">{v.scene}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {FRIENDS.map((name, i) => (
              <Phone key={name} name={name} msgs={v.msgs[i]!} typing={v.typing[i]!} pay={v.pay[i]!} />
            ))}
          </div>
        </section>

        <aside aria-label="Console" className="space-y-4">
          <Panel title="Lanes">
            {FRIENDS.map((name, i) => (
              <div key={name} className="flex items-center justify-between py-1">
                <span className="text-sm">{name} <span className="text-zinc-500">· budget 🔒</span></span>
                <span className={`rounded px-2 py-0.5 text-xs font-semibold tabular-nums transition-colors ${STAGE_TONE[v.lanes[i]!]}`}>{v.lanes[i]}</span>
              </div>
            ))}
            {v.scout ? <p className="mt-2 border-t border-zinc-800 pt-2 text-xs text-zinc-400">{v.scout}</p> : null}
          </Panel>

          <Panel title="Visa Trusted Agent Protocol · merchant verification">
            {v.tap ? (
              <>
                <p className="text-xs text-zinc-400">{v.tap.plan}</p>
                <p className="mb-2 font-mono text-xs text-zinc-300">{v.tap.route} · Ed25519</p>
                <ol className="space-y-1">
                  {TAP_NAMES.map((n, i) => {
                    const s = v.tap!.steps.find((x) => x.n === i + 1);
                    return (
                      <li key={n} className={`flex gap-2 text-xs ${s ? "" : "opacity-30"}`}>
                        <span className={`w-4 font-bold ${s ? (s.ok ? "text-emerald-400" : "text-red-400") : "text-zinc-500"}`}>{s ? (s.ok ? "✓" : "✗") : "·"}</span>
                        <span className="w-20 text-zinc-300">{i + 1} {n}</span>
                        <span className={s && !s.ok ? "text-red-300" : "text-zinc-400"}>{s?.detail ?? ""}</span>
                      </li>
                    );
                  })}
                </ol>
                {v.tap.business !== null ? (
                  <p className={`mt-2 rounded px-2 py-1 text-xs font-semibold ${v.tap.business ? "bg-emerald-950 text-emerald-300" : "bg-red-950 text-red-300"}`}>
                    {v.tap.business ? "Consent set matches · every share held → capture all" : "Rejected · nothing captured · holds untouched"}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-zinc-500">Waiting for every share to be held…</p>
            )}
          </Panel>

          <Panel title="Ledger · Cybersource sandbox">
            {FRIENDS.map((name, i) => (
              <div key={name} className="flex items-center justify-between py-1 text-sm">
                <span>{name}</span>
                <span className="tabular-nums text-zinc-300">$38.00 <span className={v.ledger[i]!.status === "CAPTURED" ? "text-emerald-400" : v.ledger[i]!.status === "RELEASED" ? "text-zinc-400" : "text-amber-300"}>{v.ledger[i]!.status}</span> <span className="font-mono text-xs text-zinc-500">{v.ledger[i]!.id}</span></span>
              </div>
            ))}
            <div className="mt-2 grid grid-cols-3 gap-2 border-t border-zinc-800 pt-2 text-center">
              <Stat label="groups converted" value={String(v.counters.converted)} />
              <Stat label="fronted by anyone" value="$0" />
              <Stat label="holds released" value={String(v.counters.released)} />
            </div>
          </Panel>
        </aside>
      </div>

      {v.end ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-zinc-950/95 p-6 text-center">
          <div>
            <p className="text-4xl font-semibold">SquadTab</p>
            <p className="mt-3 text-xl text-zinc-300">Nobody pays until everyone&apos;s in.</p>
            <p className="mx-auto mt-6 max-w-xl text-sm text-zinc-400 text-pretty">Private budgets · scout agents · one hold per friend on Cybersource · Visa Trusted Agent Protocol commit · all-or-nothing capture · release on “I&apos;m out”</p>
          </div>
        </div>
      ) : null}

      {captions && v.caption ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-16 z-10 flex justify-center px-4">
          <p className="max-w-3xl rounded-xl bg-black/80 px-4 py-2 text-center text-base text-white text-pretty">{v.caption}</p>
        </div>
      ) : null}

      <footer className="fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center gap-3 border-t border-zinc-800 bg-zinc-950 px-4 py-2">
        <button onClick={() => (t >= DURATION ? restart() : setPlaying((p) => !p))} className="h-10 min-w-24 rounded-lg bg-white px-3 text-sm font-semibold text-black">
          {playing ? "Pause" : t >= DURATION ? "Replay" : "Play"}
        </button>
        <button onClick={restart} className="h-10 rounded-lg border border-zinc-700 px-3 text-sm">Restart</button>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          Speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-sm text-white">
            {[0.75, 1, 1.25, 1.5].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} className="size-4" /> Captions
        </label>
        <input aria-label="Timeline" type="range" min={0} max={DURATION} step={100} value={t} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} className="min-w-40 flex-1" />
        <span className="w-14 text-right text-xs tabular-nums text-zinc-400">{(t / S).toFixed(1)}s</span>
        <span className="hidden text-xs text-zinc-500 md:inline">space play · r restart · c captions</span>
      </footer>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] leading-tight text-zinc-500">{label}</p>
    </div>
  );
}

function Phone({ name, msgs, typing, pay }: { name: string; msgs: Msg[]; typing: boolean; pay: View["pay"][number] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length, typing]);
  return (
    <div className="relative mx-auto flex h-[520px] w-full max-w-[260px] flex-col overflow-hidden rounded-[2rem] border-4 border-zinc-700 bg-white text-zinc-900 shadow-xl">
      <div className="border-b border-zinc-200 bg-zinc-50 px-3 pb-2 pt-3 text-center">
        <p className="text-[11px] text-zinc-500">{name}&apos;s phone</p>
        <p className="text-sm font-semibold">SquadTab</p>
      </div>
      <div ref={box} className="flex-1 space-y-1.5 overflow-y-auto px-2 py-2">
        {msgs.map((m) => (
          <div key={m.key} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
            <p className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-1.5 text-[13px] leading-snug ${m.from === "me" ? "bg-blue-500 text-white" : "bg-zinc-200 text-zinc-900"}`}>{m.text}</p>
          </div>
        ))}
        {typing ? <p className="w-12 rounded-2xl bg-zinc-200 px-3 py-1.5 text-center text-[13px] text-zinc-500">•••</p> : null}
      </div>
      {pay !== "closed" ? <PaySheet state={pay} /> : null}
    </div>
  );
}

function PaySheet({ state }: { state: View["pay"][number] }) {
  const typed = state !== "open";
  return (
    <div className="absolute inset-x-0 bottom-0 top-10 rounded-t-2xl border-t border-zinc-200 bg-white p-3 shadow-2xl">
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">SquadTab Partner Venue (demo) · Cybersource sandbox</p>
      <p className="mt-1 text-xs text-zinc-600">Prepaid dinner + show · Sat · party of 3</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">$38.00</p>
      <p className="mt-1 text-[11px] leading-snug text-zinc-600">A hold, charged only if everyone&apos;s in. Otherwise it&apos;s released.</p>
      {state === "held" ? (
        <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
          <p className="text-sm font-semibold">Held $38.00 on Visa ••1111.</p>
          <p className="text-xs text-zinc-700">Not charged yet. You&apos;ll get a text when everyone&apos;s in.</p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="h-9 rounded-lg border border-zinc-300 px-2 text-sm leading-9 text-zinc-700">{typed ? "4111 1111 1111 1111" : <span className="text-zinc-400">Card number</span>}</div>
          <div className="flex gap-2">
            <div className="h-9 flex-1 rounded-lg border border-zinc-300 px-2 text-sm leading-9 text-zinc-700">{typed ? "12 / 2028" : <span className="text-zinc-400">MM / YY</span>}</div>
            <div className="h-9 w-16 rounded-lg border border-zinc-300 px-2 text-sm leading-9 text-zinc-700">{typed ? "•••" : <span className="text-zinc-400">CVC</span>}</div>
          </div>
          <div className="h-10 rounded-lg bg-zinc-900 text-center text-sm font-semibold leading-10 text-white">{state === "processing" ? "Holding…" : "Hold $38.00"}</div>
        </div>
      )}
    </div>
  );
}
