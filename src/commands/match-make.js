const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const matchController = require('../controller/match');
const auditLog = require('../controller/audit-log');
const { formatMatches, formatMatchWithRating } = require('../discord/embed-messages/matching-results');
const models = require('../db/models');
const { formatTierBadge, POSITION_ABBR, normalizePosition } = require('../utils/tierUtils');
const { selectAllConcepts } = require('../match-maker/concept-scorers');

const MAX_MATCH_COUNT = 6;

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

  const result = await matchController.generateMatch(groupName, team1, team2, userPool, 999, discordIdMap);
  if (typeof result.result === 'string') {
    return result.result;
  }

  // 그룹 정보 조회
  const group = await models.group.findOne({ where: { groupName } });

  // 소환사별 레이팅 정보 캐시
  const ratingCache = {};
  const getRatingInfo = async (summonerName) => {
    if (ratingCache[summonerName]) return ratingCache[summonerName];

    const summonerData = await models.summoner.findOne({ where: { name: summonerName } });
    if (!summonerData)
      return {
        name: summonerName,
        rating: 500,
        position: null,
        win: 0,
        lose: 0,
        puuid: null,
        mainPositionRate: 0,
        subPosition: null,
        subPositionRate: 0,
      };

    const userData = await models.user.findOne({
      where: { groupId: group.id, puuid: summonerData.puuid },
    });
    if (!userData)
      return {
        name: summonerName,
        rating: 500,
        position: summonerData.mainPosition,
        win: 0,
        lose: 0,
        puuid: summonerData.puuid,
        mainPositionRate: summonerData.mainPositionRate || 0,
        subPosition: summonerData.subPosition,
        subPositionRate: summonerData.subPositionRate || 0,
      };

    const rating = userData.defaultRating + userData.additionalRating;
    ratingCache[summonerName] = {
      name: summonerName,
      rating,
      position: summonerData.mainPosition,
      win: userData.win || 0,
      lose: userData.lose || 0,
      puuid: summonerData.puuid,
      discordId: userData.discordId || null,
      mainPositionRate: summonerData.mainPositionRate || 0,
      subPosition: summonerData.subPosition,
      subPositionRate: summonerData.subPositionRate || 0,
    };
    return ratingCache[summonerName];
  };

  // 각 매치의 팀원들에게 티어 정보 추가 및 내림차순 정렬
  for (const match of result.result) {
    const team1WithRating = await Promise.all(match.team1.map(getRatingInfo));
    const team2WithRating = await Promise.all(match.team2.map(getRatingInfo));

    team1WithRating.sort((a, b) => b.rating - a.rating);
    team2WithRating.sort((a, b) => b.rating - a.rating);

    const formatPlayerDisplay = ({ name, rating, position }) => {
      const posTag = `[${POSITION_ABBR[position] || position || '??'}]`;
      return `${formatTierBadge(rating)}${posTag}${name}`;
    };

    match.team1 = team1WithRating.map(formatPlayerDisplay);
    match.team2 = team2WithRating.map(formatPlayerDisplay);

    // 평균 레이팅 계산
    match.team1AvgRating = team1WithRating.reduce((sum, { rating }) => sum + rating, 0) / team1WithRating.length;
    match.team2AvgRating = team2WithRating.reduce((sum, { rating }) => sum + rating, 0) / team2WithRating.length;

    // 원본 이름 보존 (버튼 클릭 시 사용)
    match.team1Names = team1WithRating.map(({ name }) => name);
    match.team2Names = team2WithRating.map(({ name }) => name);
  }

  result.result = result.result.filter((elem) => {
    for (const [key, value] of groups) {
      const team1Simplified = elem.team1Names.map((name) => name.replaceAll(' ', ''));
      const team2Simplified = elem.team2Names.map((name) => name.replaceAll(' ', ''));
      if (
        (team1Simplified.includes(value[0]) && team1Simplified.includes(value[1])) ||
        (team2Simplified.includes(value[0]) && team2Simplified.includes(value[1]))
      ) {
        return false;
      }
    }

    return true;
  });

  // 컨셉 매칭용 전체 매치 보존 (그룹 필터링만 적용된 상태)
  const allMatches = [...result.result];

  // 한 명만 다른 케이스 제외 (최소 2명 이상 차이나는 매칭만 선택)
  const filteredResults = [];
  for (const match of result.result) {
    const team1Set = new Set(match.team1Names);
    let isDuplicate = false;

    for (const selected of filteredResults) {
      const selectedTeam1Set = new Set(selected.team1Names);
      // team1 기준 공통 멤버 수 계산
      const commonCount = [...team1Set].filter((name) => selectedTeam1Set.has(name)).length;
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
  result.result = filteredResults.slice(0, MAX_MATCH_COUNT);

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
      rows[i].addComponents(
        new ButtonBuilder()
          .setCustomId(`${groupName}/${time}/${j}`)
          .setLabel(`${j + 1}번`)
          .setStyle(ButtonStyle.Primary),
      );
    }
  }

  return {
    embeds: [formatMatches(result.result)],
    components: [...rows],
    fetchReply: true,
    match: result.result,
    allMatches,
    ratingCache,
    time,
  };
};

exports.reactButton = async (interaction, match) => {
  const { customId } = interaction;
  const split = customId.split('/');
  const index = Number(split[2]);
  const { team1WinRate } = match;
  const teams = [[], []];
  const teamsForDB = [[], []];
  const teamRatings = [0, 0];
  const teamDiscordIds = [[], []];

  const group = await models.group.findOne({
    where: { discordGuildId: interaction.guildId },
  });

  const team1Members = match.team1Names || match.team1;
  const team2Members = match.team2Names || match.team2;
  const teamMembers = [team1Members, team2Members];

  for (let i = 0; i < 2; ++i) {
    for (const memberName of teamMembers[i]) {
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
      const posTag = `[${POSITION_ABBR[summonerData.mainPosition] || summonerData.mainPosition || '??'}]`;
      teams[i].push({
        name: `${formatTierBadge(rating)}${posTag}${summonerData.name}`,
        rating,
      });
      teamsForDB[i].push([summonerData.puuid, summonerData.name]);
      teamDiscordIds[i].push(userData.discordId || null);
      teamRatings[i] += rating;
    }

    teamRatings[i] /= teamMembers[i].length;
    teams[i].sort((a, b) => b.rating - a.rating);
  }

  const currentSeason = (group.settings && group.settings.currentSeason) || 1;
  const matchQueryResult = await models.match.create({
    groupId: group.id,
    team1: teamsForDB[0],
    team2: teamsForDB[1],
    seasonId: currentSeason,
  });

  auditLog.log({
    groupId: group.id,
    actorDiscordId: interaction.user.id,
    actorName: interaction.member.nickname,
    action: 'match.create',
    details: { gameId: matchQueryResult.gameId },
    source: 'discord',
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
    )
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`voiceMove|${matchQueryResult.gameId}`)
        .setLabel('🔊 보이스 이동')
        .setStyle(ButtonStyle.Secondary),
    );

  const label = match.conceptLabel ? `${match.conceptEmoji} ${match.conceptLabel}` : `Plan ${index + 1}`;

  const output = {
    content: `**[${interaction.member.nickname}]님이 [${match.conceptLabel ||
      `Plan ${index + 1}`}]을 선택하였습니다!!**`,
    embeds: [formatMatchWithRating(label, teams[0], teamRatings[0], teams[1], teamRatings[1], team1WinRate)],
    components: [buttons],
    teamDiscordIds,
  };
  return output;
};

/**
 * 컨셉 매칭 결과 생성
 * @returns {{ embeds, components, conceptMatches } | { error: string }}
 */
exports.generateConceptMatches = (allMatches, ratingCache, groupName, time) => {
  // ratingInfoMap, playerDataMap 구성
  const ratingInfoMap = {};
  const playerDataMap = {};
  for (const [name, info] of Object.entries(ratingCache)) {
    ratingInfoMap[name] = info;
    playerDataMap[name] = {
      puuid: info.puuid,
      name,
      rating: info.rating,
      mainPos: normalizePosition(info.position),
      subPos: normalizePosition(info.subPosition),
      mainPositionRate: info.mainPositionRate,
      subPositionRate: info.subPositionRate,
    };
  }

  // 5개 컨셉별 최적 매치 선택
  const conceptMatches = selectAllConcepts(allMatches, ratingInfoMap, playerDataMap);

  if (conceptMatches.length === 0) {
    return { error: '컨셉 매칭 조합을 생성할 수 없습니다.' };
  }

  // 컨셉 버튼 생성 (5개 = 1줄)
  const row = new ActionRowBuilder();
  for (let i = 0; i < conceptMatches.length; i++) {
    const match = conceptMatches[i];
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${groupName}/${time}/concept_${i}`)
        .setLabel(`${match.conceptEmoji} ${match.conceptLabel}`)
        .setStyle(ButtonStyle.Primary),
    );
  }

  return {
    embeds: [formatMatches(conceptMatches)],
    components: [row],
    conceptMatches,
  };
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
