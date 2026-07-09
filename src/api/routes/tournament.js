const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const { verifyToken, isGroupAdmin } = require('../middlewares/auth');
const models = require('../../db/models');
const auditLog = require('../../controller/audit-log');
const tournamentController = require('../../controller/tournament');
const honorController = require('../../controller/honor');
const userController = require('../../controller/user');
const auctionScout = require('../../services/auction-scout');
const { extractTopAchievementsPerCategory } = require('../../services/achievement/topPerCategory');

const { STATUS } = tournamentController;
const route = Router();

const fetchRatingMap = async (groupId, puuids) => {
  if (!puuids.length) return {};
  const users = await models.user.findAll({
    where: { groupId, puuid: puuids },
    attributes: ['puuid', 'defaultRating', 'additionalRating'],
  });
  const map = {};
  users.forEach((u) => {
    map[u.puuid] = (u.defaultRating || 0) + (u.additionalRating || 0);
  });
  return map;
};

const enrichTeamsWithRating = (teams, ratingByPuuid) => {
  return teams.map((t) => {
    const data = t.toJSON ? t.toJSON() : t;
    data.avgRating = tournamentController.computeTeamAvgRating(data.members || [], ratingByPuuid);
    return data;
  });
};

// 멤버가 서버를 나가면 active-members API에서 빠져 프론트에서 puuid로만 표시되는
// 문제를 막기 위해, 백엔드에서 표시용 정보(name/profileIconId/rating)를 직접 붙여 내려준다.
const enrichTeamsWithMemberInfo = (teams, summonerByPuuid, ratingByPuuid) => {
  teams.forEach((t) => {
    (t.members || []).forEach((m) => {
      const s = summonerByPuuid[m.puuid];
      m.name = s ? s.name : null;
      m.profileIconId = s ? s.profileIconId : null;
      m.rating = ratingByPuuid[m.puuid] != null ? ratingByPuuid[m.puuid] : null;
    });
  });
  return teams;
};

const enrichMatchesWithWinProb = (matches, avgRatingByTeamId) => {
  return matches.map((m) => {
    const data = m.toJSON ? m.toJSON() : m;
    if (data.team1Id && data.team2Id) {
      const r1 = avgRatingByTeamId[data.team1Id];
      const r2 = avgRatingByTeamId[data.team2Id];
      data.team1WinProb = tournamentController.computeWinProbability(r1, r2);
      data.team2WinProb = tournamentController.computeWinProbability(r2, r1);
    } else {
      data.team1WinProb = null;
      data.team2WinProb = null;
    }
    return data;
  });
};

const enrichTeamsWithScrimRecord = (teams, scrims) => {
  return teams.map((t) => {
    t.scrimRecord = tournamentController.computeTeamScrimRecord(t.id, scrims);
    return t;
  });
};

const enrichMatchesWithHeadToHead = (matches, scrims) => {
  return matches.map((m) => {
    if (m.team1Id && m.team2Id) {
      m.headToHeadScrim = tournamentController.computeHeadToHeadScrim(m.team1Id, m.team2Id, scrims);
    } else {
      m.headToHeadScrim = null;
    }
    return m;
  });
};

// 매물 카드에 보여줄 천생연분/톰과제리 인원 수
const SCOUT_TOP_N = 3;
// 매물 카드에 보여줄 솔랭 모스트 챔피언 수 (천생연분/톰과제리보다 조금 더 풍부하게)
const MOST_CHAMPIONS_TOP_N = 5;

// 경매 진행 중 현재 매물 후보의 풍부한 정보(내전 티어/솔랭/승패/업적/명예/트로피/스카우팅)를 모아 반환.
const buildCandidateDetail = async (tournament, puuid) => {
  if (!puuid) return null;
  const candidates = tournament.auctionConfig && tournament.auctionConfig.candidates;
  const position = tournamentController.findCandidatePosition(candidates, puuid);
  const [summoner, user, achievementsRaw, honorStats, championships, scoutMap] = await Promise.all([
    models.summoner.findOne({
      where: { puuid },
      attributes: ['puuid', 'name', 'profileIconId', 'rankTier', 'rankWin', 'rankLose', 'mainPosition', 'championStats'],
    }),
    models.user.findOne({
      where: { puuid, groupId: tournament.groupId },
      attributes: ['puuid', 'win', 'lose', 'defaultRating', 'additionalRating'],
    }),
    models.user_achievement.findAll({
      where: { puuid, groupId: tournament.groupId },
      attributes: ['achievementId', 'unlockedAt'],
      raw: true,
    }),
    honorController.getHonorStats(tournament.groupId, puuid),
    userController.getTournamentChampionships(tournament.groupId, puuid),
    // 스카우트(천생연분/톰과제리)는 그룹 전체 매치 스캔이라 실패/지연 위험이 커서 격리한다.
    // 실패해도 매물 상세 전체가 깨지지 않도록 빈 맵으로 폴백.
    auctionScout.getScoutMap(tournament.groupId).catch(() => ({})),
  ]);

  // 천생연분/톰과제리 상위 N명 추출 + 상대 puuid 이름 보강
  const scout = scoutMap[puuid] || { soulmates: [], nemeses: [] };
  const soulmates = scout.soulmates.slice(0, SCOUT_TOP_N);
  const nemeses = scout.nemeses.slice(0, SCOUT_TOP_N);
  const partnerPuuids = [...new Set([...soulmates, ...nemeses].map((s) => s.puuid))];
  const partnerSummoners = partnerPuuids.length
    ? await models.summoner.findAll({
        where: { puuid: partnerPuuids },
        attributes: ['puuid', 'name', 'profileIconId'],
      })
    : [];
  const partnerInfo = {};
  partnerSummoners.forEach((s) => { partnerInfo[s.puuid] = { name: s.name, profileIconId: s.profileIconId }; });
  const withName = (arr) => arr.map((x) => ({
    ...x,
    name: partnerInfo[x.puuid] ? partnerInfo[x.puuid].name : null,
    profileIconId: partnerInfo[x.puuid] ? partnerInfo[x.puuid].profileIconId : null,
  }));

  return {
    puuid,
    position,
    name: summoner ? summoner.name : null,
    profileIconId: summoner ? summoner.profileIconId : null,
    rankTier: summoner ? summoner.rankTier : null,
    rankWin: summoner ? summoner.rankWin : null,
    rankLose: summoner ? summoner.rankLose : null,
    mainPosition: summoner ? summoner.mainPosition : null,
    internalRating: user ? (user.defaultRating || 0) + (user.additionalRating || 0) : null,
    win: user ? user.win : null,
    lose: user ? user.lose : null,
    achievements: extractTopAchievementsPerCategory(achievementsRaw),
    honor: honorStats,
    tournamentChampionships: championships,
    mostChampions: userController.topChampions(summoner ? summoner.championStats : null, MOST_CHAMPIONS_TOP_N),
    soulmates: withName(soulmates),
    nemeses: withName(nemeses),
  };
};

const buildDetail = async (tournament) => {
  const [teamsRaw, matchesRaw, scrims, predictionsRaw] = await Promise.all([
    models.tournament_team.findAll({
      where: { tournamentId: tournament.id },
      order: [['id', 'ASC']],
    }),
    models.tournament_match.findAll({
      where: { tournamentId: tournament.id },
      order: [['round', 'ASC'], ['bracketSlot', 'ASC']],
    }),
    models.tournament_scrim.findAll({
      where: { tournamentId: tournament.id },
      order: [['createdAt', 'DESC']],
    }),
    models.tournament_match_prediction.findAll({
      include: [{
        model: models.tournament_match,
        where: { tournamentId: tournament.id },
        attributes: [],
        required: true,
      }],
      order: [['updatedAt', 'ASC']],
    }),
  ]);

  const teamMemberPuuids = new Set();
  teamsRaw.forEach((t) => (t.members || []).forEach((m) => teamMemberPuuids.add(m.puuid)));
  const summonerPuuids = new Set(teamMemberPuuids);
  predictionsRaw.forEach((p) => summonerPuuids.add(p.userPuuid));
  const summonerPuuidList = [...summonerPuuids];
  const [ratingByPuuid, summoners] = await Promise.all([
    fetchRatingMap(tournament.groupId, [...teamMemberPuuids]),
    summonerPuuidList.length > 0
      ? models.summoner.findAll({ where: { puuid: summonerPuuidList }, attributes: ['puuid', 'name', 'profileIconId'] })
      : Promise.resolve([]),
  ]);
  const summonerByPuuid = {};
  summoners.forEach((s) => {
    summonerByPuuid[s.puuid] = s;
  });
  const teams = enrichTeamsWithMemberInfo(
    enrichTeamsWithScrimRecord(enrichTeamsWithRating(teamsRaw, ratingByPuuid), scrims),
    summonerByPuuid,
    ratingByPuuid,
  );
  const avgRatingByTeamId = {};
  teams.forEach((t) => {
    avgRatingByTeamId[t.id] = t.avgRating;
  });
  const predictions = predictionsRaw.map((p) => ({
    matchId: p.matchId,
    userPuuid: p.userPuuid,
    predictedTeamId: p.predictedTeamId,
    summonerName: summonerByPuuid[p.userPuuid] ? summonerByPuuid[p.userPuuid].name : null,
    updatedAt: p.updatedAt,
  }));
  const matchesEnriched = enrichMatchesWithHeadToHead(
    enrichMatchesWithWinProb(matchesRaw, avgRatingByTeamId),
    scrims,
  );
  const { predictionMode } = tournament;
  const matches = tournamentController.enrichMatchesWithPredictions(matchesEnriched, predictions, predictionMode);
  // ROLLING은 전체 락 개념이 없고 매치별 predictable 플래그로 대체(프론트가 카드별로 판단).
  const predictionsLocked = predictionMode === tournamentController.PREDICTION_MODES.ROLLING
    ? false
    : tournamentController.isTournamentLocked(matchesRaw);
  const leaderboard = tournamentController.buildLeaderboard(matchesRaw, predictions, predictionMode);
  const roundLabels = tournamentController.computeRoundLabels(tournament.bracketSize, tournament.teamCount);
  const currentCandidate = await buildCandidateDetail(tournament, tournament.currentAuctionPuuid);
  return { tournament, teams, matches, scrims, roundLabels, predictionsLocked, leaderboard, currentCandidate };
};

const loadTournamentForAdmin = async (req, res, { requireStatus, statusError } = {}) => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ result: 'id가 필요합니다.' });
    return null;
  }
  const tournament = await models.tournament.findByPk(id);
  if (!tournament) {
    res.status(404).json({ result: '토너먼트를 찾을 수 없습니다.' });
    return null;
  }
  if (!(await isGroupAdmin(tournament.groupId, req.user.discordId))) {
    res.status(403).json({ result: '관리자 권한이 필요합니다.' });
    return null;
  }
  if (requireStatus && tournament.status !== requireStatus) {
    res.status(409).json({ result: statusError || '허용되지 않는 토너먼트 상태입니다.' });
    return null;
  }
  return tournament;
};

const auditUser = (req) => ({
  discordId: req.user.discordId,
  actorName: req.user.globalName || req.user.username || null,
});

module.exports = (app) => {
  app.use('/tournament', route);

  route.get('/group/:groupId', async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (!groupId) return res.status(400).json({ result: 'groupId가 필요합니다.' });
    try {
      const list = await models.tournament.findAll({
        where: { groupId },
        order: [['heldAt', 'DESC'], ['id', 'DESC']],
      });

      const championIds = list.map((t) => t.championTeamId).filter((v) => v != null);
      const champById = {};
      if (championIds.length) {
        const champions = await models.tournament_team.findAll({
          where: { id: championIds },
          attributes: ['id', 'name', 'captainPuuid', 'members'],
        });
        const champPuuids = new Set();
        champions.forEach((c) => (c.members || []).forEach((m) => champPuuids.add(m.puuid)));
        const champPuuidList = [...champPuuids];
        const [champRatingByPuuid, champSummoners] = await Promise.all([
          fetchRatingMap(groupId, champPuuidList),
          champPuuidList.length > 0
            ? models.summoner.findAll({
                where: { puuid: champPuuidList },
                attributes: ['puuid', 'name', 'profileIconId'],
              })
            : Promise.resolve([]),
        ]);
        const champSummonerByPuuid = {};
        champSummoners.forEach((s) => {
          champSummonerByPuuid[s.puuid] = s;
        });
        const championsData = champions.map((c) => (c.toJSON ? c.toJSON() : c));
        enrichTeamsWithMemberInfo(championsData, champSummonerByPuuid, champRatingByPuuid);
        championsData.forEach((c) => {
          champById[c.id] = c;
        });
      }

      const tournaments = list.map((t) => {
        const data = t.toJSON ? t.toJSON() : t;
        data.championTeam = t.championTeamId ? champById[t.championTeamId] || null : null;
        return data;
      });

      return res.status(200).json({ result: 'ok', tournaments });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.get('/group/:groupId/active', async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (!groupId) return res.status(400).json({ result: 'groupId가 필요합니다.' });
    try {
      const tournament = await models.tournament.findOne({
        where: { groupId, status: STATUS.IN_PROGRESS },
        order: [['createdAt', 'DESC']],
      });
      if (!tournament) {
        return res.status(200).json({ result: 'ok', tournament: null });
      }
      const detail = await buildDetail(tournament);
      return res.status(200).json({ result: 'ok', ...detail });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.get('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ result: 'id가 필요합니다.' });
    try {
      const tournament = await models.tournament.findByPk(id);
      if (!tournament) return res.status(404).json({ result: '토너먼트를 찾을 수 없습니다.' });
      const detail = await buildDetail(tournament);
      return res.status(200).json({ result: 'ok', ...detail });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.post('/', verifyToken, async (req, res) => {
    const {
      groupId, name, defaultBestOf = 3, finalBestOf = 5, trophyType = null,
      type = tournamentController.TYPES.NORMAL, auctionConfig = null, heldAt = null,
      allowSingleTeam = false, predictionMode = tournamentController.PREDICTION_MODES.BRACKET,
    } = req.body || {};
    if (!groupId || !name) {
      return res.status(400).json({ result: 'groupId, name이 필요합니다.' });
    }
    const heldAtError = tournamentController.validateHeldAt(heldAt);
    if (heldAtError) return res.status(400).json({ result: heldAtError });
    const predictionModeError = tournamentController.validatePredictionMode(predictionMode);
    if (predictionModeError) return res.status(400).json({ result: predictionModeError });
    if (!Number.isInteger(defaultBestOf) || defaultBestOf < 1 || defaultBestOf % 2 === 0) {
      return res.status(400).json({ result: 'defaultBestOf는 홀수 양의 정수여야 합니다.' });
    }
    if (!Number.isInteger(finalBestOf) || finalBestOf < 1 || finalBestOf % 2 === 0) {
      return res.status(400).json({ result: 'finalBestOf는 홀수 양의 정수여야 합니다.' });
    }
    const trophyError = tournamentController.validateTrophyType(trophyType);
    if (trophyError) return res.status(400).json({ result: trophyError });
    const typeError = tournamentController.validateTournamentType(type);
    if (typeError) return res.status(400).json({ result: typeError });
    if (type === tournamentController.TYPES.AUCTION) {
      const auctionError = tournamentController.validateAuctionConfig(auctionConfig);
      if (auctionError) return res.status(400).json({ result: auctionError });
    }
    if (!(await isGroupAdmin(groupId, req.user.discordId))) {
      return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
    }

    if (type === tournamentController.TYPES.AUCTION) {
      const allCandidatePuuids = tournamentController.collectCandidatePuuids(auctionConfig.candidates);
      if (!(await tournamentController.verifyMembersInGroup(groupId, allCandidatePuuids))) {
        return res.status(400).json({ result: '후보 풀에 그룹에 속하지 않은 puuid가 있습니다.' });
      }
    }

    try {
      const tournament = await models.tournament.create({
        groupId,
        name,
        status: STATUS.PREPARING,
        bracketSize: null,
        teamCount: null,
        defaultBestOf,
        finalBestOf,
        trophyType,
        heldAt,
        // 단일팀 즉시우승은 일반 토너먼트에만 의미가 있어 경매 타입은 항상 false로 저장.
        allowSingleTeam: type === tournamentController.TYPES.NORMAL && allowSingleTeam === true,
        predictionMode,
        type,
        auctionConfig: type === tournamentController.TYPES.AUCTION ? auctionConfig : null,
      });

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.create',
        details: { tournamentId: tournament.id, name, trophyType, heldAt, allowSingleTeam: tournament.allowSingleTeam, predictionMode: tournament.predictionMode, type, auctionConfig: tournament.auctionConfig },
        source: 'web',
      });

      const detail = await buildDetail(tournament);
      return res.status(200).json({ result: 'ok', ...detail });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.patch('/:id', verifyToken, async (req, res) => {
    const { name, trophyType, predictionMode, bidDurationSeconds } = req.body || {};
    try {
      const tournament = await loadTournamentForAdmin(req, res);
      if (!tournament) return undefined;

      const updates = {};
      const before = {};
      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          return res.status(400).json({ result: 'name은 비어있을 수 없습니다.' });
        }
        before.name = tournament.name;
        updates.name = name;
      }
      if (trophyType !== undefined) {
        const trophyError = tournamentController.validateTrophyType(trophyType);
        if (trophyError) return res.status(400).json({ result: trophyError });
        before.trophyType = tournament.trophyType;
        updates.trophyType = trophyType;
      }
      if (predictionMode !== undefined) {
        const predictionModeError = tournamentController.validatePredictionMode(predictionMode);
        if (predictionModeError) return res.status(400).json({ result: predictionModeError });
        // 예측 방식은 아직 예측/매치가 진행되지 않은 준비중 상태에서만 바꿀 수 있다.
        if (tournament.status !== STATUS.PREPARING) {
          return res.status(409).json({ result: '준비중인 토너먼트만 예측 방식을 변경할 수 있습니다.' });
        }
        before.predictionMode = tournament.predictionMode;
        updates.predictionMode = predictionMode;
      }
      if (bidDurationSeconds !== undefined) {
        // 경매시간(초). 다음 입찰 시작/시간갱신부터 적용되며, 진행 중인 타이머는 그대로 둔다.
        if (tournament.type !== tournamentController.TYPES.AUCTION || !tournament.auctionConfig) {
          return res.status(400).json({ result: '경매 타입 토너먼트만 경매시간을 수정할 수 있습니다.' });
        }
        if (!Number.isInteger(bidDurationSeconds) || bidDurationSeconds <= 0) {
          return res.status(400).json({ result: '경매시간(bidDurationSeconds)은 양의 정수(초)여야 합니다.' });
        }
        before.bidDurationSeconds = tournament.auctionConfig.bidDurationSeconds;
        // JSON 컬럼은 새 객체로 재할당해야 Sequelize가 변경을 감지한다(in-place 수정 X).
        updates.auctionConfig = { ...tournament.auctionConfig, bidDurationSeconds };
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ result: '수정할 필드가 없습니다.' });
      }

      Object.assign(tournament, updates);
      await tournament.save();

      // 감사 로그에 auctionConfig 후보 배열 전체가 실리지 않도록 변경분만 요약한다.
      const auditAfter = { ...updates };
      if (auditAfter.auctionConfig) {
        auditAfter.auctionConfig = { bidDurationSeconds: auditAfter.auctionConfig.bidDurationSeconds };
      }

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.update',
        details: { tournamentId: tournament.id, before, after: auditAfter },
        source: 'web',
      });

      const detail = await buildDetail(tournament);
      return res.status(200).json({ result: 'ok', ...detail });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.delete('/:id', verifyToken, async (req, res) => {
    try {
      const tournament = await loadTournamentForAdmin(req, res);
      if (!tournament) return undefined;

      await models.sequelize.transaction(async (transaction) => {
        await models.tournament_match.destroy({ where: { tournamentId: tournament.id }, transaction });
        await models.tournament_team.destroy({ where: { tournamentId: tournament.id }, transaction });
        await tournament.destroy({ transaction });
      });

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.delete',
        details: { tournamentId: tournament.id, name: tournament.name },
        source: 'web',
      });

      return res.status(200).json({ result: '삭제되었습니다.' });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.post('/:id/teams', verifyToken, async (req, res) => {
    const { name, captainPuuid, members, budget } = req.body || {};
    try {
      const tournament = await loadTournamentForAdmin(req, res, {
        requireStatus: STATUS.PREPARING,
        statusError: '준비중인 토너먼트만 팀을 추가할 수 있습니다.',
      });
      if (!tournament) return undefined;

      const isAuction = tournament.type === tournamentController.TYPES.AUCTION;
      const validator = isAuction
        ? tournamentController.validateAuctionTeamInput
        : tournamentController.validateTeamInput;
      const validationError = validator({ name, captainPuuid, members });
      if (validationError) return res.status(400).json({ result: validationError });

      let auctionBudget = null;
      if (isAuction) {
        const budgetError = tournamentController.validateAuctionTeamBudget(budget);
        if (budgetError) return res.status(400).json({ result: budgetError });
        auctionBudget = budget;

        const candidates = tournament.auctionConfig && tournament.auctionConfig.candidates;
        const candidatePos = tournamentController.findCandidatePosition(candidates, captainPuuid);
        if (!candidatePos) {
          return res.status(400).json({ result: '팀장이 후보 풀에 등록되어 있지 않습니다.' });
        }
        if (candidatePos !== members[0].position) {
          return res.status(400).json({ result: `팀장 포지션이 후보 풀(${candidatePos})과 다릅니다.` });
        }

        const candidatesPerPosition = tournamentController.getCandidatesPerPosition(candidates);
        const existingCount = await models.tournament_team.count({ where: { tournamentId: tournament.id } });
        if (existingCount >= candidatesPerPosition) {
          return res.status(409).json({
            result: `이미 포지션별 후보 수(${candidatesPerPosition})만큼 팀이 등록되어 있습니다.`,
          });
        }
      }

      const puuids = members.map((m) => m.puuid);
      if (!(await tournamentController.verifyMembersInGroup(tournament.groupId, puuids))) {
        return res.status(400).json({ result: '그룹에 등록되지 않은 팀원이 포함되어 있습니다.' });
      }

      const dups = await tournamentController.findDuplicatePuuids(tournament.id, puuids);
      if (dups.length > 0) {
        return res.status(409).json({ result: '다른 팀에 이미 등록된 팀원이 있습니다.', duplicatedPuuids: dups });
      }

      const team = await models.tournament_team.create({
        tournamentId: tournament.id,
        name,
        captainPuuid,
        members,
        auctionBudget,
      });

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.team_create',
        details: { tournamentId: tournament.id, teamId: team.id, name, auctionBudget },
        source: 'web',
      });

      return res.status(200).json({ result: 'ok', team });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.patch('/:id/teams/:teamId', verifyToken, async (req, res) => {
    const id = Number(req.params.id);
    const teamId = Number(req.params.teamId);
    const { name, captainPuuid, members } = req.body || {};
    if (!id) return res.status(400).json({ result: 'id가 필요합니다.' });
    if (!teamId) return res.status(400).json({ result: 'teamId가 필요합니다.' });

    try {
      const tournament = await models.tournament.findByPk(id);
      if (!tournament) return res.status(404).json({ result: '토너먼트를 찾을 수 없습니다.' });
      if (![STATUS.PREPARING, STATUS.IN_PROGRESS].includes(tournament.status)) {
        return res.status(409).json({ result: '준비중이거나 진행중인 토너먼트만 팀을 수정할 수 있습니다.' });
      }

      const team = await models.tournament_team.findOne({
        where: { id: teamId, tournamentId: tournament.id },
      });
      if (!team) return res.status(404).json({ result: '팀을 찾을 수 없습니다.' });

      const isCaptain = team.captainPuuid && team.captainPuuid === req.user.puuid;
      const isAdmin = await isGroupAdmin(tournament.groupId, req.user.discordId);
      if (!isCaptain && !isAdmin) {
        return res.status(403).json({ result: '관리자 또는 팀장만 수정할 수 있습니다.' });
      }

      // 경매 토너먼트는 경매 단계에서 멤버가 입찰로 결정되므로 일반 팀 PATCH 경로로
      // 멤버를 통째로 갈아끼우지 못하게 막는다. (팀명/팀장 변경 등은 경매 전용 API로 별도 처리)
      if (tournament.type === tournamentController.TYPES.AUCTION) {
        return res.status(409).json({ result: '경매 토너먼트의 팀은 경매 API로만 수정할 수 있습니다.' });
      }

      const validationError = tournamentController.validateTeamInput({ name, captainPuuid, members });
      if (validationError) return res.status(400).json({ result: validationError });

      const puuids = members.map((m) => m.puuid);
      if (!(await tournamentController.verifyMembersInGroup(tournament.groupId, puuids))) {
        return res.status(400).json({ result: '그룹에 등록되지 않은 팀원이 포함되어 있습니다.' });
      }
      const dups = await tournamentController.findDuplicatePuuids(tournament.id, puuids, teamId);
      if (dups.length > 0) {
        return res.status(409).json({ result: '다른 팀에 이미 등록된 팀원이 있습니다.', duplicatedPuuids: dups });
      }

      team.name = name;
      team.captainPuuid = captainPuuid;
      team.members = members;
      await team.save();

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.team_update',
        details: { tournamentId: tournament.id, teamId, name },
        source: 'web',
      });

      return res.status(200).json({ result: 'ok', team });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.delete('/:id/teams/:teamId', verifyToken, async (req, res) => {
    const teamId = Number(req.params.teamId);
    if (!teamId) return res.status(400).json({ result: 'teamId가 필요합니다.' });

    try {
      const tournament = await loadTournamentForAdmin(req, res, {
        requireStatus: STATUS.PREPARING,
        statusError: '준비중인 토너먼트만 팀을 삭제할 수 있습니다.',
      });
      if (!tournament) return undefined;

      const team = await models.tournament_team.findOne({
        where: { id: teamId, tournamentId: tournament.id },
      });
      if (!team) return res.status(404).json({ result: '팀을 찾을 수 없습니다.' });

      await team.destroy();

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.team_delete',
        details: { tournamentId: tournament.id, teamId, name: team.name },
        source: 'web',
      });

      return res.status(200).json({ result: '삭제되었습니다.' });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  // 경매 단계 진입: preparing(팀장만 등록) → auction
  route.post('/:id/start-auction', verifyToken, async (req, res) => {
    try {
      const tournament = await loadTournamentForAdmin(req, res);
      if (!tournament) return undefined;
      if (tournament.type !== tournamentController.TYPES.AUCTION) {
        return res.status(409).json({ result: '경매 타입 토너먼트가 아닙니다.' });
      }

      const teams = await models.tournament_team.findAll({ where: { tournamentId: tournament.id } });
      const result = await models.sequelize.transaction(async (transaction) => {
        return tournamentController.startAuction(tournament, teams, { transaction });
      });
      if (!result.ok) return res.status(400).json({ result: result.error });

      // 매물 스카우팅(천생연분/톰과제리) 캐시를 백그라운드로 미리 데운다. 응답을 막지 않음.
      auctionScout.warmScoutMap(tournament.groupId);

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.auction_start',
        details: { tournamentId: tournament.id, teamCount: teams.length, auctionConfig: tournament.auctionConfig },
        source: 'web',
      });

      const io = req.app.get('io');
      if (io) io.to(`tournament:${tournament.id}`).emit('auction:status', { tournamentId: tournament.id, status: tournament.status });

      const detail = await buildDetail(tournament);
      return res.status(200).json({ result: 'ok', ...detail });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  // 경매 입찰: 어드민이 한 명을 한 팀에 낙찰. position은 후보 풀에서 자동 추출.
  route.post('/:id/auction/bid', verifyToken, async (req, res) => {
    const { teamId, puuid, amount } = req.body || {};
    if (!Number.isInteger(teamId)) return res.status(400).json({ result: 'teamId가 필요합니다.' });
    try {
      const tournament = await loadTournamentForAdmin(req, res);
      if (!tournament) return undefined;
      if (tournament.status !== STATUS.AUCTION) {
        return res.status(409).json({ result: '경매 단계가 아닙니다.' });
      }

      const allTeams = await models.tournament_team.findAll({ where: { tournamentId: tournament.id } });
      const team = allTeams.find((t) => t.id === teamId);
      if (!team) return res.status(404).json({ result: '팀을 찾을 수 없습니다.' });

      const result = await models.sequelize.transaction(async (transaction) => {
        return tournamentController.recordAuctionBid(
          tournament,
          team,
          allTeams,
          { puuid, amount },
          { transaction },
        );
      });
      if (!result.ok) return res.status(400).json({ result: result.error });

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.auction_bid',
        details: { tournamentId: tournament.id, teamId, puuid, position: result.position, amount },
        source: 'web',
      });

      const io = req.app.get('io');
      if (io) {
        io.to(`tournament:${tournament.id}`).emit('auction:bid', {
          tournamentId: tournament.id,
          teamId,
          puuid,
          position: result.position,
          amount,
          remainingBudget: team.remainingBudget,
          currentAuctionCleared: result.currentAuctionCleared,
        });
      }

      const detail = await buildDetail(tournament);
      return res.status(200).json({ result: 'ok', ...detail });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  // 다음 매물 선정 (백엔드가 후보 풀에서 랜덤 픽)
  route.post('/:id/auction/next-candidate', verifyToken, async (req, res) => {
    try {
      const tournament = await loadTournamentForAdmin(req, res);
      if (!tournament) return undefined;
      if (tournament.status !== STATUS.AUCTION) {
        return res.status(409).json({ result: '경매 단계가 아닙니다.' });
      }
      if (tournament.currentAuctionDeadline && new Date(tournament.currentAuctionDeadline) > new Date()) {
        return res.status(409).json({ result: '입찰이 진행 중입니다.' });
      }

      const teams = await models.tournament_team.findAll({ where: { tournamentId: tournament.id } });

      // 강제 배정 우선: 한 포지션 마지막 1명은 남은 팀에 0원으로 자동 낙찰한다.
      const forced = tournamentController.findForcedAssignment(tournament, teams);
      if (forced) {
        const forcedTeam = teams.find((t) => t.id === forced.teamId);
        const assign = await models.sequelize.transaction(async (transaction) => {
          return tournamentController.forceAssignCandidate(tournament, forcedTeam, forced, { transaction });
        });
        if (!assign.ok) return res.status(409).json({ result: assign.error });

        const autoCandidate = await buildCandidateDetail(tournament, forced.puuid);
        const autoAssigned = {
          puuid: forced.puuid,
          position: forced.position,
          teamId: forced.teamId,
          teamName: forced.teamName,
          amount: 0,
          candidate: autoCandidate,
        };

        const { discordId, actorName } = auditUser(req);
        auditLog.log({
          groupId: tournament.groupId,
          actorDiscordId: discordId,
          actorName,
          action: 'tournament.auction_auto_assign',
          details: {
            tournamentId: tournament.id,
            puuid: forced.puuid,
            position: forced.position,
            teamId: forced.teamId,
            teamName: forced.teamName,
            amount: 0,
          },
          source: 'web',
        });

        const forcedIo = req.app.get('io');
        if (forcedIo) {
          forcedIo.to(`tournament:${tournament.id}`).emit('auction:auto-assign', {
            tournamentId: tournament.id,
            ...autoAssigned,
          });
        }

        const forcedDetail = await buildDetail(tournament);
        return res.status(200).json({ result: 'ok', autoAssigned, ...forcedDetail });
      }

      const picked = tournamentController.pickRandomCandidate(tournament, teams);
      if (!picked) {
        return res.status(400).json({ result: '남은 후보가 없습니다.' });
      }

      const result = await models.sequelize.transaction(async (transaction) => {
        // 이번 패스에 올라온 목록 갱신(유찰자 재등장 방지). setCurrentAuction의 save에 함께 반영됨.
        tournament.auctionOfferedPuuids = picked.offeredPuuids;
        return tournamentController.setCurrentAuction(tournament, picked.puuid, { transaction });
      });
      if (!result.ok) return res.status(409).json({ result: result.error });

      const currentCandidate = await buildCandidateDetail(tournament, picked.puuid);

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.auction_next_candidate',
        details: { tournamentId: tournament.id, puuid: picked.puuid, position: picked.position },
        source: 'web',
      });

      const io = req.app.get('io');
      if (io) {
        io.to(`tournament:${tournament.id}`).emit('auction:candidate', {
          tournamentId: tournament.id,
          puuid: picked.puuid,
          position: picked.position,
          candidate: currentCandidate,
        });
      }

      const detail = await buildDetail(tournament);
      return res.status(200).json({ result: 'ok', ...detail });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  // 입찰 시작: 현재 매물에 대해 auctionConfig.bidDurationSeconds로 deadline 세팅
  route.post('/:id/auction/start-bid', verifyToken, async (req, res) => {
    try {
      const tournament = await loadTournamentForAdmin(req, res);
      if (!tournament) return undefined;

      const result = await models.sequelize.transaction(async (transaction) => {
        return tournamentController.startBidTimer(tournament, { transaction });
      });
      if (!result.ok) return res.status(400).json({ result: result.error });

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.auction_start_bid',
        details: { tournamentId: tournament.id, puuid: tournament.currentAuctionPuuid, durationSeconds: result.durationSeconds, deadline: result.deadline },
        source: 'web',
      });

      const io = req.app.get('io');
      if (io) {
        io.to(`tournament:${tournament.id}`).emit('auction:bid-start', {
          tournamentId: tournament.id,
          puuid: tournament.currentAuctionPuuid,
          deadline: result.deadline,
          durationSeconds: result.durationSeconds,
        });
      }

      const detail = await buildDetail(tournament);
      return res.status(200).json({ result: 'ok', ...detail });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  // 시간 갱신: 현재 시각 기준 auctionConfig.bidDurationSeconds 후로 deadline 재설정
  route.post('/:id/auction/extend-time', verifyToken, async (req, res) => {
    try {
      const tournament = await loadTournamentForAdmin(req, res);
      if (!tournament) return undefined;

      const result = await models.sequelize.transaction(async (transaction) => {
        return tournamentController.extendBidTimer(tournament, { transaction });
      });
      if (!result.ok) return res.status(400).json({ result: result.error });

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.auction_extend_time',
        details: { tournamentId: tournament.id, puuid: tournament.currentAuctionPuuid, durationSeconds: result.durationSeconds, deadline: result.deadline },
        source: 'web',
      });

      const io = req.app.get('io');
      if (io) {
        io.to(`tournament:${tournament.id}`).emit('auction:bid-extend', {
          tournamentId: tournament.id,
          puuid: tournament.currentAuctionPuuid,
          deadline: result.deadline,
          durationSeconds: result.durationSeconds,
        });
      }

      const detail = await buildDetail(tournament);
      return res.status(200).json({ result: 'ok', ...detail });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  // 시간 종료: 진행 중인 입찰을 즉시 마감(deadline을 현재 시각으로 만료)
  route.post('/:id/auction/end-bid', verifyToken, async (req, res) => {
    try {
      const tournament = await loadTournamentForAdmin(req, res);
      if (!tournament) return undefined;

      const result = await models.sequelize.transaction(async (transaction) => {
        return tournamentController.endBidTimer(tournament, { transaction });
      });
      if (!result.ok) return res.status(400).json({ result: result.error });

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.auction_end_bid',
        details: { tournamentId: tournament.id, puuid: tournament.currentAuctionPuuid, deadline: result.deadline },
        source: 'web',
      });

      const io = req.app.get('io');
      if (io) {
        io.to(`tournament:${tournament.id}`).emit('auction:bid-end', {
          tournamentId: tournament.id,
          puuid: tournament.currentAuctionPuuid,
          deadline: result.deadline,
        });
      }

      const detail = await buildDetail(tournament);
      return res.status(200).json({ result: 'ok', ...detail });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  // 경매 입찰 취소: 잘못 낙찰한 경우 되돌리기
  route.delete('/:id/auction/bid', verifyToken, async (req, res) => {
    const { teamId, puuid } = req.body || {};
    if (!Number.isInteger(teamId)) return res.status(400).json({ result: 'teamId가 필요합니다.' });
    if (!puuid) return res.status(400).json({ result: 'puuid가 필요합니다.' });
    try {
      const tournament = await loadTournamentForAdmin(req, res);
      if (!tournament) return undefined;
      if (tournament.status !== STATUS.AUCTION) {
        return res.status(409).json({ result: '경매 단계가 아닙니다.' });
      }

      const team = await models.tournament_team.findOne({
        where: { id: teamId, tournamentId: tournament.id },
      });
      if (!team) return res.status(404).json({ result: '팀을 찾을 수 없습니다.' });

      const result = await models.sequelize.transaction(async (transaction) => {
        return tournamentController.undoAuctionBid(tournament, team, puuid, { transaction });
      });
      if (!result.ok) return res.status(400).json({ result: result.error });

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.auction_undo',
        details: { tournamentId: tournament.id, teamId, puuid, refund: result.refund },
        source: 'web',
      });

      const io = req.app.get('io');
      if (io) {
        io.to(`tournament:${tournament.id}`).emit('auction:undo', {
          tournamentId: tournament.id,
          teamId,
          puuid,
          refund: result.refund,
          remainingBudget: team.remainingBudget,
        });
      }

      const detail = await buildDetail(tournament);
      return res.status(200).json({ result: 'ok', ...detail });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  // 경매 완료: auction → preparing (이후 /start로 본선 시작)
  route.post('/:id/auction/complete', verifyToken, async (req, res) => {
    try {
      const tournament = await loadTournamentForAdmin(req, res);
      if (!tournament) return undefined;

      const teams = await models.tournament_team.findAll({ where: { tournamentId: tournament.id } });
      const result = await models.sequelize.transaction(async (transaction) => {
        return tournamentController.completeAuction(tournament, teams, { transaction });
      });
      if (!result.ok) return res.status(400).json({ result: result.error });

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.auction_complete',
        details: { tournamentId: tournament.id },
        source: 'web',
      });

      const io = req.app.get('io');
      if (io) io.to(`tournament:${tournament.id}`).emit('auction:status', { tournamentId: tournament.id, status: tournament.status });

      const detail = await buildDetail(tournament);
      return res.status(200).json({ result: 'ok', ...detail });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.post('/:id/start', verifyToken, async (req, res) => {
    const { slotMapping } = req.body || {};
    try {
      const tournament = await loadTournamentForAdmin(req, res, {
        requireStatus: STATUS.PREPARING,
        statusError: '준비중인 토너먼트만 시작할 수 있습니다.',
      });
      if (!tournament) return undefined;

      // 생성 시 영속화된 값이 우선. (구버전 호환을 위해 body 플래그도 허용)
      const allowSingleTeam = tournament.allowSingleTeam === true || (req.body || {}).allowSingleTeam === true;

      const otherActive = await models.tournament.findOne({
        where: { groupId: tournament.groupId, status: STATUS.IN_PROGRESS },
      });
      if (otherActive) {
        return res.status(409).json({ result: '이미 진행중인 토너먼트가 있습니다.' });
      }

      const teams = await models.tournament_team.findAll({ where: { tournamentId: tournament.id } });
      const teamCount = teams.length;
      if (teamCount < 1) {
        return res.status(400).json({ result: '최소 1팀이 등록되어야 시작할 수 있습니다.' });
      }
      if (teamCount < 2 && !allowSingleTeam) {
        return res.status(400).json({ result: '최소 2팀이 등록되어야 시작할 수 있습니다.' });
      }
      const bracketSize = tournamentController.computeBracketSize(teamCount);

      // 단일팀(레거시 임포트)은 slotMapping을 자동 구성한다: [팀, BYE]로 즉시 우승 처리됨.
      const effectiveSlotMapping = (allowSingleTeam && teamCount === 1)
        ? [teams[0].id, null]
        : slotMapping;

      const slotError = tournamentController.validateSlotMapping(effectiveSlotMapping, teams, bracketSize, teamCount);
      if (slotError) return res.status(400).json({ result: slotError });

      await models.sequelize.transaction(async (transaction) => {
        tournament.bracketSize = bracketSize;
        tournament.teamCount = teamCount;
        tournament.status = STATUS.IN_PROGRESS;
        await tournament.save({ transaction });

        const matchRows = tournamentController.generateMatchRows(
          tournament.id,
          bracketSize,
          tournament.defaultBestOf,
          tournament.finalBestOf,
        );
        await models.tournament_match.bulkCreate(matchRows, { transaction });

        await tournamentController.placeTeamsAndResolveByes(tournament, effectiveSlotMapping, { transaction });
      });

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.start',
        details: { tournamentId: tournament.id, teamCount, bracketSize, slotMapping: effectiveSlotMapping, allowSingleTeam },
        source: 'web',
      });

      await tournament.reload();
      const detail = await buildDetail(tournament);
      return res.status(200).json({ result: 'ok', ...detail });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.patch('/matches/:matchId', verifyToken, async (req, res) => {
    const matchId = Number(req.params.matchId);
    const { team1Score, team2Score } = req.body || {};
    if (!matchId) return res.status(400).json({ result: 'matchId가 필요합니다.' });

    try {
      const match = await models.tournament_match.findByPk(matchId);
      if (!match) return res.status(404).json({ result: '매치를 찾을 수 없습니다.' });
      const tournament = await models.tournament.findByPk(match.tournamentId);
      if (!tournament) return res.status(404).json({ result: '토너먼트를 찾을 수 없습니다.' });

      const matchTeamIds = [match.team1Id, match.team2Id].filter((v) => v != null);
      const [matchTeams, isAdmin] = await Promise.all([
        matchTeamIds.length > 0
          ? models.tournament_team.findAll({
            where: { id: matchTeamIds },
            attributes: ['captainPuuid'],
          })
          : Promise.resolve([]),
        isGroupAdmin(tournament.groupId, req.user.discordId),
      ]);
      const isCaptain = matchTeams.some((t) => t.captainPuuid && t.captainPuuid === req.user.puuid);
      if (!isAdmin && !isCaptain) {
        return res.status(403).json({ result: '관리자 또는 매치 양 팀장만 결과를 입력할 수 있습니다.' });
      }
      if (tournament.status !== STATUS.IN_PROGRESS) {
        return res.status(409).json({ result: '진행중인 토너먼트만 결과를 입력할 수 있습니다.' });
      }

      const result = await models.sequelize.transaction(async (transaction) => {
        return tournamentController.recordMatchResult(match, team1Score, team2Score, { transaction });
      });
      if (!result.ok) return res.status(400).json({ result: result.error });

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.match_result',
        details: { tournamentId: tournament.id, matchId, team1Score, team2Score, winnerTeamId: match.winnerTeamId },
        source: 'web',
      });

      await tournament.reload();
      if (tournament.status === STATUS.FINISHED) {
        setImmediate(() => tournamentController.handleTournamentFinishedAchievements(tournament));
      }
      const detail = await buildDetail(tournament);
      return res.status(200).json({ result: 'ok', ...detail });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.patch('/matches/:matchId/schedule', verifyToken, async (req, res) => {
    const matchId = Number(req.params.matchId);
    if (!matchId) return res.status(400).json({ result: 'matchId가 필요합니다.' });
    const { scheduledAt } = req.body || {};
    if (scheduledAt !== null && scheduledAt !== undefined) {
      if (typeof scheduledAt !== 'string' || Number.isNaN(new Date(scheduledAt).getTime())) {
        return res.status(400).json({ result: '유효하지 않은 일정입니다.' });
      }
    }

    try {
      const match = await models.tournament_match.findByPk(matchId);
      if (!match) return res.status(404).json({ result: '매치를 찾을 수 없습니다.' });
      const tournament = await models.tournament.findByPk(match.tournamentId);
      if (!tournament) return res.status(404).json({ result: '토너먼트를 찾을 수 없습니다.' });
      if (![STATUS.PREPARING, STATUS.IN_PROGRESS].includes(tournament.status)) {
        return res.status(409).json({ result: '준비중이거나 진행중인 토너먼트만 일정을 변경할 수 있습니다.' });
      }

      const matchTeamIds = [match.team1Id, match.team2Id].filter((v) => v != null);
      const [matchTeams, isAdmin] = await Promise.all([
        matchTeamIds.length > 0
          ? models.tournament_team.findAll({
            where: { id: matchTeamIds },
            attributes: ['captainPuuid'],
          })
          : Promise.resolve([]),
        isGroupAdmin(tournament.groupId, req.user.discordId),
      ]);
      const isCaptain = matchTeams.some((t) => t.captainPuuid && t.captainPuuid === req.user.puuid);
      if (!isAdmin && !isCaptain) {
        return res.status(403).json({ result: '관리자 또는 매치 양 팀장만 일정을 변경할 수 있습니다.' });
      }

      const before = match.scheduledAt;
      match.scheduledAt = scheduledAt == null ? null : new Date(scheduledAt);
      await match.save();

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.match_schedule',
        details: { tournamentId: tournament.id, matchId, before, after: match.scheduledAt },
        source: 'web',
      });

      return res.status(200).json({ result: 'ok', match });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  // 스크림: 토너먼트 시작 후(in_progress/finished)에만 가능. preparing은 팀 변동 가능성으로 제외.
  const SCRIM_ALLOWED_STATUSES = [STATUS.IN_PROGRESS, STATUS.FINISHED];

  const loadScrimContext = async (req, res, { requireScrimOwnership = false } = {}) => {
    const id = Number(req.params.id);
    const scrimId = Number(req.params.scrimId);
    if (!id) {
      res.status(400).json({ result: 'id가 필요합니다.' });
      return null;
    }
    const tournament = await models.tournament.findByPk(id);
    if (!tournament) {
      res.status(404).json({ result: '토너먼트를 찾을 수 없습니다.' });
      return null;
    }
    if (!SCRIM_ALLOWED_STATUSES.includes(tournament.status)) {
      res.status(409).json({ result: '시작된 토너먼트만 스크림 기록이 가능합니다.' });
      return null;
    }
    if (!requireScrimOwnership) return { tournament };

    if (!scrimId) {
      res.status(400).json({ result: 'scrimId가 필요합니다.' });
      return null;
    }
    const scrim = await models.tournament_scrim.findOne({ where: { id: scrimId, tournamentId: id } });
    if (!scrim) {
      res.status(404).json({ result: '스크림 기록을 찾을 수 없습니다.' });
      return null;
    }
    const isOwner = scrim.recordedByDiscordId === req.user.discordId;
    const isAdmin = await isGroupAdmin(tournament.groupId, req.user.discordId);
    if (!isOwner && !isAdmin) {
      res.status(403).json({ result: '본인 또는 그룹 어드민만 가능합니다.' });
      return null;
    }
    return { tournament, scrim };
  };

  route.post('/:id/scrims', verifyToken, async (req, res) => {
    const { team1Id, team2Id, team1Score, team2Score } = req.body || {};
    try {
      const ctx = await loadScrimContext(req, res);
      if (!ctx) return undefined;
      const { tournament } = ctx;

      const teams = await models.tournament_team.findAll({
        where: { tournamentId: tournament.id },
        attributes: ['id'],
      });
      const validationError = tournamentController.validateScrimInput(
        { team1Id, team2Id, team1Score, team2Score },
        teams,
      );
      if (validationError) return res.status(400).json({ result: validationError });

      const scrim = await models.tournament_scrim.create({
        tournamentId: tournament.id,
        team1Id,
        team2Id,
        team1Score,
        team2Score,
        recordedByDiscordId: req.user.discordId,
      });

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.scrim_create',
        details: { tournamentId: tournament.id, scrimId: scrim.id, team1Id, team2Id, team1Score, team2Score },
        source: 'web',
      });

      return res.status(200).json({ result: 'ok', scrim });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.patch('/:id/scrims/:scrimId', verifyToken, async (req, res) => {
    const { team1Id, team2Id, team1Score, team2Score } = req.body || {};
    try {
      const ctx = await loadScrimContext(req, res, { requireScrimOwnership: true });
      if (!ctx) return undefined;
      const { tournament, scrim } = ctx;

      const teams = await models.tournament_team.findAll({
        where: { tournamentId: tournament.id },
        attributes: ['id'],
      });
      const validationError = tournamentController.validateScrimInput(
        { team1Id, team2Id, team1Score, team2Score },
        teams,
      );
      if (validationError) return res.status(400).json({ result: validationError });

      scrim.team1Id = team1Id;
      scrim.team2Id = team2Id;
      scrim.team1Score = team1Score;
      scrim.team2Score = team2Score;
      await scrim.save();

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.scrim_update',
        details: { tournamentId: tournament.id, scrimId: scrim.id, team1Id, team2Id, team1Score, team2Score },
        source: 'web',
      });

      return res.status(200).json({ result: 'ok', scrim });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.delete('/:id/scrims/:scrimId', verifyToken, async (req, res) => {
    try {
      const ctx = await loadScrimContext(req, res, { requireScrimOwnership: true });
      if (!ctx) return undefined;
      const { tournament, scrim } = ctx;

      await scrim.destroy();

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.scrim_delete',
        details: { tournamentId: tournament.id, scrimId: scrim.id },
        source: 'web',
      });

      return res.status(200).json({ result: '삭제되었습니다.' });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  route.put('/:id/predictions', verifyToken, async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ result: 'id가 필요합니다.' });
    const predictions = req.body && req.body.predictions;
    if (!Array.isArray(predictions)) {
      return res.status(400).json({ result: 'predictions 배열이 필요합니다.' });
    }

    try {
      const tournament = await models.tournament.findByPk(id);
      if (!tournament) return res.status(404).json({ result: '토너먼트를 찾을 수 없습니다.' });
      if (tournament.status === STATUS.FINISHED) {
        return res.status(409).json({ result: '종료된 토너먼트입니다.' });
      }

      const isMember = await tournamentController.verifyMembersInGroup(tournament.groupId, [req.user.puuid]);
      if (!isMember) {
        return res.status(403).json({ result: '이 토너먼트의 그룹 멤버만 예측할 수 있습니다.' });
      }

      const [matches, teams, existingPredictions] = await Promise.all([
        models.tournament_match.findAll({ where: { tournamentId: id } }),
        models.tournament_team.findAll({ where: { tournamentId: id } }),
        models.tournament_match_prediction.findAll({
          where: { userPuuid: req.user.puuid },
          attributes: ['matchId'],
          include: [{
            model: models.tournament_match,
            where: { tournamentId: id },
            attributes: [],
            required: true,
          }],
        }),
      ]);

      // BRACKET은 전체 대진을 미리 찍는 방식이라 매치가 하나라도 시작되면 전체 동결.
      // ROLLING은 매치별로 예측 가능 여부가 다르므로 전체 락 대신 아래 검증에서 매치별로 판정.
      if (tournament.predictionMode !== tournamentController.PREDICTION_MODES.ROLLING
        && tournamentController.isTournamentLocked(matches)) {
        return res.status(409).json({ result: '이미 토너먼트가 시작되어 예측을 변경할 수 없습니다.' });
      }

      const validationError = tournamentController.validatePredictionsInput({
        predictions, matches, teams, existingPredictions, predictionMode: tournament.predictionMode,
      });
      if (validationError) return res.status(400).json({ result: validationError });

      const result = await models.sequelize.transaction(async (transaction) => {
        return tournamentController.applyPredictions({
          userPuuid: req.user.puuid,
          predictions,
          transaction,
        });
      });

      return res.status(200).json({ result: 'ok', ...result });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });
};
