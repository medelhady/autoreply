-- WhatsApp keyword auto-reply: multi-business schema.
--
-- One deployment serves many businesses. Every row that belongs to a business carries business_id,
-- and the webhook finds the business from the phone_number_id Meta puts on every delivery.
--
-- Safe to run more than once.

create extension if not exists pgcrypto;

-- One row per business that connected a WhatsApp number.
create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  -- The dashboard login that owns this business (Supabase Auth). Null until the dashboard exists.
  owner_user_id uuid references auth.users (id) on delete set null,
  name text not null,
  -- What Meta sends as metadata.phone_number_id on every incoming message. This is the routing key.
  phone_number_id text not null unique,
  waba_id text,
  -- The number as people see it, for the dashboard only.
  display_phone text,
  -- The System User token of the customer's Meta Business, AES-256-GCM encrypted by the app
  -- (see src/lib/crypto.ts). Never stored in clear and never returned to the browser.
  access_token_encrypted text not null,
  -- Sent when a message matches no rule (typically "hi"): the menu telling people what to write.
  -- Empty means stay silent.
  fallback_text text not null default '',
  active boolean not null default true,
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists businesses_owner_idx on businesses (owner_user_id);

-- One row per trigger: a word or a number, and what it answers with.
create table if not exists rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  -- Plain words for the owner: "قائمة الطعام", "العروض".
  name text not null,
  -- Comma separated. Words are matched loosely (spelling, hamza, one typo); a number such as "1" is
  -- matched only when it is the whole message.
  keywords text not null default '',
  reply_text text not null default '',
  -- [{"type": "video|image|audio|document", "path": "<business_id>/file.mp4", "name": "..."}]
  -- sent in order, before the text. Paths point into the private "rule-media" storage bucket.
  attachments jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  hits integer not null default 0,
  last_hit_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rules_business_idx on rules (business_id, active);

-- Every message in and out. Also what makes retries harmless: Meta redelivers a webhook it thinks
-- failed, and the unique index below turns the second copy into a no-op instead of a second reply.
create table if not exists message_log (
  id bigint generated always as identity primary key,
  business_id uuid not null references businesses (id) on delete cascade,
  customer_phone text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  rule_id uuid references rules (id) on delete set null,
  body text not null default '',
  -- Meta's message id for inbound messages; null for outbound.
  wa_message_id text,
  -- sent | failed for outbound; received for inbound.
  status text not null default 'received',
  error text,
  created_at timestamptz not null default now()
);

create unique index if not exists message_log_inbound_unique
  on message_log (business_id, wa_message_id)
  where direction = 'inbound' and wa_message_id is not null;

create index if not exists message_log_business_idx on message_log (business_id, created_at desc);

-- Counts one more person reached by a rule. Atomic, so two customers writing at the same moment are
-- both counted. Only the server (service role) may call it.
create or replace function increment_rule_hit(p_rule_id uuid)
returns void
language sql
as $$
  update rules set hits = hits + 1, last_hit_at = now() where id = p_rule_id;
$$;

revoke execute on function increment_rule_hit(uuid) from public, anon, authenticated;

-- Row level security: the dashboard (browser, anon key) sees only its own business. The webhook uses
-- the service role key, which bypasses these policies. The token column is kept away from the
-- browser by the column grants further down.
alter table businesses enable row level security;
alter table rules enable row level security;
alter table message_log enable row level security;

drop policy if exists businesses_owner on businesses;
drop policy if exists businesses_owner_select on businesses;
drop policy if exists businesses_owner_update on businesses;
create policy businesses_owner_select on businesses
  for select using (owner_user_id = auth.uid());
create policy businesses_owner_update on businesses
  for update using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

drop policy if exists rules_owner on rules;
create policy rules_owner on rules
  for all
  using (exists (select 1 from businesses b where b.id = rules.business_id and b.owner_user_id = auth.uid()))
  with check (exists (select 1 from businesses b where b.id = rules.business_id and b.owner_user_id = auth.uid()));

drop policy if exists message_log_owner on message_log;
create policy message_log_owner on message_log
  for select
  using (exists (select 1 from businesses b where b.id = message_log.business_id and b.owner_user_id = auth.uid()));

-- Keep the token out of reach of the browser, even for the owner.
--
-- Revoking one column does nothing while the role still holds the table-level privilege (Supabase
-- grants it by default), so the whole table is revoked and only the safe columns are granted back.
-- A business row is created by the server (service role), because the token must be encrypted there.
-- The service role is unaffected by any of this.
revoke all on businesses from anon, authenticated;

grant select (
  id, owner_user_id, name, phone_number_id, waba_id, display_phone,
  fallback_text, active, plan, created_at, updated_at
) on businesses to authenticated;

grant update (name, fallback_text, active) on businesses to authenticated;

-- Private bucket for the files rules send. Paths start with the business id.
insert into storage.buckets (id, name, public)
values ('rule-media', 'rule-media', false)
on conflict (id) do nothing;
