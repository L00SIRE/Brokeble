-- 001_app.sql: schema `app` (agent role). Source of truth: docs/PLAN.md §6.
create extension if not exists pgcrypto;
create schema if not exists app;

create table app.users (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique,
  first_name text not null,
  photon_user_id text unique,
  payer_ref text not null unique,          -- hex HMAC(PAYER_REF_SECRET, id); the ONLY identity the venue sees
  created_at timestamptz not null default now());

create table app.dm_routes (                 -- reply routing: always reply with these, never a guessed number
  user_id uuid primary key references app.users(id),
  space_id text not null,                    -- inbound message.space.id
  agent_user_id text not null,               -- inbound message.receivedBy.id  → senderId
  agent_number text,
  updated_at timestamptz not null default now());

create table app.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users(id),
  photon_assignment_id text not null unique,
  assigned_number text not null,
  created_at timestamptz not null default now(),
  released_at timestamptz);

create table app.plans (
  id uuid primary key default gen_random_uuid(),
  ref uuid not null unique default gen_random_uuid(),  -- opaque; the only plan id CREAO and the venue see
  code char(4) not null unique,
  organizer_id uuid references app.users(id),
  state text not null default 'COLLECTING',
  version int not null default 1,
  title text not null, area text not null, event_date date not null,
  time_start time not null, time_end time not null, party_target smallint not null,
  chosen_bundle_id text, venue_order_id text,
  deadlines jsonb not null default '{}',     -- {vote_at, approve_at} ISO
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table app.participants (
  plan_id uuid references app.plans(id), user_id uuid references app.users(id),
  lane smallint not null,                    -- 1..n, console lane id (no phone on console)
  stage text not null default 'INVITED',
  joined_at timestamptz not null default now(),
  primary key (plan_id, user_id), unique (plan_id, lane));

create table app.private_constraints (       -- P1: read only via repo/privateConstraints.ts
  plan_id uuid references app.plans(id), user_id uuid references app.users(id),
  target_pp_cents int not null check (target_pp_cents between 500 and 100000),
  hard_max_pp_cents int check (hard_max_pp_cents is null or hard_max_pp_cents >= target_pp_cents),
  source text not null check (source in ('dm','tier','form')),
  confidence text not null check (confidence in ('high','low')),
  confirmed_at timestamptz,
  primary key (plan_id, user_id));

create table app.preferences (plan_id uuid, user_id uuid, prefs jsonb not null,
  updated_at timestamptz not null default now(), primary key (plan_id, user_id));

create table app.research_runs (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references app.plans(id),
  kind text not null check (kind in ('scout','concierge','scout_live_demo')),
  category text check (category in ('dinner','show')),
  attempt smallint not null default 1,
  idempotency_key text not null unique,      -- 8..128 chars
  creao_run_id text unique, thread_id text,
  status text not null,                      -- pending|running|completed|failed|cancelled|timed_out
  source text not null default 'live' check (source in ('live','cached')),
  started_at timestamptz not null default now(), finished_at timestamptz,
  result jsonb);

create table app.options (plan_id uuid, id text, run_id uuid, category text not null,
  data jsonb not null, created_at timestamptz not null default now(), primary key (plan_id, id));

create table app.bundles (plan_id uuid, plan_version int, id text, data jsonb not null,
  all_in_pp_cents int not null, survived boolean not null, shortlist_rank smallint,
  primary key (plan_id, plan_version, id));

create table app.ratings (plan_id uuid, user_id uuid, bundle_id text, score real not null,
  primary key (plan_id, user_id, bundle_id));

create table app.ballots (plan_id uuid, user_id uuid, plan_version int,
  approvals text[] not null, constraints jsonb not null default '[]',
  source text not null check (source in ('digits','delegate')),
  created_at timestamptz not null default now(), primary key (plan_id, user_id, plan_version));

create table app.hold_gates (plan_id uuid, user_id uuid, plan_version int,
  share_amount_cents int not null, status text not null check (status in ('pending','approved','declined')),
  asked_at timestamptz not null default now(), answered_at timestamptz,
  primary key (plan_id, user_id, plan_version));

create table app.due_jobs (
  id bigserial primary key, plan_id uuid, kind text not null, dedupe_key text not null,
  due_at timestamptz not null, payload jsonb not null default '{}',
  attempts int not null default 0, locked_until timestamptz, done_at timestamptz, last_error text,
  unique (kind, dedupe_key));
create index due_jobs_ready on app.due_jobs (due_at) where done_at is null;
-- poll every 1s: select … where done_at is null and due_at<=now() and (locked_until is null or locked_until<now())
--   order by due_at limit 10 for update skip locked

create table app.inbound_events (source text check (source in ('photon','creao','venue')),
  event_id text, received_at timestamptz not null default now(), primary key (source, event_id));

create table app.photon_cursor (id smallint primary key default 1 check (id = 1), seq bigint not null default 0);

create table app.outbound_messages (            -- template id only; never message text (own-budget confirmations stay out of the DB)
  idempotency_key text primary key, user_id uuid, plan_id uuid, template_id text not null,
  photon_message_id text, status text not null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

create table app.events (                       -- SSE source; data validated by SseEvent (no budget fields)
  id bigserial primary key, at timestamptz not null default now(), plan_id uuid,
  type text not null, data jsonb not null);

-- Lookup indexes for hot paths (SSE replay by plan, per-plan run/job reads, FK reverse lookups).
create index events_plan_id on app.events (plan_id, id);
create index research_runs_plan on app.research_runs (plan_id);
create index due_jobs_plan on app.due_jobs (plan_id);
create index assignments_user on app.assignments (user_id);
create index participants_user on app.participants (user_id);
