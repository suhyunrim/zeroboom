const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const models = require('../db/models');
const groupController = require('../controller/group');
const { getRatingTier } = require('../services/user');
const { getLOLNickname } = require('../utils/pick-users-utils');

// URL에 프로토콜이 없으면 자동으로 http:// 추가
const rawUrl = process.env.FRONTED_URL;
const FRONTEND_URL = rawUrl && !rawUrl.startsWith('http') ? `http://${rawUrl}` : rawUrl;

exports.run = async (groupName, interaction) => {
  const nickname = interaction.member.nickname || interaction.user.username;
  const lolNickname = getLOLNickname(nickname);

  try {
    // 그룹 정보 가져오기
    const group = await models.group.findOne({
      where: { discordGuildId: interaction.guildId },
    });

    if (!group) {
      return '그룹 정보를 찾을 수 없습니다.';
    }

    // 소환사 정보 가져오기
    const summoner = await models.summoner.findOne({
      where: {
        simplifiedName: lolNickname.toLowerCase().replace(' ', ''),
      },
    });

    if (!summoner) {
      return `**${lolNickname}** 소환사를 찾을 수 없습니다.`;
    }

    // 유저 정보 가져오기
    const userInfo = await models.user.findOne({
      where: {
        groupId: group.id,
        puuid: summoner.puuid,
      },
    });

    if (!userInfo) {
      return `**${lolNickname}**님은 이 그룹에 등록되어 있지 않습니다.`;
    }

    // 랭킹 가져오기
    const rankingResult = await groupController.getRanking(groupName);
    const rankingList = rankingResult.result;
    const myRanking = rankingList.find((r) => r.puuid === summoner.puuid);

    // 전적 계산
    const win = userInfo.win || 0;
    const lose = userInfo.lose || 0;
    const totalGames = win + lose;
    const winRate = totalGames > 0 ? Math.round((win / totalGames) * 100) : 0;
    const totalRating = userInfo.defaultRating + userInfo.additionalRating;
    const tier = getRatingTier(totalRating);

    // Embed 생성
    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle(`${lolNickname}`)
      .addFields(
        { name: '티어', value: `\`${tier}\``, inline: true },
        { name: '레이팅', value: `\`${totalRating}\``, inline: true },
        { name: '랭킹', value: myRanking ? `\`#${myRanking.ranking}\`` : '`-`', inline: true },
        { name: '총 전적', value: `\`${totalGames}전\``, inline: true },
        { name: '승/패', value: `\`${win}승 ${lose}패\``, inline: true },
        { name: '승률', value: `\`${winRate}%\``, inline: true },
      );

    const response = { embeds: [embed] };

    // FRONTEND_URL이 설정되어 있으면 버튼 추가
    if (FRONTEND_URL) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setEmoji('📊')
          .setLabel('상세 전적 보기')
          .setStyle(ButtonStyle.Link)
          .setURL(FRONTEND_URL),
      );
      response.components = [row];
    }

    return response;
  } catch (e) {
    console.error(e);
    return '전적 조회 중 오류가 발생했습니다.';
  }
};

exports.conf = {
  enabled: true,
  requireGroup: true,
  aliases: ['내전적'],
  args: [],
};

exports.help = {
  name: 'my-record',
  description: '해당 그룹에서 내 전적 확인',
  usage: 'my-record',
};
