-- db/roles.sql: least-privilege roles (M1). Source of truth: docs/PLAN.md §6. NOT a migration: run it once via psql
-- as the owner role, after db:migrate has created the schemas (never commit real passwords):
--   psql "$OWNER_DATABASE_URL" -v AGENT_DB_PW="$AGENT_DB_PW" -v VENUE_DB_PW="$VENUE_DB_PW" -f db/roles.sql
-- Re-runnable: roles are created once, passwords are (re)set every run.
-- UNVERIFIED: login as tab_agent.<projectref> via Supavisor; fallback is a single role (see db/README.md).

\set ON_ERROR_STOP on

-- Supabase's public API roles must not see our schemas (guarded: absent on plain Postgres).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema app, venue from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on schema app, venue from authenticated;
  end if;
end $$;
revoke all on schema app, venue from public;

select format('create role tab_agent login password %L', :'AGENT_DB_PW')
  where not exists (select 1 from pg_roles where rolname = 'tab_agent') \gexec
select format('create role tab_venue login password %L', :'VENUE_DB_PW')
  where not exists (select 1 from pg_roles where rolname = 'tab_venue') \gexec
select format('alter role tab_agent password %L', :'AGENT_DB_PW') \gexec
select format('alter role tab_venue password %L', :'VENUE_DB_PW') \gexec

-- M1: each role sees only its own schema. No DDL, no cross-schema access.
revoke all on schema app from tab_venue;
revoke all on schema venue from tab_agent;

grant usage on schema app to tab_agent;
grant select, insert, update, delete on all tables in schema app to tab_agent;
grant usage, select on all sequences in schema app to tab_agent;

grant usage on schema venue to tab_venue;
grant select, insert, update, delete on all tables in schema venue to tab_venue;
grant usage, select on all sequences in schema venue to tab_venue;

-- Tables added by later migrations (004_pay_links, 005+_venue_*) inherit the same grants. Default privileges
-- apply only to objects created by the role running this file, so migrations must run as that same owner role.
alter default privileges in schema app grant select, insert, update, delete on tables to tab_agent;
alter default privileges in schema app grant usage, select on sequences to tab_agent;
alter default privileges in schema venue grant select, insert, update, delete on tables to tab_venue;
alter default privileges in schema venue grant usage, select on sequences to tab_venue;
