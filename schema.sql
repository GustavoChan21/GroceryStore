-- GroceryStore · Supabase schema
-- Proyecto real: GroceryStore (qydihqbqqimeqnosdglv)

create table if not exists public.store_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.store_state enable row level security;

drop policy if exists "store_state_select_own" on public.store_state;
create policy "store_state_select_own"
on public.store_state for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "store_state_insert_own" on public.store_state;
create policy "store_state_insert_own"
on public.store_state for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "store_state_update_own" on public.store_state;
create policy "store_state_update_own"
on public.store_state for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "store_state_delete_own" on public.store_state;
create policy "store_state_delete_own"
on public.store_state for delete
to authenticated
using ((select auth.uid()) = user_id);
