const { Op, QueryTypes } = require('sequelize');
const models = require('../db/models');
const { logger } = require('../loaders/logger');
const { getMatchIdsFromPuuid, getMatchData, getRankDataByPuuid } = require('../services/riot-api');
const notificationController = require('./notification');
const { fetchDiscordIdMap } = require('../utils/userLookup');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// gameType → Riot queueId 매핑
const GAME_TYPE_QUEUE_MAP = {
  soloRank: 420,
  flexRank: 440,
  aram: 450,
  arena: 1700,
};

/**
 * challenge_match_detail 에 저장하기 전 각 참가자 객체에서 저장소 비용 큰 필드를 제거.
 * `challenges` 는 Riot 세부 메트릭(매치당 4KB, 전체의 약 50%)이고 내전 봇 컨텐츠에
 * 쓰일 일이 사실상 없음. 제거해도 KDA/아이템/룬/포지션 등 나머지 144개 필드는 보존됨.
 */
function stripLargeFields(participants) {
  return participants.map(({ challenges, ...rest }) => rest);
}

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
 * 그룹의 활성 챌린지 리더보드 캐시 무효화
 */
module.exports.invalidateLeaderboardCache = async (groupId) => {
  await models.challenge.update(
    { leaderboardCache: null },
    { where: { groupId, canceledAt: null, leaderboardSnapshot: null } },
  );
};

/**
 * 그룹 본캐 멤버 조회 (outsider 제외)
 */
async function getGroupMainMembers(groupId) {
  return models.user.findAll({
    where: { groupId, primaryPuuid: null, role: { [Op.ne]: 'outsider' } },
    attributes: ['puuid'],
  });
}

// 스냅샷 스케줄러 (challengeId → timeoutId)
const snapshotTimers = new Map();

/**
 * 리더보드 스냅샷 저장
 */
async function saveLeaderboardSnapshot(challengeId) {
  try {
    const challenge = await models.challenge.findByPk(challengeId);
    if (!challenge || challenge.leaderboardSnapshot) return;

    // 스냅샷은 항상 fresh compute. 오염된 캐시(예: 데이터 동기화 전 캐싱된 빈 결과)가
    // 그대로 스냅샷으로 굳어버리는 사고를 방지한다.
    await models.challenge.update({ leaderboardCache: null }, { where: { id: challengeId } });

    const leaderboardResult = await module.exports.getLeaderboard(challengeId);
    if (leaderboardResult.status !== 200) return;

    await models.challenge.update(
      {
        leaderboardSnapshot: leaderboardResult.result,
        activePlayerCount: leaderboardResult.result.length,
      },
      { where: { id: challengeId } },
    );
    logger.info(
      `[챌린지] 리더보드 스냅샷 저장 완료 (challengeId=${challengeId}, ${leaderboardResult.result.length}명)`,
    );

    try {
      const ranks = leaderboardResult.result;
      const discordByPuuid = await fetchDiscordIdMap(challenge.groupId, ranks.map((e) => e.puuid));
      const rows = ranks
        .map((entry) => {
          const did = discordByPuuid[entry.puuid];
          if (!did) return null;
          return {
            recipientDiscordId: did,
            groupId: challenge.groupId,
            type: notificationController.NOTIFICATION_TYPES.CHALLENGE_END,
            targetKey: `challenge:${challengeId}`,
            payload: {
              challengeId,
              challengeTitle: challenge.title,
              finalRank: entry.rank,
              totalParticipants: ranks.length,
            },
          };
        })
        .filter(Boolean);
      await notificationController.createMany(rows);
    } catch (e) {
      logger.error(`[챌린지] 종료 알림 발송 실패 (challengeId=${challengeId}): ${e.message}`);
    }

    // 챌린지 업적 체크 (상위 3명)
    const top3 = leaderboardResult.result.filter((e) => e.rank <= 3);
    if (top3.length > 0) {
      const top3Puuids = top3.map((e) => e.puuid);
      const top3Users = await models.user.findAll({
        where: { groupId: challenge.groupId, puuid: top3Puuids },
      });
      if (top3Users.length > 0) {
        const userMap = {};
        top3Users.forEach((u) => {
          userMap[u.puuid] = u;
        });
        const { processAchievements } = require('../services/achievement/engine');
        const newAchievements = await processAchievements('challenge_end', {
          groupId: challenge.groupId,
          userMap,
        });
        if (newAchievements.length > 0) {
          logger.info(`[챌린지] 업적 해금 ${newAchievements.length}건 (challengeId=${challengeId})`);
        }
      }
    }
  } catch (e) {
    logger.error(`[챌린지] 리더보드 스냅샷 저장 실패 (challengeId=${challengeId}): ${e.message}`);
  } finally {
    snapshotTimers.delete(challengeId);
  }
}

/**
 * 챌린지 종료 시 스냅샷을 찍도록 스케줄 등록
 */
function scheduleSnapshot(challenge) {
  if (challenge.canceledAt || challenge.leaderboardSnapshot) return;

  // 기존 타이머 제거
  if (snapshotTimers.has(challenge.id)) {
    clearTimeout(snapshotTimers.get(challenge.id));
    snapshotTimers.delete(challenge.id);
  }

  const delay = new Date(challenge.endAt).getTime() - Date.now();
  if (delay <= 0) {
    // 이미 종료됨 → 즉시 실행
    saveLeaderboardSnapshot(challenge.id);
    return;
  }

  const timerId = setTimeout(() => saveLeaderboardSnapshot(challenge.id), delay);
  snapshotTimers.set(challenge.id, timerId);
  logger.info(`[챌린지] 스냅샷 스케줄 등록 (challengeId=${challenge.id}, ${Math.round(delay / 60000)}분 후)`);
}

/**
 * 서버 시작 시 호출: 활성 챌린지들의 스냅샷 스케줄러 등록
 */
module.exports.initSnapshotSchedulers = async () => {
  try {
    const now = new Date();
    const challenges = await models.challenge.findAll({
      where: {
        canceledAt: null,
        leaderboardSnapshot: null,
        startAt: { [Op.lte]: now },
      },
    });

    for (const challenge of challenges) {
      scheduleSnapshot(challenge);
    }

    if (challenges.length > 0) {
      logger.info(`[챌린지] ${challenges.length}개 챌린지 스냅샷 스케줄러 등록 완료`);
    }
  } catch (e) {
    logger.error(`[챌린지] 스냅샷 스케줄러 초기화 실패: ${e.message}`);
  }
};

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

    scheduleSnapshot(challenge);

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
    const allowedFields = [
      'title',
      'description',
      'gameType',
      'startAt',
      'endAt',
      'scoringType',
      'isVisible',
      'displayOrder',
    ];
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateFields[field] = data[field];
      }
    }

    await models.challenge.update(updateFields, { where: { id: challengeId } });
    const updated = await models.challenge.findByPk(challengeId);

    // endAt 변경 시 스냅샷 스케줄러 재등록
    if (data.endAt !== undefined) {
      scheduleSnapshot(updated);
    }

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

    await models.challenge.update({ canceledAt: new Date(), leaderboardCache: null }, { where: { id: challengeId } });

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
      order: [
        ['displayOrder', 'ASC'],
        ['createdAt', 'DESC'],
      ],
    });

    const result = challenges.map((c) => ({
      ...withStatus(c),
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

    const sync = syncState.get(challengeId);

    return {
      result: {
        ...withStatus(challenge),
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
      order: [
        ['displayOrder', 'ASC'],
        ['createdAt', 'DESC'],
      ],
    });

    const result = challenges.map((c) => ({
      ...withStatus(c),
    }));

    return { result, status: 200 };
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

    // ended + 확정 스냅샷 반환
    if (getChallengeStatus(challenge) === 'ended' && challenge.leaderboardSnapshot) {
      return { result: challenge.leaderboardSnapshot, status: 200 };
    }

    // sync 시 저장된 캐시 반환
    if (challenge.leaderboardCache) {
      return { result: challenge.leaderboardCache, status: 200 };
    }

    // 그룹 전체 유저 (본캐만)
    const groupUsers = await getGroupMainMembers(challenge.groupId);
    if (groupUsers.length === 0) return { result: [], status: 200 };

    const puuids = groupUsers.map((u) => u.puuid);
    const queueId = GAME_TYPE_QUEUE_MAP[challenge.gameType];

    // 부캐 puuid 포함
    const { allPuuids, puuidToMain } = await getParticipantPuuidsWithSubs(puuids);

    // 본캐 → 부캐 puuid 매핑
    const mainToSub = {};
    for (const [subPuuid, mainPuuid] of Object.entries(puuidToMain)) {
      if (subPuuid !== mainPuuid) mainToSub[mainPuuid] = subPuuid;
    }

    // challenge_matches를 주도 테이블로 JOIN해서 그룹 멤버가 낀 매치의 승패만 한 번에 조회
    // (participants JSON 파싱 및 별도 매치 재조회 회피)
    const rows = await models.sequelize.query(
      `SELECT cm.matchId, cm.puuid, cm.win, cmd.gameCreation
         FROM challenge_matches cm
         INNER JOIN challenge_match_details cmd ON cm.matchId = cmd.matchId
        WHERE cm.puuid IN (:allPuuids)
          AND cmd.queueId = :queueId
          AND cmd.gameCreation BETWEEN :startAt AND :endAt`,
      {
        replacements: {
          allPuuids,
          queueId,
          startAt: challenge.startAt,
          endAt: challenge.endAt,
        },
        type: QueryTypes.SELECT,
      },
    );

    // matchId별로 그룹핑 → 본캐+부캐 합쳐 distinct puuid ≥ 2인 매치만 유지
    const rowsByMatch = {};
    for (const r of rows) {
      if (!rowsByMatch[r.matchId]) rowsByMatch[r.matchId] = [];
      rowsByMatch[r.matchId].push(r);
    }

    // 본캐 puuid 기준으로 그룹핑 (부캐 전적은 본캐에 합산)
    const matchesByMain = {};
    for (const matchId of Object.keys(rowsByMatch)) {
      const matchRows = rowsByMatch[matchId];
      const distinctPuuids = new Set(matchRows.map((r) => r.puuid));
      if (distinctPuuids.size < 2) continue;

      for (const r of matchRows) {
        const mainPuuid = puuidToMain[r.puuid] || r.puuid;
        if (!matchesByMain[mainPuuid]) matchesByMain[mainPuuid] = [];
        matchesByMain[mainPuuid].push({
          matchId: r.matchId,
          win: !!r.win,
          gameCreation: r.gameCreation,
        });
      }
    }
    for (const puuid of Object.keys(matchesByMain)) {
      matchesByMain[puuid].sort((a, b) => new Date(a.gameCreation) - new Date(b.gameCreation));
    }

    // 소환사 정보 조회 (본캐 기준)
    const tierField = ['soloRank', 'flexRank'].includes(challenge.gameType)
      ? challenge.gameType === 'soloRank'
        ? 'rankTier'
        : 'flexRankTier'
      : null;
    const summonerAttrs = ['puuid', 'name'];
    if (tierField) summonerAttrs.push(tierField);

    const summoners = await models.summoner.findAll({
      where: { puuid: puuids },
      attributes: summonerAttrs,
    });
    const nameMap = {};
    const tierMap = {};
    summoners.forEach((s) => {
      nameMap[s.puuid] = s.name;
      if (tierField) tierMap[s.puuid] = s[tierField] || 'UNRANKED';
    });

    // 부캐 소환사 이름 조회
    const subPuuids = Object.values(mainToSub);
    const subNameMap = {};
    if (subPuuids.length > 0) {
      const subSummoners = await models.summoner.findAll({
        where: { puuid: subPuuids },
        attributes: ['puuid', 'name'],
      });
      subSummoners.forEach((s) => {
        subNameMap[s.puuid] = s.name;
      });
    }

    // 참가자별 통계 계산 (본캐 puuid 기준)
    const leaderboard = puuids.map((puuid) => {
      const playerMatches = matchesByMain[puuid] || [];
      const wins = playerMatches.filter((m) => m.win).length;
      const losses = playerMatches.filter((m) => !m.win).length;
      const totalGames = wins + losses;
      const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 1000) / 10 : 0;
      const points = calculatePoints(wins, losses);
      const streaks = calculateStreaks(playerMatches);

      const subPuuid = mainToSub[puuid];
      return {
        puuid,
        name: nameMap[puuid] || '알 수 없음',
        tier: tierMap[puuid] || null,
        subAccountName: subPuuid ? subNameMap[subPuuid] || null : null,
        totalGames,
        wins,
        losses,
        winRate,
        points,
        ...streaks,
      };
    });

    // 전적 없는 유저 제외
    const filtered = leaderboard.filter((e) => e.totalGames > 0);

    // 정렬: points desc → wins desc → winRate desc → totalGames desc
    filtered.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      return b.totalGames - a.totalGames;
    });

    // 순위 부여
    filtered.forEach((entry, idx) => {
      entry.rank = idx + 1;
    });

    // 풀 계산 결과를 DB에 캐시
    models.challenge.update({ leaderboardCache: filtered }, { where: { id: challengeId } }).catch(() => {});

    return { result: filtered, status: 200 };
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
    if (!myEntry) return { result: '전적이 없습니다.', status: 404 };

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

    const { allPuuids: puuidsToQuery } = await getParticipantPuuidsWithSubs([puuid]);

    // 해당 유저(본캐+부캐)의 matchId 목록
    const userMatches = await models.challenge_match.findAll({
      where: { puuid: puuidsToQuery },
      attributes: ['matchId', 'win', 'puuid'],
    });
    if (userMatches.length === 0) return { result: [], status: 200 };

    const userMatchIds = userMatches.map((m) => m.matchId);
    const winMap = {};
    userMatches.forEach((m) => {
      winMap[m.matchId] = m.win;
    });

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
    const groupMemberMap = {};

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
      summoners.forEach((s) => {
        groupMemberMap[s.puuid] = s.name;
      });
    }

    const result = details
      .map((d) => {
        const participants = d.participants || [];
        const me = participants.find((p) => puuidsToQuery.includes(p.puuid));

        const entry = {
          matchId: d.matchId,
          win: winMap[d.matchId],
          gameCreation: d.gameCreation,
          targetPuuid: me ? me.puuid : null,
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
      })
      .filter((entry) => entry.groupMembers.length > 0);

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

    // 그룹 전체 유저로 동기화
    const groupUsers = await getGroupMainMembers(challenge.groupId);
    if (groupUsers.length === 0) return { result: { synced: 0 }, status: 200 };

    const groupPuuids = groupUsers.map((u) => u.puuid);
    const { allPuuids } = await getParticipantPuuidsWithSubs(groupPuuids);

    // 진행 상태 초기화 후 백그라운드 실행
    syncState.set(challengeId, { done: 0, total: allPuuids.length });

    runSyncInBackground(challengeId, challenge, groupPuuids);

    return { result: { message: '전적 갱신을 시작했습니다.', total: allPuuids.length }, status: 202 };
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }
};

/**
 * 백그라운드에서 동기화 실행
 * 그룹 전체 유저 + 부캐 puuid도 함께 전적 수집
 */
async function runSyncInBackground(challengeId, challenge, puuids) {
  const queueId = GAME_TYPE_QUEUE_MAP[challenge.gameType];
  let totalSynced = 0;

  const { allPuuids } = await getParticipantPuuidsWithSubs(puuids);

  try {
    for (let i = 0; i < allPuuids.length; i++) {
      const puuid = allPuuids[i];
      try {
        const synced = await fetchAndStoreMatches(puuid, queueId, challenge.startAt, challenge.endAt, allPuuids);
        totalSynced += synced;
      } catch (e) {
        logger.error(`[챌린지] 동기화 실패 (puuid=${puuid}): ${e.message}`);
      }

      syncState.set(challengeId, { done: i + 1, total: allPuuids.length });
      await sleep(2000);
    }

    // 본캐 유저들의 summoner 티어 갱신
    for (const puuid of puuids) {
      try {
        const leagueData = await getRankDataByPuuid(puuid);
        const soloRank = leagueData.find((e) => e.queueType === 'RANKED_SOLO_5x5');
        const flexRank = leagueData.find((e) => e.queueType === 'RANKED_FLEX_SR');
        await models.summoner.update(
          {
            rankTier: soloRank ? `${soloRank.tier} ${soloRank.rank}` : 'UNRANKED',
            rankWin: soloRank ? soloRank.wins : 0,
            rankLose: soloRank ? soloRank.losses : 0,
            flexRankTier: flexRank ? `${flexRank.tier} ${flexRank.rank}` : 'UNRANKED',
            flexRankWin: flexRank ? flexRank.wins : 0,
            flexRankLose: flexRank ? flexRank.losses : 0,
          },
          { where: { puuid } },
        );
      } catch (e) {
        logger.error(`[챌린지] 티어 갱신 실패 (puuid=${puuid}): ${e.message}`);
      }
      await sleep(1200);
    }

    // 캐시 무효화 후 리더보드 재계산 (getLeaderboard 내부에서 캐시 자동 저장)
    await models.challenge.update({ leaderboardCache: null }, { where: { id: challengeId } });
    const leaderboardResult = await module.exports.getLeaderboard(challengeId);
    const playerCount = leaderboardResult.status === 200 ? leaderboardResult.result.length : 0;

    await models.challenge.update(
      { lastSyncAt: new Date(), activePlayerCount: playerCount },
      { where: { id: challengeId } },
    );
    logger.info(`[챌린지] 동기화 완료 (challengeId=${challengeId}) - ${totalSynced}건, ${playerCount}명`);
  } catch (e) {
    logger.error(`[챌린지] 동기화 에러 (challengeId=${challengeId}): ${e.stack}`);
  } finally {
    syncState.delete(challengeId);
  }
}

/**
 * Riot API에서 매치를 가져와 challenge_match + challenge_match_detail에 저장
 * 증분 갱신: 해당 유저의 마지막 저장 매치 이후부터만 조회
 * groupAllPuuids가 주어지면 매치에 참여한 그룹원(본+부) 전원의 challenge_match 행을
 * 한 번에 생성 — "반쪽 sync" gap 방지.
 * @returns {number} 새로 저장된 매치 수
 */
async function fetchAndStoreMatches(puuid, queueId, startAt, endAt, groupAllPuuids = null) {
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

  const startTime = latestMatch ? Math.floor(new Date(latestMatch.gameCreation).getTime() / 1000) : challengeStartTime;

  let beginIndex = 0;
  let totalSynced = 0;
  const batchSize = 20;
  const groupPuuidSet = groupAllPuuids ? new Set(groupAllPuuids) : null;

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
            participants: stripLargeFields(matchData.info.participants),
          },
        });

        // challenge_match: 매치에 참여한 그룹원 전원의 승패를 한 번에 기록
        // (groupAllPuuids 미전달 시 기존처럼 본인 행만 기록)
        for (const p of matchData.info.participants) {
          const shouldInsert = groupPuuidSet ? groupPuuidSet.has(p.puuid) : p.puuid === puuid;
          if (!shouldInsert) continue;
          await models.challenge_match.findOrCreate({
            where: { matchId, puuid: p.puuid },
            defaults: { win: p.win },
          });
        }

        totalSynced++;
      } catch (e) {
        logger.error(`[챌린지] 매치 데이터 저장 실패 (matchId=${matchId}): ${e.message}`);
      }

      await sleep(2000);
    }

    if (matchIds.length < batchSize) break;

    beginIndex += batchSize;
    await sleep(2000);
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
        [Op.or]: [{ endAt: { [Op.gte]: now } }, { endAt: { [Op.gte]: threeDaysAgo } }],
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
      // 그룹 전체 유저 (본캐만)
      const groupUsers = await models.user.findAll({
        where: { groupId: challenge.groupId, primaryPuuid: null, role: { [Op.ne]: 'outsider' } },
        attributes: ['puuid'],
      });
      const groupPuuids = groupUsers.map((u) => u.puuid);
      const { allPuuids } = await getParticipantPuuidsWithSubs(groupPuuids);

      const queueId = GAME_TYPE_QUEUE_MAP[challenge.gameType];

      for (const puuid of allPuuids) {
        const key = `${puuid}:${queueId}:${challenge.startAt}:${challenge.endAt}`;
        if (seen.has(key)) continue;
        seen.add(key);

        syncTasks.push({
          puuid,
          queueId,
          startAt: challenge.startAt,
          endAt: challenge.endAt,
          groupAllPuuids: allPuuids,
        });
      }
    }

    logger.info(`[챌린지 배치] ${syncTasks.length}건의 동기화 작업 시작`);

    let successCount = 0;
    let failCount = 0;

    for (const task of syncTasks) {
      try {
        const synced = await fetchAndStoreMatches(
          task.puuid,
          task.queueId,
          task.startAt,
          task.endAt,
          task.groupAllPuuids,
        );
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

    // 각 챌린지 캐시 무효화 + lastSyncAt 업데이트
    for (const challenge of challenges) {
      await models.challenge.update(
        { leaderboardCache: null, lastSyncAt: new Date() },
        { where: { id: challenge.id } },
      );
    }
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
