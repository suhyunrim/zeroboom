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

-- ───────── 대회(토너먼트) 트로피 — 우승팀 멤버 1행 ─────────
-- 종료된 대회(status='finished', championTeamId 있음)의 우승팀 members(JSON [{puuid,position},...])를
-- 펼쳐 한 행 = (대회, 트로피 보유자). 트로피 개수 = COUNT(*) GROUP BY player_name.
-- trophy_type 예: worlds/lck/msi/kespa/first_stand (null일 수 있음). puuid는 노출 안 함.
CREATE OR REPLACE VIEW ai_trophies AS
SELECT
  s.name            AS player_name,
  x.trophy_type,
  x.tournament_name,
  x.won_at,
  x.position
FROM (
  SELECT t.id AS tournament_id, t.name AS tournament_name, t.trophyType AS trophy_type,
         COALESCE(t.heldAt, t.updatedAt) AS won_at,
         jt.puuid AS puuid, jt.position AS position
  FROM tournaments t
  JOIN tournament_teams tm ON tm.id = t.championTeamId
  JOIN JSON_TABLE(tm.members, '$[*]' COLUMNS (
        puuid    VARCHAR(128) PATH '$.puuid',
        position VARCHAR(16)  PATH '$.position'
  )) jt ON 1 = 1
  WHERE t.groupId = ai_current_group()
    AND t.status = 'finished'
    AND t.championTeamId IS NOT NULL
) x
LEFT JOIN summoners s ON s.puuid = x.puuid;

-- ───────── 명예/추천(honor) — 추천 1표 = 1행 ─────────
-- honor_votes: 경기 후 추천. target=받은 사람. "명예 많이 받은 사람" = COUNT(*) GROUP BY target_name.
-- ★ 추천한 사람(voter)의 신원은 노출하지 않는다(프라이버시) — "누가 받았나"만 집계 가능. puuid 비노출(이름만).
CREATE OR REPLACE VIEW ai_honor AS
SELECT
  st.name       AS target_name,
  hv.gameId     AS game_id,
  hv.teamNumber AS team,
  hv.createdAt  AS voted_at
FROM honor_votes hv
LEFT JOIN summoners st ON st.puuid = hv.targetPuuid
WHERE hv.groupId = ai_current_group();

-- ───────── 시즌 스냅샷 레이팅 — 시즌 종료 시점 멤버별 레이팅 ─────────
-- rating은 raw(default+additional). 답변엔 티어로 환산. "지난 시즌 1황" = 특정 season ORDER BY rating DESC.
CREATE OR REPLACE VIEW ai_season_ratings AS
SELECT
  s.name    AS name,
  ss.season AS season,
  (COALESCE(ss.defaultRating, 0) + COALESCE(ss.additionalRating, 0)) AS rating
FROM season_snapshots ss
LEFT JOIN summoners s ON s.puuid = ss.puuid
WHERE ss.groupId = ai_current_group();

-- ───────── 업적 획득 내역 — 획득 1건 = 1행 ─────────
-- achievement_id는 코드 식별자(사람이 읽는 이름/설명/목표는 코드 definitions.js → get_achievement_progress 보완).
-- "업적 많이 깬 사람" = COUNT(*) GROUP BY player_name. "특정 업적 누가" = WHERE achievement_id='...'.
CREATE OR REPLACE VIEW ai_achievements AS
SELECT
  s.name           AS player_name,
  ua.achievementId AS achievement_id,
  ua.unlockedAt    AS unlocked_at
FROM user_achievements ua
LEFT JOIN summoners s ON s.puuid = ua.puuid
WHERE ua.groupId = ai_current_group();

-- ───────── 업적 진행 통계 — (사람, 통계종류, 값) ─────────
-- stat_type별 누적 카운터(업적 진행도). "OO 스탯 1등" = WHERE stat_type='...' ORDER BY value DESC.
CREATE OR REPLACE VIEW ai_achievement_stats AS
SELECT
  s.name       AS player_name,
  uas.statType AS stat_type,
  uas.value    AS value
FROM user_achievement_stats uas
LEFT JOIN summoners s ON s.puuid = uas.puuid
WHERE uas.groupId = ai_current_group();

-- ───────── 보이스(음성채널) 활동 — 일자별 체류시간 ─────────
-- 원본은 discordId+guildId 기준이라, 그룹의 길드(groups.discordGuildId)로 한정 + 그 그룹의 본캐 user로 이름 해석.
-- duration_seconds = 그 날 음성채널 체류 초. "음챗 오래한 사람" = SUM(duration_seconds) GROUP BY player_name.
CREATE OR REPLACE VIEW ai_voice_activity AS
SELECT
  s.name       AS player_name,
  vad.date     AS activity_date,
  vad.duration AS duration_seconds
FROM voice_activity_dailies vad
JOIN `groups` g ON g.id = ai_current_group() AND g.discordGuildId = vad.guildId
JOIN users u    ON u.discordId = vad.discordId AND u.groupId = ai_current_group()
               AND u.primaryPuuid IS NULL AND u.leftGuildAt IS NULL
JOIN summoners s ON s.puuid = u.puuid;

-- ───────── 유저 생성/권한 (비밀번호 치환해 별도 실행) ─────────
-- CREATE USER IF NOT EXISTS 'zeroboom_ai_ro'@'%' IDENTIFIED BY '<<RO_PASSWORD>>';
-- ALTER USER 'zeroboom_ai_ro'@'%' IDENTIFIED BY '<<RO_PASSWORD>>';
-- GRANT SELECT   ON zeroboom_bot.ai_players            TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot.ai_match_players      TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot.ai_trophies           TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot.ai_honor              TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot.ai_season_ratings     TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot.ai_achievements       TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot.ai_achievement_stats  TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot.ai_voice_activity     TO 'zeroboom_ai_ro'@'%';
-- GRANT EXECUTE  ON FUNCTION zeroboom_bot.ai_current_group       TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot_test.ai_players       TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot_test.ai_match_players TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot_test.ai_trophies      TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot_test.ai_honor             TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot_test.ai_season_ratings    TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot_test.ai_achievements      TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot_test.ai_achievement_stats TO 'zeroboom_ai_ro'@'%';
-- GRANT SELECT   ON zeroboom_bot_test.ai_voice_activity     TO 'zeroboom_ai_ro'@'%';
-- GRANT EXECUTE  ON FUNCTION zeroboom_bot_test.ai_current_group  TO 'zeroboom_ai_ro'@'%';
-- FLUSH PRIVILEGES;
