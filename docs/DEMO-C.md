# Demo runbook: C (venue · TAP · Cybersource)

What is real: Cybersource **sandbox** auth / capture / reversal on the shared public test merchant `testrest`, Microform card fields, Ed25519 TAP signatures verified in 6 steps, all-or-nothing capture, release on "I'm out". The key directory is a labelled mock.

## Paths, best first

| # | Path | When | Command |
|---|---|---|---|
| 1 | **Production** `https://squadtab-venue.vercel.app` with the agent (the old `tab-venue.vercel.app` is simulated) | Supabase writes work (see "Production DB" below) and Vercel has the testrest env | the full SquadTab flow on phones |
| 2 | **Local venue + real Cybersource sandbox** | production DB still read-only | `cd apps/venue` → terminal 1: `pnpm demo:serve` → terminal 2: `pnpm demo` |
| 3 | Local, simulated | Cybersource sandbox down | set `CYBS_MODE=mock` in `apps/venue/.env.local`, restart `pnpm demo:serve`; say "simulated" (the page header says it too) |

Path 2 needs Docker running (local Postgres container `tab-pg`) and the git-ignored `apps/venue/.env.local` + `apps/venue/.env.demo-agent` (on C's laptop only).
To show the card form on the laptop: `set -a; . ./.env.local; set +a; pnpm exec tsx scripts/seed-test-share.ts` → open the printed `http://localhost:3001/pay/…` → card `4111 1111 1111 1111`, any future expiry, any CVC, a made-up name → "Held".

## What `pnpm demo` shows (≈20 s)

1. Three friends each place their **own** hold (`capture:false`), priced by the venue. Real Cybersource auth ids printed.
2. The agent signs the exact consent set (order, total, every auth id). The venue rebuilds it from its DB and verifies **6 TAP steps** → captures all three (real capture ids).
3. Tamper: one share +$1 after signing → **step 6 ✗ content-digest mismatch** → nothing captured.
4. Wrong intent tag → step 1 ✗; expired signature → step 3 ✗.
5. "I'm out" → all three holds **RELEASED**. Copy: "Nobody was charged; your pending authorization was released."

## Visa pitch (45 s)

A group purchase is an assurance contract at the merchant of record. Every friend places their own cardholder-initiated authorization on a Cybersource Microform page; nobody fronts money. Tab's agent then sends a request signed with the Visa Trusted Agent Protocol that covers the exact consent set: the order, the total and each authorization ID. The merchant rebuilds that set from its own database and verifies all six TAP steps. Only if every share is held does it capture. One decline or one "I'm out", and every hold is released.

## Say before a judge asks

- "Payments run on Cybersource's **sandbox**, on its shared public test merchant, because our provisioned hackathon merchant fails every auth with reason 150 on its processor (Cybersource Level II support case SR#002689822 is open; their 8:20 AM fix did not take and we replied with request ids)."
- "The key directory is a labelled mock; production is Visa agent registration (`/icc/v1/agents`)."
- Never say "Visa-verified" or "$0 instantly".
- Card data lives only in Microform iframes; our server sees a transient token. No retries on unknown auth outcomes: timeout reversal by transactionId.

## Production DB (blocking path 1)

Vercel logs: `cannot execute UPDATE in a read-only transaction` (Postgres 25006). Reads work, writes fail. In the Supabase SQL editor:

```sql
show default_transaction_read_only;
select pg_size_pretty(pg_database_size(current_database()));
select rolname, rolconfig from pg_roles where rolname in ('postgres','tab_venue','tab_agent');
```

- `on` + a disk-usage banner → Supabase read-only mode (disk over the free limit): free space or raise the limit in the dashboard.
- a role shows `default_transaction_read_only=on` → `alter role <role> reset default_transaction_read_only;`
- Fastest independent fix: give the venue its **own** database (the venue only needs schema `venue`): new Supabase project → SQL editor → paste `db/migrations/002_venue.sql` → set the Transaction-pooler URL (`:6543`) as `DATABASE_URL` on Vercel → Redeploy.
