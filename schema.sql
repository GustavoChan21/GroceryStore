-- GroceryStore v2.2.0 · Supabase schema
-- Proyecto real: GroceryStore (qydihqbqqimeqnosdglv)
-- Modo: una tienda compartida, sin inicio de sesión.
-- La publishable key se usa desde GitHub Pages; nunca expongas service_role/sb_secret_*.

create table if not exists public.store_state_shared (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint store_state_shared_main_only check (id = 'main')
);

alter table public.store_state_shared enable row level security;

grant select, insert, update on public.store_state_shared to anon;
grant select, insert, update on public.store_state_shared to authenticated;

drop policy if exists "shared_store_select" on public.store_state_shared;
create policy "shared_store_select"
on public.store_state_shared
for select
to anon, authenticated
using (id = 'main');

drop policy if exists "shared_store_insert" on public.store_state_shared;
create policy "shared_store_insert"
on public.store_state_shared
for insert
to anon, authenticated
with check (id = 'main');

drop policy if exists "shared_store_update" on public.store_state_shared;
create policy "shared_store_update"
on public.store_state_shared
for update
to anon, authenticated
using (id = 'main')
with check (id = 'main');
