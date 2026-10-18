# db

Schema source of truth: `docs/PLAN.md` §6. No seed data (PLAN specifies none; demo data lives in `apps/agent/fixtures/`).

## Layout

| File | Owner | How it runs |
|---|---|---|
| `migrations/001_app.sql` | foundation | `pnpm db:migrate` |
| `migrations/002_venue.sql` | foundation | `pnpm db:migrate` |
| `migrations/004_pay_links.sql` | A | `pnpm db:migrate` |
| `migrations/005+_venue_*.sql` | C | `pnpm db:migrate` |
| `roles.sql` | foundation | once, via `psql` (not a migration) |

## Apply

Both steps run as the project owner (Supabase `postgres` role; direct or Session pooler URL, never the `:6543` transaction pooler). `OWNER_DATABASE_URL` is local/CI only, never on Fly or Vercel.

```sh
# 1. Migrations: every db/migrations/*.sql in name order, once each, each in a transaction.
#    Applied names are recorded in public.tab_schema_migrations. Reads OWNER_DATABASE_URL (repo-root .env.local or shell).
pnpm db:migrate

# 2. Roles, once (re-runnable). Passwords come from your shell; never commit them.
psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v AGENT_DB_PW="$AGENT_DB_PW" -v VENUE_DB_PW="$VENUE_DB_PW" \
  -f db/roles.sql
```

- Migrations are plain SQL (postgres.js simple protocol): no psql meta-commands. `db:migrate` refuses a file that has them.
- 001 and 002 are not idempotent (plain `create table`). Later changes go in new additive files, never edits to applied ones.
- `roles.sql` creates roles once and resets passwords each run. It needs psql (`\gexec`, `:'VAR'`), so it does **not** work in the Supabase SQL editor. There, replace each `select format(...) \gexec` line with `create role tab_agent login password '<pw>';` (and the same for `tab_venue`), typing the password in the editor only.
- `roles.sql` sets **default privileges**, so tables that later migrations create get the same grants, but only when those migrations run as the same owner role. That is why `db:migrate` uses `OWNER_DATABASE_URL`.
- Upgrading a database that recorded the old `003_roles.sql` in `public.tab_schema_migrations`: nothing to do; the row is inert. Run `roles.sql` once if roles were never created.

## Roles (M1 / least privilege)

| Role | Access |
|---|---|
| `tab_agent` | schema `app` only: select/insert/update/delete on tables, usage/select on sequences |
| `tab_venue` | schema `venue` only: same grants |

Neither role can run DDL or touch the other schema. `anon`/`authenticated`/`public` are revoked on both schemas.

Connection strings: `tab_agent.<projectref>` on the Session pooler (`:5432`) for the agent; `tab_venue.<projectref>` on the Transaction pooler (`:6543`, `prepare: false`) for the venue. Custom-role login through Supavisor is UNVERIFIED (PLAN §19): smoke test with `psql` as each role. Fallback: use the owner role for both and rely on tests P1/M1.

## Tests

DB-gated tests (`apps/agent/test/db.integration.test.ts`) run only when `TEST_DATABASE_URL` points at a throwaway Postgres with the migrations applied (`OWNER_DATABASE_URL=<that url> pnpm db:migrate`). Never prod data.
