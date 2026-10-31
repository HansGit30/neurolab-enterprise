-- =====================================================================
-- NeuroLab Enterprise · Migración inicial (PostgreSQL / Supabase)
-- Ejecutar en Supabase → SQL Editor (o psql) una sola vez.
-- Es idempotente: puede volver a ejecutarse sin romper datos existentes.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Usuarios de aplicación (vinculados a auth.users de Supabase)
-- ---------------------------------------------------------------------
create table if not exists public.users (
  id            uuid primary key,
  email         text not null unique,
  display_name  text not null default '',
  role          text not null default 'engineer'
                check (role in ('admin','project_owner','engineer','reviewer','reader')),
  status        text not null default 'active'
                check (status in ('active','disabled')),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Proyectos y miembros
-- ---------------------------------------------------------------------
create table if not exists public.projects (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  description       text not null default '',
  problem_statement text not null default '',
  documentation     text not null default '',
  tags              json not null default '[]',
  owner_id          uuid not null references public.users(id),
  status            text not null default 'active'
                    check (status in ('active','paused','archived')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  role        text not null check (role in ('owner','engineer','reviewer','reader')),
  added_at    timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- ---------------------------------------------------------------------
-- Datasets (los archivos viven en Supabase Storage, aquí solo metadatos)
-- ---------------------------------------------------------------------
create table if not exists public.datasets (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  name          text not null,
  version       integer not null default 1,
  storage_key   text,
  metadata_json json not null default '{}',
  created_by    uuid references public.users(id),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- ---------------------------------------------------------------------
-- Arquitecturas (configuración validada de capas)
-- ---------------------------------------------------------------------
create table if not exists public.architectures (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  name          text not null,
  family        text not null check (family in ('feedforward','rnn','cnn','gan')),
  config_json   json not null,
  summary_json  json not null default '{}',
  justification text not null default '',
  version       integer not null default 1,
  created_by    uuid references public.users(id),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Trabajos de entrenamiento (máquina de estados explícita)
-- ---------------------------------------------------------------------
create table if not exists public.training_jobs (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  architecture_id  uuid not null references public.architectures(id),
  dataset_id       uuid not null references public.datasets(id),
  status           text not null default 'QUEUED'
                   check (status in ('QUEUED','PREPARING','RUNNING','COMPLETED','FAILED','CANCELLED')),
  progress         double precision not null default 0,
  current_epoch    integer not null default 0,
  total_epochs     integer not null default 0,
  priority         integer not null default 0,
  params_json      json not null default '{}',
  result_json      json not null default '{}',
  code_version     text not null default '',
  cancel_requested boolean not null default false,
  cancel_reason    text,
  error_message    text,
  attempts         integer not null default 0,
  created_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  ended_at         timestamptz,
  heartbeat_at     timestamptz
);
create index if not exists idx_jobs_queue on public.training_jobs (status, priority desc, created_at);
create index if not exists idx_jobs_project on public.training_jobs (project_id, created_at desc);

create table if not exists public.training_metrics (
  id            bigserial primary key,
  job_id        uuid not null references public.training_jobs(id) on delete cascade,
  epoch         integer not null,
  metric_name   text not null,
  metric_value  double precision not null,
  recorded_at   timestamptz not null default now()
);
create index if not exists idx_metrics_job on public.training_metrics (job_id, id);

create table if not exists public.job_logs (
  id          bigserial primary key,
  job_id      uuid not null references public.training_jobs(id) on delete cascade,
  level       text not null default 'info',
  message     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_logs_job on public.job_logs (job_id, id);

-- ---------------------------------------------------------------------
-- Registro de modelos (versiones inmutables)
-- ---------------------------------------------------------------------
create table if not exists public.model_versions (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  job_id        uuid not null unique references public.training_jobs(id),
  version       integer not null,
  storage_key   text not null,
  status        text not null default 'draft'
                check (status in ('draft','reviewed','approved','retired')),
  checksum      text not null,
  size_bytes    bigint not null default 0,
  metrics_json  json not null default '{}',
  notes         text not null default '',
  created_by    uuid references public.users(id),
  reviewed_by   uuid references public.users(id),
  created_at    timestamptz not null default now(),
  unique (project_id, version)
);

-- ---------------------------------------------------------------------
-- Auditoría y configuración global
-- ---------------------------------------------------------------------
create table if not exists public.audit_events (
  id            bigserial primary key,
  actor_id      uuid references public.users(id),
  project_id    uuid references public.projects(id) on delete set null,
  action        text not null,
  metadata_json json not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists idx_audit_project on public.audit_events (project_id, created_at desc);

create table if not exists public.system_settings (
  key    text primary key,
  value  json not null
);

insert into public.system_settings (key, value) values
  ('limits', '{"max_epochs":200,"max_batch_size":1024,"max_concurrent_jobs_per_user":2,"max_upload_mb":10,"job_timeout_seconds":900,"max_layers":24,"max_units":1024}'),
  ('features', '{"gan_training_enabled":false,"rnn_training_enabled":true,"cnn_training_enabled":true}'),
  ('retention', '{"audit_days":365,"logs_days":90}'),
  ('signup', '{"default_role":"project_owner"}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Perfil automático al registrarse en Supabase Auth.
-- El PRIMER usuario registrado recibe el rol 'admin'; el resto, el rol
-- definido en system_settings.signup.default_role (editable desde Administración).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    case when (select count(*) from public.users) = 0 then 'admin'
         else coalesce((select value->>'default_role' from public.system_settings where key = 'signup'), 'reader')
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'auth') then
    drop trigger if exists on_auth_user_created on auth.users;
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_auth_user();
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Seguridad: RLS activado SIN políticas públicas.
-- La API (FastAPI) se conecta con el rol de servidor y aplica RBAC;
-- así nadie puede leer tablas directamente con la anon key del frontend.
-- ---------------------------------------------------------------------
alter table public.users            enable row level security;
alter table public.projects         enable row level security;
alter table public.project_members  enable row level security;
alter table public.datasets         enable row level security;
alter table public.architectures    enable row level security;
alter table public.training_jobs    enable row level security;
alter table public.training_metrics enable row level security;
alter table public.job_logs         enable row level security;
alter table public.model_versions   enable row level security;
alter table public.audit_events     enable row level security;
alter table public.system_settings  enable row level security;

-- ---------------------------------------------------------------------
-- Bucket PRIVADO de Supabase Storage para datasets y modelos .keras
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public)
    values ('neurolab', 'neurolab', false)
    on conflict (id) do nothing;
  end if;
end $$;
