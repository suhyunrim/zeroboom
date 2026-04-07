const { Client, GatewayIntentBits, REST, Routes, ComponentType, InteractionResponse, ChannelType, PermissionFlagsBits } = require('discord.js');
const { Op } = require('sequelize');
const commandListLoader = require('./command.js');
const { logger } = require('./logger');
const models = require('../db/models');
const matchController = require('../controller/match');
const honorController = require('../controller/honor');
const tempVoiceController = require('../controller/temp-voice');
const { POSITION_EMOJI, TEAM_EMOJI } = require('../utils/pick-users-utils');

const VOTE_CATEGORIES = [
  { emoji: '⚔️', label: '캐리 머신', question: '이번 경기 가장 잘한 사람은?' },
  { emoji: '💰', label: '가성비 왕', question: '레이팅 대비 가장 활약한 사람은?' },
  { emoji: '🧠', label: '멘탈 지킴이', question: '팀 분위기를 살린 사람은?' },
  { emoji: '📢', label: '샷콜러', question: '콜을 가장 잘한 사람은?' },
  { emoji: '🛡️', label: '희생 정신', question: '묵묵히 팀을 서포트한 사람은?' },
  { emoji: '🎯', label: '한타 MVP', question: '한타에서 가장 빛난 사람은?' },
  { emoji: '🔥', label: '라인전 킹', question: '라인전을 가장 잘한 사람은?' },
];

function formatHonorResults(results, session) {
  if (!results || results.length === 0) {
    return '**🏆 명예 투표 종료** - 투표 결과가 없습니다.';
  }
  const allVoted = session.voters && session.voters.size >= 10;
  const voteCount = session.voters ? session.voters.size : 0;
  const allPlayers = [...session.team1, ...session.team2];

  // 팀 구분 없이 득표순 내림차순 정렬
  const merged = {};
  for (const r of results) {
    if (!merged[r.targetPuuid]) {
      merged[r.targetPuuid] = { targetPuuid: r.targetPuuid, votes: 0 };
    }
    merged[r.targetPuuid].votes += r.votes;
  }
  const sorted = Object.values(merged).sort((a, b) => b.votes - a.votes);

  const cat = session.category;
  let text = allVoted
    ? `**🎉✨ 전원 투표 완료! ${cat.emoji} ${cat.label} 투표 결과 ✨🎉**\n전원 투표 보너스로 참가자 모두 명예 +1!\n`
    : `**${cat.emoji} ${cat.label}** - ${cat.question}\n💡 전원 투표 시 참가자 모두 명예 +1 보너스!\n${voteCount}명 투표했습니다! (${voteCount}/10)\n`;
  for (const entry of sorted) {
    const name = (allPlayers.find(p => p.puuid === entry.targetPuuid) || {}).name || '알 수 없음';
    text += `**${name}** - ${entry.votes}표\n`;
  }
  return text;
}

module.exports = async (app) => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  const matches = new Map();
  const conceptData = new Map(); // 컨셉 매칭용 데이터 (allMatches, ratingCache)
  const pickUsersData = new Map();
  const honorVoteSessions = new Map();

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const commandList = await commandListLoader();
    const command = commandList.get(interaction.commandName);

    try {
      let groupName;
      if (command.conf.aliases[0] == '방등록') {
        groupName = interaction.options.data[0].value;
      } else {
        if (command.conf.requireGroup) {
          const group = await models.group.findOne({
            where: { discordGuildId: interaction.guildId },
          });
          groupName = group ? group.groupName : '';

          if (groupName === '') {
            interaction.reply('[Error] 방 등록을 해주세요. 사용법: /방등록 그룹이름');
            return;
          }
        }
      }

      const output = await command.run(groupName, interaction);
      if (output) {
        if (command.conf.aliases[0] == '매칭생성') {
          for (let i = 0; i < output.match.length; ++i) {
            matches.set(`${groupName}/${output.time}/${i}`, output.match[i]);
          }
          // 컨셉 매칭용 데이터 저장
          if (output.allMatches && output.ratingCache) {
            conceptData.set(`${groupName}/${output.time}`, {
              allMatches: output.allMatches,
              ratingCache: output.ratingCache,
              groupName,
            });
          }
        }

        // 인원뽑기 관련 명령어 버튼 데이터 저장
        const pickCommands = ['인원뽑기', '랜덤인원뽑기', '테스트_인원뽑기'];
        if (pickCommands.includes(command.conf.aliases[0]) && typeof output === 'object' && output.components) {
          const timeKey = output.components[0].components[0].data.custom_id.split('|')[1];

          if (output.isToggleMode) {
            // 토글 모드 데이터 저장
            pickUsersData.set(timeKey, {
              isToggleMode: true,
              memberList: output.memberList,
              excludedIds: output.excludedIds || [],
              groupName: output.groupName,
              channelName: output.channelName,
            });
          } else if (output.pickedUsers) {
            // 결과 모드 데이터 저장
            pickUsersData.set(timeKey, {
              pickedUsers: output.pickedUsers,
              pickedMembersData: output.pickedMembersData,
              commandStr: output.commandStr,
            });
          }
        }

        const replied = await interaction.reply(output);
        // const collector = replied.createMessageComponentCollector({
        //   componentType: ComponentType.Button,
        // });

        // collector.on('collect', async (interaction) => {
        //   await replied.edit({ components: [] });
        // });
      }
    } catch (e) {
      logger.error(e);
      return `[Error] ${command.help.name}`;
    }
  });

  // 일단은 여기에 로직들 넣어둠.. (by zeroboom)
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) {
      return;
    }

    const commandList = await commandListLoader();

    try {
      const split = interaction.customId.split('|');

      // pickToggle 버튼 (토글 모드)
      if (split[0] === 'pickToggle') {
        const timeKey = split[1];
        const memberId = split[2];
        const data = pickUsersData.get(timeKey);

        if (!data || !data.isToggleMode) {
          await interaction.reply({ content: '데이터가 만료되었습니다. 다시 인원뽑기를 해주세요.', ephemeral: true });
          return;
        }

        // 인원뽑기 또는 테스트_인원뽑기 명령어 사용
        const pickUsersCommand = commandList.get('인원뽑기') || commandList.get('테스트_인원뽑기');

        if (memberId === 'start') {
          // 뽑기 시작
          const output = await pickUsersCommand.executePick(interaction, data);
          if (output.pickedUsers) {
            // 결과 데이터 저장 (복사/매칭 버튼용)
            const newTimeKey = output.components[0].components[0].data.custom_id.split('|')[1];
            pickUsersData.set(newTimeKey, {
              pickedUsers: output.pickedUsers,
              pickedMembersData: output.pickedMembersData,
              commandStr: output.commandStr,
            });
          }
          await interaction.update(output);
        } else {
          // 멤버 토글 (memberId = discordId)
          const output = await pickUsersCommand.handleToggle(interaction, data, memberId);
          // 업데이트된 제외 목록 저장
          data.excludedIds = output.excludedIds;
          pickUsersData.set(timeKey, data);
          await interaction.update(output);
        }
        return;
      }

      // pickUsers 버튼 (결과 화면 - 인원뽑기, 랜덤인원뽑기 공용)
      if (split[0] === 'pickUsers') {
        const timeKey = split[1];
        const action = split[2];
        const data = pickUsersData.get(timeKey);
        if (data) {
          const pickUsersCommand = commandList.get('인원뽑기') || commandList.get('랜덤인원뽑기');
          const output = await pickUsersCommand.reactButton(interaction, data);
          if (output) {
            if (output.isPositionMode) {
              // 포지션 모드 데이터 저장
              const reply = await interaction.update(output);
              pickUsersData.set(timeKey, {
                ...data,
                isPositionMode: true,
                pickedMembersData: output.pickedMembersData || data.pickedMembersData,
                positionData: output.positionData,
                mainMessage: reply, // 메인 메시지 참조 저장
              });
            } else if (output.isPositionMatchMode) {
              // 포지션 매칭 모드 데이터 저장
              pickUsersData.set(String(output.time), {
                isPositionMatchMode: true,
                positionMatches: output.positionMatches,
                playerDataMap: output.playerDataMap,
                groupId: output.groupId,
              });
              await interaction.reply(output);
            } else if (output.isConceptMatch && output.conceptMatches) {
              // 컨셉 매칭 버튼 결과
              for (let i = 0; i < output.conceptMatches.length; i++) {
                matches.set(`${output.groupName}/${output.time}/concept_${i}`, output.conceptMatches[i]);
              }
              await interaction.reply(output);
            } else {
              // 바로 매칭생성 버튼인 경우 matches Map에 데이터 저장
              if (action === 'match' && output.match) {
                const group = await models.group.findOne({
                  where: { discordGuildId: interaction.guildId },
                });
                if (group) {
                  for (let i = 0; i < output.match.length; ++i) {
                    matches.set(`${group.groupName}/${output.time}/${i}`, output.match[i]);
                  }
                  // 컨셉 매칭용 데이터 저장
                  if (output.allMatches && output.ratingCache) {
                    conceptData.set(`${group.groupName}/${output.time}`, {
                      allMatches: output.allMatches,
                      ratingCache: output.ratingCache,
                      groupName: group.groupName,
                    });
                  }
                }
              }
              await interaction.reply(output);
            }
          }
        } else {
          await interaction.reply({ content: '데이터가 만료되었습니다. 다시 인원뽑기를 해주세요.', ephemeral: true });
        }
        return;
      }

      // posMatch 버튼 (포지션 매칭 선택)
      if (split[0] === 'posMatch') {
        const timeKey = split[1];
        const index = Number(split[2]);
        const data = pickUsersData.get(timeKey);

        if (!data || !data.isPositionMatchMode) {
          await interaction.reply({ content: '데이터가 만료되었습니다. 다시 인원뽑기를 해주세요.', ephemeral: true });
          return;
        }

        const { positionMatches, playerDataMap, groupId } = data;
        const selectedMatch = positionMatches[index];

        if (!selectedMatch) {
          await interaction.reply({ content: '매칭 데이터를 찾을 수 없습니다.', ephemeral: true });
          return;
        }

        const po = selectedMatch.positionOptimization;

        // DB에 매치 생성
        const teamsForDB = [[], []];
        for (const assignment of po.teamA.assignments) {
          const playerData = playerDataMap[assignment.playerName];
          teamsForDB[0].push([playerData.puuid, assignment.playerName]);
        }
        for (const assignment of po.teamB.assignments) {
          const playerData = playerDataMap[assignment.playerName];
          teamsForDB[1].push([playerData.puuid, assignment.playerName]);
        }

        const matchQueryResult = await models.match.create({
          groupId: groupId,
          team1: teamsForDB[0],
          team2: teamsForDB[1],
        });

        // 결과 메시지
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
        const { getTierName, getTierStep, getTierPoint } = require('../utils/tierUtils');

        const positionAbbr = { TOP: 'TOP', JUNGLE: 'JG', MIDDLE: 'MID', BOTTOM: 'AD', SUPPORT: 'SUP' };
        const typeEmoji = { MAIN: '🟢', SUB: '🟡', OFF: '🔴' };

        const formatTeam = (teamResult) => {
          let totalRating = 0;
          const lines = teamResult.assignments.map(a => {
            const playerData = playerDataMap[a.playerName];
            const rating = playerData?.rating || 500;
            totalRating += rating;
            const tierName = getTierName(rating);
            const tierStep = getTierStep(rating);
            const isHighTier = tierName === 'MASTER' || tierName === 'GRANDMASTER' || tierName === 'CHALLENGER';
            const tierAbbr = tierName === 'GRANDMASTER' ? 'GM' : tierName.charAt(0);
            const tierDisplay = isHighTier
              ? `[${tierAbbr} ${getTierPoint(rating)}LP]`
              : `[${tierName.charAt(0)}${tierStep}]`;
            return `${typeEmoji[a.assignmentType]}\`${tierDisplay}[${positionAbbr[a.position]}]${a.playerName}\``;
          });
          const avgRating = totalRating / 5;
          return { lines: lines.join('\n'), avgRating };
        };

        const team1Result = formatTeam(po.teamA);
        const team2Result = formatTeam(po.teamB);

        // 평균 티어 포맷 함수
        const formatAvgTier = (avgRating) => {
          const tierName = getTierName(avgRating);
          const tierStep = getTierStep(avgRating);
          const isHighTier = tierName === 'MASTER' || tierName === 'GRANDMASTER' || tierName === 'CHALLENGER';
          const tierAbbr = tierName === 'GRANDMASTER' ? 'GM' : tierName.charAt(0);
          return isHighTier
            ? `[${tierAbbr} ${getTierPoint(avgRating)}LP]`
            : `[${tierName.charAt(0)}${tierStep}]`;
        };

        const embed = new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('🧪 포지션 매칭 확정!')
          .setDescription(`**[${interaction.member.nickname}]**님이 Plan ${index + 1}을 선택했습니다.\n🟢 메인 / 🟡 서브 / 🔴 오프`)
          .addFields(
            { name: `🐶 1팀 (${(selectedMatch.team1WinRate * 100).toFixed(1)}%) ${formatAvgTier(team1Result.avgRating)}`, value: team1Result.lines, inline: true },
            { name: `🐱 2팀 (${((1 - selectedMatch.team1WinRate) * 100).toFixed(1)}%) ${formatAvgTier(team2Result.avgRating)}`, value: team2Result.lines, inline: true },
          );

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

        await interaction.deferUpdate();
        await interaction.followUp({ embeds: [embed], components: [buttons] });

        return;
      }

      // posEditUser 버튼 (유저별 설정 버튼, customId에 인덱스 사용)
      if (split[0] === 'posEditUser') {
        const timeKey = split[1];
        const userIndex = Number(split[2]);
        const data = pickUsersData.get(timeKey);

        if (!data) {
          await interaction.reply({ content: '데이터가 만료되었습니다. 다시 인원뽑기를 해주세요.', ephemeral: true });
          return;
        }

        const nickname = data.pickedUsers[userIndex];
        const pickUsersCommand = commandList.get('인원뽑기');

        // 메인 UI 먼저 업데이트 (현재 상태 반영)
        const mainUI = pickUsersCommand.buildPositionUI(data.pickedUsers, data.positionData, timeKey);
        const reply = await interaction.update(mainUI);

        // 메인 메시지 참조 저장
        data.mainMessage = reply;
        pickUsersData.set(timeKey, data);

        // ephemeral로 개인 설정창 표시
        const editUI = pickUsersCommand.buildUserEditUI(userIndex, nickname, data.positionData, timeKey);
        await interaction.followUp(editUI);
        return;
      }


      // posConfirm 버튼 (매칭 생성)
      if (split[0] === 'posConfirm') {
        const timeKey = split[1];
        const data = pickUsersData.get(timeKey);

        if (!data) {
          await interaction.reply({ content: '데이터가 만료되었습니다. 다시 인원뽑기를 해주세요.', ephemeral: true });
          return;
        }

        const group = await models.group.findOne({
          where: { discordGuildId: interaction.guildId },
        });

        if (!group) {
          await interaction.update({ content: '그룹 정보를 찾을 수 없습니다.', components: [] });
          return;
        }

        // 팀/포지션 정보 기반으로 매칭 생성
        // discordId로 실제 소환사 이름을 조회하여 fakeOptions 생성
        const fakeOptions = [];
        for (let index = 0; index < data.pickedUsers.length; index++) {
          const parsedNickname = data.pickedUsers[index];
          const memberData = data.pickedMembersData ? data.pickedMembersData[index] : null;
          let actualName = parsedNickname;

          // discordId가 있으면 DB에서 실제 소환사 이름 조회
          if (memberData && memberData.discordId) {
            const userData = await models.user.findOne({
              where: { groupId: group.id, discordId: memberData.discordId },
            });
            if (userData) {
              const summonerData = await models.summoner.findOne({
                where: { puuid: userData.puuid },
              });
              if (summonerData) {
                actualName = summonerData.name;
              }
            }
          }

          const pData = data.positionData[parsedNickname] || { team: '랜덤팀', position: '상관X' };
          let value = actualName;

          if (pData.team === '1팀') {
            // 1팀 고정
            value = `${actualName}@1`;
          } else if (pData.team === '2팀') {
            // 2팀 고정
            value = `${actualName}@2`;
          } else if (pData.position !== '상관X') {
            // 랜덤팀이지만 포지션 지정됨 → 같은 포지션은 다른 팀으로 나뉨
            value = `${actualName}@${pData.position}`;
          }

          fakeOptions.push({
            name: `유저${index + 1}`,
            value: value,
            discordId: memberData?.discordId || null,
          });
        }

        const fakeInteraction = {
          ...interaction,
          options: {
            data: fakeOptions,
          },
        };

        const matchMakeCommand = commandList.get('매칭생성');
        const result = await matchMakeCommand.run(group.groupName, fakeInteraction);

        // matches Map에 데이터 저장 (1~3번 버튼 동작을 위해)
        if (result.match) {
          for (let i = 0; i < result.match.length; ++i) {
            matches.set(`${group.groupName}/${result.time}/${i}`, result.match[i]);
          }
          // 컨셉 매칭용 데이터 저장
          if (result.allMatches && result.ratingCache) {
            conceptData.set(`${group.groupName}/${result.time}`, {
              allMatches: result.allMatches,
              ratingCache: result.ratingCache,
              groupName: group.groupName,
            });
          }
        }

        await interaction.update({ components: [] });
        await interaction.followUp(result);
        return;
      }

      // cancelMatch 버튼 체크 (승/패 취소)
      if (split[0] === 'cancelMatch') {
        const gameId = Number(split[1]);
        const matchData = await models.match.findOne({ where: { gameId } });
        if (!matchData) {
          await interaction.reply({ content: '매치 데이터를 찾을 수 없습니다.', ephemeral: true });
          return;
        }
        const previousWinTeam = matchData.winTeam;
        if (!previousWinTeam) {
          await interaction.reply({ content: '이미 승/패가 설정되지 않은 상태입니다.', ephemeral: true });
          return;
        }

        // 투표 세션 및 DB 데이터 삭제
        honorVoteSessions.delete(gameId);
        await Promise.all([
          honorController.deleteVotesByGameId(gameId),
          matchData.update({ winTeam: null }),
        ]);
        await matchController.applyMatchResult(gameId, previousWinTeam);

        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const buttons = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`winCommand|${gameId}|1`)
              .setLabel('🐶팀 승리!')
              .setStyle(ButtonStyle.Success),
          )
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`winCommand|${gameId}|2`)
              .setLabel('🐱팀 승리!')
              .setStyle(ButtonStyle.Danger),
          )
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`voiceMove|${gameId}`)
              .setLabel('🔊 보이스 이동')
              .setStyle(ButtonStyle.Secondary),
          );

        await interaction.update({
          content: `**❌ [${interaction.member.nickname}]님이 승/패를 취소했습니다. 레이팅이 롤백되었습니다.**`,
          components: [buttons],
        });
        return;
      }

      // voiceMove 버튼 체크 (보이스 채널 이동)
      if (split[0] === 'voiceMove') {
        const gameId = Number(split[1]);
        const matchData = await models.match.findOne({ where: { gameId } });
        if (!matchData) {
          await interaction.reply({ content: '매치 데이터를 찾을 수 없습니다.', ephemeral: true });
          return;
        }

        const freshMember = await interaction.guild.members.fetch(interaction.user.id);
        const voiceChannel = freshMember.voice ? freshMember.voice.channel : null;
        if (!voiceChannel) {
          await interaction.reply({ content: '음성 채널에 접속한 상태에서 눌러주세요.', ephemeral: true });
          return;
        }

        try {
          const group = await models.group.findOne({ where: { discordGuildId: interaction.guildId } });
          const getDiscordIds = async (teamJson) => {
            const puuids = teamJson.map(([puuid]) => puuid);
            const users = await models.user.findAll({
              where: { groupId: group.id, puuid: { [Op.in]: puuids } },
              raw: true,
            });
            const userMap = {};
            users.forEach((u) => { userMap[u.puuid] = u.discordId || null; });
            return puuids.map((puuid) => userMap[puuid] || null);
          };
          const [team1DiscordIds, team2DiscordIds] = await Promise.all([
            getDiscordIds(matchData.team1),
            getDiscordIds(matchData.team2),
          ]);

          await tempVoiceController.createMatchTeamChannels({
            guild: interaction.guild,
            categoryId: voiceChannel.parentId,
            ownerDiscordId: interaction.user.id,
            team1DiscordIds,
            team2DiscordIds,
            channelName: interaction.channel ? interaction.channel.name : null,
          });
          await interaction.reply({ content: '🔊 팀 보이스 채널로 이동했습니다!', ephemeral: true });
        } catch (e) {
          logger.error('팀 채널 생성/이동 오류:', e);
          await interaction.reply({ content: '보이스 채널 이동 중 오류가 발생했습니다.', ephemeral: true });
        }
        return;
      }

      // winCommand 버튼 체크
      if (split[0] === 'winCommand') {
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const group = await models.group.findOne({
          where: { discordGuildId: interaction.guildId },
        });
        const matchData = await models.match.findOne({
          where: { gameId: Number(split[1]) },
        });
        const previousWinTeam = matchData.winTeam; // 이전 승리팀 저장 (되돌리기용)
        const winTeam = Number(split[2]);
        await matchData.update({ winTeam });
        await matchController.applyMatchResult(matchData.gameId, previousWinTeam);
        const teamEmoji = winTeam == 1 ? '🐶' : '🐱';

        // 승/패 버튼을 "승/패 변경하기" 버튼으로 교체
        const changeButton = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`changeWinCommand|${split[1]}`)
              .setLabel('승/패 변경하기')
              .setStyle(ButtonStyle.Secondary),
          );

        // 먼저 reply로 응답
        await interaction.reply(
          `${teamEmoji}팀이 **승리**하였습니다! 레이팅에 반영 되었습니다.\n(by ${interaction.member.nickname})`,
        );
        // 원본 메시지의 버튼 변경
        await interaction.message.edit({ components: [changeButton] });

        // 명예 투표 버튼 전송
        const team1Data = matchData.team1;
        const team2Data = matchData.team2;
        const category = VOTE_CATEGORIES[Math.floor(Math.random() * VOTE_CATEGORIES.length)];
        const voteSession = {
          gameId: matchData.gameId,
          groupId: group.id,
          team1: team1Data.map(p => ({ puuid: p[0], name: p[1] })),
          team2: team2Data.map(p => ({ puuid: p[0], name: p[1] })),
          voters: new Set(),
          category,
        };
        honorVoteSessions.set(matchData.gameId, voteSession);

        const honorButton = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`honorVoteStart|${matchData.gameId}`)
              .setLabel(`${category.emoji} ${category.label} 투표하기`)
              .setStyle(ButtonStyle.Primary),
          );

        const honorMessage = await interaction.channel.send({
          content: `**[MVP 투표]**\n**${category.emoji} ${category.label}** - ${category.question}\n💡 전원 투표 시 참가자 모두 명예 +1 보너스!\n0명 투표했습니다! (0/10)`,
          components: [honorButton],
        });
        voteSession.honorMessage = honorMessage;

        // 12시간 후 자동 마감
        setTimeout(async () => {
          const session = honorVoteSessions.get(matchData.gameId);
          if (session) {
            honorVoteSessions.delete(matchData.gameId);
            try {
              const results = await honorController.getVoteResults(matchData.gameId);
              await honorMessage.edit({
                content: formatHonorResults(results, session),
                components: [],
              });
            } catch (e) {
              logger.error(e);
            }
          }
        }, 12 * 60 * 60 * 1000);

        return;
      }

      // honorVoteStart 버튼 체크 (명예 투표하기)
      if (split[0] === 'honorVoteStart') {
        const { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
        const gameId = Number(split[1]);
        const session = honorVoteSessions.get(gameId);

        if (!session) {
          await interaction.reply({ content: '투표가 이미 마감되었습니다.', ephemeral: true });
          return;
        }

        // 투표자 식별
        const voterUser = await models.user.findOne({
          where: { groupId: session.groupId, discordId: interaction.user.id },
        });

        if (!voterUser) {
          await interaction.reply({ content: '등록되지 않은 사용자입니다.', ephemeral: true });
          return;
        }

        const voterPuuid = voterUser.puuid;

        // 매치 참가자인지 확인
        const inTeam1 = session.team1.find(p => p.puuid === voterPuuid);
        const inTeam2 = session.team2.find(p => p.puuid === voterPuuid);

        if (!inTeam1 && !inTeam2) {
          await interaction.reply({ content: '참가한 사람만 투표할 수 있습니다.', ephemeral: true });
          return;
        }

        // 이미 투표했는지 확인
        if (session.voters.has(voterPuuid)) {
          await interaction.reply({ content: '이미 투표하셨습니다.', ephemeral: true });
          return;
        }

        // 같은 팀원만 표시 (자기 자신 제외)
        const myTeam = inTeam1 ? session.team1 : session.team2;
        const myTeamNumber = inTeam1 ? 1 : 2;
        const teammates = myTeam.filter(p => p.puuid !== voterPuuid);

        const selectMenu = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`honorVote|${gameId}|${myTeamNumber}`)
            .setPlaceholder(session.category.question)
            .addOptions(
              teammates.map(p =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(p.name)
                  .setValue(p.puuid),
              ),
            ),
        );

        await interaction.reply({
          content: '같은 팀에서 MVP를 선택해주세요!',
          components: [selectMenu],
          ephemeral: true,
        });
        return;
      }

      // changeWinCommand 버튼 체크 (승/패 변경하기)
      if (split[0] === 'changeWinCommand') {
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const gameId = split[1];

        // 기존 투표 세션 및 DB 데이터 삭제
        honorVoteSessions.delete(Number(gameId));
        await honorController.deleteVotesByGameId(Number(gameId));

        // 다시 승/패 버튼 표시 (취소 버튼 포함)
        const buttons = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`winCommand|${gameId}|1`)
              .setLabel('🐶팀 승리!')
              .setStyle(ButtonStyle.Success),
          )
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`winCommand|${gameId}|2`)
              .setLabel('🐱팀 승리!')
              .setStyle(ButtonStyle.Danger),
          )
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`cancelMatch|${gameId}`)
              .setLabel('❌ 취소')
              .setStyle(ButtonStyle.Secondary),
          );

        await interaction.update({ components: [buttons] });
        return;
      }

      // 매칭생성 버튼 (customId 형식: groupName/time/index)
      const slashSplit = interaction.customId.split('/');
      if (slashSplit.length === 3) {
        // 컨셉 매칭 버튼 (customId: conceptMatch/groupName/time)
        if (slashSplit[0] === 'conceptMatch') {
          const groupName = slashSplit[1];
          const time = slashSplit[2];
          const data = conceptData.get(`${groupName}/${time}`);
          if (!data) {
            await interaction.reply({ content: '매칭 데이터가 만료되었습니다. 다시 매칭생성을 해주세요.', ephemeral: true });
            return;
          }
          const matchMakeCommand = commandList.get('매칭생성');
          if (matchMakeCommand) {
            const output = matchMakeCommand.generateConceptMatches(data.allMatches, data.ratingCache, groupName, time);
            if (output.error) {
              await interaction.reply({ content: output.error, ephemeral: true });
              return;
            }
            // 컨셉 매치 데이터를 matches Map에 저장
            for (let i = 0; i < output.conceptMatches.length; i++) {
              matches.set(`${groupName}/${time}/concept_${i}`, output.conceptMatches[i]);
            }
            await interaction.update({ embeds: output.embeds, components: output.components });
            return;
          }
        }

        const match = matches.get(interaction.customId);
        if (match) {
          const matchMakeCommand = commandList.get('매칭생성');
          if (matchMakeCommand) {
            const output = await matchMakeCommand.reactButton(interaction, match);
            if (output) {
              await interaction.reply(output);
            }
            return;
          }
        } else {
          await interaction.reply({ content: '매칭 데이터가 만료되었습니다. 다시 매칭생성을 해주세요.', ephemeral: true });
          return;
        }
      }
    } catch (e) {
      logger.error(e);
    }
  });

  // Select Menu 핸들러
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isStringSelectMenu()) {
      return;
    }

    const commandList = await commandListLoader();

    try {
      const split = interaction.customId.split('|');

      // honorVote SelectMenu (명예 투표)
      if (split[0] === 'honorVote') {
        const gameId = Number(split[1]);
        const teamNumber = Number(split[2]);
        const selectedPuuid = interaction.values[0];
        const session = honorVoteSessions.get(gameId);

        if (!session) {
          await interaction.update({ content: '투표가 이미 마감되었습니다.', components: [] });
          return;
        }

        // 투표자 식별
        const voterUser = await models.user.findOne({
          where: { groupId: session.groupId, discordId: interaction.user.id },
        });

        if (!voterUser) {
          await interaction.update({ content: '등록되지 않은 사용자입니다.', components: [] });
          return;
        }

        const voterPuuid = voterUser.puuid;

        // 중복 투표 방지
        if (session.voters.has(voterPuuid)) {
          await interaction.update({ content: '이미 투표하셨습니다.', components: [] });
          return;
        }

        // DB에 투표 기록
        const result = await honorController.castVote(gameId, session.groupId, voterPuuid, selectedPuuid, teamNumber);

        if (result.status === 200) {
          session.voters.add(voterPuuid);
          const targetPlayer = [...session.team1, ...session.team2].find(p => p.puuid === selectedPuuid);
          const targetName = (targetPlayer && targetPlayer.name) || '알 수 없음';
          await interaction.update({ content: `✅ **${targetName}**에게 투표 완료!`, components: [] });

          // 투표 현황 갱신
          if (session.honorMessage) {
            if (session.voters.size >= 10) {
              // 전원 투표 보너스 지급
              const allPlayers = [...session.team1, ...session.team2];
              await honorController.grantFullVoteBonus(gameId, session.groupId, allPlayers);
              honorVoteSessions.delete(gameId);
            }
            const results = await honorController.getVoteResults(gameId);
            await session.honorMessage.edit({
              content: formatHonorResults(results, session),
              components: session.voters.size >= 10 ? [] : undefined,
            });
          }
        } else {
          await interaction.update({ content: result.result, components: [] });
        }
        return;
      }

      // posSelectTeam SelectMenu (팀 선택, customId에 인덱스 사용)
      if (split[0] === 'posSelectTeam') {
        const timeKey = split[1];
        const userIndex = Number(split[2]);
        const selectedTeam = interaction.values[0];
        const data = pickUsersData.get(timeKey);

        if (!data) {
          await interaction.reply({ content: '데이터가 만료되었습니다. 다시 인원뽑기를 해주세요.', ephemeral: true });
          return;
        }

        const nickname = data.pickedUsers[userIndex];

        // 데이터 업데이트
        data.positionData[nickname].team = selectedTeam;
        pickUsersData.set(timeKey, data);

        // 메인 메시지 업데이트
        if (data.mainMessage) {
          const pickUsersCommand = commandList.get('인원뽑기');
          const mainUI = pickUsersCommand.buildPositionUI(data.pickedUsers, data.positionData, timeKey);
          await data.mainMessage.edit(mainUI);
        }

        // ephemeral 메시지 닫기
        await interaction.update({
          content: `✅ **${nickname}** 팀 설정: ${TEAM_EMOJI[selectedTeam]} ${selectedTeam}`,
          components: []
        });
        return;
      }

      // posSelectPos SelectMenu (포지션 선택, customId에 인덱스 사용)
      if (split[0] === 'posSelectPos') {
        const timeKey = split[1];
        const userIndex = Number(split[2]);
        const selectedPosition = interaction.values[0];
        const data = pickUsersData.get(timeKey);

        if (!data) {
          await interaction.reply({ content: '데이터가 만료되었습니다. 다시 인원뽑기를 해주세요.', ephemeral: true });
          return;
        }

        const nickname = data.pickedUsers[userIndex];

        // 데이터 업데이트
        data.positionData[nickname].position = selectedPosition;
        pickUsersData.set(timeKey, data);

        // 메인 메시지 업데이트
        if (data.mainMessage) {
          const pickUsersCommand = commandList.get('인원뽑기');
          const mainUI = pickUsersCommand.buildPositionUI(data.pickedUsers, data.positionData, timeKey);
          await data.mainMessage.edit(mainUI);
        }

        // ephemeral 메시지 닫기
        await interaction.update({
          content: `✅ **${nickname}** 포지션 설정: ${POSITION_EMOJI[selectedPosition]} ${selectedPosition}`,
          components: []
        });
        return;
      }
    } catch (e) {
      logger.error(e);
    }
  });

  // 임시 음성 채널: 생성기 채널 접속 시 임시 채널 생성, 퇴장 시 삭제
  client.on('voiceStateUpdate', async (oldState, newState) => {
    if (oldState.channelId === newState.channelId) return;

    try {
      const memberId = newState.member?.id || oldState.member?.id;
      const guildId = newState.guild?.id || oldState.guild?.id;
      if (memberId && guildId) {
        (async () => {
          if (oldState.channelId) {
            const activity = await models.voice_activity.findOne({
              where: { discordId: memberId, guildId, [Op.or]: [{ lastLeftAt: null }, { lastLeftAt: { [Op.lt]: models.sequelize.col('lastJoinedAt') } }] },
            });
            if (activity && activity.lastJoinedAt) {
              const now = new Date();
              // 비정상적으로 오래된 세션은 최대 7일까지만 처리
              const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
              const joinedAt = new Date(Math.max(new Date(activity.lastJoinedAt).getTime(), now.getTime() - MAX_DURATION_MS));
              const dailyDurations = [];
              let cursor = new Date(joinedAt);
              while (cursor < now) {
                const dateStr = cursor.toISOString().slice(0, 10);
                const nextDay = new Date(cursor);
                nextDay.setUTCFullYear(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1);
                nextDay.setUTCHours(0, 0, 0, 0);
                const end = nextDay < now ? nextDay : now;
                const seconds = Math.floor((end - cursor) / 1000);
                if (seconds > 0) {
                  dailyDurations.push({ date: dateStr, duration: seconds });
                }
                cursor = nextDay;
              }
              await Promise.all(dailyDurations.map(({ date, duration }) =>
                models.sequelize.query(
                  `INSERT INTO voice_activity_dailies (discordId, guildId, date, duration, createdAt, updatedAt)
                   VALUES (:discordId, :guildId, :date, :duration, NOW(), NOW())
                   ON DUPLICATE KEY UPDATE duration = duration + :duration, updatedAt = NOW()`,
                  { replacements: { discordId: memberId, guildId, date, duration } },
                ),
              ));
              await activity.update({ lastLeftAt: now });
            }
          }
          if (newState.channelId) {
            await models.voice_activity.upsert({
              discordId: memberId,
              guildId,
              lastJoinedAt: new Date(),
            });
          }
        })().catch((e) => logger.error('보이스 활동 기록 오류:', e));
      }

      // 생성기 채널에 접속한 경우 → 임시 채널 생성
      if (newState.channelId) {
        const generator = await tempVoiceController.findGenerator(newState.channelId);
        if (generator) {
          const guild = newState.guild;
          const member = newState.member;
          const activeCount = await tempVoiceController.countActiveChannels(generator.id);
          const channelName = generator.defaultName
            .replace('{username}', member.displayName)
            .replace('{count}', activeCount + 1);

          // 생성기 채널의 권한을 복사하고 소유자 권한 추가
          const generatorChannel = guild.channels.cache.get(generator.channelId);
          const permissionOverwrites = generatorChannel
            ? [...generatorChannel.permissionOverwrites.cache.values()].map((perm) => ({
              id: perm.id,
              allow: perm.allow,
              deny: perm.deny,
            }))
            : [];
          permissionOverwrites.push({
            id: member.id,
            allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers],
          });

          const tempChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: generator.categoryId || null,
            userLimit: generator.defaultUserLimit || 0,
            permissionOverwrites,
          });

          await tempVoiceController.createTempChannel({
            channelId: tempChannel.id,
            guildId: guild.id,
            ownerDiscordId: member.id,
            generatorId: generator.id,
          });

          await newState.setChannel(tempChannel);
          logger.info(`임시 음성 채널 생성: ${channelName} (${tempChannel.id}) by ${member.displayName}`);
        }
      }

      // 임시 채널에서 모든 유저가 나간 경우 → 채널 삭제
      if (oldState.channelId && oldState.channelId !== newState.channelId) {
        const tempChannelRecord = await tempVoiceController.findTempChannel(oldState.channelId);
        if (tempChannelRecord) {
          const channel = oldState.guild.channels.cache.get(oldState.channelId);
          if (channel && channel.members.size === 0) {
            await channel.delete();
            await tempVoiceController.deleteTempChannel(oldState.channelId);
            logger.info(`임시 음성 채널 삭제: ${channel.name} (${oldState.channelId})`);
          }
        }
      }
    } catch (e) {
      logger.error('임시 음성 채널 처리 오류:', e);
    }
  });

  // 봇 시작 시 DB와 실제 Discord 채널 정합성 확인
  client.once('ready', async () => {
    try {
      await tempVoiceController.cleanupOrphanedChannels(client);
      logger.info('임시 음성 채널 정합성 확인 완료');
    } catch (e) {
      logger.error('임시 음성 채널 정합성 확인 오류:', e);
    }
  });

  app.discordClient = client;

  client.login(process.env.DISCORD_BOT_TOKEN);

  const commandList = await commandListLoader();
  const commandJsons = commandList.getSlashCommands().map((command) => command.toJSON());
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

  const serverIds = [
    '635802085601968158', // 협곡에휘핑크림
    '280311002656931844', // 롤리데이
    '765934529231716365', // LRZ
    '1235540411230191626',
  ];

  for (let serverId of serverIds) {
    rest
      .put(Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID, serverId), {
        body: commandJsons,
      })
      .then((data) => console.log(`[${serverId}] Successfully registered ${data.length} application commands.`))
      .catch(console.error);
  }
};
