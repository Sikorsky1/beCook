alter table public.week_days enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;

drop policy if exists "week_days_select_own_week" on public.week_days;
drop policy if exists "week_days_insert_own_week" on public.week_days;
drop policy if exists "week_days_update_own_week" on public.week_days;
drop policy if exists "week_days_delete_own_week" on public.week_days;

create policy "week_days_select_own_week"
on public.week_days
for select
to authenticated
using (
  exists (
    select 1
    from public.weeks
    where weeks.id = week_days.week_id
      and weeks.user_id = auth.uid()
  )
);

create policy "week_days_insert_own_week"
on public.week_days
for insert
to authenticated
with check (
  exists (
    select 1
    from public.weeks
    where weeks.id = week_days.week_id
      and weeks.user_id = auth.uid()
  )
);

create policy "week_days_update_own_week"
on public.week_days
for update
to authenticated
using (
  exists (
    select 1
    from public.weeks
    where weeks.id = week_days.week_id
      and weeks.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.weeks
    where weeks.id = week_days.week_id
      and weeks.user_id = auth.uid()
  )
);

create policy "week_days_delete_own_week"
on public.week_days
for delete
to authenticated
using (
  exists (
    select 1
    from public.weeks
    where weeks.id = week_days.week_id
      and weeks.user_id = auth.uid()
  )
);

drop policy if exists "shopping_lists_select_own_week" on public.shopping_lists;
drop policy if exists "shopping_lists_insert_own_week" on public.shopping_lists;
drop policy if exists "shopping_lists_update_own_week" on public.shopping_lists;
drop policy if exists "shopping_lists_delete_own_week" on public.shopping_lists;

create policy "shopping_lists_select_own_week"
on public.shopping_lists
for select
to authenticated
using (
  exists (
    select 1
    from public.weeks
    where weeks.id = shopping_lists.week_id
      and weeks.user_id = auth.uid()
  )
);

create policy "shopping_lists_insert_own_week"
on public.shopping_lists
for insert
to authenticated
with check (
  exists (
    select 1
    from public.weeks
    where weeks.id = shopping_lists.week_id
      and weeks.user_id = auth.uid()
  )
);

create policy "shopping_lists_update_own_week"
on public.shopping_lists
for update
to authenticated
using (
  exists (
    select 1
    from public.weeks
    where weeks.id = shopping_lists.week_id
      and weeks.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.weeks
    where weeks.id = shopping_lists.week_id
      and weeks.user_id = auth.uid()
  )
);

create policy "shopping_lists_delete_own_week"
on public.shopping_lists
for delete
to authenticated
using (
  exists (
    select 1
    from public.weeks
    where weeks.id = shopping_lists.week_id
      and weeks.user_id = auth.uid()
  )
);

drop policy if exists "shopping_items_select_own_week" on public.shopping_items;
drop policy if exists "shopping_items_insert_own_week" on public.shopping_items;
drop policy if exists "shopping_items_update_own_week" on public.shopping_items;
drop policy if exists "shopping_items_delete_own_week" on public.shopping_items;

create policy "shopping_items_select_own_week"
on public.shopping_items
for select
to authenticated
using (
  exists (
    select 1
    from public.shopping_lists
    join public.weeks on weeks.id = shopping_lists.week_id
    where shopping_lists.id = shopping_items.shopping_list_id
      and weeks.user_id = auth.uid()
  )
);

create policy "shopping_items_insert_own_week"
on public.shopping_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.shopping_lists
    join public.weeks on weeks.id = shopping_lists.week_id
    where shopping_lists.id = shopping_items.shopping_list_id
      and weeks.user_id = auth.uid()
  )
);

create policy "shopping_items_update_own_week"
on public.shopping_items
for update
to authenticated
using (
  exists (
    select 1
    from public.shopping_lists
    join public.weeks on weeks.id = shopping_lists.week_id
    where shopping_lists.id = shopping_items.shopping_list_id
      and weeks.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.shopping_lists
    join public.weeks on weeks.id = shopping_lists.week_id
    where shopping_lists.id = shopping_items.shopping_list_id
      and weeks.user_id = auth.uid()
  )
);

create policy "shopping_items_delete_own_week"
on public.shopping_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.shopping_lists
    join public.weeks on weeks.id = shopping_lists.week_id
    where shopping_lists.id = shopping_items.shopping_list_id
      and weeks.user_id = auth.uid()
  )
);
