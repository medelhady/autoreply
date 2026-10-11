-- Customer panel: a private link per business (no signup, no password).
-- Safe to run more than once.

-- gen_random_bytes lives in pgcrypto.
create extension if not exists pgcrypto;

-- The secret in the customer's link. Existing businesses each get their own random value.
alter table businesses
  add column if not exists panel_key text not null default encode(gen_random_bytes(18), 'hex');

create unique index if not exists businesses_panel_key_unique on businesses (panel_key);

-- Not granted to the browser roles: the column grants in schema.sql list safe columns only, so
-- panel_key is readable by the server (service role) alone.
