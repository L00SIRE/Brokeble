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

const FRIENDS = ["Christian", "Dawson", "Suman"] as const;
const S = 1000;
const TAP_NAMES = ["tag", "params", "timestamps", "nonce", "key", "signature"];
const AMT = 29; // all-in per person, the same for everyone
const TITLE = "Noodle Lab → Open Mic at The Cellar";
const EVERY: Who[] = [0, 1, 2];
const C = 0 as Who, D = 1 as Who, SU = 2 as Who;

// Message copy below is the agent's real template text (packages/shared/src/templates.ts).
const me = (at: number, who: Who, text: string): Ev[] => [{ at: at * S, kind: "msg", who, from: "me", text }];
const tab = (at: number, who: Who, text: string): Ev[] => [
  { at: at * S - 700, kind: "typing", who, on: true },
  { at: at * S, kind: "msg", who, from: "tab", text },
];
const tabAll = (at: number, text: (who: Who) => string, gap = 0.25): Ev[] => EVERY.flatMap((w, i) => tab(at + i * gap, w, text(w)));
const lane = (at: number, who: Who, stage: Stage): Ev[] => [{ at: at * S, kind: "lane", who, stage }];
const laneAll = (at: number, stage: Stage): Ev[] => EVERY.flatMap((w) => lane(at, w, stage));

const PICKS =
  "Okay, found 3 plans that work for everyone:\n" +
  "1. Noodle Lab → Open Mic at The Cellar · dinner 6:30 PM → show 8:30 PM · $29 pp all-in\n" +
  "2. Taco Garage → Rooftop Movie Night · dinner 6:45 PM → show 8:45 PM · $27 pp all-in\n" +
  "3. Curry Corner → Improv Jam · dinner 7:00 PM → show 9:00 PM · $30 pp all-in\n" +
  "Tell me which ones you'd be happy with (like '1 3'), or just say it in your own words.";

function holdFlow(at: number, who: Who, idTail: string): Ev[] {
  return [
    ...tab(at, who, `Here's your share for ${TITLE}: $${AMT}. It's only a hold, and it turns into a charge only if everyone's in by Sat 5:00 PM. Otherwise it's released. tab-venue.vercel.app/pay/•••`),
    ...lane(at, who, "LINK_SENT"),
    { at: at * S + 700, kind: "pay", who, state: "open" },
    { at: at * S + 1300, kind: "pay", who, state: "typing" },
    { at: at * S + 1900, kind: "pay", who, state: "processing" },
    { at: at * S + 2400, kind: "pay", who, state: "held" },
    ...lane(at + 2.4, who, "HELD"),
    { at: at * S + 2400, kind: "ledger", who, status: "AUTHORIZED", id: idTail },
    { at: at * S + 3300, kind: "pay", who, state: "closed" },
    ...tab(at + 3.6, who, `All set, I'm holding $${AMT} on your Visa ••1111. Not charged yet.`),
  ];
}

const EVENTS: Ev[] = [
  // 1 · joining
  { at: 0, kind: "scene", title: "1 · Everyone texts SquadTab privately" },
  { at: 0, kind: "caption", text: "Midterms are over. Christian just got his first paycheck. Dawson wants to celebrate. Suman has 27 dollars until Friday." },
  ...laneAll(0, "INVITED"),
  ...me(0.6, C, "JOIN 4821"), ...lane(0.6, C, "JOINED"),
  ...tab(1.5, C, "Hey, you're in for Post-midterms night out, Sat Oct 24! Two quick questions and I'll get planning. Whatever you tell me stays between us."),
  ...me(1.2, D, "JOIN 4821"), ...lane(1.2, D, "JOINED"),
  ...tab(2.1, D, "Hey, you're in for Post-midterms night out, Sat Oct 24! Two quick questions and I'll get planning. Whatever you tell me stays between us."),
  ...me(1.8, SU, "JOIN 4821"), ...lane(1.8, SU, "JOINED"),
  ...tab(2.7, SU, "Hey, you're in for Post-midterms night out, Sat Oct 24! Two quick questions and I'll get planning. Whatever you tell me stays between us."),
  ...tabAll(3.8, () => "First up: what's the most you'd want to spend tonight on dinner + show tickets, all-in per person (tax and tip included)? Most nights land around $50–80. Totally private. Nobody in the group, and no other agent, ever sees it."),
  { at: 5 * S, kind: "caption", text: "Each one answers in their own DM. Nobody in the group sees anyone else's number. Not the friends, not their agents." },
  ...me(5.2, C, "just got my first paycheck 💸 100 max, let's go big"),
  ...me(5.8, SU, "ok real talk. I have $27 to my name until friday 😭 like 30 max"),
  ...me(6.2, D, "50ish?"),
  ...tab(6.6, C, "Got it. Just between us: aim ~$80, never over $100. Text 'change budget' anytime."), ...lane(6.6, C, "BUDGET_LOCKED"),
  ...tab(7.1, SU, "Got it. Just between us: aim ~$25, never over $30. Text 'change budget' anytime."), ...lane(7.1, SU, "BUDGET_LOCKED"),
  ...tab(7.5, D, "Got it. Just between us: aim ~$45, never over $55. Text 'change budget' anytime."), ...lane(7.5, D, "BUDGET_LOCKED"),

  // 2 · scouting + private filter
  { at: 8.6 * S, kind: "scene", title: "2 · Agents scout, a private filter decides" },
  ...tabAll(8.8, () => "Last one: anything you're craving, can't eat, or want to steer clear of tonight?"),
  ...me(10.2, C, "omakase 🍣🍣🍣"),
  ...me(10.6, D, "no seafood, I'm allergic lol"),
  ...me(11.0, SU, "anything with free refills"),
  ...tabAll(11.8, () => "Still on it! Checking what's actually open and fun tonight."),
  { at: 11.8 * S, kind: "caption", text: "A scout agent searches the real web. Then plain code keeps only plans that fit everyone's private cap, and never says whose." },
  { at: 12.2 * S, kind: "scout", text: "Scout: 24 dinner + show combos near Westwood…" },
  { at: 13.6 * S, kind: "scout", text: "Private filter: 21 removed (omakase included). Nobody learns why." },
  { at: 15.0 * S, kind: "scout", text: "3 plans fit everyone · budgets never left their owner 🔒" },
  ...tabAll(15.6, () => PICKS),
  ...me(17.6, C, "wait where's the omakase 😭 ok which one of you is broke"),
  { at: 17.6 * S, kind: "caption", text: "The omakase got quietly filtered out. Christian wants a name. SquadTab won't give one." },
  ...tab(18.6, C, "I only know yours. Everyone's budget stays between them and me."),
  ...me(19.4, SU, "1 3"), ...lane(19.4, SU, "VOTED"),
  ...me(19.9, D, "1 or 2, no fish pls"), ...lane(19.9, D, "VOTED"),
  ...me(20.4, C, "fine. 1 actually sounds fun"), ...lane(20.4, C, "VOTED"),
  ...tabAll(21.4, () => `We have a winner: ${TITLE}! Your hold link is on its way. Nobody's charged unless everyone's in.`),

  // 3 · holds
  { at: 23 * S, kind: "scene", title: "3 · Each friend holds only their own share" },
  { at: 23 * S, kind: "caption", text: "Everyone gets a single-use link and holds only their own share on the merchant's Cybersource card form. A hold, not a charge." },
  ...holdFlow(23.2, D, "…48903813"),
  ...tab(27.4, C, "1 of 3 are in!"), ...tab(27.4, SU, "1 of 3 are in!"),
  ...holdFlow(27.8, C, "…33303814"),
  ...tab(32.0, D, "2 of 3 are in!"), ...tab(32.0, SU, "2 of 3 are in!"),
  ...me(32.6, SU, "my bank app just asked if I'm okay"),
  ...holdFlow(33.2, SU, "…93403812"),

  // 4 · commit with proof
  { at: 37.6 * S, kind: "scene", title: "4 · The agent commits, with proof" },
  { at: 37.6 * S, kind: "caption", text: "Everyone's held. SquadTab's agent signs the exact consent set with the Visa Trusted Agent Protocol. The merchant rebuilds it and runs six checks." },
  { at: 38 * S, kind: "tapStart", route: "POST /checkout/ord_ggznhykcfe", plan: `Plan #1 · ${TITLE}` },
  ...TAP_NAMES.map((_, i) => ({
    at: 38.6 * S + i * 600, kind: "tap" as const, n: i + 1, ok: true,
    detail: ["agent-payer-auth on POST", "created, expires, keyid, alg, nonce, tag", "valid for 119 s more", "nonce unseen", "tab-agent-ed25519-1 (mock directory)", "Ed25519 signature verified"][i]!,
  })),
  { at: 42.4 * S, kind: "business", ok: true },
  ...EVERY.flatMap((w, i) => [
    { at: 43 * S + i * 300, kind: "ledger" as const, who: w, status: "CAPTURED", id: ["…34103814", "…94403812", "…34303814"][i]! },
    ...lane(43 + i * 0.3, w, "CAPTURED"),
  ]),
  { at: 44 * S, kind: "counters", converted: 1, released: 0 },
  ...tabAll(44.2, () => `Everyone's in, so you're booked for ${TITLE}! Charged $${AMT}.`),
  ...tabAll(45.6, () => "Your night, all planned: squadtab.app/i/••• · Add it to your calendar: squadtab.app/ics/•••"),
  ...me(47.0, SU, "first group plan where I didn't have to fake a stomachache 🙏"),
  { at: 47 * S, kind: "caption", text: "Suman is in. Nobody fronted money, nobody chased anyone, and nobody ever knew who set the cap." },

  // 5 · tamper
  { at: 50.5 * S, kind: "scene", title: "5 · Next weekend: someone tampers with the request" },
  { at: 50.5 * S, kind: "caption", text: "Plan #2. If anyone changes the agent's signed request, even by one dollar, the signature no longer matches and nothing is captured." },
  ...EVERY.flatMap((w, i) => [
    ...lane(50.7, w, "HELD"),
    { at: 50.7 * S, kind: "ledger" as const, who: w, status: "AUTHORIZED", id: ["…94703812", "…95203812", "…34603814"][i]! },
  ]),
  { at: 51.2 * S, kind: "tapStart", route: "POST /checkout/ord_llglatyr6y", plan: "Plan #2 · tampered (+$1 on one share)" },
  ...TAP_NAMES.map((_, i) => ({
    at: 51.8 * S + i * 500, kind: "tap" as const, n: i + 1, ok: i < 5,
    detail: ["agent-payer-auth on POST", "created, expires, keyid, alg, nonce, tag", "valid for 120 s more", "nonce unseen", "tab-agent-ed25519-1 (mock directory)", "content-digest mismatch: body changed after signing"][i]!,
  })),
  { at: 55 * S, kind: "business", ok: false },

  // 6 · I'm out
  { at: 57 * S, kind: "scene", title: "6 · Christian gets called into a shift → everyone is released" },
  { at: 57 * S, kind: "caption", text: "And when someone bails, every hold is released. Nobody's told why, and nobody's out a single dollar." },
  ...me(57.4, C, "I'm out 😩 manager called me in for a double"),
  ...tab(58.4, C, "No problem, you're out of Taco Garage → Rooftop Movie Night. Nobody's told why."),
  ...EVERY.flatMap((w, i) => [
    ...lane(59 + i * 0.3, w, "RELEASED"),
    { at: 59 * S + i * 300, kind: "ledger" as const, who: w, status: "RELEASED", id: ["…94703812", "…95203812", "…34603814"][i]! },
  ]),
  ...tab(59.8, D, "Plan's off. Nobody was charged; your pending authorization was released."),
  ...tab(60.1, SU, "Plan's off. Nobody was charged; your pending authorization was released."),
  { at: 60.4 * S, kind: "counters", converted: 1, released: 3 },
  ...me(61.4, SU, "honestly the most financially responsible group chat I've ever been in"),
  { at: 64 * S, kind: "end" },
];
const DURATION = 68 * S;

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
                <span className="tabular-nums text-zinc-300">{"$" + AMT}.00 <span className={v.ledger[i]!.status === "CAPTURED" ? "text-emerald-400" : v.ledger[i]!.status === "RELEASED" ? "text-zinc-400" : "text-amber-300"}>{v.ledger[i]!.status}</span> <span className="font-mono text-xs text-zinc-500">{v.ledger[i]!.id}</span></span>
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
  // Mirrors app/pay/[token] (PayForm + StateCard) on the shared Cybersource sandbox merchant.
  const typed = state !== "open";
  const field = "h-8 rounded-lg border border-zinc-300 bg-white px-2 text-[12px] leading-8 text-zinc-700";
  return (
    <div className="absolute inset-x-0 bottom-0 top-10 overflow-hidden rounded-t-2xl border-t border-zinc-200 bg-white px-3 pt-3 shadow-2xl">
      <p className="text-[9px] font-medium uppercase leading-tight tracking-wide text-zinc-500">SquadTab Partner Venue (demo) · Cybersource sandbox · shared public test merchant</p>
      <p className="mt-1 text-[12px] font-semibold">Prepaid dinner + show bundle</p>
      <p className="text-[11px] leading-snug text-zinc-600">2026-10-24 · dinner 6:30 PM · show 8:30 PM · party of 3</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">${AMT}.00</p>
      <p className="text-[10px] leading-snug text-zinc-600">This is a hold. It&apos;s charged only if everyone&apos;s in by Sat 5:00 PM; otherwise it&apos;s released.</p>
      {state === "held" ? (
        <div aria-live="polite" className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
          <p className="text-[13px] font-semibold">Held ${AMT}.00 on Visa ••1111.</p>
          <p className="text-[11px] text-zinc-700">Not charged yet. You&apos;ll get a text when everyone&apos;s in.</p>
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[9px] leading-snug text-amber-900">Test cards only. This is Cybersource&apos;s shared public sandbox: use 4111 1111 1111 1111, any future expiry, any CVC, and a made-up name.</p>
          <div className={field}>{typed ? "Test Payer" : <span className="text-zinc-400">Name on card</span>}</div>
          <div className={field}>{typed ? "4111 1111 1111 1111" : <span className="text-zinc-400">Card number</span>}</div>
          <div className="flex gap-1.5">
            <div className={`${field} flex-1`}>{typed ? "12" : <span className="text-zinc-400">MM</span>}</div>
            <div className={`${field} flex-1`}>{typed ? "2028" : <span className="text-zinc-400">YYYY</span>}</div>
            <div className={`${field} flex-1`}>{typed ? "•••" : <span className="text-zinc-400">CVC</span>}</div>
          </div>
          <div className={field}>{typed ? "90024" : <span className="text-zinc-400">ZIP</span>}</div>
          <div className="h-9 rounded-xl bg-zinc-900 text-center text-[13px] font-semibold leading-9 text-white">{state === "processing" ? "Holding…" : `Hold $${AMT}.00`}</div>
        </div>
      )}
    </div>
  );
}
