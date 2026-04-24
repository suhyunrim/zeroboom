/**
 * 업적 대량 확장 후 소급 적용 스크립트
 *
 * 처리 대상 (신규 stat):
 *   - 시간대: weekend_games, weekday_games
 *   - 하루 N판: max_games_per_day, games_in_today, today_key
 *   - 환영위원회: welcomer_wins (매치 시점 createdAt 3주 이내 팀메이트 판정)
 *   - 연속 출석: current_consecutive_days, best_consecutive_days
 *   - 매치 MVP: match_mvp_count, current_match_mvp_streak, best_match_mvp_streak
 *   - 세트: reverse_wins/loses, sweep_wins/loses
 *   - 채널 개척자: temp_voice_created (temp_voice_channels 테이블 COUNT)
 *
 * 스킵 (백필 불가):
 *   - 밤새기(night_owl_sessions): voice_activity는 마지막 세션만 저장 → 과거 세션 복원 불가
 *
 * 쿼리 기반이라 stat 불필요:
 *   - 명예왕/투표러: honor_votes 직접 COUNT
 *
 * 실행:
 *   node scripts/backfill-achievements-v2.js
 *
 * 주의: 기존 backfill-achievements.js와 독립적으로 실행 가능 (다른 stat type)
 */
require('dotenv').config();
const { Op } = require('sequelize');
const models = require('../src/db/models');
const { processAchievements } = require('../src/services/achievement/engine');
const { STAT_TYPES } = require('../src/services/achievement/definitions');
const { getCompositionKey } = require('../src/services/balance-report');
const {
  isWeekendTime, isWeekdayTime, getKSTDateKey, kstDayKeyDiff,
} = require('../src/utils/timeUtils');

const NEWBIE_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;
const SET_WINDOW_MS = 24 * 60 * 60 * 1000;

function emptyStats() {
  return {
    [STAT_TYPES.WEEKEND_GAMES]: 0,
    [STAT_TYPES.WEEKDAY_GAMES]: 0,
    [STAT_TYPES.MAX_GAMES_PER_DAY]: 0,
    [STAT_TYPES.GAMES_IN_TODAY]: 0,
    [STAT_TYPES.TODAY_KEY]: 0,
    [STAT_TYPES.WELCOMER_WINS]: 0,
    [STAT_TYPES.CURRENT_CONSECUTIVE_DAYS]: 0,
    [STAT_TYPES.BEST_CONSECUTIVE_DAYS]: 0,
    [STAT_TYPES.MATCH_MVP_COUNT]: 0,
    [STAT_TYPES.CURRENT_MATCH_MVP_STREAK]: 0,
    [STAT_TYPES.BEST_MATCH_MVP_STREAK]: 0,
    [STAT_TYPES.REVERSE_WINS]: 0,
    [STAT_TYPES.REVERSE_LOSES]: 0,
    [STAT_TYPES.SWEEP_WINS]: 0,
    [STAT_TYPES.SWEEP_LOSES]: 0,
  };
}

async function backfillGroup(group, users) {
  const groupId = group.id;

  const matchesRaw = await models.match.findAll({
    where: { groupId, winTeam: { [Op.ne]: null } },
    order: [['gameId', 'ASC']],
    raw: true,
  });
  const matches = matchesRaw.map((m) => ({
    ...m,
    team1: typeof m.team1 === 'string' ? JSON.parse(m.team1) : m.team1,
    team2: typeof m.team2 === 'string' ? JSON.parse(m.team2) : m.team2,
  }));

  const userMap = {};
  users.forEach((u) => { userMap[u.puuid] = u; });

  // 매치별 (gameId, targetPuuid) 투표 수 사전 집계
  const honorVotes = await models.honor_vote.findAll({
    where: { groupId },
    attributes: ['gameId', 'targetPuuid'],
    raw: true,
  });
  const voteCounts = {};
  honorVotes.forEach((v) => {
    const key = `${v.gameId}|${v.targetPuuid}`;
    voteCounts[key] = (voteCounts[key] || 0) + 1;
  });
  const isMatchMvp = (gameId, puuid) => (voteCounts[`${gameId}|${puuid}`] || 0) >= 3;

  const stats = {};
  const getS = (puuid) => {
    if (!stats[puuid]) stats[puuid] = emptyStats();
    return stats[puuid];
  };

  // composition별 진행 중인 세트 추적 (runtime의 processSetAchievements와 동일 규칙)
  const compositionSet = {};

  for (const match of matches) {
    const matchDate = match.gameCreation || match.createdAt;
    const matchTime = new Date(matchDate).getTime();
    const dayKey = getKSTDateKey(matchDate);
    const weekend = isWeekendTime(matchDate);
    const weekday = isWeekdayTime(matchDate);
    const newbieCutoff = matchTime - NEWBIE_WINDOW_MS;
    const isNewbie = (puuid) => {
      const u = userMap[puuid];
      return u && u.createdAt && new Date(u.createdAt).getTime() >= newbieCutoff;
    };

    // 세트 갱신: 진행 중 시리즈에 현재 매치를 이어붙이고, 스윕(2-0) 또는 3경기째에 시리즈 종료 처리
    const compKey = getCompositionKey(match);
    const existing = compositionSet[compKey] || [];
    const lastTime = existing.length
      ? new Date(existing[existing.length - 1].gameCreation || existing[existing.length - 1].createdAt).getTime()
      : 0;
    const continueSet = existing.length > 0 && matchTime - lastTime <= SET_WINDOW_MS;
    const currentSet = continueSet ? [...existing, match] : [match];

    let setWinStat = null;
    let setLoseStat = null;
    if (currentSet.length === 2 && currentSet[0].winTeam === match.winTeam) {
      setWinStat = STAT_TYPES.SWEEP_WINS;
      setLoseStat = STAT_TYPES.SWEEP_LOSES;
      compositionSet[compKey] = []; // 스윕으로 시리즈 종료
    } else if (currentSet.length === 3) {
      // 1-1에서 온 3경기 → 시리즈 종료. 1경기 패자가 승자면 역전
      if (currentSet[0].winTeam !== match.winTeam) {
        setWinStat = STAT_TYPES.REVERSE_WINS;
        setLoseStat = STAT_TYPES.REVERSE_LOSES;
      }
      compositionSet[compKey] = [];
    } else {
      compositionSet[compKey] = currentSet;
    }

    const winTeamData = match.winTeam === 1 ? match.team1 : match.team2;
    const allPlayers = [...match.team1, ...match.team2];

    for (const [puuid] of allPlayers) {
      if (!userMap[puuid]) continue;
      const s = getS(puuid);
      const inTeam1 = match.team1.some((p) => p[0] === puuid);
      const myTeam = inTeam1 ? match.team1 : match.team2;
      const isWin = (inTeam1 && match.winTeam === 1) || (!inTeam1 && match.winTeam === 2);

      if (weekend) s[STAT_TYPES.WEEKEND_GAMES] += 1;
      if (weekday) s[STAT_TYPES.WEEKDAY_GAMES] += 1;

      if (isWin) {
        const hasNewbie = myTeam.some(([p]) => p !== puuid && isNewbie(p));
        if (hasNewbie) s[STAT_TYPES.WELCOMER_WINS] += 1;
      }

      // 하루 N판 + 연속 출석
      const prevKey = s[STAT_TYPES.TODAY_KEY];
      if (prevKey === 0) {
        s[STAT_TYPES.GAMES_IN_TODAY] = 1;
        s[STAT_TYPES.CURRENT_CONSECUTIVE_DAYS] = 1;
      } else if (prevKey === dayKey) {
        s[STAT_TYPES.GAMES_IN_TODAY] += 1;
        if (s[STAT_TYPES.CURRENT_CONSECUTIVE_DAYS] === 0) s[STAT_TYPES.CURRENT_CONSECUTIVE_DAYS] = 1;
      } else {
        s[STAT_TYPES.GAMES_IN_TODAY] = 1;
        const diff = kstDayKeyDiff(dayKey, prevKey);
        s[STAT_TYPES.CURRENT_CONSECUTIVE_DAYS] = diff === 1
          ? s[STAT_TYPES.CURRENT_CONSECUTIVE_DAYS] + 1
          : 1;
      }
      s[STAT_TYPES.TODAY_KEY] = dayKey;
      if (s[STAT_TYPES.GAMES_IN_TODAY] > s[STAT_TYPES.MAX_GAMES_PER_DAY]) {
        s[STAT_TYPES.MAX_GAMES_PER_DAY] = s[STAT_TYPES.GAMES_IN_TODAY];
      }
      if (s[STAT_TYPES.CURRENT_CONSECUTIVE_DAYS] > s[STAT_TYPES.BEST_CONSECUTIVE_DAYS]) {
        s[STAT_TYPES.BEST_CONSECUTIVE_DAYS] = s[STAT_TYPES.CURRENT_CONSECUTIVE_DAYS];
      }

      // 매치 MVP
      if (isMatchMvp(match.gameId, puuid)) {
        s[STAT_TYPES.MATCH_MVP_COUNT] += 1;
        s[STAT_TYPES.CURRENT_MATCH_MVP_STREAK] += 1;
        if (s[STAT_TYPES.CURRENT_MATCH_MVP_STREAK] > s[STAT_TYPES.BEST_MATCH_MVP_STREAK]) {
          s[STAT_TYPES.BEST_MATCH_MVP_STREAK] = s[STAT_TYPES.CURRENT_MATCH_MVP_STREAK];
        }
      } else {
        s[STAT_TYPES.CURRENT_MATCH_MVP_STREAK] = 0;
      }

      // 세트 업적
      if (setWinStat) {
        const inWinTeam = winTeamData.some((p) => p[0] === puuid);
        if (inWinTeam) s[setWinStat] += 1;
        else s[setLoseStat] += 1;
      }
    }
  }

  // 채널 개척자: temp_voice_channels 테이블 COUNT (해당 그룹의 guild 한정)
  if (group.discordGuildId) {
    const tempCounts = await models.temp_voice_channel.findAll({
      where: { guildId: group.discordGuildId },
      attributes: [
        'ownerDiscordId',
        [models.sequelize.fn('COUNT', models.sequelize.col('id')), 'cnt'],
      ],
      group: ['ownerDiscordId'],
      raw: true,
    });
    const byOwner = {};
    tempCounts.forEach((r) => { byOwner[r.ownerDiscordId] = Number(r.cnt); });
    for (const user of users) {
      if (user.discordId && byOwner[user.discordId]) {
        const s = getS(user.puuid);
        s[STAT_TYPES.TEMP_VOICE_CREATED] = byOwner[user.discordId];
      }
    }
  }

  // upsert (value = :value 로 덮어쓰기)
  const upserts = [];
  for (const [puuid, userStats] of Object.entries(stats)) {
    for (const [statType, value] of Object.entries(userStats)) {
      if (!value) continue;
      upserts.push(
        models.sequelize.query(
          `INSERT INTO user_achievement_stats (puuid, groupId, statType, value, createdAt, updatedAt)
           VALUES (:puuid, :groupId, :statType, :value, NOW(), NOW())
           ON DUPLICATE KEY UPDATE value = :value, updatedAt = NOW()`,
          { replacements: { puuid, groupId, statType, value } },
        ),
      );
    }
  }
  await Promise.all(upserts);

  return stats;
}

(async () => {
  try {
    const groups = await models.group.findAll({ attributes: ['id', 'groupName', 'discordGuildId'] });
    for (const group of groups) {
      const users = await models.user.findAll({ where: { groupId: group.id } });
      if (users.length === 0) {
        console.log(`[${group.groupName}] 유저 없음, 스킵`);
        continue;
      }

      console.log(`[${group.groupName}] stat 계산 중 (${users.length}명)...`);
      const stats = await backfillGroup(group, users);
      console.log(`[${group.groupName}] ${Object.keys(stats).length}명 stat upsert 완료`);

      const userMap = {};
      users.forEach((u) => { userMap[u.puuid] = u; });

      const [matchAch, honorAch, voiceAch, tempAch] = await Promise.all([
        processAchievements('match_result', { groupId: group.id, matchData: null, userMap }),
        processAchievements('honor_voted', { groupId: group.id, userMap }),
        processAchievements('voice_leave', { groupId: group.id, userMap }),
        processAchievements('temp_voice_created', { groupId: group.id, userMap }),
      ]);
      const total = matchAch.length + honorAch.length + voiceAch.length + tempAch.length;
      console.log(`[${group.groupName}] 업적 ${total}개 부여 완료 (match=${matchAch.length}, honor=${honorAch.length}, voice=${voiceAch.length}, temp=${tempAch.length})`);
    }
    console.log('완료');
    process.exit(0);
  } catch (e) {
    console.error('오류:', e);
    process.exit(1);
  }
})();
