-- Run once in the Supabase SQL Editor for the existing DOTT project.
-- The public site needs only its EXISTING publishable key.
-- No service-role key is ever placed in client-side code.
create table if not exists public.dopamin_mystery_runs (
  id uuid primary key,
  nickname text not null check (char_length(nickname) between 1 and 16),
  duration_seconds integer not null check (duration_seconds between 0 and 86400),
  score smallint not null check (score between 0 and 5),
  success boolean not null,
  created_at timestamptz not null default now()
);
-- Accept accurate sub-20-second runs even when this SQL is rerun.
alter table public.dopamin_mystery_runs
  drop constraint if exists dopamin_mystery_runs_duration_seconds_check;
alter table public.dopamin_mystery_runs
  add constraint dopamin_mystery_runs_duration_seconds_check
  check (duration_seconds between 0 and 86400);

create index if not exists dopamin_mystery_runs_fastest_idx
  on public.dopamin_mystery_runs (success, duration_seconds, created_at desc);
create index if not exists dopamin_mystery_runs_latest_idx
  on public.dopamin_mystery_runs (created_at desc);
alter table public.dopamin_mystery_runs enable row level security;
revoke all on public.dopamin_mystery_runs from public, anon, authenticated;
grant select on public.dopamin_mystery_runs to anon, authenticated;
drop policy if exists mystery_runs_public_read on public.dopamin_mystery_runs;
create policy mystery_runs_public_read on public.dopamin_mystery_runs
  for select to anon, authenticated using (true);

-- Store ONLY server-computed scores, not player-submitted success/score.
create or replace function public.submit_dopamin_mystery_run(
  p_id uuid, p_nickname text, p_duration_seconds integer, p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nickname text := btrim(p_nickname);
  v_score integer := 0;
  v_success boolean;
  v_saved public.dopamin_mystery_runs%rowtype;
begin
  if p_id is null or p_answers is null or jsonb_typeof(p_answers) <> 'object'
     or v_nickname is null or char_length(v_nickname) not between 1 and 16
     or p_duration_seconds not between 0 and 86400 then
    raise exception 'invalid submission';
  end if;
  if p_answers->>'suspect' = 'jihoon' then v_score := v_score + 1; end if;
  if p_answers->>'motive' = 'late' then v_score := v_score + 1; end if;
  if p_answers->>'weapon' = 'metal' then v_score := v_score + 1; end if;
  if p_answers->>'frame' = 'jei' then v_score := v_score + 1; end if;
  if p_answers->>'proof' in ('exit','chatfull','corridor') then v_score := v_score + 1; end if;
  v_success := p_answers->>'suspect'='jihoon' and v_score>=4;

  insert into public.dopamin_mystery_runs(id,nickname,duration_seconds,score,success)
  values(p_id,v_nickname,p_duration_seconds,v_score,v_success)
  on conflict (id) do nothing;
  select * into v_saved from public.dopamin_mystery_runs where id=p_id;
  if v_saved.nickname<>v_nickname or v_saved.duration_seconds<>p_duration_seconds then
    raise exception 'submission already exists';
  end if;
  return jsonb_build_object(
    'id',v_saved.id,'nickname',v_saved.nickname,
    'duration_seconds',v_saved.duration_seconds,
    'score',v_saved.score,'success',v_saved.success,
    'created_at',v_saved.created_at
  );
end;
$$;
revoke all on function public.submit_dopamin_mystery_run(uuid,text,integer,jsonb) from public;
grant execute on function public.submit_dopamin_mystery_run(uuid,text,integer,jsonb) to anon,authenticated;
