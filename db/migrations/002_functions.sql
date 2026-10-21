-- 월 파티션 준비: 기준 월 앞뒤로 미리 만든다
create or replace function ensure_usage_partitions(p_back int default 1, p_ahead int default 2)
returns void language plpgsql as $$
declare
  m date;
  name text;
begin
  for i in -p_back..p_ahead loop
    m := (date_trunc('month', now()) + make_interval(months => i))::date;
    name := 'usage_sessions_' || to_char(m, 'YYYYMM');
    if to_regclass(name) is null then
      execute format(
        'create table %I partition of usage_sessions for values from (%L) to (%L)',
        name, m, (m + interval '1 month')::date
      );
    end if;
  end loop;
end $$;

select ensure_usage_partitions(1, 3);

-- 범위 안의 총 사용시간, 실제 사용시간(합집합), 사용 덩어리 수
-- packages/core summarize() 와 같은 결과를 내야 하며 fixtures/intervals 로 검증한다
create or replace function usage_totals(
  p_user     uuid,
  p_from     timestamptz,
  p_to       timestamptz,
  p_now      timestamptz default now(),
  p_devices  uuid[] default null,
  p_packages text[] default null
) returns table (total_ms bigint, actual_ms bigint, pickups int)
language sql stable as $$
  with win as (
    select tstzrange(p_from, greatest(p_from, least(p_to, p_now))) as w
  ), clipped as (
    select s.span * win.w as r
    from usage_sessions s, win
    where s.user_id = p_user
      and s.span && win.w
      and s.started_at < upper(win.w)
      and (p_devices is null or s.device_id = any (p_devices))
      and (p_packages is null or s.package_name = any (p_packages))
  ), merged as (
    select unnest(range_agg(r)) as m from clipped where not isempty(r)
  )
  select
    coalesce((select sum(extract(epoch from upper(r) - lower(r)) * 1000)::bigint from clipped where not isempty(r)), 0),
    coalesce((select sum(extract(epoch from upper(m) - lower(m)) * 1000)::bigint from merged), 0),
    (select count(*)::int from merged)
$$;

-- 요청 컨텍스트: API 가 트랜잭션마다 set_config 로 지정한다
create or replace function app_user() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app_is_system() returns boolean language sql stable as $$
  select coalesce(current_setting('app.system', true), '') = 'on'
$$;

create or replace function app_kiosk_dashboard() returns uuid language sql stable as $$
  select nullif(current_setting('app.kiosk_dashboard', true), '')::uuid
$$;

-- RLS 정책 안에서 다른 테이블을 조회하므로 security definer 로 재귀를 피한다
create or replace function app_group() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select group_id from group_members where user_id = app_user()),
    (select group_id from dashboards where id = app_kiosk_dashboard())
  )
$$;

create or replace function app_role() returns member_role
language sql stable security definer set search_path = public as $$
  select role from group_members where user_id = app_user()
$$;

-- 그룹대표가 정한 공개 수준(구성원별 예외 우선)
create or replace function effective_visibility(p_member uuid) returns visibility_level
language sql stable security definer set search_path = public as $$
  select coalesce(gm.visibility_override, g.visibility)
  from group_members gm join groups g on g.id = gm.group_id
  where gm.user_id = p_member
$$;

-- 같은 그룹 구성원의 원본 세션 조회. 공개 수준이 app 일 때만 허용
create or replace function member_sessions(p_member uuid, p_from timestamptz, p_to timestamptz)
returns table (device_id uuid, package_name text, started_at timestamptz, ended_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_member <> app_user() then
    if app_kiosk_dashboard() is not null
       or not exists (
         select 1 from group_members
         where user_id = p_member and group_id = app_group()
       )
       or effective_visibility(p_member) <> 'app' then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;
  return query
    select s.device_id, s.package_name, s.started_at, s.ended_at
    from usage_sessions s
    where s.user_id = p_member
      and s.span && tstzrange(p_from, p_to)
      and s.started_at < p_to
    order by s.started_at;
end $$;
