alter table public.weeks
add column if not exists iso_year integer;

alter table public.weeks
add column if not exists iso_week integer;

alter table public.weeks
drop constraint if exists weeks_iso_week_range_chk;

alter table public.weeks
add constraint weeks_iso_week_range_chk
check (
  (iso_year is null and iso_week is null)
  or (
    iso_year between 2000 and 2100
    and iso_week between 1 and 53
  )
);

create unique index if not exists weeks_user_iso_week_unique_idx
on public.weeks(user_id, iso_year, iso_week)
where user_id is not null
  and iso_year is not null
  and iso_week is not null;
