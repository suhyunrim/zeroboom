const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const { verifyToken } = require('../middlewares/auth');
const models = require('../../db/models');
const auditLog = require('../../controller/audit-log');
const tournamentController = require('../../controller/tournament');

const route = Router();

const isGroupAdmin = async (groupId, discordId) => {
  if (!discordId) return false;
  const superAdmin = await models.super_admin.findByPk(discordId);
  if (superAdmin) return true;
  const adminRow = await models.user.findOne({
    where: { groupId, discordId, role: 'admin' },
    attributes: ['role'],
  });
  return !!adminRow;
};

/**
 * 토너먼트 상세 페이로드 조립 (토너먼트 + 팀 전체 + 매치 전체 + 라운드 라벨).
 */
const buildDetail = async (tournament) => {
  const [teams, matches] = await Promise.all([
    models.tournament_team.findAll({
      where: { tournamentId: tournament.id },
      order: [['id', 'ASC']],
    }),
    models.tournament_match.findAll({
      where: { tournamentId: tournament.id },
      order: [['round', 'ASC'], ['bracketSlot', 'ASC']],
    }),
  ]);
  const roundLabels = tournament.bracketSize
    ? tournamentController.computeRoundLabels(tournament.bracketSize, tournament.teamCount)
    : {};
  return { tournament, teams, matches, roundLabels };
};

module.exports = (app) => {
  app.use('/tournament', route);

  /**
   * GET /api/tournament/group/:groupId
   * 그룹의 토너먼트 목록 (요약).
   */
  route.get('/group/:groupId', async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (!groupId) return res.status(400).json({ result: 'groupId가 필요합니다.' });
    try {
      const list = await models.tournament.findAll({
        where: { groupId },
        order: [['createdAt', 'DESC']],
      });
      return res.status(200).json({ result: 'ok', tournaments: list });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * GET /api/tournament/group/:groupId/active
   * 그룹의 진행중 토너먼트 (없으면 200 + null).
   */
  route.get('/group/:groupId/active', async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (!groupId) return res.status(400).json({ result: 'groupId가 필요합니다.' });
    try {
      const tournament = await models.tournament.findOne({
        where: { groupId, status: 'in_progress' },
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

  /**
   * GET /api/tournament/:id
   * 상세 (팀 + 매치 전체).
   */
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

  /**
   * POST /api/tournament
   * body: { groupId, name, defaultBestOf?, finalBestOf? }
   * 토너먼트 생성. bracketSize/teamCount/매치 행은 시작 시점에 결정됨.
   */
  route.post('/', verifyToken, async (req, res) => {
    const { groupId, name, defaultBestOf = 3, finalBestOf = 5 } = req.body || {};
    const { discordId, globalName, username } = req.user;

    if (!groupId || !name) {
      return res.status(400).json({ result: 'groupId, name이 필요합니다.' });
    }
    if (!Number.isInteger(defaultBestOf) || defaultBestOf < 1 || defaultBestOf % 2 === 0) {
      return res.status(400).json({ result: 'defaultBestOf는 홀수 양의 정수여야 합니다.' });
    }
    if (!Number.isInteger(finalBestOf) || finalBestOf < 1 || finalBestOf % 2 === 0) {
      return res.status(400).json({ result: 'finalBestOf는 홀수 양의 정수여야 합니다.' });
    }

    if (!(await isGroupAdmin(groupId, discordId))) {
      return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
    }

    try {
      const tournament = await models.tournament.create({
        groupId,
        name,
        status: 'preparing',
        bracketSize: null,
        teamCount: null,
        defaultBestOf,
        finalBestOf,
      });

      auditLog.log({
        groupId,
        actorDiscordId: discordId,
        actorName: globalName || username || null,
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

  /**
   * DELETE /api/tournament/:id
   * 토너먼트 + 팀 + 매치 전부 삭제 (어드민 전용).
   */
  route.delete('/:id', verifyToken, async (req, res) => {
    const id = Number(req.params.id);
    const { discordId, globalName, username } = req.user;
    if (!id) return res.status(400).json({ result: 'id가 필요합니다.' });

    try {
      const tournament = await models.tournament.findByPk(id);
      if (!tournament) return res.status(404).json({ result: '토너먼트를 찾을 수 없습니다.' });
      if (!(await isGroupAdmin(tournament.groupId, discordId))) {
        return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
      }

      await models.tournament_match.destroy({ where: { tournamentId: id } });
      await models.tournament_team.destroy({ where: { tournamentId: id } });
      await tournament.destroy();

      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName: globalName || username || null,
        action: 'tournament.delete',
        details: { tournamentId: id, name: tournament.name },
        source: 'web',
      });

      return res.status(200).json({ result: '삭제되었습니다.' });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * POST /api/tournament/:id/teams
   * body: { name, captainPuuid, members: [{ puuid, position }] }
   * 팀 추가 (preparing 상태에서만).
   */
  route.post('/:id/teams', verifyToken, async (req, res) => {
    const id = Number(req.params.id);
    const { name, captainPuuid, members } = req.body || {};
    const { discordId, globalName, username } = req.user;
    if (!id) return res.status(400).json({ result: 'id가 필요합니다.' });

    try {
      const tournament = await models.tournament.findByPk(id);
      if (!tournament) return res.status(404).json({ result: '토너먼트를 찾을 수 없습니다.' });
      if (!(await isGroupAdmin(tournament.groupId, discordId))) {
        return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
      }
      if (tournament.status !== 'preparing') {
        return res.status(409).json({ result: '준비중인 토너먼트만 팀을 추가할 수 있습니다.' });
      }

      const validationError = tournamentController.validateTeamInput({ name, captainPuuid, members });
      if (validationError) return res.status(400).json({ result: validationError });

      const puuids = members.map((m) => m.puuid);
      if (!(await tournamentController.verifyMembersInGroup(tournament.groupId, puuids))) {
        return res.status(400).json({ result: '그룹에 등록되지 않은 팀원이 포함되어 있습니다.' });
      }

      const dups = await tournamentController.findDuplicatePuuids(id, puuids);
      if (dups.length > 0) {
        return res.status(409).json({ result: '다른 팀에 이미 등록된 팀원이 있습니다.', duplicatedPuuids: dups });
      }

      const team = await models.tournament_team.create({
        tournamentId: id,
        name,
        captainPuuid,
        members,
      });

      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName: globalName || username || null,
        action: 'tournament.team_create',
        details: { tournamentId: id, teamId: team.id, name },
        source: 'web',
      });

      return res.status(200).json({ result: 'ok', team });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * PATCH /api/tournament/:id/teams/:teamId
   * 팀 정보 수정 (preparing 상태에서만).
   */
  route.patch('/:id/teams/:teamId', verifyToken, async (req, res) => {
    const id = Number(req.params.id);
    const teamId = Number(req.params.teamId);
    const { name, captainPuuid, members } = req.body || {};
    const { discordId, globalName, username } = req.user;
    if (!id || !teamId) return res.status(400).json({ result: 'id, teamId가 필요합니다.' });

    try {
      const tournament = await models.tournament.findByPk(id);
      if (!tournament) return res.status(404).json({ result: '토너먼트를 찾을 수 없습니다.' });
      if (!(await isGroupAdmin(tournament.groupId, discordId))) {
        return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
      }
      if (tournament.status !== 'preparing') {
        return res.status(409).json({ result: '준비중인 토너먼트만 팀을 수정할 수 있습니다.' });
      }
      const team = await models.tournament_team.findOne({ where: { id: teamId, tournamentId: id } });
      if (!team) return res.status(404).json({ result: '팀을 찾을 수 없습니다.' });

      const validationError = tournamentController.validateTeamInput({ name, captainPuuid, members });
      if (validationError) return res.status(400).json({ result: validationError });

      const puuids = members.map((m) => m.puuid);
      if (!(await tournamentController.verifyMembersInGroup(tournament.groupId, puuids))) {
        return res.status(400).json({ result: '그룹에 등록되지 않은 팀원이 포함되어 있습니다.' });
      }
      const dups = await tournamentController.findDuplicatePuuids(id, puuids, teamId);
      if (dups.length > 0) {
        return res.status(409).json({ result: '다른 팀에 이미 등록된 팀원이 있습니다.', duplicatedPuuids: dups });
      }

      team.name = name;
      team.captainPuuid = captainPuuid;
      team.members = members;
      await team.save();

      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName: globalName || username || null,
        action: 'tournament.team_update',
        details: { tournamentId: id, teamId, name },
        source: 'web',
      });

      return res.status(200).json({ result: 'ok', team });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * DELETE /api/tournament/:id/teams/:teamId
   * 팀 삭제 (preparing 상태에서만).
   */
  route.delete('/:id/teams/:teamId', verifyToken, async (req, res) => {
    const id = Number(req.params.id);
    const teamId = Number(req.params.teamId);
    const { discordId, globalName, username } = req.user;
    if (!id || !teamId) return res.status(400).json({ result: 'id, teamId가 필요합니다.' });

    try {
      const tournament = await models.tournament.findByPk(id);
      if (!tournament) return res.status(404).json({ result: '토너먼트를 찾을 수 없습니다.' });
      if (!(await isGroupAdmin(tournament.groupId, discordId))) {
        return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
      }
      if (tournament.status !== 'preparing') {
        return res.status(409).json({ result: '준비중인 토너먼트만 팀을 삭제할 수 있습니다.' });
      }
      const team = await models.tournament_team.findOne({ where: { id: teamId, tournamentId: id } });
      if (!team) return res.status(404).json({ result: '팀을 찾을 수 없습니다.' });

      await team.destroy();

      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName: globalName || username || null,
        action: 'tournament.team_delete',
        details: { tournamentId: id, teamId, name: team.name },
        source: 'web',
      });

      return res.status(200).json({ result: '삭제되었습니다.' });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * POST /api/tournament/:id/start
   * body: { slotMapping: [teamId|null, ...] (length = nextPow2(teams.length)) }
   * 등록된 팀 수로 bracketSize 결정 → 매치 행 생성 → 1라운드 슬롯 배치 + BYE 자동 진출.
   */
  route.post('/:id/start', verifyToken, async (req, res) => {
    const id = Number(req.params.id);
    const { slotMapping } = req.body || {};
    const { discordId, globalName, username } = req.user;
    if (!id) return res.status(400).json({ result: 'id가 필요합니다.' });

    try {
      const tournament = await models.tournament.findByPk(id);
      if (!tournament) return res.status(404).json({ result: '토너먼트를 찾을 수 없습니다.' });
      if (!(await isGroupAdmin(tournament.groupId, discordId))) {
        return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
      }
      if (tournament.status !== 'preparing') {
        return res.status(409).json({ result: '준비중인 토너먼트만 시작할 수 있습니다.' });
      }

      // 같은 그룹에 다른 in_progress가 있으면 거부 (동시 진행 금지)
      const otherActive = await models.tournament.findOne({
        where: { groupId: tournament.groupId, status: 'in_progress' },
      });
      if (otherActive) {
        return res.status(409).json({ result: '이미 진행중인 토너먼트가 있습니다.' });
      }

      const teams = await models.tournament_team.findAll({ where: { tournamentId: id } });
      const teamCount = teams.length;
      if (teamCount < 2) {
        return res.status(400).json({ result: '최소 2팀이 등록되어야 시작할 수 있습니다.' });
      }
      const bracketSize = tournamentController.computeBracketSize(teamCount);

      if (!Array.isArray(slotMapping) || slotMapping.length !== bracketSize) {
        return res.status(400).json({ result: `slotMapping은 길이 ${bracketSize}의 배열이어야 합니다.` });
      }

      // teamId 유효성 + 중복 + 카운트 검증
      const placedIds = slotMapping.filter((v) => v !== null && v !== undefined);
      if (placedIds.length !== teamCount) {
        return res.status(400).json({ result: `정확히 ${teamCount}개의 팀을 배치해야 합니다.` });
      }
      if (new Set(placedIds).size !== placedIds.length) {
        return res.status(400).json({ result: '같은 팀이 여러 슬롯에 배치되었습니다.' });
      }
      const teamIdSet = new Set(teams.map((t) => t.id));
      if (!placedIds.every((tid) => teamIdSet.has(tid))) {
        return res.status(400).json({ result: '존재하지 않는 팀이 슬롯에 포함되어 있습니다.' });
      }

      // 한 매치에 두 BYE가 들어가지 않도록 검증
      for (let i = 0; i < bracketSize; i += 2) {
        if (!slotMapping[i] && !slotMapping[i + 1]) {
          return res.status(400).json({ result: '한 매치에 두 BYE가 들어갈 수 없습니다.' });
        }
      }

      tournament.bracketSize = bracketSize;
      tournament.teamCount = teamCount;
      tournament.status = 'in_progress';
      await tournament.save();

      const matchRows = tournamentController.generateMatchRows(
        tournament.id,
        bracketSize,
        tournament.defaultBestOf,
        tournament.finalBestOf,
      );
      await models.tournament_match.bulkCreate(matchRows);

      await tournamentController.placeTeamsAndResolveByes(tournament, slotMapping);

      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName: globalName || username || null,
        action: 'tournament.start',
        details: { tournamentId: id, teamCount, bracketSize, slotMapping },
        source: 'web',
      });

      const refreshed = await models.tournament.findByPk(id);
      const detail = await buildDetail(refreshed);
      return res.status(200).json({ result: 'ok', ...detail });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * PATCH /api/tournament/matches/:matchId
   * body: { team1Score, team2Score }
   * 매치 결과 입력. winner 결정 후 다음 라운드 자동 진출. 결승이면 챔피언 + finished.
   */
  route.patch('/matches/:matchId', verifyToken, async (req, res) => {
    const matchId = Number(req.params.matchId);
    const { team1Score, team2Score } = req.body || {};
    const { discordId, globalName, username } = req.user;
    if (!matchId) return res.status(400).json({ result: 'matchId가 필요합니다.' });

    try {
      const match = await models.tournament_match.findByPk(matchId);
      if (!match) return res.status(404).json({ result: '매치를 찾을 수 없습니다.' });
      const tournament = await models.tournament.findByPk(match.tournamentId);
      if (!tournament) return res.status(404).json({ result: '토너먼트를 찾을 수 없습니다.' });
      if (!(await isGroupAdmin(tournament.groupId, discordId))) {
        return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
      }
      if (tournament.status !== 'in_progress') {
        return res.status(409).json({ result: '진행중인 토너먼트만 결과를 입력할 수 있습니다.' });
      }

      const result = await tournamentController.recordMatchResult(match, team1Score, team2Score);
      if (!result.ok) return res.status(400).json({ result: result.error });

      auditLog.log({
        groupId: tournament.groupId,
        actorDiscordId: discordId,
        actorName: globalName || username || null,
        action: 'tournament.match_result',
        details: { tournamentId: tournament.id, matchId, team1Score, team2Score, winnerTeamId: match.winnerTeamId },
        source: 'web',
      });

      const refreshed = await models.tournament.findByPk(match.tournamentId);
      const detail = await buildDetail(refreshed);
      return res.status(200).json({ result: 'ok', ...detail });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });
};
