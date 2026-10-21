-- API 접속 역할. 소유자가 아니므로 RLS 가 항상 적용된다. 비밀번호는 마이그레이터가 설정
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'iman_app') then
    create role iman_app login;
  end if;
end $$;

grant usage on schema public to iman_app;
grant select, insert, update, delete on all tables in schema public to iman_app;
grant usage, select on all sequences in schema public to iman_app;
grant execute on all functions in schema public to iman_app;
alter default privileges in schema public grant select, insert, update, delete on tables to iman_app;

-- 본인 데이터 전용 테이블
do $$
declare
  t text;
begin
  foreach t in array array['usage_sessions', 'goals', 'rests', 'weekly_reports'] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy own_rows on %I using (app_is_system() or user_id = app_user()) with check (app_is_system() or user_id = app_user())',
      t
    );
  end loop;
end $$;

alter table refresh_tokens enable row level security;
create policy system_only on refresh_tokens using (app_is_system()) with check (app_is_system());

alter table devices enable row level security;
create policy own_rows on devices
  using (app_is_system() or user_id = app_user()
         or user_id in (select user_id from group_members where group_id = app_group()))
  with check (app_is_system() or user_id = app_user());

alter table push_tokens enable row level security;
create policy own_rows on push_tokens
  using (app_is_system() or device_id in (select id from devices where user_id = app_user()))
  with check (app_is_system() or device_id in (select id from devices where user_id = app_user()));

alter table goal_results enable row level security;
create policy own_or_group on goal_results
  using (app_is_system() or goal_id in (
    select id from goals g where g.user_id = app_user()
       or g.user_id in (select user_id from group_members where group_id = app_group())))
  with check (app_is_system() or goal_id in (select id from goals where user_id = app_user()));

-- goals 는 같은 그룹이 목표 달성 현황을 볼 수 있도록 읽기만 추가 허용
create policy group_read on goals for select
  using (user_id in (select user_id from group_members where group_id = app_group()));

-- 집계: 본인 쓰기, 같은 그룹(대시보드 키오스크 포함) 읽기
alter table daily_rollups enable row level security;
create policy own_write on daily_rollups
  using (app_is_system() or user_id = app_user())
  with check (app_is_system() or user_id = app_user());
create policy group_read on daily_rollups for select
  using (user_id in (select user_id from group_members where group_id = app_group()));

-- 사용자 프로필: 본인과 같은 그룹 읽기
alter table users enable row level security;
create policy self_or_group on users
  using (app_is_system() or id = app_user()
         or id in (select user_id from group_members where group_id = app_group()))
  with check (app_is_system() or id = app_user());

-- 그룹 단위 테이블: 그룹 읽기, 쓰기는 그룹대표(그룹 생성과 초대 수락은 system 컨텍스트)
alter table groups enable row level security;
create policy group_read on groups for select using (app_is_system() or id = app_group());
create policy leader_write on groups
  using (app_is_system() or (id = app_group() and app_role() = 'leader'))
  with check (app_is_system() or (id = app_group() and app_role() = 'leader'));

alter table group_members enable row level security;
create policy group_read on group_members for select using (app_is_system() or group_id = app_group());
create policy leader_write on group_members
  using (app_is_system() or (group_id = app_group() and app_role() = 'leader'))
  with check (app_is_system() or (group_id = app_group() and app_role() = 'leader'));

do $$
declare
  t text;
begin
  foreach t in array array['invites', 'dashboards'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy group_read on %I for select using (app_is_system() or group_id = app_group())', t);
    execute format(
      'create policy leader_write on %I using (app_is_system() or (group_id = app_group() and app_role() = ''leader'')) with check (app_is_system() or (group_id = app_group() and app_role() = ''leader''))',
      t
    );
  end loop;
end $$;

alter table pauses enable row level security;
create policy group_rows on pauses
  using (app_is_system() or group_id = app_group())
  with check (app_is_system() or (group_id = app_group() and app_role() in ('leader', 'member')));

alter table kiosk_pairings enable row level security;
create policy system_only on kiosk_pairings using (app_is_system()) with check (app_is_system());

-- apps 카탈로그는 모두 읽고 쓴다(라벨, 카테고리 공유)
