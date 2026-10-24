-- Phase 2 deterministic draft intents. The BFF derives `to_address` and `data`
-- from an allowlisted method; the model/frontend only provide semantic values.
-- Unsigned records expire, are wallet-bound, and are never completion evidence.

create table if not exists intents (
  id text primary key,
  wallet text not null,
  kind text not null check (kind in ('deposit', 'withdrawLocal', 'cctpWithdraw')),
  chain_id integer not null,
  treasury text not null,
  to_address text not null,
  data text not null,
  value numeric(78,0) not null default 0,
  amount numeric(78,0) not null,
  is_max boolean not null default false,
  destination_domain integer,
  mint_recipient text,
  status text not null default 'draft'
    check (status in ('draft', 'reviewed', 'submitted', 'confirmed', 'failed', 'expired')),
  simulation jsonb not null default '{}'::jsonb,
  idempotency_key text,
  tx_hash text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  submitted_at timestamptz
);

create unique index if not exists intents_wallet_idempotency_idx
  on intents (wallet, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists intents_tx_hash_idx
  on intents (tx_hash)
  where tx_hash is not null;

create index if not exists intents_wallet_created_idx
  on intents (wallet, created_at desc);
