-- 002_venue.sql: schema `venue` (venue role). Source of truth: docs/PLAN.md §6.
create schema if not exists venue;

create table venue.orders (
  id text primary key,                        -- 'ord_' + 10 base32
  plan_ref uuid not null, plan_version int not null,
  status text not null default 'OPEN',
  bundle jsonb not null, items jsonb not null, party_size smallint not null,
  total_cents int not null, currency char(3) not null default 'USD',
  deadline_at timestamptz not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (plan_ref, plan_version));

create table venue.shares (
  id text primary key,                        -- 'shr_' + 10 base32
  order_id text not null references venue.orders(id),
  payer_ref text not null, amount_cents int not null,
  status text not null default 'PENDING',
  token_hash bytea not null unique,           -- sha256(token); 128-bit random token, single use
  token_expires_at timestamptz not null, token_used_at timestamptz,
  cybs_payment_id text, card_brand text, card_last4 text,
  updated_at timestamptz not null default now(),
  unique (order_id, payer_ref));

create table venue.customers (                -- TMS tokens only, merchant-scoped
  payer_ref text primary key, cybs_customer_id text not null,
  cybs_payment_instrument_id text, card_brand text, card_last4 text,
  created_at timestamptz not null default now());

create table venue.payment_ops (
  id bigserial primary key,
  share_id text not null references venue.shares(id),
  op text not null check (op in ('auth','capture','reverse','timeout_reverse')),
  attempt smallint not null,
  client_ref_code text not null unique,       -- '<shareId>-<op>-<attempt>'  (≤59 chars)
  transaction_id text not null unique,        -- 30 hex chars (Cybersource maxLength 30)
  cybs_id text, status text not null, http_status int,
  response jsonb,                             -- redacted: never a transient token or PAN
  created_at timestamptz not null default now(),
  unique (share_id, op, attempt));

create table venue.tap_nonces (nonce text primary key, seen_at timestamptz not null default now());
create table venue.outbox (id bigserial primary key, event jsonb not null, attempts int not null default 0,
  delivered_at timestamptz, created_at timestamptz not null default now());

-- Sweep / outbox-drain lookups.
create index shares_order on venue.shares (order_id);
create index orders_open_deadline on venue.orders (deadline_at) where status in ('OPEN','COMMITTING','CANCELLING');
create index outbox_undelivered on venue.outbox (id) where delivered_at is null;
create index tap_nonces_seen_at on venue.tap_nonces (seen_at);
