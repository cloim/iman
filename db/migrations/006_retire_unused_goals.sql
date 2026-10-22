-- 과거 목표와 판정 이력은 보존하며 현재 목표에서 제외한다.
UPDATE goals
   SET active = 'false'
 WHERE type IN ('pickups', 'quiet_hours');
