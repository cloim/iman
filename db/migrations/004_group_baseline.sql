-- 그룹별 기본 기준시간(분). 목표를 설정하지 않은 구성원의 채움 기준으로 사용
alter table groups add column if not exists baseline_min int not null default 240 check (baseline_min between 30 and 1440);
