-- Run once in the Supabase SQL Editor for the existing DOTT project.
-- The public site needs only its EXISTING publishable key.
-- No service-role key is ever placed in client-side code.
create table if not exists public.dopamin_mystery_runs (
  id uuid primary key,
  nickname text not null check (char_length(nickname) between 1 and 16),
  duration_seconds integer not null check (duration_seconds between 0 and 86400),
  score smallint not null check (score between 0 and 5),
  success boolean not null,
  scoring_version smallint not null default 1,
  created_at timestamptz not null default now()
);
-- Accept accurate sub-20-second runs even when this SQL is rerun.
alter table public.dopamin_mystery_runs
  drop constraint if exists dopamin_mystery_runs_duration_seconds_check;
alter table public.dopamin_mystery_runs
  add constraint dopamin_mystery_runs_duration_seconds_check
  check (duration_seconds between 0 and 86400);

alter table public.dopamin_mystery_runs add column if not exists scoring_version smallint not null default 1;

create index if not exists dopamin_mystery_runs_fastest_idx
  on public.dopamin_mystery_runs (success, duration_seconds, created_at desc);
create index if not exists dopamin_mystery_runs_latest_idx
  on public.dopamin_mystery_runs (created_at desc);
alter table public.dopamin_mystery_runs enable row level security;
revoke all on public.dopamin_mystery_runs from public, anon, authenticated;
grant select (nickname,duration_seconds,score,success,created_at,scoring_version) on public.dopamin_mystery_runs to anon, authenticated;
drop policy if exists mystery_runs_public_read on public.dopamin_mystery_runs;
create policy mystery_runs_public_read on public.dopamin_mystery_runs
  for select to anon, authenticated using (true);

-- Store ONLY server-computed scores, not player-submitted success/score.

-- Player answers are private; never expose them through the public leaderboard.
create schema if not exists mystery_private;
revoke all on schema mystery_private from public, anon, authenticated;
create table if not exists mystery_private.dopamin_mystery_run_answers(
 run_id uuid primary key references public.dopamin_mystery_runs(id) on delete cascade,
 answers jsonb not null,
 recorded_at timestamptz not null default now()
);
alter table mystery_private.dopamin_mystery_run_answers enable row level security;
revoke all on mystery_private.dopamin_mystery_run_answers from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_dopamin_mystery_run(p_id uuid, p_nickname text, p_duration_seconds integer, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_answers->>'proof' in ('exit','chatfull','corridor','payment') then v_score := v_score + 1; end if;
  v_success := p_answers->>'suspect'='jihoon' and v_score>=4;

  insert into public.dopamin_mystery_runs(id,nickname,duration_seconds,score,success,scoring_version)
  values(p_id,v_nickname,p_duration_seconds,v_score,v_success,2)
  on conflict (id) do nothing;
  select * into v_saved from public.dopamin_mystery_runs where id=p_id;
  if v_saved.nickname<>v_nickname or v_saved.duration_seconds<>p_duration_seconds then
    raise exception 'submission already exists';
  end if;
  if v_saved.scoring_version = 2 then
    insert into mystery_private.dopamin_mystery_run_answers(run_id, answers)
    values(v_saved.id, p_answers) on conflict (run_id) do nothing;
  end if;
  return jsonb_build_object(
    'id',v_saved.id,'nickname',v_saved.nickname,
    'duration_seconds',v_saved.duration_seconds,
    'score',v_saved.score,'success',v_saved.success,'scoring_version',v_saved.scoring_version,
    'created_at',v_saved.created_at
  );
end;
$function$;

revoke all on function public.submit_dopamin_mystery_run(uuid,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.submit_dopamin_mystery_run(uuid,text,integer,jsonb) to anon,authenticated;

CREATE OR REPLACE FUNCTION public.regrade_dopamin_mystery_run(p_id uuid, p_nickname text, p_duration_seconds integer, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.dopamin_mystery_runs%rowtype;
  v_old_score integer := 0;
  v_new_score integer := 0;
  v_old_success boolean;
  v_new_success boolean;
begin
  if p_id is null or p_nickname is null or p_duration_seconds is null
     or p_answers is null or jsonb_typeof(p_answers) <> 'object'
     or length(btrim(p_nickname)) not between 1 and 16 then
    raise exception 'invalid submission';
  end if;
  select * into v from public.dopamin_mystery_runs
  where id=p_id for update;
  if not found then raise exception 'submission not found'; end if;
  if v.nickname <> btrim(p_nickname) or v.duration_seconds <> p_duration_seconds then
    raise exception 'submission details differ';
  end if;

  if v.scoring_version=1 then
    if p_answers->>'suspect'='jihoon' then v_old_score:=v_old_score+1; end if;
    if p_answers->>'motive'='late' then v_old_score:=v_old_score+1; end if;
    if p_answers->>'weapon'='metal' then v_old_score:=v_old_score+1; end if;
    if p_answers->>'frame'='jei' then v_old_score:=v_old_score+1; end if;
    if p_answers->>'proof' in ('exit','chatfull','corridor') then v_old_score:=v_old_score+1; end if;
    v_old_success:=(p_answers->>'suspect'='jihoon' and v_old_score >= 4);
    if v_old_score <> v.score or v_old_success is distinct from v.success then
      raise exception 'original scoring mismatch';
    end if;
    v_new_score:=v_old_score;
    if p_answers->>'proof'='payment' then v_new_score:=v_new_score+1; end if;
    v_new_success:=(p_answers->>'suspect'='jihoon' and v_new_score >= 4);
    update public.dopamin_mystery_runs
       set score=v_new_score, success=v_new_success, scoring_version=2
     where id=p_id returning * into v;
    insert into mystery_private.dopamin_mystery_run_answers(run_id,answers)
    values (v.id,p_answers) on conflict (run_id) do nothing;
  elsif v.scoring_version<>2 then
    raise exception 'unsupported scoring version';
  end if;
  return jsonb_build_object('id',v.id,'nickname',v.nickname,
    'duration_seconds',v.duration_seconds,'score',v.score,'success',v.success,
    'scoring_version',v.scoring_version,'created_at',v.created_at);
end;
$function$;
revoke all on function public.regrade_dopamin_mystery_run(uuid,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.regrade_dopamin_mystery_run(uuid,text,integer,jsonb) to anon,authenticated;
