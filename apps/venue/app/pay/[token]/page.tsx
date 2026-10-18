import { connection } from "next/server";
import { cybsService, cybsSource, isSharedSandbox } from "@/cybs";
import { isSandboxHost } from "@/cybs/config";
import { env } from "@/env";
import { loadByToken, savedCard, pageStateOf } from "./load";
import { PayForm } from "./PayForm";
import { Shell, StateCard, clock, day, money } from "./StateCard";

export default async function PayPage({ params }: PageProps<"/pay/[token]">) {
  await connection(); // dynamic: never cached
  const { token } = await params; // bearer credential: never log or render it
  const { share, order } = await loadByToken(token); // GET never consumes the token
  const state = pageStateOf(share, order);

  if (!share || !order || state !== "ready") {
    const amount = share ? money(share.amount_cents) : "";
    return (
      <Shell source={cybsSource().label}>
        {state === "booked" ? (
          <StateCard tone="good" title={`Everyone's in. Charged ${amount}.`} />
        ) : state === "already_held" ? (
          <StateCard tone="good" title="Your hold is in place." body="Not charged yet. You'll get a text when everyone's in." />
        ) : state === "cancelled" ? (
          <StateCard title="Plan cancelled." body="Nobody was charged; your pending authorization was released." />
        ) : state === "unconfirmed" ? (
          <StateCard tone="bad" title="We couldn't confirm your hold." body="Nothing has been charged. You'll get a fresh link in about a minute." />
        ) : (
          <StateCard title="This link has expired or was already used." body="Text SquadTab for a fresh one." />
        )}
      </Shell>
    );
  }

  const live = env().CYBS_MODE === "live";
  let capture: { jwt: string; clientLibrary: string; clientLibraryIntegrity: string } | null = null;
  let captureFailed = false;
  if (live) {
    try {
      capture = await cybsService().captureContext(); // every load: valid 15 min, targetOrigins fixed server-side
    } catch {
      captureFailed = true;
    }
  }
  const customer = await savedCard(share.payer_ref);
  const b = order.bundle as { date: string; dinner: { time: string }; show: { time: string } };

  return (
    <Shell source={cybsSource().label}>
      <section className="plan-ticket mt-7" aria-label={`Your share: ${money(share.amount_cents)}, a hold`}>
        <p className="eyebrow">Your share · prepaid dinner + show</p>
        <h1 className="title">Dinner + show</h1>
        <p className="meta">
          {day(b.date)} · dinner {clock(b.dinner.time)} · show {clock(b.show.time)} · party of {order.party_size}
        </p>
        <div className="count-row">
          <span className="price">{money(share.amount_cents)}</span>
          <span className="note">a hold,<br />not a charge</span>
        </div>
      </section>
      <p className="mt-4 text-[16px] leading-snug text-[#6b6355] text-pretty">
        It&apos;s charged only if everyone&apos;s in by{" "}
        {order.deadline_at.toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" })}
        . Otherwise it&apos;s released.
      </p>
      <PayForm
        token={token}
        amountLabel={money(share.amount_cents)}
        mode={live ? "live" : "mock"}
        capture={capture}
        initialFailed={captureFailed}
        saved={customer ? { brand: customer.card_brand, last4: customer.card_last4 } : null}
        sandboxFallback={live && isSandboxHost(env().CYBS_RUN_ENV)}
        sharedSandbox={isSharedSandbox()}
      />
    </Shell>
  );
}
