-- 예외 앱: 사용시간 집계, 목표 판정, 넛지에서 뺀다. 원본 세션은 그대로 둔다
-- 그룹 공통 목록과 구성원별 추가 목록의 합집합을 적용한다
alter table groups add column if not exists excluded_packages text[] not null default '{}';
alter table group_members add column if not exists excluded_packages text[] not null default '{}';

-- 사용자에게 적용되는 예외 패키지(정렬, 중복 제거). 그룹이 없으면 빈 배열
create or replace function excluded_packages_of(p_user uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select array(select distinct p from unnest(g.excluded_packages || gm.excluded_packages) p order by p)
     from group_members gm join groups g on g.id = gm.group_id
     where gm.user_id = p_user),
    '{}'::text[]
  )
$$;

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
  ), excluded as (
    select excluded_packages_of(p_user) as e
  ), clipped as (
    select s.span * win.w as r
    from usage_sessions s, win, excluded
    where s.user_id = p_user
      and s.span && win.w
      and s.started_at < upper(win.w)
      and not (s.package_name = any (excluded.e))
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

grant execute on function excluded_packages_of(uuid) to iman_app;
