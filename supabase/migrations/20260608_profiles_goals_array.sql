alter table public.profiles
add column if not exists goals text[];

alter table public.profiles
add column if not exists other_goal text;

update public.profiles
set goals = array[goal]
where goals is null
  and goal is not null
  and goal in (
    'fat_loss',
    'muscle_gain',
    'sports_performance',
    'healthy_eating'
  );

update public.profiles
set goals = array['healthy_eating']
where goals is null
  and goal = 'maintenance';

alter table public.profiles
drop constraint if exists profiles_goals_allowed_chk;

alter table public.profiles
add constraint profiles_goals_allowed_chk
check (
  goals is null
  or goals <@ array[
    'fat_loss',
    'muscle_gain',
    'sports_performance',
    'healthy_eating',
    'other'
  ]::text[]
);
