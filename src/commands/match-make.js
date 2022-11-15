const matchController = require('../controller/match');
const { formatMatches, formatMatch } = require('../discord/embed-messages/matching-results');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const models = require('../db/models');

exports.run = async (groupName, interaction) => {
  const userPool = new Array();
  const team1 = new Array();
  const team2 = new Array();

  interaction.options.data.forEach(function(optionData) {
    const userInfo = optionData.value.split('@');
    if (userInfo.length == 1) {
      userPool.push(userInfo[0]);
      return;
    }

    if (userInfo[1] == 1) {
      team1.push(userInfo[0]);
    }

    if (userInfo[1] == 2) {
      team2.push(userInfo[0]);
    }
  });

  const result = await matchController.generateMatch(groupName, team1, team2, userPool, 6);

  if (result.status !== 200) {
    return result.result;
  }

  // 디스코드 버튼은 한번에 최대 5개만 삽입 가능해서 3개씩 두줄로 처리 (by zeroboom)
  const rows = [new ActionRowBuilder(), new ActionRowBuilder()];
  for (let i = 0; i < 2; ++i) {
    for (let j = i * 3; j < Math.min(result.result.length, (i + 1) * 3); j++) {
      const match = result.result[j];
      // 버튼 interaction을 더 이쁘장하게 하는 법이 있을 것 같으나, 일단은 customId에 여러 정보를 실어보냄
      // customId limit length가 100이어서 간략화 (by zeroboom)
      const customeIdStr = `${j}|${match.team1WinRate.toFixed(4)}|${match.team1.join('|')}|${match.team2.join('|')}`;
      rows[i].addComponents(
        new ButtonBuilder()
          .setCustomId(customeIdStr)
          .setLabel(`${j + 1}번`)
          .setStyle(ButtonStyle.Primary),
      );
    }
  }

  return { embeds: [formatMatches(result.result)], components: [...rows], fetchReply: true };
};

exports.reactButton = async (interaction) => {
  const customId = interaction.customId;
  const split = customId.split('|');
  const index = Number(split[0]);
  const team1WinRate = Number(split[1]);
  const teams = [[], []];
  const teamsForDB = [[], []];

  const group = await models.group.findOne({
    where: { discordGuildId: interaction.guildId },
  });

  for (let i = 0; i < 2; ++i) {
    const startIndex = i * 5 + 2;
    for (let j = startIndex; j < startIndex + 5; ++j) {
      // 나중에 최적화..
      const summonerData = await models.summoner.findOne({
        where: { name: split[j] },
      });
      const userData = await models.user.findOne({
        where: { groupId: group.id, riotId: summonerData.riotId },
      });
      teams[i].push(`${summonerData.name} (${userData.defaultRating + userData.additionalRating})`);
      teamsForDB[i].push([summonerData.puuid, summonerData.name]);
    }
    teams[i].sort((a, b) => {
      const aRating = Number(a.split('(')[1].split(')')[0]);
      const bRating = Number(b.split('(')[1].split(')')[0]);
      return bRating - aRating;
    });
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
    embeds: [formatMatch(index, teams[0], teams[1], team1WinRate)],
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
