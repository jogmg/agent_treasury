-- Hermes business state. This is deliberately separate from Hermes' internal
-- SQLite state.db, which is not a stable public interface.

create table if not exists treasury_snapshots (
  id bigserial primary key,
  chain_id integer not null,
  block_number bigint not null,
  treasury_address text not null,
  agent_address text not null,
  principal numeric(78,0) not null,
  total_balance numeric(78,0) not null,
  vault_shares numeric(78,0) not null,
  idle_usdc numeric(78,0) not null,
  active_vault_id numeric(78,0),
  paused boolean not null,
  keeper text not null,
  gateway_receiver text not null,
  captured_at timestamptz not null default now(),
  unique (chain_id, block_number, treasury_address, agent_address)
);

create index if not exists treasury_snapshots_agent_time_idx
  on treasury_snapshots (agent_address, captured_at desc);

create table if not exists activity_events (
  id text primary key,
  event_type text not null,
  block_number bigint not null,
  tx_hash text not null,
  log_index integer not null,
  agent_address text,
  block_timestamp timestamptz,
  args jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_events_agent_block_idx
  on activity_events (agent_address, block_number desc, log_index desc);

create index if not exists activity_events_type_block_idx
  on activity_events (event_type, block_number desc);

create table if not exists transfers (
  id bigserial primary key,
  direction text not null check (direction in ('in', 'out')),
  withdrawal_id bigint,
  burn_tx_hash text not null,
  burn_block bigint not null,
  source_domain integer not null,
  destination_domain integer,
  amount numeric(78,0) not null,
  nonce text,
  iris_status text,
  phase text not null check (phase in ('waiting', 'ready', 'done', 'error')),
  mint_tx_hash text,
  mint_block bigint,
  message_hash text,
  last_checked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  unique (burn_tx_hash, direction)
);

create index if not exists transfers_phase_idx on transfers (phase);
create index if not exists transfers_withdrawal_idx on transfers (withdrawal_id);

create table if not exists withdrawal_bookkeeping (
  withdrawal_id bigint primary key,
  burn_tx_hash text not null,
  executed_on_chain boolean not null default false,
  verified_complete_at timestamptz,
  keeper_tx_hash text,
  status text not null default 'pending',
  updated_at timestamptz not null default now()
);

create table if not exists alerts (
  id bigserial primary key,
  dedupe_key text not null unique,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  kind text not null,
  subject text not null,
  payload jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_sent_at timestamptz,
  resolved_at timestamptz
);

create index if not exists alerts_open_idx on alerts (severity, last_seen_at desc)
  where resolved_at is null;

create table if not exists audit_events (
  id bigserial primary key,
  actor text not null,
  action text not null,
  subject text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists monitor_cursor (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
