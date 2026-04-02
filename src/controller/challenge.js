const models = require('../db/models');
const { Op } = require('sequelize');
const { logger } = require('../loaders/logger');
const { getMatchIdsFromPuuid, getMatchData } = require('../services/riot-api');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// gameType → Riot queueId 매핑
const GAME_TYPE_QUEUE_MAP = {
  soloRank: 420,
  flexRank: 440,
  aram: 450,
  arena: 1700,
};

/**
 * 참가자 puuid 목록에서 부캐 puuid까지 포함한 매핑을 반환
 * @returns {{ allPuuids: string[], puuidToMain: Record<string, string> }}
 *   allPuuids: 본캐+부캐 전체 puuid 배열
 *   puuidToMain: puuid → 본캐 puuid 매핑 (본캐는 자기 자신으로 매핑)
 */
async function getParticipantPuuidsWithSubs(puuids) {
  // 부캐 조회: primaryPuuid가 참가자 puuid 중 하나인 유저
  const subAccounts = await models.user.findAll({
    where: { primaryPuuid: puuids },
    attributes: ['puuid', 'primaryPuuid'],
  });

  const allPuuids = [...puuids];
  const puuidToMain = {};

  // 본캐는 자기 자신으로 매핑
  for (const p of puuids) {
    puuidToMain[p] = p;
  }

  // 부캐는 본캐로 매핑
  for (const sub of subAccounts) {
    if (!allPuuids.includes(sub.puuid)) {
      allPuuids.push(sub.puuid);
    }
    puuidToMain[sub.puuid] = sub.primaryPuuid;
  }

  return { allPuuids, puuidToMain };
}

// 포인트 계산 (판당 +1, 추후 정책 변경 가능)
const calculatePoints = (wins, losses) => {
  return wins + losses;
};

// 동기화 진행 상태 (인메모리)
const syncState = new Map();

/**
 * 챌린지의 현재 상태를 기간 데이터에서 자동 계산
 */
function getChallengeStatus(challenge) {
  if (challenge.canceledAt) return 'canceled';
  const now = new Date();
  if (now < new Date(challenge.startAt)) return 'scheduled';
  if (now <= new Date(challenge.endAt)) return 'active';
  return 'ended';
}

/**
 * 챌린지 객체에 계산된 status를 붙여서 반환
 */
function withStatus(challenge) {
  const json = challenge.toJSON ? challenge.toJSON() : { ...challenge };
  json.status = getChallengeStatus(json);
  return json;
}

// --- 관리자 기능 ---

module.exports.createChallenge = async (groupId, data, createdBy) => {
  try {
    const group = await models.group.findByPk(groupId);
    if (!group) return { result: '그룹을 찾을 수 없습니다.', status: 404 };

    const challenge = await models.challenge.create({
      groupId,
      title: data.title,
      description: data.description || null,
      gameType: data.gameType,
      startAt: new Date(data.startAt),
      endAt: new Date(data.endAt),
      scoringType: data.scoringType || 'points',
      isVisible: data.isVisible || false,
      createdBy,
      displayOrder: data.displayOrder || 0,
    });

    return { result: withStatus(challenge), status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};

module.exports.updateChallenge = async (challengeId, data) => {
  try {
    const challenge = await models.challenge.findByPk(challengeId);
    if (!challenge) return { result: '챌린지를 찾을 수 없습니다.', status: 404 };

    const updateFields = {};
    const allowedFields = ['title', 'description', 'gameType', 'startAt', 'endAt', 'scoringType', 'isVisible', 'displayOrder'];
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateFields[field] = data[field];
      }
    }

    await models.challenge.update(updateFields, { where: { id: challengeId } });
    const updated = await models.challenge.findByPk(challengeId);

    return { result: withStatus(updated), status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};

module.exports.cancelChallenge = async (challengeId) => {
  try {
    const challenge = await models.challenge.findByPk(challengeId);
    if (!challenge) return { result: '챌린지를 찾을 수 없습니다.', status: 404 };

    if (challenge.canceledAt) {
      return { result: '이미 취소된 챌린지입니다.', status: 400 };
    }

    await models.challenge.update({ canceledAt: new Date() }, { where: { id: challengeId } });

    return { result: { id: challengeId, status: 'canceled' }, status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};

module.exports.listChallenges = async (groupId) => {
  try {
    const challenges = await models.challenge.findAll({
      where: { groupId },
      order: [['displayOrder', 'ASC'], ['createdAt', 'DESC']],
    });

    // 참가자 수 조회
    const challengeIds = challenges.map((c) => c.id);
    const participants = await models.challenge_participant.findAll({
      where: { challengeId: challengeIds },
      attributes: ['challengeId', [models.sequelize.fn('COUNT', models.sequelize.col('id')), 'count']],
      group: ['challengeId'],
    });
    const countMap = {};
    participants.forEach((p) => {
      countMap[p.challengeId] = Number(p.getDataValue('count'));
    });

    const result = challenges.map((c) => ({
      ...withStatus(c),
      participantCount: countMap[c.id] || 0,
    }));

    return { result, status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};

module.exports.getChallengeDetail = async (challengeId) => {
  try {
    const challenge = await models.challenge.findByPk(challengeId);
    if (!challenge) return { result: '챌린지를 찾을 수 없습니다.', status: 404 };

    const participantCount = await models.challenge_participant.count({
      where: { challengeId },
    });

    const sync = syncState.get(challengeId);

    return {
      result: {
        ...withStatus(challenge),
        participantCount,
        syncStatus: sync ? 'syncing' : 'idle',
        syncProgress: sync || null,
      },
      status: 200,
    };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};

// --- 유저 기능 ---

module.exports.listVisibleChallenges = async (groupId) => {
  try {
    const challenges = await models.challenge.findAll({
      where: {
        groupId,
        isVisible: true,
        canceledAt: null,
      },
      order: [['displayOrder', 'ASC'], ['createdAt', 'DESC']],
    });

    const challengeIds = challenges.map((c) => c.id);
    const participants = await models.challenge_participant.findAll({
      where: { challengeId: challengeIds },
      attributes: ['challengeId', [models.sequelize.fn('COUNT', models.sequelize.col('id')), 'count']],
      group: ['challengeId'],
    });
    const countMap = {};
    participants.forEach((p) => {
      countMap[p.challengeId] = Number(p.getDataValue('count'));
    });

    const result = challenges.map((c) => ({
      ...withStatus(c),
      participantCount: countMap[c.id] || 0,
    }));

    return { result, status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};

module.exports.joinChallenge = async (challengeId, puuid) => {
  try {
    const challenge = await models.challenge.findByPk(challengeId);
    if (!challenge) return { result: '챌린지를 찾을 수 없습니다.', status: 404 };

    const status = getChallengeStatus(challenge);
    if (!['scheduled', 'active'].includes(status)) {
      return { result: '참가할 수 없는 상태의 챌린지입니다.', status: 400 };
    }

    const existing = await models.challenge_participant.findOne({
      where: { challengeId, puuid },
    });
    if (existing) return { result: '이미 참가한 챌린지입니다.', status: 400 };

    const participant = await models.challenge_participant.create({
      challengeId,
      puuid,
    });

    return { result: participant, status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};

module.exports.cancelJoin = async (challengeId, puuid) => {
  try {
    const challenge = await models.challenge.findByPk(challengeId);
    if (!challenge) return { result: '챌린지를 찾을 수 없습니다.', status: 404 };

    const status = getChallengeStatus(challenge);
    if (!['scheduled', 'active'].includes(status)) {
      return { result: '참가 취소할 수 없는 상태의 챌린지입니다.', status: 400 };
    }

    const participant = await models.challenge_participant.findOne({
      where: { challengeId, puuid },
    });
    if (!participant) return { result: '참가하지 않은 챌린지입니다.', status: 400 };

    await participant.destroy();

    return { result: '참가가 취소되었습니다.', status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};

/**
 * 리더보드 집계
 * challenge_match_detail에서 기간+큐 필터 → challenge_match에서 승패 집계
 */
module.exports.getLeaderboard = async (challengeId) => {
  try {
    const challenge = await models.challenge.findByPk(challengeId);
    if (!challenge) return { result: '챌린지를 찾을 수 없습니다.', status: 404 };

    const participants = await models.challenge_participant.findAll({
      where: { challengeId },
    });
    if (participants.length === 0) return { result: [], status: 200 };

    const puuids = participants.map((p) => p.puuid);
    const queueId = GAME_TYPE_QUEUE_MAP[challenge.gameType];

    // 부캐 puuid 포함
    const { allPuuids, puuidToMain } = await getParticipantPuuidsWithSubs(puuids);

    // 챌린지 기간 내 매치 ID 조회
    const details = await models.challenge_match_detail.findAll({
      where: {
        queueId,
        gameCreation: {
          [Op.gte]: challenge.startAt,
          [Op.lte]: challenge.endAt,
        },
      },
      attributes: ['matchId', 'gameCreation'],
      order: [['gameCreation', 'ASC']],
    });
    const matchIds = details.map((d) => d.matchId);

    // matchId → gameCreation 매핑 (streak 정렬용)
    const gameCreationMap = {};
    details.forEach((d) => { gameCreationMap[d.matchId] = d.gameCreation; });

    // 해당 매치들에서 참가자별 승패 조회 (본캐+부캐 전체)
    const matches = matchIds.length > 0
      ? await models.challenge_match.findAll({
        where: {
          matchId: matchIds,
          puuid: allPuuids,
        },
      })
      : [];

    // 본캐 puuid 기준으로 그룹핑 (부캐 전적은 본캐에 합산)
    const matchesByMain = {};
    for (const m of matches) {
      const mainPuuid = puuidToMain[m.puuid] || m.puuid;
      if (!matchesByMain[mainPuuid]) matchesByMain[mainPuuid] = [];
      matchesByMain[mainPuuid].push({
        matchId: m.matchId,
        win: m.win,
        gameCreation: gameCreationMap[m.matchId],
      });
    }
    for (const puuid of Object.keys(matchesByMain)) {
      matchesByMain[puuid].sort((a, b) => new Date(a.gameCreation) - new Date(b.gameCreation));
    }

    // 소환사 이름 조회 (본캐 기준)
    const summoners = await models.summoner.findAll({
      where: { puuid: puuids },
      attributes: ['puuid', 'name'],
    });
    const nameMap = {};
    summoners.forEach((s) => { nameMap[s.puuid] = s.name; });

    // 참가자별 통계 계산 (본캐 puuid 기준)
    const leaderboard = puuids.map((puuid) => {
      const playerMatches = matchesByMain[puuid] || [];
      const wins = playerMatches.filter((m) => m.win).length;
      const losses = playerMatches.filter((m) => !m.win).length;
      const totalGames = wins + losses;
      const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 1000) / 10 : 0;
      const points = calculatePoints(wins, losses);
      const streaks = calculateStreaks(playerMatches);

      return {
        puuid,
        name: nameMap[puuid] || '알 수 없음',
        totalGames,
        wins,
        losses,
        winRate,
        points,
        ...streaks,
      };
    });

    // 정렬: points desc → wins desc → winRate desc → totalGames desc
    leaderboard.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      return b.totalGames - a.totalGames;
    });

    // 순위 부여
    leaderboard.forEach((entry, idx) => {
      entry.rank = idx + 1;
    });

    return { result: leaderboard, status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};

module.exports.getMyStats = async (challengeId, puuid) => {
  try {
    const leaderboardResult = await module.exports.getLeaderboard(challengeId);
    if (leaderboardResult.status !== 200) return leaderboardResult;

    const myEntry = leaderboardResult.result.find((e) => e.puuid === puuid);
    if (!myEntry) return { result: '참가하지 않은 챌린지입니다.', status: 404 };

    return { result: myEntry, status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};

/**
 * 챌린지 기간 내 특정 유저의 전적 상세 조회
 * challenge_match_detail에서 participants JSON을 가져와서 상세 정보 제공
 */
module.exports.getUserMatchHistory = async (challengeId, puuid, groupId) => {
  try {
    const challenge = await models.challenge.findByPk(challengeId);
    if (!challenge) return { result: '챌린지를 찾을 수 없습니다.', status: 404 };

    const queueId = GAME_TYPE_QUEUE_MAP[challenge.gameType];

    // 부캐 puuid도 포함하여 조회
    const subAccount = await models.user.findOne({
      where: { primaryPuuid: puuid },
      attributes: ['puuid'],
    });
    const puuidsToQuery = [puuid];
    if (subAccount) puuidsToQuery.push(subAccount.puuid);

    // 해당 유저(본캐+부캐)의 matchId 목록
    const userMatches = await models.challenge_match.findAll({
      where: { puuid: puuidsToQuery },
      attributes: ['matchId', 'win', 'puuid'],
    });
    if (userMatches.length === 0) return { result: [], status: 200 };

    const userMatchIds = userMatches.map((m) => m.matchId);
    const winMap = {};
    userMatches.forEach((m) => { winMap[m.matchId] = m.win; });

    // 기간+큐 필터하여 상세 데이터 조회
    const details = await models.challenge_match_detail.findAll({
      where: {
        matchId: userMatchIds,
        queueId,
        gameCreation: {
          [Op.gte]: challenge.startAt,
          [Op.lte]: challenge.endAt,
        },
      },
      order: [['gameCreation', 'DESC']],
    });

    // 그룹 멤버 맵 구성
    let groupMemberMap = {};

    if (groupId) {
      const groupUsers = await models.user.findAll({
        where: { groupId },
        attributes: ['puuid'],
      });
      const groupPuuids = groupUsers.map((u) => u.puuid);

      const summoners = await models.summoner.findAll({
        where: { puuid: groupPuuids },
        attributes: ['puuid', 'name'],
      });
      summoners.forEach((s) => { groupMemberMap[s.puuid] = s.name; });
    }

    const result = details.map((d) => {
      const participants = d.participants || [];
      const me = participants.find((p) => puuidsToQuery.includes(p.puuid));

      const entry = {
        matchId: d.matchId,
        win: winMap[d.matchId],
        gameCreation: d.gameCreation,
        // participants 전체를 내려줌 (프론트에서 챔피언/KDA/CS 등 렌더링)
        participants,
      };

      // 같은 매치에 있는 그룹 멤버 추출
      entry.groupMembers = participants
        .filter((p) => !puuidsToQuery.includes(p.puuid) && groupMemberMap[p.puuid])
        .map((p) => ({
          puuid: p.puuid,
          name: groupMemberMap[p.puuid],
          championName: p.championName,
          teamId: p.teamId,
          win: p.win,
          sameTeam: me ? p.teamId === me.teamId : false,
        }));

      return entry;
    });

    return { result, status: 200 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};

// --- 전적 동기화 ---

const SYNC_COOLDOWN_MS = 30 * 60 * 1000; // 30분

/**
 * 동기화 진행 상태 조회 (DB 조회 없음, 인메모리)
 */
module.exports.getSyncStatus = (challengeId) => {
  const sync = syncState.get(challengeId);
  return {
    result: {
      syncStatus: sync ? 'syncing' : 'idle',
      syncProgress: sync || null,
    },
    status: 200,
  };
};

/**
 * 챌린지 전체 참가자 전적 동기화 (비동기)
 * 즉시 202 반환 후 백그라운드에서 동기화 진행
 * 진행률은 getChallengeDetail에서 syncStatus/syncProgress로 확인
 */
module.exports.syncChallengeMatches = async (challengeId) => {
  try {
    const challenge = await models.challenge.findByPk(challengeId);
    if (!challenge) return { result: '챌린지를 찾을 수 없습니다.', status: 404 };

    // 이미 동기화 진행 중
    if (syncState.has(challengeId)) {
      return { result: '이미 동기화가 진행 중입니다.', status: 409 };
    }

    // 챌린지 단위 쿨다운 체크
    if (challenge.lastSyncAt) {
      const elapsed = Date.now() - new Date(challenge.lastSyncAt).getTime();
      if (elapsed < SYNC_COOLDOWN_MS) {
        const remainMin = Math.ceil((SYNC_COOLDOWN_MS - elapsed) / 60000);
        return { result: `${remainMin}분 후에 다시 시도해주세요.`, status: 429 };
      }
    }

    const participants = await models.challenge_participant.findAll({
      where: { challengeId },
      attributes: ['puuid'],
    });
    if (participants.length === 0) return { result: { synced: 0 }, status: 200 };

    // 부캐 포함 전체 수 계산
    const participantPuuids = participants.map((p) => p.puuid);
    const { allPuuids } = await getParticipantPuuidsWithSubs(participantPuuids);

    // 진행 상태 초기화 후 백그라운드 실행
    syncState.set(challengeId, { done: 0, total: allPuuids.length });

    runSyncInBackground(challengeId, challenge, participants);

    return { result: { message: '전적 갱신을 시작했습니다.', total: allPuuids.length }, status: 202 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};

/**
 * 백그라운드에서 동기화 실행
 * 참가자의 부캐 puuid도 함께 전적 수집
 */
async function runSyncInBackground(challengeId, challenge, participants) {
  const queueId = GAME_TYPE_QUEUE_MAP[challenge.gameType];
  let totalSynced = 0;

  // 부캐 포함 전체 puuid 수집
  const participantPuuids = participants.map((p) => p.puuid);
  const { allPuuids, puuidToMain } = await getParticipantPuuidsWithSubs(participantPuuids);

  try {
    for (let i = 0; i < allPuuids.length; i++) {
      const puuid = allPuuids[i];
      try {
        const synced = await fetchAndStoreMatches(puuid, queueId, challenge.startAt, challenge.endAt);
        totalSynced += synced;
      } catch (e) {
        logger.error(`[챌린지] 동기화 실패 (puuid=${puuid}): ${e.message}`);
      }

      syncState.set(challengeId, { done: i + 1, total: allPuuids.length });
      await sleep(2000);
    }

    await models.challenge.update({ lastSyncAt: new Date() }, { where: { id: challengeId } });
    logger.info(`[챌린지] 동기화 완료 (challengeId=${challengeId}) - ${totalSynced}건`);
  } catch (e) {
    logger.error(`[챌린지] 동기화 에러 (challengeId=${challengeId}): ${e.stack}`);
  } finally {
    syncState.delete(challengeId);
  }
}

/**
 * Riot API에서 매치를 가져와 challenge_match + challenge_match_detail에 저장
 * 증분 갱신: 해당 유저의 마지막 저장 매치 이후부터만 조회
 * @returns {number} 새로 저장된 매치 수
 */
async function fetchAndStoreMatches(puuid, queueId, startAt, endAt) {
  const challengeStartTime = Math.floor(new Date(startAt).getTime() / 1000);
  const endTime = Math.floor(new Date(endAt).getTime() / 1000);

  // 증분 갱신: 이미 저장된 마지막 매치 시간 이후부터 조회
  const latestMatch = await models.challenge_match_detail.findOne({
    where: {
      queueId,
      gameCreation: { [Op.gte]: startAt, [Op.lte]: endAt },
      matchId: {
        [Op.in]: models.sequelize.literal(
          `(SELECT matchId FROM challenge_matches WHERE puuid = ${models.sequelize.escape(puuid)})`,
        ),
      },
    },
    order: [['gameCreation', 'DESC']],
    attributes: ['gameCreation'],
  });

  const startTime = latestMatch
    ? Math.floor(new Date(latestMatch.gameCreation).getTime() / 1000)
    : challengeStartTime;

  let beginIndex = 0;
  let totalSynced = 0;
  const batchSize = 20;

  while (true) {
    let matchIds;
    try {
      matchIds = await getMatchIdsFromPuuid(puuid, beginIndex, batchSize, queueId, startTime, endTime);
    } catch (e) {
      logger.error(`[챌린지] 매치 ID 조회 실패 (puuid=${puuid}): ${e.message}`);
      break;
    }

    if (!matchIds || matchIds.length === 0) break;

    // 이미 저장된 매치 필터링
    const existingMatches = await models.challenge_match.findAll({
      where: { matchId: matchIds, puuid },
      attributes: ['matchId'],
    });
    const existingIds = new Set(existingMatches.map((m) => m.matchId));
    const newMatchIds = matchIds.filter((id) => !existingIds.has(id));

    for (const matchId of newMatchIds) {
      try {
        const matchData = await getMatchData(matchId);
        const participant = matchData.info.participants.find((p) => p.puuid === puuid);
        if (!participant) continue;

        // challenge_match_detail: 매치당 1행 (이미 있으면 스킵)
        await models.challenge_match_detail.findOrCreate({
          where: { matchId },
          defaults: {
            queueId: matchData.info.queueId,
            gameCreation: new Date(matchData.info.gameCreation),
            participants: matchData.info.participants,
          },
        });

        // challenge_match: 유저별 승패 기록
        await models.challenge_match.findOrCreate({
          where: { matchId, puuid },
          defaults: { win: participant.win },
        });

        totalSynced++;
      } catch (e) {
        logger.error(`[챌린지] 매치 데이터 저장 실패 (matchId=${matchId}): ${e.message}`);
      }

      await sleep(1200);
    }

    if (matchIds.length < batchSize) break;

    beginIndex += batchSize;
    await sleep(1200);
  }

  return totalSynced;
}

// --- 배치 동기화 ---

/**
 * 활성 챌린지 참가자 전체 전적 일괄 동기화
 * 스케줄러에서 매일 새벽 호출
 * 진행 중이거나 최근 3일 이내 종료된 챌린지 대상
 */
module.exports.syncAllActiveChallenges = async () => {
  try {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    // 취소되지 않았고, (진행 중이거나 최근 종료된) 챌린지
    const challenges = await models.challenge.findAll({
      where: {
        canceledAt: null,
        startAt: { [Op.lte]: now },
        [Op.or]: [
          { endAt: { [Op.gte]: now } },
          { endAt: { [Op.gte]: threeDaysAgo } },
        ],
      },
    });

    if (challenges.length === 0) {
      logger.info('[챌린지 배치] 동기화 대상 챌린지 없음');
      return;
    }

    logger.info(`[챌린지 배치] ${challenges.length}개 챌린지 동기화 시작`);

    const syncTasks = [];
    const seen = new Set();

    for (const challenge of challenges) {
      const participants = await models.challenge_participant.findAll({
        where: { challengeId: challenge.id },
        attributes: ['puuid'],
      });

      const queueId = GAME_TYPE_QUEUE_MAP[challenge.gameType];

      for (const p of participants) {
        const key = `${p.puuid}:${queueId}:${challenge.startAt}:${challenge.endAt}`;
        if (seen.has(key)) continue;
        seen.add(key);

        syncTasks.push({
          puuid: p.puuid,
          queueId,
          startAt: challenge.startAt,
          endAt: challenge.endAt,
        });
      }
    }

    logger.info(`[챌린지 배치] ${syncTasks.length}건의 동기화 작업 시작`);

    let successCount = 0;
    let failCount = 0;

    for (const task of syncTasks) {
      try {
        const synced = await fetchAndStoreMatches(task.puuid, task.queueId, task.startAt, task.endAt);
        successCount++;
        if (synced > 0) {
          logger.info(`[챌린지 배치] puuid=${task.puuid} ${synced}건 동기화`);
        }
      } catch (e) {
        failCount++;
        logger.error(`[챌린지 배치] 동기화 실패 (puuid=${task.puuid}): ${e.message}`);
      }

      await sleep(2000);
    }

    logger.info(`[챌린지 배치] 완료 - 성공: ${successCount}, 실패: ${failCount}`);
  } catch (e) {
    logger.error(`[챌린지 배치] 에러: ${e.stack}`);
  }
};

// --- 유틸 (export for testing) ---

module.exports.getChallengeStatus = getChallengeStatus;

/**
 * 연승/연패 streak 계산
 */
function calculateStreaks(matches) {
  let currentWinStreak = 0;
  let currentLoseStreak = 0;
  let bestWinStreak = 0;
  let bestLoseStreak = 0;
  let tempWin = 0;
  let tempLose = 0;

  for (const m of matches) {
    if (m.win) {
      tempWin++;
      tempLose = 0;
      if (tempWin > bestWinStreak) bestWinStreak = tempWin;
    } else {
      tempLose++;
      tempWin = 0;
      if (tempLose > bestLoseStreak) bestLoseStreak = tempLose;
    }
  }

  currentWinStreak = tempWin;
  currentLoseStreak = tempLose;

  return { currentWinStreak, currentLoseStreak, bestWinStreak, bestLoseStreak };
}
