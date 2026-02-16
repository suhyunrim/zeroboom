const { Router } = require('express');
const honorController = require('../../controller/honor');
const models = require('../../db/models');

const route = Router();

module.exports = (app) => {
  app.use('/honor', route);

  /**
   * GET /api/honor/ranking/:groupId?since=YYYY-MM-DD&limit=20
   * 그룹 내 명예 포인트 랭킹
   */
  route.get('/ranking/:groupId', async (req, res) => {
    const { groupId } = req.params;
    const { since, limit } = req.query;

    if (!groupId || Number.isNaN(Number(groupId))) {
      return res.status(400).json({ result: 'invalid groupId', status: 400 });
    }

    const options = {};
    if (since) options.since = new Date(since);
    if (limit) options.limit = Number(limit);

    const ranking = await honorController.getHonorRanking(Number(groupId), options);

    // 소환사 이름 추가
    const puuids = ranking.map((entry) => entry.puuid);
    const summoners = await models.summoner.findAll({ where: { puuid: puuids } });
    const summonerMap = {};
    summoners.forEach((s) => {
      summonerMap[s.puuid] = s.name;
    });
    const result = ranking.map((entry) => ({
      ...entry,
      name: summonerMap[entry.puuid] || '알 수 없음',
    }));

    return res.status(200).json(result);
  });

  /**
   * GET /api/honor/stats/:groupId/:puuid
   * 특정 유저의 명예 통계
   */
  route.get('/stats/:groupId/:puuid', async (req, res) => {
    const { groupId, puuid } = req.params;

    if (!groupId || Number.isNaN(Number(groupId))) {
      return res.status(400).json({ result: 'invalid groupId', status: 400 });
    }

    const stats = await honorController.getHonorStats(Number(groupId), puuid);

    const summoner = await models.summoner.findOne({ where: { puuid } });
    stats.name = summoner ? summoner.name : '알 수 없음';

    return res.status(200).json(stats);
  });
};
