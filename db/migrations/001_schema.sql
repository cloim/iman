-- 이만(iman) 기본 스키마
create extension if not exists btree_gist;

create type visibility_level as enum ('summary', 'category', 'app');
create type member_role as enum ('leader', 'member', 'viewer');

create table users (
  id           uuid primary key default gen_random_uuid(),
  google_sub   text not null unique,
  email        text not null,
  display_name text not null,
  avatar_url   text,
  timezone     text not null default 'Asia/Seoul',
  last_role    member_role,
  created_at   timestamptz not null default now()
);

create table refresh_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  token_hash  text not null unique,
  client      text not null check (client in ('web', 'app')),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  replaced_by uuid,
  created_at  timestamptz not null default now()
);
create index refresh_tokens_user_idx on refresh_tokens (user_id);

create table groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 40),
  emoji      text not null default '🌿',
  owner_id   uuid not null references users (id),
  week_start smallint not null default 0 check (week_start between 0 and 6),
  visibility visibility_level not null default 'category',
  created_at timestamptz not null default now()
);

-- user_id 가 기본키이므로 한 계정은 한 그룹에만 소속된다
create table group_members (
  user_id             uuid primary key references users (id) on delete cascade,
  group_id            uuid not null references groups (id) on delete cascade,
  role                member_role not null,
  nickname            text,
  visibility_override visibility_level,
  joined_at           timestamptz not null default now()
);
create index group_members_group_idx on group_members (group_id);

create table invites (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups (id) on delete cascade,
  code       text not null unique,
  email      text,
  role       member_role not null check (role in ('member', 'viewer')),
  expires_at timestamptz not null,
  max_uses   int not null default 1 check (max_uses > 0),
  used_count int not null default 0,
  created_by uuid not null references users (id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table devices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users (id) on delete cascade,
  install_id     text not null,
  model          text not null,
  alias          text,
  os_version     text,
  app_version    text,
  last_synced_at timestamptz,
  clock_skew_ms  int not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (user_id, install_id)
);

create table apps (
  package_name text primary key,
  label        text not null,
  category     text not null default 'other',
  updated_at   timestamptz not null default now()
);

-- 앱별 사용 구간. ended_at 이 null 이면 진행 중
create table usage_sessions (
  user_id      uuid not null,
  device_id    uuid not null,
  package_name text not null,
  started_at   timestamptz not null,
  ended_at     timestamptz,
  span         tstzrange generated always as (tstzrange(started_at, coalesce(ended_at, 'infinity'))) stored,
  received_at  timestamptz not null default now(),
  primary key (device_id, package_name, started_at),
  check (ended_at is null or ended_at >= started_at)
) partition by range (started_at);

create table usage_sessions_default partition of usage_sessions default;
create index usage_sessions_span_idx on usage_sessions using gist (user_id, span);
create index usage_sessions_user_start_idx on usage_sessions (user_id, started_at);

create table daily_rollups (
  user_id     uuid not null references users (id) on delete cascade,
  local_date  date not null,
  total_ms    bigint not null,
  actual_ms   bigint not null,
  pickups     int not null,
  by_app      jsonb not null,
  by_category jsonb not null,
  by_device   jsonb not null,
  by_hour     bigint[] not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, local_date)
);

create table goals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  type         text not null check (type in ('daily_actual', 'app_limit', 'category_limit', 'quiet_hours', 'pickups')),
  target       int not null check (target >= 0),
  scope_ref    text,
  days_of_week smallint not null default 127 check (days_of_week between 1 and 127),
  quiet_from   text check (quiet_from ~ '^[0-2][0-9]:[0-5][0-9]$'),
  quiet_to     text check (quiet_to ~ '^[0-2][0-9]:[0-5][0-9]$'),
  nudge        jsonb not null default '{"enabled": true}',
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index goals_user_idx on goals (user_id);

create table goal_results (
  goal_id    uuid not null references goals (id) on delete cascade,
  local_date date not null,
  status     text not null check (status in ('met', 'near', 'over')),
  value      bigint not null,
  primary key (goal_id, local_date)
);

create table dashboards (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references groups (id) on delete cascade,
  name          text not null default '우리 그룹',
  layout        jsonb not null default '{"metric": "actual", "showRibbon": true, "showRanking": false}',
  theme         text not null default 'paper' check (theme in ('paper', 'night', 'auto')),
  display_level visibility_level not null default 'summary',
  privacy_blur  boolean not null default false,
  night_dim     jsonb not null default '{"from": "23:00", "to": "07:00"}',
  created_at    timestamptz not null default now()
);

create table kiosk_pairings (
  id              uuid primary key default gen_random_uuid(),
  pair_code_hash  text not null,
  code_expires_at timestamptz not null,
  dashboard_id    uuid references dashboards (id) on delete cascade,
  device_label    text,
  token_hash      text unique,
  approved_by     uuid references users (id),
  approved_at     timestamptz,
  last_seen_at    timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index kiosk_pairings_code_idx on kiosk_pairings (pair_code_hash) where approved_at is null;

-- 함께 쉬기
create table pauses (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups (id) on delete cascade,
  started_by uuid not null references users (id),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz not null,
  created_at timestamptz not null default now()
);

-- 개인 쉬기(넛지의 "이만, 쉬기", 위젯, 함께 쉬기 참여)
create table rests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  pause_id   uuid references pauses (id) on delete set null,
  source     text not null check (source in ('nudge', 'widget', 'app', 'group')),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, starts_at)
);

create table push_tokens (
  device_id  uuid primary key references devices (id) on delete cascade,
  fcm_token  text not null,
  updated_at timestamptz not null default now()
);

create table weekly_reports (
  user_id    uuid not null references users (id) on delete cascade,
  week_start date not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, week_start)
);
