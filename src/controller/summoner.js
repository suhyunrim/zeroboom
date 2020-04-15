const moment = require('moment');
const models = require('../db/models');
const { getSummonerByName } = require('../services/riot-api');
const { logger } = require('../loaders/logger');

const expirationCheck = (time, duration = { unit: 'days', number: 1 }) => {
    const timeMoment = moment.isMoment(time) ? time : moment(time);
    const durationMoment = moment.isDuration(duration)
      ? duration
      : moment.duration(duration);
    const expiredAt = timeMoment.add(durationMoment);
  
    return expiredAt.diff(moment()) <= 0;
  };

module.exports.getSummonerByName = async (name) => {
      //const { name } = req.params;

      // TODO: 검색 시 대소문자 및 띄어쓰기를 고려 안하게 해야 함.
      const found = await models.summoner.findOne({ where: { name } });

      // no data
      if (!found) {
        try {
          const result = await getSummonerByName(name);

          // TODO: 닉변한 케이스에서 riotId 가 겹치는 경우 update로 처리해야 함
          const created = await models.summoner.create({
            riotId: result.id,
            accountId: result.accountId,
            puuid: result.puuid,
            name: result.name,
            profileIconId: result.profileIconId,
            revisionDate: result.revisionDate,
            summonerLevel: result.summonerLevel,
          });

          return { result: created, status: 200 };
        } catch (e) {
          logger.error(e.stack);
          return { result: found || e.message, status: 501 };
        }
      }

      // expired data
      if (expirationCheck(found.updatedAt)) {
        try {
          const result = await getSummonerByName(name);
          found.update({
            riotId: result.id,
            accountId: result.accountId,
            puuid: result.puuid,
            name: result.name,
            profileIconId: result.profileIconId,
            revisionDate: result.revisionDate,
            summonerLevel: result.summonerLevel,
          });
        } catch (e) {
          logger.error(e.stack);
          return { result: found || e.message, status: 501 };
        }
      }

      return { result: found, status: 200 };
    };