-- 004_pay_links: A's additive table (A plan T9). OrderStatus does not return pay URLs, and T_REPING / holdGate YES need them later.
-- pay_url is a single-use bearer link to pay one's OWN share (no card data). Never log it, emit it on SSE or show it in an X-ray preview.
create table app.pay_links (
  plan_id uuid references app.plans(id),
  user_id uuid references app.users(id),
  plan_version int not null,
  share_id text not null,
  amount_cents int not null,
  pay_url text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (plan_id, user_id, plan_version)
);
