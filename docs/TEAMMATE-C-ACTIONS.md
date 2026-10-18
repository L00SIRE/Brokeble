# Venue (tab-venue on Vercel): actions for C, before 11:30 AM

These steps are needed because the venue's Vercel project is in C's account. Everything else is deployed.

## 1. Fix the read-only database (blocking)

**Symptom:** since about 08:09Z, the agent's sweep call to `POST https://tab-venue.vercel.app/ops/sweep` returns 500 every 30 s. The new diagnostics show the cause in every step:

```
venue sweep failed: HTTP 500 (steps: a_stale=25006, f_committing=25006, h_nonces=25006)
```

**Diagnosis:** Postgres `25006` is `read_only_sql_transaction`. The venue's `DATABASE_URL` connects in **read-only mode**, so every UPDATE or DELETE fails. That breaks expiry, timeout reversals, outbox redelivery and nonce cleanup. One of these is the likely cause:
- a Supabase **read replica** connection string;
- a role whose `default_transaction_read_only` is on;
- `?options=-c default_transaction_read_only=on` in the URL.

**Fix:** in Vercel → `tab-venue` → Settings → Environment Variables (Production), set `DATABASE_URL` to the Supabase **Transaction pooler** string for the **primary** database. That's port **6543**, `aws-…pooler.supabase.com`, user `postgres.<ref>`. Christian's `.env.local` has a working value under `VENUE_DATABASE_URL`. Then redeploy.

**Check:** `fly logs -a tab-agent --no-tail | grep venue_sweep` stops printing `25006`.

## 2. Switch production payments to the public testrest merchant (the main Visa item)

Production is currently in **mock** mode. On Vercel → `tab-venue`, Production, set:

| Var | Value |
|---|---|
| `CYBS_MODE` | `live` |
| `CYBS_MERCHANT_ID` | `testrest` |
| `CYBS_KEY_ID` / `CYBS_SECRET_KEY` | the public values in `github.com/CyberSource/cybersource-rest-samples-node` `Data/Configuration.js` |
| `CYBS_AUTH_TYPE` | `jwt` |
| `CYBS_RUN_ENV` | `apitest.cybersource.com` |
| `VENUE_PUBLIC_URL` | `https://tab-venue.vercel.app` (no trailing slash; Microform needs the exact origin) |
| `VENUE_PUBLIC_HOST` | `tab-venue.vercel.app` |

**Before redeploying:**
1. Make sure no plan is mid-payment.
2. Run `delete from venue.customers;`, because saved cards from the old merchant won't work.

**After redeploying:**
1. A pay page header should read "Cybersource sandbox · shared public test merchant".
2. Do one Microform hold from a phone using `4111 1111 1111 1111`.

The local verification already proved every operation on testrest, including real browser Microform holds, captures and reversals, and TAP 6/6 with tamper and replay rejected. See `docs/VERIFICATION.md`.

**If it fails on the day:** set `CYBS_MODE=mock` and call it a "labelled simulation" (the Visa rep allowed simulation).
