const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const { verifyToken, isGroupAdmin } = require('../middlewares/auth');
const models = require('../../db/models');
const auditLog = require('../../controller/audit-log');
const tournamentController = require('../../controller/tournament');

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

  const allPuuids = new Set();
  teamsRaw.forEach((t) => (t.members || []).forEach((m) => allPuuids.add(m.puuid)));
  const predictionPuuids = [...new Set(predictionsRaw.map((p) => p.userPuuid))];
  const [ratingByPuuid, summoners] = await Promise.all([
    fetchRatingMap(tournament.groupId, [...allPuuids]),
    predictionPuuids.length > 0
      ? models.summoner.findAll({ where: { puuid: predictionPuuids }, attributes: ['puuid', 'name'] })
      : Promise.resolve([]),
  ]);
  const summonerNameByPuuid = {};
  summoners.forEach((s) => {
    summonerNameByPuuid[s.puuid] = s.name;
  });
  const teams = enrichTeamsWithScrimRecord(enrichTeamsWithRating(teamsRaw, ratingByPuuid), scrims);
  const avgRatingByTeamId = {};
  teams.forEach((t) => {
    avgRatingByTeamId[t.id] = t.avgRating;
  });
  const predictions = predictionsRaw.map((p) => ({
    matchId: p.matchId,
    userPuuid: p.userPuuid,
    predictedTeamId: p.predictedTeamId,
    summonerName: summonerNameByPuuid[p.userPuuid] || null,
    updatedAt: p.updatedAt,
  }));
  const matchesEnriched = enrichMatchesWithHeadToHead(
    enrichMatchesWithWinProb(matchesRaw, avgRatingByTeamId),
    scrims,
  );
  const matches = tournamentController.enrichMatchesWithPredictions(matchesEnriched, predictions);
  const predictionsLocked = tournamentController.isTournamentLocked(matchesRaw);
  const leaderboard = tournamentController.buildLeaderboard(matchesRaw, predictions);
  const roundLabels = tournamentController.computeRoundLabels(tournament.bracketSize, tournament.teamCount);
  return { tournament, teams, matches, scrims, roundLabels, predictionsLocked, leaderboard };
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
        order: [['createdAt', 'DESC']],
      });

      const championIds = list.map((t) => t.championTeamId).filter((v) => v != null);
      const champions = championIds.length
        ? await models.tournament_team.findAll({
            where: { id: championIds },
            attributes: ['id', 'name', 'captainPuuid', 'members'],
          })
        : [];
      const champById = {};
      champions.forEach((c) => {
        champById[c.id] = c;
      });

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
    const { groupId, name, defaultBestOf = 3, finalBestOf = 5 } = req.body || {};
    if (!groupId || !name) {
      return res.status(400).json({ result: 'groupId, name이 필요합니다.' });
    }
    if (!Number.isInteger(defaultBestOf) || defaultBestOf < 1 || defaultBestOf % 2 === 0) {
      return res.status(400).json({ result: 'defaultBestOf는 홀수 양의 정수여야 합니다.' });
    }
    if (!Number.isInteger(finalBestOf) || finalBestOf < 1 || finalBestOf % 2 === 0) {
      return res.status(400).json({ result: 'finalBestOf는 홀수 양의 정수여야 합니다.' });
    }
    if (!(await isGroupAdmin(groupId, req.user.discordId))) {
      return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
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
      });

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.create',
        details: { tournamentId: tournament.id, name },
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
    const { name, captainPuuid, members } = req.body || {};
    try {
      const tournament = await loadTournamentForAdmin(req, res, {
        requireStatus: STATUS.PREPARING,
        statusError: '준비중인 토너먼트만 팀을 추가할 수 있습니다.',
      });
      if (!tournament) return undefined;

      const validationError = tournamentController.validateTeamInput({ name, captainPuuid, members });
      if (validationError) return res.status(400).json({ result: validationError });

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
      });

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.team_create',
        details: { tournamentId: tournament.id, teamId: team.id, name },
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

  route.post('/:id/start', verifyToken, async (req, res) => {
    const { slotMapping } = req.body || {};
    try {
      const tournament = await loadTournamentForAdmin(req, res, {
        requireStatus: STATUS.PREPARING,
        statusError: '준비중인 토너먼트만 시작할 수 있습니다.',
      });
      if (!tournament) return undefined;

      const otherActive = await models.tournament.findOne({
        where: { groupId: tournament.groupId, status: STATUS.IN_PROGRESS },
      });
      if (otherActive) {
        return res.status(409).json({ result: '이미 진행중인 토너먼트가 있습니다.' });
      }

      const teams = await models.tournament_team.findAll({ where: { tournamentId: tournament.id } });
      const teamCount = teams.length;
      if (teamCount < 2) {
        return res.status(400).json({ result: '최소 2팀이 등록되어야 시작할 수 있습니다.' });
      }
      const bracketSize = tournamentController.computeBracketSize(teamCount);

      const slotError = tournamentController.validateSlotMapping(slotMapping, teams, bracketSize, teamCount);
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

        await tournamentController.placeTeamsAndResolveByes(tournament, slotMapping, { transaction });
      });

      const { discordId, actorName } = auditUser(req);
      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName,
        action: 'tournament.start',
        details: { tournamentId: tournament.id, teamCount, bracketSize, slotMapping },
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

      const [matches, teams] = await Promise.all([
        models.tournament_match.findAll({ where: { tournamentId: id } }),
        models.tournament_team.findAll({ where: { tournamentId: id } }),
      ]);

      if (tournamentController.isTournamentLocked(matches)) {
        return res.status(409).json({ result: '이미 토너먼트가 시작되어 예측을 변경할 수 없습니다.' });
      }

      const validationError = tournamentController.validatePredictionsInput({ predictions, matches, teams });
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
