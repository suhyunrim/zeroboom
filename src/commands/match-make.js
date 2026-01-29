const matchController = require('../controller/match');
const { formatMatches, formatMatchWithRating } = require('../discord/embed-messages/matching-results');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const models = require('../db/models');
const { getTierName, getTierPoint, getTierStep } = require('../utils/tierUtils');

const MAX_MATCH_COUNT = 6

exports.run = async (groupName, interaction) => {
  const userPool = new Array();
  const team1 = new Array();
  const team2 = new Array();
  const groups = new Map();

  // discordIdMap 수집 (fakeInteraction에서 전달된 경우)
  const discordIdMap = interaction.options.discordIdMap || {};

  interaction.options.data.forEach(function(optionData) {
    const userInfo = optionData.value.split('@');
    const summonerName = userInfo[0];

    // optionData에 discordId가 있으면 매핑에 추가
    if (optionData.discordId) {
      discordIdMap[summonerName] = optionData.discordId;
    }

    if (userInfo.length == 1) {
      userPool.push(summonerName);
      return;
    }

    if (userInfo[1] == 1) {
      team1.push(summonerName);
    } else if (userInfo[1] == 2) {
      team2.push(summonerName);
    } else {
      const simplifiedName = summonerName.replaceAll(' ', '');
      if (groups.has(userInfo[1])) {
        groups.get(userInfo[1]).push(simplifiedName);
      } else {
        groups.set(userInfo[1], [simplifiedName]);
      }
      userPool.push(summonerName);
    }
  });

  const result = await matchController.generateMatch(groupName, team1, team2, userPool, 100, discordIdMap);
  if (typeof(result.result) == 'string') {
    return result.result;
  }

  // 그룹 정보 조회
  const group = await models.group.findOne({ where: { groupName } });

  // 소환사별 레이팅 정보 캐시
  const ratingCache = {};
  const getRatingInfo = async (summonerName) => {
    if (ratingCache[summonerName]) return ratingCache[summonerName];

    const summonerData = await models.summoner.findOne({ where: { name: summonerName } });
    if (!summonerData) return { name: summonerName, rating: 500 };

    const userData = await models.user.findOne({
      where: { groupId: group.id, puuid: summonerData.puuid },
    });
    if (!userData) return { name: summonerName, rating: 500 };

    const rating = userData.defaultRating + userData.additionalRating;
    ratingCache[summonerName] = { name: summonerName, rating };
    return ratingCache[summonerName];
  };

  // 각 매치의 팀원들에게 티어 정보 추가 및 내림차순 정렬
  for (const match of result.result) {
    const team1WithRating = await Promise.all(match.team1.map(getRatingInfo));
    const team2WithRating = await Promise.all(match.team2.map(getRatingInfo));

    team1WithRating.sort((a, b) => b.rating - a.rating);
    team2WithRating.sort((a, b) => b.rating - a.rating);

    const formatTierDisplay = (name, rating) => {
      const tierName = getTierName(rating);
      const tierStep = getTierStep(rating);
      const isHighTier = tierName === 'MASTER' || tierName === 'GRANDMASTER' || tierName === 'CHALLENGER';
      if (isHighTier) {
        const tierPoint = getTierPoint(rating);
        const tierAbbr = tierName === 'GRANDMASTER' ? 'GM' : tierName.charAt(0);
        return `[${tierAbbr} ${tierPoint}LP]${name}`;
      }
      return `[${tierName.charAt(0)}${tierStep}]${name}`;
    };

    match.team1 = team1WithRating.map(({ name, rating }) => formatTierDisplay(name, rating));
    match.team2 = team2WithRating.map(({ name, rating }) => formatTierDisplay(name, rating));

    // 평균 레이팅 계산
    match.team1AvgRating = team1WithRating.reduce((sum, { rating }) => sum + rating, 0) / 5;
    match.team2AvgRating = team2WithRating.reduce((sum, { rating }) => sum + rating, 0) / 5;

    // 원본 이름 보존 (버튼 클릭 시 사용)
    match.team1Names = team1WithRating.map(({ name }) => name);
    match.team2Names = team2WithRating.map(({ name }) => name);
  }

  result.result = result.result.filter((elem) => {
    for (let [key, value] of groups) {
      const team1Simplified = elem.team1Names.map(name => name.replaceAll(' ', ''));
      const team2Simplified = elem.team2Names.map(name => name.replaceAll(' ', ''));
      if ((team1Simplified.includes(value[0]) && team1Simplified.includes(value[1])) || (team2Simplified.includes(value[0]) && team2Simplified.includes(value[1]))) {
        return false;
      }
    }

    return true;
  });

  // 한 명만 다른 케이스 제외 (최소 2명 이상 차이나는 매칭만 선택)
  const filteredResults = [];
  for (const match of result.result) {
    const team1Set = new Set(match.team1Names);
    let isDuplicate = false;

    for (const selected of filteredResults) {
      const selectedTeam1Set = new Set(selected.team1Names);
      // team1 기준 공통 멤버 수 계산
      const commonCount = [...team1Set].filter(name => selectedTeam1Set.has(name)).length;
      // 4명 공통 = 1명만 다름 → 제외
      if (commonCount === 4) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      filteredResults.push(match);
    }
  }
  result.result = filteredResults;

  result.result = result.result.slice(0, MAX_MATCH_COUNT);

  if (result.status !== 200) {
    return result.result;
  }

  if (result.result.length === 0) {
    return '포지션 조건을 만족하는 매칭 조합이 없습니다. 포지션 설정을 조정해주세요.';
  }

  // 디스코드 버튼은 한번에 최대 5개만 삽입 가능해서 3개씩 두줄로 처리 (by zeroboom)
  const rows = [];
  const time = Date.now();
  for (let i = 0; i < (result.result.length <= 3 ? 1 : 2); ++i) {
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

  const members = [...(match.team1Names || match.team1), ...(match.team2Names || match.team2)];
  for (let i = 0; i < 2; ++i) {
    const startIndex = i * 5;
    for (let j = startIndex; j < startIndex + 5; ++j) {
      const memberName = members[j];

      const summonerData = await models.summoner.findOne({
        where: { name: memberName },
      });
      if (!summonerData) {
        return { content: `소환사 정보를 찾을 수 없습니다: ${memberName}`, ephemeral: true };
      }

      const userData = await models.user.findOne({
        where: { groupId: group.id, puuid: summonerData.puuid },
      });
      if (!userData) {
        return { content: `유저 정보를 찾을 수 없습니다: ${memberName}`, ephemeral: true };
      }

      const rating = userData.defaultRating + userData.additionalRating;
      const tierName = getTierName(rating);
      const isHighTier = tierName === 'MASTER' || tierName === 'GRANDMASTER' || tierName === 'CHALLENGER';
      const tierAbbr = tierName === 'GRANDMASTER' ? 'GM' : tierName.charAt(0);
      const tierDisplay = isHighTier
        ? `[${tierAbbr} ${getTierPoint(rating)}LP]`
        : `[${tierName.charAt(0)}${getTierStep(rating)}]`;
      teams[i].push({
        name: `${tierDisplay}${summonerData.name}`,
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
