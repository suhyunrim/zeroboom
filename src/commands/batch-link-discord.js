const { AttachmentBuilder } = require('discord.js');
const models = require('../db/models');
const { getLOLNickname } = require('../utils/pick-users-utils');

exports.run = async (groupName, interaction) => {
  await interaction.deferReply(); // 시간이 오래 걸릴 수 있으므로 defer

  // dry_run 옵션 (기본값: true)
  const dryRun = interaction.options.getBoolean('dry_run') ?? true;

  const group = await models.group.findOne({
    where: { groupName },
  });

  if (!group) {
    return interaction.editReply('그룹 정보를 찾을 수 없습니다.');
  }

  // 현재 서버의 모든 멤버 가져오기
  const guild = interaction.guild;
  const members = await guild.members.fetch();

  const results = {
    success: [],   // 매칭 성공
    notFound: [],  // summoner 또는 user 못 찾음
    noChange: [],  // 이미 discordId가 설정되어 있음
  };

  for (const [memberId, member] of members) {
    // 봇은 제외
    if (member.user.bot) continue;

    const nickname = member.nickname || member.user.username;
    const lolNickname = getLOLNickname(nickname);

    // summoner 검색 (simplifiedName으로 검색)
    const simplifiedName = lolNickname.toLowerCase().replace(/ /g, '');
    let summoner = await models.summoner.findOne({
      where: { simplifiedName },
    });

    let user = null;

    if (!summoner) {
      // summoner를 못 찾으면 discordId로 user 테이블에서 검색
      const userByDiscordId = await models.user.findOne({
        where: { groupId: group.id, discordId: memberId },
      });

      if (userByDiscordId) {
        // user가 있으면 puuid로 summoner 찾기
        summoner = await models.summoner.findOne({
          where: { puuid: userByDiscordId.puuid },
        });

        if (summoner) {
          // discordId로 이미 연결된 유저
          results.noChange.push({
            lolNickname: summoner.name,
            discordUser: member.user.tag,
          });
          continue;
        }
      }

      // summoner를 여전히 못 찾으면 notFound
      results.notFound.push({
        discordNickname: nickname,
        lolNickname: lolNickname,
        discordUser: member.user.tag,
        reason: 'summoner 없음',
      });
      continue;
    }

    // user 검색
    user = await models.user.findOne({
      where: { groupId: group.id, puuid: summoner.puuid },
    });

    if (!user) {
      results.notFound.push({
        discordNickname: nickname,
        lolNickname: lolNickname,
        discordUser: member.user.tag,
        reason: 'user 없음',
      });
      continue;
    }

    // 이미 discordId가 설정되어 있으면 스킵
    if (user.discordId) {
      results.noChange.push({
        lolNickname: lolNickname,
        discordUser: member.user.tag,
      });
      continue;
    }

    // DB 업데이트 (dry_run이 false일 때만 실행)
    if (!dryRun) {
      await user.update({ discordId: memberId });
    }

    results.success.push({
      lolNickname: lolNickname,
      discordUser: member.user.tag,
      discordId: memberId,
    });
  }

  // 결과 텍스트 생성
  let fileContent = `일괄 디스코드 연결 결과\n`;
  fileContent += `========================================\n\n`;

  if (results.success.length > 0) {
    fileContent += `✅ 연결 대상 (${results.success.length}명)\n`;
    fileContent += `----------------------------------------\n`;
    results.success.forEach((r) => {
      fileContent += `${r.lolNickname} → ${r.discordUser}\n`;
    });
    fileContent += `\n`;
  }

  if (results.noChange.length > 0) {
    fileContent += `⏭️ 이미 연결됨 (${results.noChange.length}명)\n`;
    fileContent += `----------------------------------------\n`;
    results.noChange.forEach((r) => {
      fileContent += `${r.lolNickname} → ${r.discordUser}\n`;
    });
    fileContent += `\n`;
  }

  if (results.notFound.length > 0) {
    fileContent += `❌ 매칭 실패 (${results.notFound.length}명)\n`;
    fileContent += `----------------------------------------\n`;
    results.notFound.forEach((r) => {
      fileContent += `${r.lolNickname} (${r.discordUser}) - ${r.reason}\n`;
    });
    fileContent += `\n`;
  }

  fileContent += `========================================\n`;
  if (dryRun) {
    fileContent += `🔍 [DRY RUN] 실제 DB 업데이트 없이 시뮬레이션만 수행했습니다.\n`;
  } else {
    fileContent += `✅ [실행 완료] DB 업데이트가 완료되었습니다.\n`;
  }

  const modeText = dryRun ? `🔍 **[DRY RUN]** 시뮬레이션 모드` : `✅ **[실행 완료]** DB 업데이트됨`;
  const summary = `## 일괄 디스코드 연결 결과\n` +
    `${modeText}\n\n` +
    `- ✅ 연결 대상: **${results.success.length}명**\n` +
    `- ⏭️ 이미 연결됨: **${results.noChange.length}명**\n` +
    `- ❌ 매칭 실패: **${results.notFound.length}명**`;

  // 파일 첨부 시도
  try {
    const buffer = Buffer.from(fileContent, 'utf-8');
    const attachment = new AttachmentBuilder(buffer, { name: 'batch-link-result.txt' });

    return await interaction.editReply({
      content: summary + `\n상세 내용은 첨부 파일을 확인하세요.`,
      files: [attachment],
    });
  } catch (e) {
    // 파일 첨부 실패 시 여러 메시지로 분할
    await interaction.editReply(summary + `\n\n(파일 첨부 실패, 메시지로 출력합니다)`);

    // 메시지 분할 함수
    const sendChunkedMessages = async (title, items, formatter) => {
      if (items.length === 0) return;

      let chunk = `**${title}**\n\`\`\`\n`;
      for (const item of items) {
        const line = formatter(item) + '\n';
        if (chunk.length + line.length + 3 > 1900) {
          chunk += '```';
          await interaction.followUp(chunk);
          chunk = '```\n';
        }
        chunk += line;
      }
      if (chunk.length > 4) {
        chunk += '```';
        await interaction.followUp(chunk);
      }
    };

    await sendChunkedMessages(
      `✅ 연결 대상 (${results.success.length}명)`,
      results.success,
      (r) => `${r.lolNickname} → ${r.discordUser}`
    );

    await sendChunkedMessages(
      `⏭️ 이미 연결됨 (${results.noChange.length}명)`,
      results.noChange,
      (r) => `${r.lolNickname} → ${r.discordUser}`
    );

    await sendChunkedMessages(
      `❌ 매칭 실패 (${results.notFound.length}명)`,
      results.notFound,
      (r) => `${r.lolNickname} (${r.discordUser}) - ${r.reason}`
    );

    return;
  }
};

exports.conf = {
  enabled: true,
  requireGroup: true,
  aliases: ['일괄반영'],
  args: [
    ['boolean', 'dry_run', '시뮬레이션 모드 (기본: true, false로 설정 시 실제 DB 업데이트)', false],
  ],
};

exports.help = {
  name: 'batch-link-discord',
  description: '서버 내 모든 유저의 디스코드 ID 일괄 연결',
  usage: '/일괄반영 [dry_run:false]',
};
