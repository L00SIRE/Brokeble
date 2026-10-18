"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Capture = { jwt: string; clientLibrary: string; clientLibraryIntegrity: string };
type Saved = { brand: string | null; last4: string | null } | null;
type View = "ready" | "processing" | "held" | "declined" | "cancelled" | "expired" | "unconfirmed" | "form_failed" | "already_held" | "booked";
type Result = { state: string; card?: { brand: string | null; last4: string | null } | null; retry_url?: string; error?: string };

const YEARS = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() + i);
const inputCls = "field";
const btnCls = "btn-ink";

export function PayForm(p: {
  token: string; amountLabel: string; mode: "live" | "mock"; capture: Capture | null; initialFailed: boolean;
  saved: Saved; sandboxFallback: boolean; sharedSandbox: boolean;
}) {
  const [view, setView] = useState<View>(p.initialFailed ? "form_failed" : "ready");
  const [useSaved, setUseSaved] = useState(!!p.saved);
  const [saveCard, setSaveCard] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [card, setCard] = useState<Result["card"]>(null);
  const [retry, setRetry] = useState<string | null>(null);
  const micro = useRef<any>(null);
  const live = p.mode === "live";
  const showFields = !useSaved;

  // Load Microform once, only when we need card entry.
  useEffect(() => {
    if (!live || !p.capture || !showFields || micro.current) return;
    const s = document.createElement("script");
    s.src = p.capture.clientLibrary;
    s.integrity = p.capture.clientLibraryIntegrity;
    s.crossOrigin = "anonymous";
    s.async = true;
    s.onload = () => {
      try {
        const flex = new (window as any).Flex(p.capture!.jwt);
        const m = flex.microform("card", { styles: { input: { "font-size": "16px" } } });
        m.createField("number", { placeholder: "Card number" }).load("#cc-number");
        m.createField("securityCode", { placeholder: "CVC" }).load("#cc-cvc");
        micro.current = m;
      } catch {
        setView("form_failed");
      }
    };
    s.onerror = () => setView("form_failed");
    document.head.appendChild(s);
  }, [live, p.capture, showFields]);

  async function post(body: Record<string, unknown>) {
    setView("processing");
    try {
      const r = await fetch(`/api/pay/${encodeURIComponent(p.token)}/authorize`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const j = (await r.json()) as Result;
      if (!r.ok) { setErr(j.error === "card_required" ? "Enter your card details." : "Something went wrong. Try again."); setView("ready"); return; }
      if (j.card !== undefined) setCard(j.card);
      if (j.retry_url) setRetry(j.retry_url);
      setView((["held", "declined", "cancelled", "expired", "unconfirmed", "already_held", "booked"].includes(j.state) ? j.state : "unconfirmed") as View);
    } catch {
      setView("unconfirmed"); // a network drop mid-authorization: the venue reverses by transactionId if needed
    }
  }

  function billTo(f: FormData) {
    const name = String(f.get("name") ?? "").trim() || "Card Holder";
    const [first, ...rest] = name.split(/\s+/);
    return { first_name: first!, last_name: rest.join(" "), postal_code: String(f.get("zip") ?? "").trim() || "90024" };
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const f = new FormData(e.currentTarget);
    if (useSaved) return void post({ save_card: false, bill_to: billTo(f) });
    if (!live) return void post({ save_card: saveCard, bill_to: billTo(f) });
    if (!micro.current) return setErr("The card form is still loading.");
    if (!String(f.get("zip") ?? "").trim() || !String(f.get("name") ?? "").trim()) return setErr("Add the name on the card and your ZIP.");
    setView("processing");
    micro.current.createToken({ expirationMonth: String(f.get("mm")), expirationYear: String(f.get("yyyy")) }, (cErr: any, token: string) => {
      if (cErr) { setErr(cErr.message ?? "Check your card details."); setView("ready"); return; }
      void post({ transientTokenJwt: token, save_card: saveCard, bill_to: billTo(f) });
    });
  }

  if (view === "held") {
    return (
      <Banner tone="good" title={`Held ${p.amountLabel}${card?.last4 ? ` on ${label(card.brand)} ••${card.last4}` : ""}.`}>
        Not charged yet. You&apos;ll get a text when everyone&apos;s in.
      </Banner>
    );
  }
  if (view === "already_held") return <Banner tone="good" title="Your hold is in place.">Not charged yet.</Banner>;
  if (view === "booked") return <Banner tone="good" title="Everyone's in.">Charged {p.amountLabel}.</Banner>;
  if (view === "cancelled") return <Banner title="Plan cancelled.">Nobody was charged; your pending authorization was released.</Banner>;
  if (view === "expired") return <Banner title="This link has expired or was already used.">Text SquadTab for a fresh one.</Banner>;
  if (view === "unconfirmed") return <Banner tone="bad" title="We couldn't confirm your hold.">Nothing has been charged. You&apos;ll get a fresh link in about a minute.</Banner>;
  if (view === "declined") {
    return (
      <Banner tone="bad" title="That card didn't go through.">
        Only you see this.
        {retry ? <a className={`${btnCls} mt-4 flex items-center justify-center`} href={retry}>Try another card</a> : null}
      </Banner>
    );
  }
  if (view === "form_failed") {
    return (
      <Banner tone="bad" title="The secure card form didn't load.">
        Reload to try again.
        <button className={`${btnCls} mt-4`} onClick={() => location.reload()}>Reload</button>
        {p.sandboxFallback ? <Fallback post={post} /> : null}
      </Banner>
    );
  }

  const busy = view === "processing";
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3" aria-busy={busy}>
      {useSaved ? (
        <>
          <button className={btnCls} disabled={busy}>{busy ? "Holding…" : `Hold ${p.amountLabel} on ${label(p.saved?.brand)} ••${p.saved?.last4 ?? ""}`}</button>
          <button type="button" className="h-11 w-full text-base underline underline-offset-4" onClick={() => setUseSaved(false)}>Use a different card</button>
        </>
      ) : (
        <>
          {p.sharedSandbox ? (
            <p className="rounded-[6px] border-2 border-dotted border-[#100e0a] bg-[#ede6d6] p-3 text-[14px] leading-snug text-pretty">
              Test cards only. This is Cybersource&apos;s shared public sandbox: use 4111 1111 1111 1111, any future expiry, any CVC, and a made-up name.
            </p>
          ) : null}
          <input name="name" autoComplete="cc-name" placeholder={live ? "Name on card" : "Name (mock: decline or timeout)"} className={inputCls} aria-label="Name on card" />
          {live ? (
            <>
              <div id="cc-number" className="field" aria-label="Card number" />
              <div className="flex gap-2">
                <select name="mm" defaultValue="12" className={inputCls} aria-label="Expiry month">
                  {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => <option key={m}>{m}</option>)}
                </select>
                <select name="yyyy" defaultValue={String(YEARS[2])} className={inputCls} aria-label="Expiry year">
                  {YEARS.map((y) => <option key={y}>{y}</option>)}
                </select>
                <div id="cc-cvc" className="field" aria-label="Security code" />
              </div>
            </>
          ) : null}
          <input name="zip" inputMode="numeric" autoComplete="postal-code" placeholder="ZIP" className={inputCls} aria-label="ZIP" />
          <label className="flex min-h-11 items-start gap-2 text-[14px] text-[#6b6355]">
            <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} className="mt-1 size-4 accent-[#100e0a]" />
            <span>Save this card with SquadTab Partner Venue for one-tap holds next time (stored as a Cybersource sandbox token)</span>
          </label>
          <button className={btnCls} disabled={busy}>{busy ? "Holding…" : live ? `Hold ${p.amountLabel}` : "Mock hold (no card)"} {busy ? null : <span aria-hidden="true">→</span>}</button>
        </>
      )}
      <p role="alert" className="min-h-5 text-sm font-semibold">{err}</p>
      {p.sandboxFallback ? <Fallback post={post} disabled={busy} /> : null}
    </form>
  );
}

function Fallback({ post, disabled }: { post: (b: Record<string, unknown>) => Promise<void>; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} className="mt-2 h-11 w-full text-sm text-[#6b6355] underline underline-offset-4"
      onClick={() => post({ save_card: false, sandbox_test_card: true, bill_to: { first_name: "Test", last_name: "Card", postal_code: "90024" } })}>
      Use sandbox test card (Visa 4111) — no card entry
    </button>
  );
}

const label = (b: string | null | undefined) => (b ? b.charAt(0) + b.slice(1).toLowerCase() : "card");

function Banner({ title, tone = "neutral", children }: { title: string; tone?: "neutral" | "good" | "bad"; children?: React.ReactNode }) {
  const look = tone === "good" ? "bg-[#ffb224] text-[#100e0a]" : tone === "bad" ? "border-2 border-dashed border-[#100e0a] bg-[#ede6d6]" : "bg-[#ede6d6]";
  return (
    <section aria-live="polite" className={`mt-6 rounded-[14px] p-5 ${look}`}>
      <h2 className="font-[family-name:var(--font-display)] text-[26px] font-extrabold leading-tight tracking-tight text-balance">{title}</h2>
      <div className="mt-2 text-[17px] leading-snug text-pretty">{children}</div>
    </section>
  );
}
