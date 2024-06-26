const matchController = require('../controller/match');
const { formatMatches, formatMatchWithRating } = require('../discord/embed-messages/matching-results');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const models = require('../db/models');
const { getTierName, getTierPoint, getTierStep } = require('../utils/tierUtils');

exports.run = async (groupName, interaction) => {
  const userPool = new Array();
  const team1 = new Array();
  const team2 = new Array();
  const groups = new Map();

  interaction.options.data.forEach(function(optionData) {
    const userInfo = optionData.value.split('@');
    if (userInfo.length == 1) {
      userPool.push(userInfo[0]);
      return;
    }

    if (userInfo[1] == 1) {
      team1.push(userInfo[0]);
    } else if (userInfo[1] == 2) {
      team2.push(userInfo[0]);
    } else {
      if (groups.has(userInfo[1])) {
        groups.get(userInfo[1]).push(userInfo[0]);
      } else {
        groups.set(userInfo[1], [userInfo[0]]);
      }
      userPool.push(userInfo[0]);
    }
  });

  const result = await matchController.generateMatch(groupName, team1, team2, userPool, 100);
  if (typeof(result.result) == 'string') {
    return result.result;
  }

  result.result = result.result.filter((elem) => {
    for (let [key, value] of groups) {
      const team1Simplified = elem.team1.map(elem => elem.replaceAll(' ', ''));
      const team2Simplified = elem.team2.map(elem => elem.replaceAll(' ', ''));
      if ((team1Simplified.includes(value[0]) && team1Simplified.includes(value[1])) || (team2Simplified.includes(value[0]) && team2Simplified.includes(value[1]))) {
        return false;
      }
    }

    return true;
  });

  result.result = result.result.slice(0, 6);

  if (result.status !== 200) {
    return result.result;
  }

  // 디스코드 버튼은 한번에 최대 5개만 삽입 가능해서 3개씩 두줄로 처리 (by zeroboom)
  const rows = [];
  const time = Date.now();
  for (let i = 0; i < (result.result.length < 3 ? 1 : 2); ++i) {
    rows.push(new ActionRowBuilder());
    for (let j = i * 3; j < Math.min(result.result.length, (i + 1) * 3); j++) {
      const match = result.result[j];
      // 버튼 interaction을 더 이쁘장하게 하는 법이 있을 것 같으나, 일단은 customId에 여러 정보를 실어보냄
      // customId limit length가 100이어서 간략화 (by zeroboom)
      const customeIdStr = `${j}|${match.team1WinRate.toFixed(4)}|${match.team1.join('|')}|${match.team2.join('|')}`;
      rows[i].addComponents(
        new ButtonBuilder()
          .setCustomId(`${groupName}/${time}/${j}`)
          .setLabel(`${j + 1}번`)
          .setStyle(ButtonStyle.Primary),
      );
    }
  }

  return { embeds: [formatMatches(result.result)], components: [...rows], fetchReply: true, match: result.result, time };
};

exports.reactButton = async (interaction, match) => {
  const customId = interaction.customId;
  const split = customId.split('/');
  const index = Number(split[2]);
  const team1WinRate = match.team1WinRate;
  const teams = [[], []];
  const teamsForDB = [[], []];
  const teamRatings = [0, 0];

  const group = await models.group.findOne({
    where: { discordGuildId: interaction.guildId },
  });

  const members = [...match.team1, ...match.team2];
  for (let i = 0; i < 2; ++i) {
    const startIndex = i * 5;
    for (let j = startIndex; j < startIndex + 5; ++j) {
      const summonerData = await models.summoner.findOne({
        where: { name: members[j] },
      });
      const userData = await models.user.findOne({
        where: { groupId: group.id, riotId: summonerData.riotId },
      });
      const rating = userData.defaultRating + userData.additionalRating;
      teams[i].push({
        name: `${summonerData.name} (${getTierName(rating).charAt(0)}${getTierStep(rating)} ${getTierPoint(rating)}LP)`,
        rating: rating,
      });
      teamsForDB[i].push([summonerData.puuid, summonerData.name]);
      teamRatings[i] += rating;
    }

    teamRatings[i] /= 5;
    teams[i].sort((a, b) => b.rating - a.rating);
  }

  const matchQueryResult = await models.match.create({
    groupId: group.id,
    team1: teamsForDB[0],
    team2: teamsForDB[1],
  });

  const buttons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`winCommand|${matchQueryResult.gameId}|1`)
        .setLabel('🐶팀 승리!')
        .setStyle(ButtonStyle.Success),
    )
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`winCommand|${matchQueryResult.gameId}|2`)
        .setLabel('🐱팀 승리!')
        .setStyle(ButtonStyle.Danger),
    );

  const output = {
    content: `**[${interaction.member.nickname}]님이 Plan ${index + 1}를 선택하였습니다!!**`,
    embeds: [formatMatchWithRating(index, teams[0], teamRatings[0], teams[1], teamRatings[1], team1WinRate)],
    components: [buttons],
  };
  return output;
};

exports.conf = {
  enabled: true,
  requireGroup: true,
  aliases: ['매칭생성', '자동매칭', 'mm'],
  args: [
    ['string', '유저1', '유저1 닉네임', true],
    ['string', '유저2', '유저2 닉네임', true],
    ['string', '유저3', '유저3 닉네임', true],
    ['string', '유저4', '유저4 닉네임', true],
    ['string', '유저5', '유저5 닉네임', true],
    ['string', '유저6', '유저6 닉네임', true],
    ['string', '유저7', '유저7 닉네임', true],
    ['string', '유저8', '유저8 닉네임', true],
    ['string', '유저9', '유저9 닉네임', true],
    ['string', '유저10', '유저10 닉네임', true],
  ],
};

exports.help = {
  name: 'match-make',
  description: 'rating-based auto matching.',
  usage: '/match-make [command]',
};
