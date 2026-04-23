/**
 * user_achievement.unlockedAt 을 실제 달성 시점으로 보정
 *
 * 매치 히스토리를 시간순으로 리플레이하면서 각 유저의 카운터/stat을 추적하고,
 * 업적이 처음 충족된 시점을 계산한다. 비매치 업적(명예/채널/챌린지/보이스/기념일)은
 * 별도 데이터 소스로 계산.
 *
 * 복원 불가: night_owl (voice_activity 히스토리 없음)
 *
 * 실행:
 *   node scripts/backfill-achievement-timestamps.js            # 전체 그룹
 *   node scripts/backfill-achievement-timestamps.js --group 4  # 특정 그룹만
 *   node scripts/backfill-achievement-timestamps.js --dry-run  # UPDATE 없이 요약만
 */
require('dotenv').config();
const { Op } = require('sequelize');
const elo = require('arpad');
const models = require('../src/db/models');
const { definitions, TIERS, STAT_TYPES } = require('../src/services/achievement/definitions');
const { getTierName } = require('../src/utils/tierUtils');
const { getCompositionKey } = require('../src/services/balance-report');
const {
  getKSTHours, getKSTDateKey, kstDayKeyDiff, isWeekendTime, isWeekdayTime,
} = require('../src/utils/timeUtils');

const ratingCalculator = new elo(16);
const NEWBIE_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;
const SET_WINDOW_MS = 24 * 60 * 60 * 1000;

// 매치 리플레이의 checkAchievement 과 같은 값. 중첩 삼항 피하려고 테이블로 분리.
const CHALLENGE_MEDAL_KEY = {
  CHALLENGE_TRIPLE_GOLD: 'gold',
  CHALLENGE_GOLD_MEDAL: 'gold',
  CHALLENGE_SILVER_MEDAL: 'silver',
  CHALLENGE_BRONZE_MEDAL: 'bronze',
};

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const groupIdx = argv.indexOf('--group');
const ONLY_GROUP_ID = groupIdx >= 0 ? Number(argv[groupIdx + 1]) : null;

// 복원 불가 카테고리
const SKIP_CATEGORIES = new Set(['night_owl']);

function recordIfFirst(unlocks, puuid, achievementId, when) {
  if (!unlocks[puuid]) unlocks[puuid] = {};
  if (!unlocks[puuid][achievementId]) unlocks[puuid][achievementId] = when;
}

/**
 * rows 를 주어진 순서대로 훑으며 (keyField로 묶은) 카운터가 각 업적의 goal에
 * 처음 도달한 시점을 unlocks에 기록. 시간 기반 업적들의 공통 패턴.
 */
function accumulateAndUnlock({
  rows, keyField, puuidOf, getWhen, defs, unlocks,
}) {
  const counters = {};
  for (const row of rows) {
    const puuid = puuidOf ? puuidOf(row) : row[keyField];
    if (!puuid) continue;
    counters[puuid] = (counters[puuid] || 0) + 1;
    const cnt = counters[puuid];
    const when = getWhen(row);
    for (const def of defs) {
      if (cnt >= def.goal) recordIfFirst(unlocks, puuid, def.id, when);
    }
  }
}

/**
 * 매치 리플레이로 매치 기반 업적의 정확한 달성 시점 계산.
 */
function replayMatches(matches, userMap, honorVotes, unlocks) {
  const voteCounts = {};
  honorVotes.forEach((v) => {
    const key = `${v.gameId}|${v.targetPuuid}`;
    voteCounts[key] = (voteCounts[key] || 0) + 1;
  });
  const isMatchMvp = (gameId, puuid) => (voteCounts[`${gameId}|${puuid}`] || 0) >= 3;

  const runningStats = {};
  const init = (puuid) => {
    if (!runningStats[puuid]) {
      runningStats[puuid] = {
        wins: 0,
        games: 0,
        currentWin: 0,
        currentLose: 0,
        bestWin: 0,
        bestLose: 0,
        bestRating: 0,
        underdog: 0,
        lateNight: 0,
        weekendGames: 0,
        weekdayGames: 0,
        maxGamesPerDay: 0,
        todayKey: 0,
        gamesInToday: 0,
        currentConsecutive: 0,
        bestConsecutive: 0,
        mvpCount: 0,
        currentMvpStreak: 0,
        bestMvpStreak: 0,
        welcomer: 0,
        reverseWin: 0,
        reverseLose: 0,
        sweepWin: 0,
        sweepLose: 0,
      };
    }
    return runningStats[puuid];
  };

  const byCategory = {};
  definitions.forEach((d) => {
    if (!byCategory[d.category]) byCategory[d.category] = [];
    byCategory[d.category].push(d);
  });

  const compositionSet = {};

  for (const match of matches) {
    const matchDate = match.gameCreation || match.createdAt;
    const matchTime = new Date(matchDate).getTime();
    const dayKey = getKSTDateKey(matchDate);
    const weekend = isWeekendTime(matchDate);
    const weekday = isWeekdayTime(matchDate);
    const isLateNight = getKSTHours(matchDate) < 5;
    const when = new Date(matchDate);
    const newbieCutoff = matchTime - NEWBIE_WINDOW_MS;
    const isNewbie = (p) => {
      const u = userMap[p];
      return u && u.createdAt && new Date(u.createdAt).getTime() >= newbieCutoff;
    };

    const team1 = match.team1 || [];
    const team2 = match.team2 || [];
    const hasSnapshot = team1[0] && team1[0].length >= 3;
    let team1Avg = 500;
    let team2Avg = 500;
    if (hasSnapshot) {
      const t1 = team1.map((p) => p[2]).filter(Number.isFinite);
      const t2 = team2.map((p) => p[2]).filter(Number.isFinite);
      if (t1.length) team1Avg = t1.reduce((a, b) => a + b, 0) / t1.length;
      if (t2.length) team2Avg = t2.reduce((a, b) => a + b, 0) / t2.length;
    }
    const team1WinRate = ratingCalculator.expectedScore(team1Avg, team2Avg);
    const isTeam1Underdog = match.winTeam === 1 && team1WinRate <= 0.45;
    const isTeam2Underdog = match.winTeam === 2 && 1 - team1WinRate <= 0.45;

    const compKey = getCompositionKey(match);
    const prevSet = compositionSet[compKey] || [];
    const lastTime = prevSet.length
      ? new Date(prevSet[prevSet.length - 1].gameCreation || prevSet[prevSet.length - 1].createdAt).getTime()
      : 0;
    const keep = prevSet.length > 0 && matchTime - lastTime <= SET_WINDOW_MS && prevSet.length < 3;
    const currentSet = keep ? [...prevSet, match] : [match];
    compositionSet[compKey] = currentSet;

    let setWinKind = null;
    if (currentSet.length === 2 && currentSet[0].winTeam === match.winTeam) {
      setWinKind = 'sweep';
    } else if (currentSet.length === 3 && currentSet[0].winTeam !== currentSet[1].winTeam) {
      setWinKind = 'reverse';
    }

    const winTeam = match.winTeam === 1 ? team1 : team2;
    const allPlayers = [...team1, ...team2];

    for (const p of allPlayers) {
      const puuid = p[0];
      if (!userMap[puuid]) continue;
      const s = init(puuid);
      const inTeam1 = team1.some((t) => t[0] === puuid);
      const myTeam = inTeam1 ? team1 : team2;
      const isWin = (inTeam1 && match.winTeam === 1) || (!inTeam1 && match.winTeam === 2);

      s.games += 1;
      if (isWin) s.wins += 1;

      if (isWin) {
        s.currentWin += 1;
        s.currentLose = 0;
        if (s.currentWin > s.bestWin) s.bestWin = s.currentWin;
      } else {
        s.currentLose += 1;
        s.currentWin = 0;
        if (s.currentLose > s.bestLose) s.bestLose = s.currentLose;
      }

      if ((inTeam1 && isTeam1Underdog) || (!inTeam1 && isTeam2Underdog)) s.underdog += 1;
      if (isLateNight) s.lateNight += 1;
      if (weekend) s.weekendGames += 1;
      if (weekday) s.weekdayGames += 1;

      // 하루 N판 + 연속 출석 (dayKey 이어짐 여부로 streak 관리)
      if (s.todayKey === 0) {
        s.gamesInToday = 1;
        s.currentConsecutive = 1;
      } else if (s.todayKey === dayKey) {
        s.gamesInToday += 1;
      } else {
        const diff = kstDayKeyDiff(dayKey, s.todayKey);
        s.gamesInToday = 1;
        s.currentConsecutive = diff === 1 ? s.currentConsecutive + 1 : 1;
      }
      s.todayKey = dayKey;
      if (s.gamesInToday > s.maxGamesPerDay) s.maxGamesPerDay = s.gamesInToday;
      if (s.currentConsecutive > s.bestConsecutive) s.bestConsecutive = s.currentConsecutive;

      // 환영위원회: 가입 3주 이내 팀원과 함께 승리
      if (isWin) {
        const hasNewbie = myTeam.some(([q]) => q !== puuid && isNewbie(q));
        if (hasNewbie) s.welcomer += 1;
      }

      if (isMatchMvp(match.gameId, puuid)) {
        s.mvpCount += 1;
        s.currentMvpStreak += 1;
        if (s.currentMvpStreak > s.bestMvpStreak) s.bestMvpStreak = s.currentMvpStreak;
      } else {
        s.currentMvpStreak = 0;
      }

      if (setWinKind) {
        const inWinTeam = winTeam.some((t) => t[0] === puuid);
        if (setWinKind === 'sweep') {
          if (inWinTeam) s.sweepWin += 1;
          else s.sweepLose += 1;
        } else if (inWinTeam) s.reverseWin += 1;
        else s.reverseLose += 1;
      }

      if (hasSnapshot && p[2] != null && p[2] > s.bestRating) {
        s.bestRating = p[2];
      }

      // --- 업적 충족 체크 ---
      for (const def of byCategory.match || []) {
        if (s.wins >= def.goal) recordIfFirst(unlocks, puuid, def.id, when);
      }
      // games: externalGames는 여기서 제외, 아래 fallback에서 처리
      for (const def of byCategory.games || []) {
        if (s.games >= def.goal) recordIfFirst(unlocks, puuid, def.id, when);
      }
      for (const def of byCategory.streak || []) {
        if (def.id.startsWith('WIN_STREAK') && s.bestWin >= def.goal) recordIfFirst(unlocks, puuid, def.id, when);
        if (def.id.startsWith('LOSE_STREAK') && s.bestLose >= def.goal) recordIfFirst(unlocks, puuid, def.id, when);
      }
      if (hasSnapshot && s.bestRating > 0) {
        const tierIdx = TIERS.indexOf(getTierName(s.bestRating));
        for (const def of byCategory.tier || []) {
          if (tierIdx >= TIERS.indexOf(def.goal)) recordIfFirst(unlocks, puuid, def.id, when);
        }
      }
      const simpleChecks = [
        ['underdog', s.underdog],
        ['late_night', s.lateNight],
        ['weekend_games', s.weekendGames],
        ['weekday_games', s.weekdayGames],
        ['games_per_day', s.maxGamesPerDay],
        ['welcomer', s.welcomer],
        ['consecutive_days', s.bestConsecutive],
        ['match_mvp', s.mvpCount],
        ['match_mvp_streak', s.bestMvpStreak],
        ['reverse_win', s.reverseWin],
        ['reverse_lose', s.reverseLose],
        ['sweep_win', s.sweepWin],
        ['sweep_lose', s.sweepLose],
      ];
      for (const [cat, value] of simpleChecks) {
        for (const def of byCategory[cat] || []) {
          if (value >= def.goal) recordIfFirst(unlocks, puuid, def.id, when);
        }
      }
    }
  }
}

/**
 * externalGames만으로 games 업적을 달성한 케이스. 매치 리플레이에 안 잡힘.
 * fallback으로 유저 가입일 사용 (정확하진 않지만 백필 시점보다는 현실적).
 */
function applyExternalGamesFallback(unlocks, users, externalGamesMap) {
  const gamesDefs = definitions.filter((d) => d.category === 'games');
  for (const u of users) {
    const ext = externalGamesMap[u.puuid] || 0;
    if (ext === 0 || !u.createdAt) continue;
    const when = new Date(u.createdAt);
    for (const def of gamesDefs) {
      if (ext >= def.goal) recordIfFirst(unlocks, u.puuid, def.id, when);
    }
  }
}

function applyAnniversary(unlocks, users) {
  const anniversary = definitions.filter((d) => d.category === 'anniversary');
  for (const u of users) {
    if (!u.createdAt) continue;
    const created = new Date(u.createdAt);
    for (const def of anniversary) {
      const when = new Date(created.getTime() + def.goal * 24 * 60 * 60 * 1000);
      recordIfFirst(unlocks, u.puuid, def.id, when);
    }
  }
}

async function applyHonor(unlocks, groupId) {
  const received = definitions.filter((d) => d.category === 'honor_received');
  const voted = definitions.filter((d) => d.category === 'honor_voted_count');
  if (received.length === 0 && voted.length === 0) return;

  const votes = await models.honor_vote.findAll({
    where: { groupId },
    attributes: ['voterPuuid', 'targetPuuid', 'createdAt'],
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
    raw: true,
  });

  const getWhen = (v) => new Date(v.createdAt);
  accumulateAndUnlock({ rows: votes, keyField: 'targetPuuid', getWhen, defs: received, unlocks });
  accumulateAndUnlock({ rows: votes, keyField: 'voterPuuid', getWhen, defs: voted, unlocks });
}

async function applyChannelCreator(unlocks, group, users) {
  const defs = definitions.filter((d) => d.category === 'channel_creator');
  if (!group.discordGuildId || defs.length === 0) return;

  const discordToPuuid = {};
  users.forEach((u) => { if (u.discordId) discordToPuuid[u.discordId] = u.puuid; });

  const channels = await models.temp_voice_channel.findAll({
    where: { guildId: group.discordGuildId },
    attributes: ['ownerDiscordId', 'createdAt'],
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
    raw: true,
  });
  accumulateAndUnlock({
    rows: channels,
    puuidOf: (c) => discordToPuuid[c.ownerDiscordId],
    getWhen: (c) => new Date(c.createdAt),
    defs,
    unlocks,
  });
}

/**
 * 챌린지: 종료 시점(endAt)에 메달 집계, 누적 메달이 goal에 처음 도달한 시점을 기록
 */
async function applyChallenge(unlocks, groupId) {
  const defs = definitions.filter((d) => d.category === 'challenge');
  if (defs.length === 0) return;

  const challenges = await models.challenge.findAll({
    where: { groupId, leaderboardSnapshot: { [Op.ne]: null }, canceledAt: null },
    attributes: ['leaderboardSnapshot', 'endAt', 'updatedAt'],
    order: [['endAt', 'ASC']],
    raw: true,
  });

  const medalsByPuuid = {};
  for (const ch of challenges) {
    const snapshot = typeof ch.leaderboardSnapshot === 'string'
      ? JSON.parse(ch.leaderboardSnapshot)
      : ch.leaderboardSnapshot;
    if (!Array.isArray(snapshot)) continue;
    const when = new Date(ch.endAt || ch.updatedAt);

    for (const entry of snapshot) {
      if (entry.rank < 1 || entry.rank > 3) continue;
      if (!medalsByPuuid[entry.puuid]) medalsByPuuid[entry.puuid] = { gold: 0, silver: 0, bronze: 0 };
      const m = medalsByPuuid[entry.puuid];
      if (entry.rank === 1) m.gold += 1;
      else if (entry.rank === 2) m.silver += 1;
      else if (entry.rank === 3) m.bronze += 1;

      for (const def of defs) {
        const medalKey = CHALLENGE_MEDAL_KEY[def.id];
        if (medalKey && m[medalKey] >= def.goal) recordIfFirst(unlocks, entry.puuid, def.id, when);
      }
    }
  }
}

/**
 * voice: 일별 duration(초) 을 date ASC 누적하여 goal(시간) 도달한 날의 EOD를 unlockedAt으로
 */
async function applyVoice(unlocks, group, users) {
  const defs = definitions.filter((d) => d.category === 'voice');
  if (!group.discordGuildId || defs.length === 0) return;

  const discordToPuuid = {};
  const discordIds = [];
  users.forEach((u) => {
    if (u.discordId) {
      discordToPuuid[u.discordId] = u.puuid;
      discordIds.push(u.discordId);
    }
  });
  if (discordIds.length === 0) return;

  const rows = await models.voice_activity_daily.findAll({
    where: { guildId: group.discordGuildId, discordId: discordIds },
    attributes: ['discordId', 'date', 'duration'],
    order: [['date', 'ASC']],
    raw: true,
  });

  const cumulative = {};
  for (const r of rows) {
    const puuid = discordToPuuid[r.discordId];
    if (!puuid) continue;
    cumulative[puuid] = (cumulative[puuid] || 0) + Number(r.duration);
    const whenEOD = new Date(`${r.date}T23:59:59`);
    for (const def of defs) {
      if (cumulative[puuid] >= def.goal * 3600) {
        recordIfFirst(unlocks, puuid, def.id, whenEOD);
      }
    }
  }
}

async function processGroup(group) {
  const users = await models.user.findAll({
    where: { groupId: group.id },
    attributes: ['puuid', 'discordId', 'createdAt', 'defaultRating', 'additionalRating'],
    raw: true,
  });
  if (users.length === 0) return { group: group.groupName, skipped: true };

  const userMap = {};
  users.forEach((u) => { userMap[u.puuid] = u; });

  const [matchesRaw, honorVotes, externalRecords] = await Promise.all([
    models.match.findAll({
      where: { groupId: group.id, winTeam: { [Op.ne]: null } },
      order: [['gameCreation', 'ASC'], ['createdAt', 'ASC'], ['gameId', 'ASC']],
      attributes: ['gameId', 'winTeam', 'team1', 'team2', 'gameCreation', 'createdAt'],
      raw: true,
    }),
    models.honor_vote.findAll({
      where: { groupId: group.id },
      attributes: ['gameId', 'targetPuuid'],
      raw: true,
    }),
    models.externalRecord.findAll({
      where: { groupId: group.id },
      attributes: ['puuid', 'win', 'lose'],
      raw: true,
    }),
  ]);
  const matches = matchesRaw.map((m) => ({
    ...m,
    team1: typeof m.team1 === 'string' ? JSON.parse(m.team1) : m.team1,
    team2: typeof m.team2 === 'string' ? JSON.parse(m.team2) : m.team2,
  }));

  const unlocks = {};

  // 매치 리플레이
  replayMatches(matches, userMap, honorVotes, unlocks);

  // externalRecord로만 달성한 games 업적 보정
  const externalGamesMap = {};
  externalRecords.forEach((r) => {
    externalGamesMap[r.puuid] = (externalGamesMap[r.puuid] || 0) + (r.win || 0) + (r.lose || 0);
  });
  applyExternalGamesFallback(unlocks, users, externalGamesMap);

  // anniversary 는 동기 계산
  applyAnniversary(unlocks, users);

  // 비매치 데이터 소스들 (서로 독립이라 병렬)
  await Promise.all([
    applyHonor(unlocks, group.id),
    applyChannelCreator(unlocks, group, users),
    applyChallenge(unlocks, group.id),
    applyVoice(unlocks, group, users),
  ]);

  const existingRows = await models.user_achievement.findAll({
    where: { groupId: group.id },
    attributes: ['id', 'puuid', 'achievementId', 'unlockedAt'],
    raw: true,
  });

  const defById = {};
  definitions.forEach((d) => { defById[d.id] = d; });

  let updated = 0;
  let unchanged = 0;
  let skippedNoMatch = 0;
  let skippedCategory = 0;
  const byCategoryUpdated = {};

  for (const row of existingRows) {
    const def = defById[row.achievementId];
    if (!def) continue;
    if (SKIP_CATEGORIES.has(def.category)) {
      skippedCategory += 1;
      continue;
    }

    const computed = unlocks[row.puuid]?.[row.achievementId];
    if (!computed) {
      skippedNoMatch += 1;
      continue;
    }

    if (new Date(row.unlockedAt).getTime() === computed.getTime()) {
      unchanged += 1;
      continue;
    }

    if (!DRY_RUN) {
      await models.user_achievement.update(
        { unlockedAt: computed },
        { where: { id: row.id } },
      );
    }
    updated += 1;
    byCategoryUpdated[def.category] = (byCategoryUpdated[def.category] || 0) + 1;
  }

  return {
    group: group.groupName,
    groupId: group.id,
    totalExisting: existingRows.length,
    updated,
    unchanged,
    skippedNoMatch,
    skippedCategory,
    byCategoryUpdated,
  };
}

(async () => {
  try {
    console.log(`DATABASE_NAME=${process.env.DATABASE_NAME}, DRY_RUN=${DRY_RUN}, ONLY_GROUP=${ONLY_GROUP_ID || 'all'}`);

    const whereGroup = ONLY_GROUP_ID ? { id: ONLY_GROUP_ID } : {};
    const groups = await models.group.findAll({
      where: whereGroup,
      attributes: ['id', 'groupName', 'discordGuildId'],
    });

    for (const group of groups) {
      console.log(`\n[${group.groupName}] 처리 중...`);
      const result = await processGroup(group);
      if (result.skipped) {
        console.log(`  유저 없음, 스킵`);
        continue;
      }
      console.log(`  전체 레코드: ${result.totalExisting}`);
      console.log(`  UPDATE${DRY_RUN ? ' (예정)' : ''}: ${result.updated}`);
      console.log(`  동일하여 스킵: ${result.unchanged}`);
      console.log(`  매치 계산 불가 (기존 유지): ${result.skippedNoMatch}`);
      console.log(`  카테고리 제외 (night_owl): ${result.skippedCategory}`);
      console.log(`  카테고리별 업데이트:`);
      Object.entries(result.byCategoryUpdated).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
        console.log(`    ${k.padEnd(20)} ${v}`);
      });
    }

    console.log('\n완료');
    process.exit(0);
  } catch (e) {
    console.error('오류:', e);
    process.exit(1);
  }
})();
