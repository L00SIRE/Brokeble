# db

Schema source of truth: `docs/PLAN.md` §6. No seed data (PLAN specifies none; demo data lives in `apps/agent/fixtures/`).

## Apply order

Run as the project owner (Supabase `postgres` role, direct or session-pooler URL, not the transaction pooler):

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_app.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/002_venue.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v AGENT_DB_PW="$AGENT_DB_PW" -v VENUE_DB_PW="$VENUE_DB_PW" \
  -f db/migrations/003_roles.sql
```

- 001 and 002 are not idempotent (plain `create table`); apply once. Later changes go in new additive files (`004_*.sql`, ...), never edits to applied ones.
- 003 is re-runnable (creates roles once, resets passwords each run). It needs psql (uses `\gexec` and `:'VAR'`), so it does **not** work in the Supabase SQL editor. In the editor, paste 001 and 002 only, then run 003 via psql, or replace the `select format(...) \gexec` lines with `create role tab_agent login password '<pw>';` (and the same for `tab_venue`), typing the password in the editor only.
- Passwords come from your shell env; never commit them.

## Roles (M1 / least privilege)

| Role | Access |
|---|---|
| `tab_agent` | schema `app` only: select/insert/update/delete on tables, usage/select on sequences |
| `tab_venue` | schema `venue` only: same grants |

Neither role can run DDL or touch the other schema. `anon`/`authenticated`/`public` are revoked on both schemas. Default privileges are set so tables created by later migrations (applied by the same owner role) get the same grants.

Connection strings: `tab_agent.<projectref>` on the Session pooler (`:5432`) for the agent; `tab_venue.<projectref>` on the Transaction pooler (`:6543`, `prepare: false`) for the venue. Custom-role login through Supavisor is UNVERIFIED (PLAN §19): smoke test with `psql` as each role. Fallback: use the owner role for both and rely on tests P1/M1.

## Local check

Against a throwaway local Postgres, the three files apply cleanly in order, 003 applies twice, `tab_agent` is denied `venue.*`, and `tab_venue` is denied `app.*`.
