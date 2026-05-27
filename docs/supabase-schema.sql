create table if not exists public.finance_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  app_state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.finance_app_state enable row level security;

create policy "Users can read their finance state"
on public.finance_app_state
for select
using (auth.uid() = user_id);

create policy "Users can insert their finance state"
on public.finance_app_state
for insert
with check (auth.uid() = user_id);

create policy "Users can update their finance state"
on public.finance_app_state
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their finance state"
on public.finance_app_state
for delete
using (auth.uid() = user_id);
