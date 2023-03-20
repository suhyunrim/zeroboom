const models = require('../db/models');
const { logger } = require('../loaders/logger');
const moment = require('moment');
const { Op } = require('sequelize');

const {
    getMatchIdsFromPuuid,
    getMatchData,
  } = require('../services/riot-api');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports.retrieveMatches = async (groupName, until) => {
  const group = await models.group.findOne({ where: { groupName } });
  if (!group) return { result: 'group is not exist' };

  try {
    const users = await models.user.findAll({
        where: {
            groupId: group.id,
            latestMatchDate: {
                [Op.gte]: moment().subtract(60, 'days').toDate()
            }
        }
    });

    const puuIds = users.map((elem) => elem.puuid);
    for (let puuId of puuIds) {
        let beginIndex = 0;
        let isBroken = false;
        while (!isBroken) {
            const matchIds = await getMatchIdsFromPuuid(puuId, beginIndex);
            if (matchIds.length === 0) {
                break;
            }

            const existMatchs = await models.riot_match.findAll({ where: { matchId: matchIds } });
            const existMatchIds = existMatchs.map(elem => elem.matchId);
            if (existMatchIds.length > 0) {
                console.log(`test`);
            }

            const targetMatchIds = matchIds.filter((matchId) => !existMatchIds.includes(matchId));

            for (let matchId of targetMatchIds) {
                const matchData = await getMatchData(matchId);
                const matchDate = moment(matchData.info.gameCreation);
                if (matchDate.isBefore(until)) {
                    isBroken = true;
                    break;
                }

                await models.riot_match.create({
                    matchId: matchData.metadata.matchId,
                    participants: matchData.metadata.participants,
                    gameCreation: matchDate.format('YYYY-MM-DD HH:mm:ss'),
                }, {
                    ignoreDuplicates: true
                });

                await delay(1000);
            }

            await delay(1000);

            if (isBroken)
                break;

            beginIndex += 20;
        }

        await delay(1000);
    }
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }

  return { status: 200 };
};