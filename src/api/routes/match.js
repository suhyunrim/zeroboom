const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const { Op } = require("sequelize");

const models = require('../../db/models');
const { getSummonerByName_V1, getCustomGameHistory, getMatchData } = require('../../services/riot-api');

const route = Router();

module.exports = (app) => {
  app.use('/match', route);

  route.post('/register', async (req, res) => {
    const { tokenId, summonerName } = req.body;

    if (!tokenId)
      return res.json({ result: "invalid token id" });
    
    if (!summonerName)
      return res.json({ result: "invalid summoner name" });

    const summoner = await getSummonerByName_V1(tokenId, summonerName);
    if (!summoner)
      return res.json({ result: "invalid summoner" });

    const matches = await getCustomGameHistory(tokenId, summoner.accountId);
    for (let gameId of matches)
    {
      if (models.match.findOne( { where: { gameId: gameId } } ))
        continue;

      const matchData = await getMatchData(tokenId, gameId);
      if (!matchData)
        continue;

      try {
        await models.match.create({
          where: {
            gameId: matchData.gameId,
          }, defaults: matchData});
      } catch (e) {
        logger.error(e.stack);
        return res.json({ result: e.message }).status(501);
      }
    }

    return res.json({ result: "succeed" }).status(200);
  });

  route.post('/calculate', async (req, res) => {
    const { groupName } = req.body;

    if (!groupName)
      return res.json({ result: "invalid group name" });

    const group = await models.group.findOne({ where: { groupName: groupName } });
    if (!group)
      return res.json({ result: "group is not exist" });

    const matches = await models.match.findAll({
      where: {
        [Op.or]: [ { groupId: null }, { groupId: group.id } ]
      }
    });

    if (matches.length == 0)
      return res.json({ result: "there is no match" });

    matches.sort((a, b) => a.gameCreation > b.gameCreation);

    let summoners = {}
    let users = {}
    let unknownSummoners = {}
    let unknownUsers = {}

    const getUser = async (accountId, name) => {
      if (unknownSummoners[accountId])
        return;

      let summoner = summoners[accountId];
      if (!summoner)
        summoner = await models.summoner.findOne({ where: { accountId: accountId } })

      if (!summoner)
      {
        summoner = await models.summoner.findOne({ where: { name: name } });
        if (summoner)
        {
          await models.summoner.update({ accountId: accountId }, { where: { name: name } });
        }
      }

      if (!summoner)
      {
        unknownSummoners[accountId] = name;
        return;
      }
      
      let user = users[summoner.riotId];
      if (!user)
      {
        user = await models.user.findOne({
          where: {
            [Op.and]: [ { riotId: summoner.riotId }, { groupId: group.id } ]
          }
        });

        user.win = 0;
        user.lose = 0;
        user.additionalRating = 0;
        user.accountId = accountId;
      }
           
      if (!user)
      {
        unknownUsers[summoner.riotId] = summoner.name;
        return;
      }

      summoners[accountId] = summoner;
      users[summoner.riotId] = user;

      return user;
    };

    const getTeam = async (teamData) => {
      let ret = [];
      for (const pair of teamData)
      {
        let user = await getUser(pair[0], pair[1]);
        if (user)
          ret.push(user);
      }
      return ret;
    };

    const apply = (team, isWon) => {
      team.forEach((elem) => {
        if (isWon)
          elem.win++;
        else
          elem.lose++;

        users[elem.accountId] = elem;
      });
    };

    for (const match of matches)
    {
      let team1 = await getTeam(match.team1);
      let team2 = await getTeam(match.team2);

      if (team1.length + team2.length < 10)
        continue;

      match.update( { groupId: group.id } );

      apply(team1, match.winTeam == 1);
      apply(team2, match.winTeam == 2);
    }

    Object.entries(users).forEach(([k, v]) => v.update(v.dataValues));

    if (Object.keys(unknownSummoners).length > 0 || Object.keys(unknownUsers).length > 0)
    {
      return res.json({
        result: 'unknown users are exist',
        unknownSummoners: JSON.stringify(unknownSummoners),
        unknownUsers: JSON.stringify(unknownUsers),
      });
    }

    return res.json({ result: "succeed" });
  });
};
