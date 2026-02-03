const { Router } = require('express');
const models = require('../../db/models');

const route = Router();
const { logger } = require('../../loaders/logger');

const groupController = require('../../controller/group');
const tokenController = require('../../controller/token');
const userController = require('../../controller/user');
const summonerController = require('../../controller/summoner');
const matchController = require('../../controller/match');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = (app) => {
  app.use('/group', route);

  route.post('/register', async (req, res) => {
    const groupName = req.body.groupName;
    if (!groupName)
      return res.status(501).json({ result: 'invalid group name' });

    const result = await groupController.registerGroup(groupName);
    return res.status(result.status).json({ result: result.result });
  });

  route.post('/retrieve-match', async (req, res) => {
    const groupName = req.body.groupName;
    if (!groupName)
      return res.status(501).json({ result: 'invalid group name' });

    const result = await groupController.retrieveMatches(groupName);
    return res.status(result.status).json({ result: result.result });
  });

  route.get('/ranking', async (req, res) => {
    const { groupName } = req.query;

    if (!groupName)
      return res.status(501).json({ result: 'invalid group name' });

    try {
      const tokenId = req.headers.riottokenid;
      await tokenController.validateUserGroup(tokenId, groupName);

      const rankings = await groupController.getRanking(groupName);
      return res.status(rankings.status).json({ result: rankings.result });
    } catch (e) {
      logger.error(e);
      return res.status(501);
    }
  });

  route.post('/setUserRole', async (req, res, next) => {
    const groupName = req.body.groupName;
    if (!groupName)
      return res.status(501).json({ result: 'invalid group name' });

    const targetAccountId = req.body.targetAccountId;
    if (!targetAccountId)
      return res.status(501).json({ result: 'invalid account id' });

    const role = req.body.role;
    if (role !== 'admin' && role !== 'member' && role !== 'outsider')
      return { result: 'invalid role type', status: 501 };

    try {
      const group = await models.group.findOne({ where: { groupName } });
      if (!group) return { result: 'group is not exist' };

      const tokenId = req.headers.riottokenid;
      const accountId = await tokenController.getAccountId(tokenId);
      const userInfo = await userController.getInfo(group.id, accountId);
      // TODO : admin 체크

      const result = await groupController.setUserRole(
        groupName,
        targetAccountId,
        role,
      );
      return res.status(result.status).json({});
    } catch (e) {
      logger.error(e);
      return res.status(500);
    }
  });

  // 특정 그룹의 모든 소환사 포지션 갱신
  route.post('/update-positions', async (req, res) => {
    const { groupName } = req.body;

    if (!groupName) {
      return res.status(400).json({ result: 'groupName이 필요합니다.' });
    }

    try {
      const group = await models.group.findOne({ where: { groupName } });
      if (!group) {
        return res.status(404).json({ result: '그룹을 찾을 수 없습니다.' });
      }

      // 해당 그룹의 유저들 조회
      const users = await models.user.findAll({
        where: { groupId: group.id },
      });

      const puuids = users.map((u) => u.puuid);

      const summoners = await models.summoner.findAll({
        where: { puuid: puuids },
      });

      logger.info(`[${groupName}] 포지션 업데이트 시작 - ${summoners.length}명`);

      // 즉시 응답 (백그라운드에서 처리)
      // 1명당 약 2.5분 (100매치 × 1.5초)
      const estimatedMinutes = Math.ceil(summoners.length * 2.5);
      res.status(200).json({
        result: `${summoners.length}명의 포지션 업데이트를 시작합니다. 완료까지 약 ${estimatedMinutes}분 소요 예정.`,
      });

      // 백그라운드에서 포지션 업데이트
      let successCount = 0;
      let skipCount = 0;
      const failList = [];

      for (let i = 0; i < summoners.length; i++) {
        const summoner = summoners[i];
        const progress = `[${groupName}] [${i + 1}/${summoners.length}]`;

        if (!summoner.name) {
          failList.push({ name: summoner.puuid, reason: '소환사 이름 없음' });
          continue;
        }

        try {
          const positionResult = await summonerController.getPositions(summoner.name);
          if (positionResult.skipped) {
            skipCount++;
            logger.info(`${progress} ${summoner.name} 스킵 (갱신 불필요)`);
            continue;
          }
          successCount++;
          logger.info(`${progress} ${summoner.name} 완료`);
        } catch (e) {
          failList.push({ name: summoner.name, reason: e.message });
          logger.error(`${progress} ${summoner.name} 실패: ${e.message}`);
        }

        // API 호출한 경우에만 rate limit 방지 대기
        if (i < summoners.length - 1) {
          await sleep(2000);
        }
      }

      logger.info(`[${groupName}] 포지션 업데이트 완료 - 성공: ${successCount}, 스킵: ${skipCount}, 실패: ${failList.length}`);
      if (failList.length > 0) {
        logger.info(`[${groupName}] 실패 목록:\n${failList.map((f) => `  - ${f.name}: ${f.reason}`).join('\n')}`);
      }
    } catch (e) {
      logger.error(e);
      // 이미 응답을 보냈으므로 여기서는 로그만
    }
  });

  // 그룹 전체 레이팅 재계산 (정합성 리프레시)
  route.post('/recalculate-rating', async (req, res) => {
    const { groupName } = req.body;

    if (!groupName) {
      return res.status(400).json({ result: 'groupName이 필요합니다.' });
    }

    try {
      const group = await models.group.findOne({ where: { groupName } });
      if (!group) {
        return res.status(404).json({ result: '그룹을 찾을 수 없습니다.' });
      }

      logger.info(`[${groupName}] 레이팅 재계산 시작`);

      const result = await matchController.calculateRating(groupName);

      if (result.status === 200) {
        logger.info(`[${groupName}] 레이팅 재계산 완료`);
        return res.status(200).json({ result: '레이팅 재계산이 완료되었습니다.' });
      } else {
        return res.status(result.status || 500).json({ result: result.result });
      }
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: e.message });
    }
  });
}
