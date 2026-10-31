-- =====================================================================
-- NeuroLab · 002 · Instantáneas de la red (pesos y activaciones reales por época)
-- Ejecutar en Supabase → SQL Editor después de 001_init.sql. Idempotente.
-- =====================================================================
create table if not exists public.network_snapshots (
  id          bigserial primary key,
  job_id      uuid not null references public.training_jobs(id) on delete cascade,
  epoch       integer not null,
  data        json not null,
  created_at  timestamptz not null default now(),
  unique (job_id, epoch)
);
create index if not exists idx_snapshots_job on public.network_snapshots (job_id, epoch);
alter table public.network_snapshots enable row level security;
