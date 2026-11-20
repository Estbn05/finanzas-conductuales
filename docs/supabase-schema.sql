create table if not exists public.finance_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  app_state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.finance_app_state enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.finance_app_state to authenticated;

drop policy if exists "Users can read their finance state" on public.finance_app_state;
create policy "Users can read their finance state"
on public.finance_app_state
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their finance state" on public.finance_app_state;
create policy "Users can insert their finance state"
on public.finance_app_state
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their finance state" on public.finance_app_state;
create policy "Users can update their finance state"
on public.finance_app_state
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their finance state" on public.finance_app_state;
create policy "Users can delete their finance state"
on public.finance_app_state
for delete
using (auth.uid() = user_id);

-- Anonymous usage statistics (metrics.js). Insert-only for the app: nobody can read them
-- back with the public key; they are looked at in the Supabase dashboard. No amounts,
-- names or anything typed by the user: an event name and a few small flags.
create table if not exists public.app_events (
  id bigint generated always as identity primary key,
  install_id uuid not null,
  name text not null check (char_length(name) between 2 and 40),
  props jsonb not null default '{}'::jsonb check (pg_column_size(props) <= 1024),
  app_version text not null default '' check (char_length(app_version) <= 20),
  platform text not null default '' check (char_length(platform) <= 12),
  happened_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index if not exists app_events_name_time on public.app_events (name, happened_at);
create index if not exists app_events_install on public.app_events (install_id, happened_at);

alter table public.app_events enable row level security;
grant usage on schema public to anon, authenticated;
grant insert on public.app_events to anon, authenticated;

drop policy if exists "Anyone can send anonymous events" on public.app_events;
create policy "Anyone can send anonymous events"
on public.app_events
for insert
to anon, authenticated
with check (true);

-- "Enviar comentario" (Menú). Same rules: insert-only, read in the dashboard.
create table if not exists public.app_feedback (
  id bigint generated always as identity primary key,
  install_id uuid not null,
  message text not null check (char_length(message) between 1 and 2000),
  contact text not null default '' check (char_length(contact) <= 120),
  app_version text not null default '' check (char_length(app_version) <= 20),
  platform text not null default '' check (char_length(platform) <= 12),
  received_at timestamptz not null default now()
);

alter table public.app_feedback enable row level security;
grant insert on public.app_feedback to anon, authenticated;

drop policy if exists "Anyone can send a comment" on public.app_feedback;
create policy "Anyone can send a comment"
on public.app_feedback
for insert
to anon, authenticated
with check (true);
