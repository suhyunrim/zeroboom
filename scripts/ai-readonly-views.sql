-- AI 채팅 읽기 전용 SQL 탈출구용 함수 + 뷰 + SELECT 전용 유저.
--
-- 적용 방법(테섭 스키마 예시 — 라이브는 zeroboom_bot 으로):
--   sudo docker exec -i zeroboom-db mysql -uroot -p"$DB_ROOT_PW" zeroboom_bot_test < scripts/ai-readonly-views.sql
-- 유저/권한은 비밀번호가 들어가므로 이 파일 아래 "유저 생성" 블록을 별도로(비밀번호 치환해) 실행한다.
--
-- 설계:
--  - 그룹 격리는 세션변수 @ai_group_id 로 한다(서버가 SET, 미설정 시 NULL=0행=fail closed).
--  - MySQL 뷰는 세션변수(@var)를 직접 못 쓰므로(ERROR 1351), 함수 ai_current_group() 로 감싸 뷰가 호출한다.
--  - 민감 컬럼(puuid/discordId/accountId 등)은 절대 노출하지 않는다.
--  - 뷰는 DEFINER 권한으로 base 테이블을 읽고, 읽기 전용 유저에겐 "뷰 SELECT + 함수 EXECUTE" 만 GRANT 한다
--    → 읽기 전용 유저는 base 테이블·타그룹·민감 컬럼에 접근할 수 없다.

-- ───────── 그룹 격리용 함수 (세션변수 @ai_group_id 반환) ─────────
-- DETERMINISTIC NO SQL 로 선언해 binlog 신뢰 검사(log_bin_trust_function_creators)도 통과한다.
DROP FUNCTION IF EXISTS ai_current_group;
CREATE FUNCTION ai_current_group() RETURNS INT UNSIGNED DETERMINISTIC NO SQL
  RETURN CAST(@ai_group_id AS UNSIGNED);

-- ───────── 활성 멤버별 누적 전적·포지션·내전레이팅 ─────────
-- rating은 raw 점수(정렬/비교용). 답변에는 티어로 환산해 노출하도록 프롬프트가 강제한다.
CREATE OR REPLACE VIEW ai_players AS
SELECT
  s.name              AS name,
  s.rankTier          AS solo_rank_tier,
  s.mainPosition      AS main_position,
  s.mainPositionRate  AS main_position_rate,
  s.subPosition       AS sub_position,
  s.subPositionRate   AS sub_position_rate,
  u.win               AS win,
  u.lose              AS lose,
  (COALESCE(u.win, 0) + COALESCE(u.lose, 0))                       AS games,
  (COALESCE(u.defaultRating, 0) + COALESCE(u.additionalRating, 0)) AS rating,
  u.role              AS role,
  u.firstMatchDate    AS first_match_date,
  u.latestMatchDate   AS latest_match_date
FROM users u
JOIN summoners s ON s.puuid = u.puuid
WHERE u.groupId = ai_current_group()
  AND u.primaryPuuid IS NULL   -- 본캐만(부캐 제외)
  AND u.role <> 'outsider'     -- 외부인 제외
  AND u.leftGuildAt IS NULL;   -- 탈퇴자 제외

-- ───────── 매치별 참가자 1행(승패/포지션/시각) ─────────
-- team1/team2 JSON([[puuid,name,rating,position], ...])을 펼쳐 한 행 = (매치, 참가자).
-- won = 1/0 이라 AVG(won)=승률. 최근 N판은 played_at DESC. puuid는 노출하지 않는다(이름만).
CREATE OR REPLACE VIEW ai_match_players AS
SELECT
  t.game_id,
  t.played_at,
  t.team,
  (t.win_team = t.team) AS won,
  s.name                AS player_name,
  t.position
FROM (
  SELECT m.gameId AS game_id, m.createdAt AS played_at, m.winTeam AS win_team,
         1 AS team, jt.puuid AS puuid, jt.position AS position
  FROM matches m
  JOIN JSON_TABLE(m.team1, '$[*]' COLUMNS (
        puuid    VARCHAR(128) PATH '$[0]',
        position VARCHAR(16)  PATH '$[3]'
  )) jt ON 1 = 1
  WHERE m.groupId = ai_current_group() AND m.winTeam IS NOT NULL
  UNION ALL
  SELECT m.gameId, m.createdAt, m.winTeam,
         2 AS team, jt.puuid, jt.position
  FROM matches m
  JOIN JSON_TABLE(m.team2, '$[*]' COLUMNS (
        puuid    VARCHAR(128) PATH '$[0]',
        position VARCHAR(16)  PATH '$[3]'
  )) jt ON 1 = 1
  WHERE m.groupId = ai_current_group() AND m.winTeam IS NOT NULL
) t
LEFT JOIN summoners s ON s.puuid = t.puuid;

-- ───────── 유저 생성/권한 (비밀번호 치환해 별도 실행) ─────────
-- CREATE USER IF NOT EXISTS 'zeroboom_ai_ro'@'%' IDENTIFIED BY '<<RO_PASSWORD>>';
-- ALTER USER 'zeroboom_ai_ro'@'%' IDENTIFIED BY '<<RO_PASSWORD>>';
-- GRANT SELECT   ON zeroboom_bot.ai_players            TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot.ai_match_players      TO 'zeroboom_ai_ro'@'%';
-- GRANT EXECUTE  ON FUNCTION zeroboom_bot.ai_current_group       TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot_test.ai_players       TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot_test.ai_match_players TO 'zeroboom_ai_ro'@'%';
-- GRANT EXECUTE  ON FUNCTION zeroboom_bot_test.ai_current_group  TO 'zeroboom_ai_ro'@'%';
-- FLUSH PRIVILEGES;
