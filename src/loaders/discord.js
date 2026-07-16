const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  ComponentType,
  InteractionResponse,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActivityType,
} = require('discord.js');
const { Op } = require('sequelize');
const commandListLoader = require('./command.js');
const { logger } = require('./logger');
const models = require('../db/models');
const { MatchVoteSession } = require('../services/match-vote');
const matchController = require('../controller/match');
const honorController = require('../controller/honor');
const tempVoiceController = require('../controller/temp-voice');
const auditLog = require('../controller/audit-log');
const { POSITION_EMOJI, TEAM_EMOJI } = require('../utils/pick-users-utils');
const { withLock } = require('../utils/keyed-mutex');
const {
  startOnboarding,
  sendOnboardingFallback,
  handleOnboardSelectMenu,
  handleOnboardButton,
  handleOnboardModalSubmit,
} = require('../discord/onboarding');
const { initEmojis } = require('../discord/emoji-manager');
const { isDiscordAdmin } = require('../discord/adminSync');
const matchCache = require('../redis/match-cache');
const redisClient = require('../redis/redis');

const ADMINISTRATOR = BigInt(0x8);

/**
 * 그룹의 모든 유저에 대해 Discord 관리자 권한을 DB role에 동기화
 * @param {Collection} members - guild.members.fetch() 결과
 * @param {Object} group - DB group 레코드
 */
async function syncAdminRoles(members, group) {
  // 부캐는 항상 member 유지. Discord 권한은 본캐에만 동기화한다.
  const users = await models.user.findAll({
    where: { groupId: group.id, discordId: { [Op.ne]: null }, leftGuildAt: null, primaryPuuid: null },
    attributes: ['puuid', 'discordId', 'role'],
  });

  let promoted = 0;
  let demoted = 0;

  for (const user of users) {
    const member = members.get(user.discordId);
    if (!member) continue;

    const shouldBeAdmin = isDiscordAdmin(member);
    const isAdmin = user.role === 'admin';

    if (shouldBeAdmin && !isAdmin) {
      await models.user.update({ role: 'admin' }, { where: { groupId: group.id, puuid: user.puuid } });
      promoted++;
    } else if (!shouldBeAdmin && isAdmin) {
      await models.user.update({ role: 'member' }, { where: { groupId: group.id, puuid: user.puuid } });
      demoted++;
    }
  }

  return { promoted, demoted };
}

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
  const allPlayers = [...session.team1, ...session.team2];
  const totalPlayers = allPlayers.length;
  const allVoted = session.voters && session.voters.size >= totalPlayers;
  const voteCount = session.voters ? session.voters.size : 0;

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
    : `**${cat.emoji} ${cat.label}** - ${cat.question}\n💡 전원 투표 시 참가자 모두 명예 +1 보너스!\n${voteCount}명 투표했습니다! (${voteCount}/${totalPlayers})\n`;
  for (const entry of sorted) {
    const name = (allPlayers.find((p) => p.puuid === entry.targetPuuid) || {}).name || '알 수 없음';
    text += `**${name}** - ${entry.votes}표\n`;
  }
  return text;
}

// 승패 버튼 메시지의 위치를 match에 저장 → 수집기 자동 확정이 같은 메시지를 갱신할 수 있게 한다.
async function trackMatchMessage(message, gameId) {
  if (!message || !gameId) return;
  await models.match
    .update(
      { discordChannelId: message.channelId, discordMessageId: message.id },
      { where: { gameId } },
    )
    .catch((e) => logger.error(`매치 메시지 참조 저장 실패: ${e.message}`));
}

module.exports = async (app) => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  // 매칭생성 플랜/컨셉 데이터는 matchCache(인메모리 Map + Redis 백스토어)로 관리 →
  // 봇 재시작 후에도 플랜 버튼이 살아있다. (Redis 연결은 best-effort)
  redisClient.connect();
  const pickUsersData = new Map();
  const honorVoteSessions = new Map();
  const matchVoteSessions = new Map(); // 매칭 투표 세션

  // matchVoteMode: 'off' | 'normal' | 'blind'
  function getMatchVoteMode(group) {
    const mode = group?.settings?.matchVoteMode;
    if (mode === 'normal' || mode === 'blind') return mode;
    return 'off';
  }

  // 승패 확정 후 MVP(명예) 투표를 시작한다. 수동 버튼 확정과 자동(수집기) 확정이 공유한다.
  async function startHonorVote({ channel, matchData, groupId }) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const team1Data = matchData.team1;
    const team2Data = matchData.team2;
    const category = VOTE_CATEGORIES[Math.floor(Math.random() * VOTE_CATEGORIES.length)];
    const voteSession = {
      gameId: matchData.gameId,
      groupId,
      team1: team1Data.map((p) => ({ puuid: p[0], name: p[1] })),
      team2: team2Data.map((p) => ({ puuid: p[0], name: p[1] })),
      voters: new Set(),
      category,
    };
    honorVoteSessions.set(matchData.gameId, voteSession);

    const honorButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`honorVoteStart|${matchData.gameId}`)
        .setLabel(`${category.emoji} ${category.label} 투표하기`)
        .setStyle(ButtonStyle.Primary),
    );

    const honorMessage = await channel.send({
      content: `**[MVP 투표]**\n**${category.emoji} ${category.label}** - ${category.question}\n💡 전원 투표 시 참가자 모두 명예 +1 보너스!\n0명 투표했습니다! (0/${team1Data.length + team2Data.length})`,
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
          await honorMessage.edit({ content: formatHonorResults(results, session), components: [] });
        } catch (e) {
          logger.error(e);
        }
      }
    }, 12 * 60 * 60 * 1000);

    return honorMessage;
  }

  // 수집기(elise)가 올린 게임이 내전 match와 매핑되면, 사용자가 승패 버튼을 누른 것과 동일하게
  // 서버에서 자동으로 승패를 확정한다: 레이팅 반영 + 버튼 교체 + 승리 메시지 + 업적 알림 + 명예 투표.
  // - 이미 확정된 매치(수동/자동)는 건드리지 않는다. (winTeam != null → skip)
  // - 승패 메시지 참조(discordChannelId/MessageId)가 없거나 메시지가 사라졌으면 확정하지 않는다.
  async function autoConfirmMatchWin({ gameId, winTeam }) {
    if (winTeam !== 1 && winTeam !== 2) return { skip: 'badwin' };

    const match = await models.match.findOne({ where: { gameId } });
    if (!match) return { skip: 'notfound' };
    if (match.winTeam != null) return { skip: 'already' };
    if (!match.discordChannelId || !match.discordMessageId) return { skip: 'nomsg' };

    // Discord 메시지를 갱신할 수 있을 때만 레이팅을 반영한다 (레이팅과 메시지 상태 불일치 방지)
    const channel = await client.channels.fetch(match.discordChannelId).catch(() => null);
    const message = channel ? await channel.messages.fetch(match.discordMessageId).catch(() => null) : null;
    if (!message) return { skip: 'msggone' };

    const locked = await withLock(gameId, async () => {
      const fresh = await models.match.findOne({ where: { gameId } });
      if (!fresh || fresh.winTeam != null) return { alreadyConfirmed: true };
      await fresh.update({ winTeam });
      const matchResult = await matchController.applyMatchResult(gameId, null);
      return { matchData: fresh, matchResult, alreadyConfirmed: false };
    });
    if (locked.alreadyConfirmed) return { skip: 'already' };

    const { matchData, matchResult } = locked;

    auditLog
      .log({
        groupId: matchData.groupId,
        actorDiscordId: null,
        actorName: 'auto(collector)',
        action: 'match.confirm',
        details: { gameId, winTeam, previousWinTeam: null, source: 'collector' },
        source: 'api',
      })
      .catch((e) => logger.error('감사 로그 오류:', e));

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const teamEmoji = winTeam === 1 ? '🐶' : '🐱';

    // 승/패 버튼을 "승/패 변경하기"로 교체 (수동 확정과 동일)
    const changeButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`changeWinCommand|${gameId}`)
        .setLabel('승/패 변경하기')
        .setStyle(ButtonStyle.Secondary),
    );
    await message.edit({ components: [changeButton] });
    await channel.send(
      `${teamEmoji}팀이 **승리**하였습니다! 레이팅에 반영 되었습니다.\n(🤖 수집 프로그램 자동 확정)`,
    );

    // 업적 달성 알림
    if (matchResult.newAchievements?.length > 0) {
      const { sendAchievementNotification } = require('../services/achievement/notifier');
      sendAchievementNotification(channel, matchResult.newAchievements, matchData.groupId).catch((e) =>
        logger.error('업적 알림 오류:', e),
      );
    }

    // 명예 투표 시작
    await startHonorVote({ channel, matchData, groupId: matchData.groupId });

    return { confirmed: true, gameId, winTeam };
  }

  // 수집기 라우트/스케줄러가 호출할 수 있도록 노출
  app.autoConfirmMatchWin = autoConfirmMatchWin;

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
            await matchCache.setMatch(`${groupName}/${output.time}/${i}`, output.match[i]);
          }
          // 컨셉 매칭용 데이터 저장
          if (output.allMatches && output.ratingCache) {
            await matchCache.setConcept(`${groupName}/${output.time}`, {
              allMatches: output.allMatches,
              ratingCache: output.ratingCache,
              groupName,
            });
          }
          // 투표 모드 확인 및 세션 생성
          const group = await models.group.findOne({ where: { groupName } });
          const voteMode = getMatchVoteMode(group);
          if (voteMode !== 'off') {
            // 참가자 discordId 수집 (ratingCache에서)
            const participantDiscordIds = new Set();
            if (output.ratingCache) {
              Object.values(output.ratingCache).forEach((info) => {
                if (info.discordId) participantDiscordIds.add(info.discordId);
              });
            }
            matchVoteSessions.set(`${groupName}/${output.time}`,
              new MatchVoteSession(participantDiscordIds, output.match.length, { blind: voteMode === 'blind' }),
            );
          }

          // 포지션 정하기 진입 버튼 (입력 멤버 기반 포지션 설정 UI로 연결)
          if (output.components && output.pickedUsers) {
            const timeKey = String(output.time);
            pickUsersData.set(timeKey, {
              pickedUsers: output.pickedUsers,
              pickedMembersData: output.pickedUsers.map((name) => ({ discordId: null, lolNickname: name })),
            });
            output.components.push(
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`pickUsers|${timeKey}|position`)
                  .setLabel('🎯 포지션 정하기')
                  .setStyle(ButtonStyle.Success),
              ),
            );
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
              isTestMode: !!output.isTestMode,
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

  // 자동완성용 등록 유저 이름 캐시 (guildId → { names, expires }) — 키 입력마다 쿼리하지 않도록
  const autocompleteCache = new Map();
  const AUTOCOMPLETE_CACHE_TTL = 90 * 1000;

  // 슬래시 명령어 자동완성 (매칭생성 유저 옵션 — 등록 + 디코 연동 유저만 제안)
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isAutocomplete()) return;

    try {
      const commandList = await commandListLoader();
      const command = commandList.get(interaction.commandName);
      if (!command || command.conf.aliases[0] !== '매칭생성') return;

      let cached = autocompleteCache.get(interaction.guildId);
      if (!cached || cached.expires < Date.now()) {
        const group = await models.group.findOne({ where: { discordGuildId: interaction.guildId } });
        if (!group) {
          await interaction.respond([]);
          return;
        }

        const users = await models.user.findAll({
          where: { groupId: group.id, primaryPuuid: null, discordId: { [Op.ne]: null } },
          attributes: ['puuid'],
        });
        const summoners = await models.summoner.findAll({
          where: { puuid: users.map((u) => u.puuid) },
          attributes: ['name'],
        });

        cached = {
          names: summoners
            .map((s) => ({ name: s.name, lower: s.name.toLowerCase() }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
          expires: Date.now() + AUTOCOMPLETE_CACHE_TTL,
        };
        autocompleteCache.set(interaction.guildId, cached);
      }

      // 다른 칸에 이미 입력된 유저는 제안에서 제외 (@접미사는 내부 문법이라 이름부만 비교)
      const focused = interaction.options.getFocused(true);
      const taken = new Set(
        interaction.options.data
          .filter((o) => o.name !== focused.name && o.value)
          .map((o) => String(o.value).split('@')[0]),
      );

      const query = String(focused.value || '').trim().toLowerCase();
      const names = cached.names
        .filter((e) => !taken.has(e.name) && (!query || e.lower.includes(query)))
        .slice(0, 25)
        .map((e) => e.name);

      await interaction.respond(names.map((name) => ({ name: name.slice(0, 100), value: name.slice(0, 100) })));
    } catch (e) {
      logger.error('자동완성 처리 오류:', e);
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

      // 온보딩 버튼 핸들러
      if (split[0] === 'onboard' || split[0] === 'onboardTest') {
        await handleOnboardButton(interaction);
        return;
      }

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
              isTestMode: !!data.isTestMode,
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
                await matchCache.setMatch(`${output.groupName}/${output.time}/concept_${i}`, output.conceptMatches[i]);
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
                    await matchCache.setMatch(`${group.groupName}/${output.time}/${i}`, output.match[i]);
                  }
                  // 컨셉 매칭용 데이터 저장
                  if (output.allMatches && output.ratingCache) {
                    await matchCache.setConcept(`${group.groupName}/${output.time}`, {
                      allMatches: output.allMatches,
                      ratingCache: output.ratingCache,
                      groupName: group.groupName,
                    });
                  }
                  // 투표 모드 세션 생성 (테스트_인원뽑기에서 온 거면 건너뜀)
                  const conceptVoteMode = getMatchVoteMode(group);
                  if (conceptVoteMode !== 'off' && !data.isTestMode) {
                    const participantDiscordIds = new Set();
                    if (output.ratingCache) {
                      Object.values(output.ratingCache).forEach((info) => {
                        if (info.discordId) participantDiscordIds.add(info.discordId);
                      });
                    }
                    matchVoteSessions.set(`${group.groupName}/${output.time}`,
                      new MatchVoteSession(participantDiscordIds, output.match.length, { blind: conceptVoteMode === 'blind' }),
                    );
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

        // DB에 매치 생성 (배정 포지션을 Riot 표준으로 정규화해 함께 저장)
        const { normalizeToRiotPosition } = require('../utils/tierUtils');
        const teamsForDB = [[], []];
        for (const assignment of po.teamA.assignments) {
          const playerData = playerDataMap[assignment.playerName];
          teamsForDB[0].push([playerData.puuid, assignment.playerName, normalizeToRiotPosition(assignment.position)]);
        }
        for (const assignment of po.teamB.assignments) {
          const playerData = playerDataMap[assignment.playerName];
          teamsForDB[1].push([playerData.puuid, assignment.playerName, normalizeToRiotPosition(assignment.position)]);
        }

        const matchQueryResult = await matchController.createMatchWithSnapshot({
          groupId,
          team1: teamsForDB[0],
          team2: teamsForDB[1],
        });

        // 결과 메시지
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
        const { formatTierBadge, formatAvgTierBadge, POSITION_ABBR } = require('../utils/tierUtils');

        const typeEmoji = { MAIN: '🟢', SUB: '🟡', OFF: '🔴' };

        const formatTeam = (teamResult) => {
          let totalRating = 0;
          const lines = teamResult.assignments.map((a) => {
            const playerData = playerDataMap[a.playerName];
            const rating = playerData?.rating || 500;
            totalRating += rating;
            return `${typeEmoji[a.assignmentType]}\`${formatTierBadge(rating)}[${POSITION_ABBR[a.position]}]${a.playerName}\``;
          });
          const avgRating = totalRating / 5;
          return { lines: lines.join('\n'), avgRating };
        };

        const team1Result = formatTeam(po.teamA);
        const team2Result = formatTeam(po.teamB);

        const embed = new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('🧪 포지션 매칭 확정!')
          .setDescription(
            `**[${interaction.member.nickname}]**님이 Plan ${index + 1}을 선택했습니다.\n🟢 메인 / 🟡 서브 / 🔴 오프`,
          )
          .addFields(
            {
              name: `🐶 1팀 (${(selectedMatch.team1WinRate * 100).toFixed(1)}%) ${formatAvgTierBadge(
                team1Result.avgRating,
              )}`,
              value: team1Result.lines,
              inline: true,
            },
            {
              name: `🐱 2팀 (${((1 - selectedMatch.team1WinRate) * 100).toFixed(1)}%) ${formatAvgTierBadge(
                team2Result.avgRating,
              )}`,
              value: team2Result.lines,
              inline: true,
            },
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
        const winMessage = await interaction.followUp({ embeds: [embed], components: [buttons] });

        // 수집기 자동 승패확정이 이 메시지를 갱신할 수 있도록 위치를 저장
        await trackMatchMessage(winMessage, matchQueryResult.gameId);

        return;
      }

      // posTeamEdit 버튼 (팀 일괄 입력 모달 — 멀티셀렉트 1개로 1팀 인원 선택)
      if (split[0] === 'posTeamEdit') {
        const timeKey = split[1];
        const data = pickUsersData.get(timeKey);

        if (!data) {
          await interaction.reply({ content: '데이터가 만료되었습니다. 다시 인원뽑기를 해주세요.', ephemeral: true });
          return;
        }

        const { ModalBuilder, StringSelectMenuBuilder, LabelBuilder } = require('discord.js');
        const pickUsersCommand = commandList.get('인원뽑기');
        const teamSize = Math.floor(data.pickedUsers.length / 2);

        const select = new StringSelectMenuBuilder()
          .setCustomId('team1')
          .setMinValues(teamSize)
          .setMaxValues(teamSize)
          .addOptions(pickUsersCommand.buildTeamSelectOptions(data.pickedUsers, data.positionData, teamSize));
        const label = new LabelBuilder()
          .setLabel(`🔵 1팀에 넣을 ${teamSize}명 선택 (나머지 2팀)`.slice(0, 45))
          .setStringSelectMenuComponent(select);

        const modal = new ModalBuilder()
          .setCustomId(`posTeamModal|${timeKey}`)
          .setTitle('팀 일괄 입력')
          .addComponents(label);

        await interaction.showModal(modal);
        return;
      }

      // posPosEdit 버튼 (포지션 입력 모달 — 포지션별 5칸, 한 모달)
      if (split[0] === 'posPosEdit') {
        const timeKey = split[1];
        const data = pickUsersData.get(timeKey);

        if (!data) {
          await interaction.reply({ content: '데이터가 만료되었습니다. 다시 인원뽑기를 해주세요.', ephemeral: true });
          return;
        }

        const { ModalBuilder, StringSelectMenuBuilder, LabelBuilder } = require('discord.js');
        const pickUsersCommand = commandList.get('인원뽑기');
        const LANES = ['탑', '정글', '미드', '원딜', '서폿'];
        const maxPerLane = Math.min(2, data.pickedUsers.length);

        const modal = new ModalBuilder()
          .setCustomId(`posPosModal|${timeKey}`)
          .setTitle('포지션 입력');

        LANES.forEach((lane) => {
          // 재시도 시엔 직전에 고른 값(laneDraft)을, 아니면 현재 배정을 prefill
          const selected = (data.laneDraft && data.laneDraft[lane])
            || pickUsersCommand.laneDefaults(data.pickedUsers, data.positionData, lane);
          const select = new StringSelectMenuBuilder()
            .setCustomId(`lane_${lane}`)
            .setMinValues(0)
            .setMaxValues(maxPerLane)
            .setRequired(false) // min 0 허용하려면 required=false 필요 (모달 컴포넌트 기본 required)
            .addOptions(pickUsersCommand.buildLaneOptions(data.pickedUsers, selected));
          const label = new LabelBuilder()
            .setLabel(`${POSITION_EMOJI[lane]} ${lane} (최대 2명)`)
            .setStringSelectMenuComponent(select);
          modal.addComponents(label);
        });

        // draft는 1회성 — 모달 열면서 소비
        if (data.laneDraft) {
          delete data.laneDraft;
          pickUsersData.set(timeKey, data);
        }

        await interaction.showModal(modal);
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
        const { normalizeToRiotPosition } = require('../utils/tierUtils');
        const fakeOptions = [];
        const positionMap = {}; // 소환사명 → 수동 지정 배정 포지션(Riot 표준), 매치 저장용
        for (let index = 0; index < data.pickedUsers.length; index++) {
          const parsedNickname = data.pickedUsers[index];
          const memberData = data.pickedMembersData ? data.pickedMembersData[index] : null;
          let actualName = parsedNickname;

          // discordId가 있으면 DB에서 실제 소환사 이름 조회 (본캐 우선)
          if (memberData && memberData.discordId) {
            const userData = await models.user.findOne({
              where: { groupId: group.id, discordId: memberData.discordId, primaryPuuid: null },
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
          positionMap[actualName] = normalizeToRiotPosition(pData.position);
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
            // 수동 지정 포지션을 플랜에 첨부 → reactButton 기록 시 매치에 저장됨
            result.match[i].positionMap = positionMap;
            await matchCache.setMatch(`${group.groupName}/${result.time}/${i}`, result.match[i]);
          }
          // 컨셉 매칭용 데이터 저장
          if (result.allMatches && result.ratingCache) {
            await matchCache.setConcept(`${group.groupName}/${result.time}`, {
              allMatches: result.allMatches,
              ratingCache: result.ratingCache,
              groupName: group.groupName,
            });
          }
          // 투표 모드 세션 생성 (테스트_인원뽑기에서 온 거면 건너뜀)
          const pickVoteMode = getMatchVoteMode(group);
          if (pickVoteMode !== 'off' && !data.isTestMode) {
            const participantDiscordIds = new Set();
            if (result.ratingCache) {
              Object.values(result.ratingCache).forEach((info) => {
                if (info.discordId) participantDiscordIds.add(info.discordId);
              });
            }
            matchVoteSessions.set(`${group.groupName}/${result.time}`,
              new MatchVoteSession(participantDiscordIds, result.match.length, { blind: pickVoteMode === 'blind' }),
            );
          }
        }

        await interaction.update({ components: [] });
        await interaction.followUp(result);
        return;
      }

      // cancelMatch 버튼 체크 (승/패 취소)
      if (split[0] === 'cancelMatch') {
        const gameId = Number(split[1]);

        // 승패확정과 같은 gameId 락으로 직렬화 (확정/취소 동시 실행 시 레이팅 꼬임 방지)
        const locked = await withLock(gameId, async () => {
          const matchData = await models.match.findOne({ where: { gameId } });
          if (!matchData) return { error: 'notfound' };
          const previousWinTeam = matchData.winTeam;
          if (!previousWinTeam) return { error: 'notset' };

          // 투표 세션 및 DB 데이터 삭제
          honorVoteSessions.delete(gameId);
          await Promise.all([honorController.deleteVotesByGameId(gameId), matchData.update({ winTeam: null })]);
          await matchController.applyMatchResult(gameId, previousWinTeam);
          return { previousWinTeam };
        });

        if (locked.error === 'notfound') {
          await interaction.reply({ content: '매치 데이터를 찾을 수 없습니다.', ephemeral: true });
          return;
        }
        if (locked.error === 'notset') {
          await interaction.reply({ content: '이미 승/패가 설정되지 않은 상태입니다.', ephemeral: true });
          return;
        }
        const previousWinTeam = locked.previousWinTeam;

        const group = await models.group.findOne({ where: { discordGuildId: interaction.guildId } });
        auditLog
          .log({
            groupId: group?.id,
            actorDiscordId: interaction.user.id,
            actorName: interaction.member.nickname,
            action: 'match.cancel',
            details: { gameId, previousWinTeam },
            source: 'discord',
          })
          .catch((e) => logger.error('감사 로그 오류:', e));

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
        // 채널 생성/이동이 3초를 넘기면 인터랙션 토큰이 만료되므로 먼저 defer
        await interaction.deferReply({ ephemeral: true });

        const gameId = Number(split[1]);
        const matchData = await models.match.findOne({ where: { gameId } });
        if (!matchData) {
          await interaction.editReply({ content: '매치 데이터를 찾을 수 없습니다.' });
          return;
        }

        const freshMember = await interaction.guild.members.fetch(interaction.user.id);
        const voiceChannel = freshMember.voice ? freshMember.voice.channel : null;
        if (!voiceChannel) {
          await interaction.editReply({ content: '음성 채널에 접속한 상태에서 눌러주세요.' });
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
            users.forEach((u) => {
              userMap[u.puuid] = u.discordId || null;
            });
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
          await interaction.editReply({ content: '🔊 팀 보이스 채널로 이동했습니다!' });
        } catch (e) {
          logger.error('팀 채널 생성/이동 오류:', e);
          await interaction.editReply({ content: '보이스 채널 이동 중 오류가 발생했습니다.' });
        }
        return;
      }

      // winCommand 버튼 체크
      if (split[0] === 'winCommand') {
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const group = await models.group.findOne({
          where: { discordGuildId: interaction.guildId },
        });
        const gameId = Number(split[1]);
        const winTeam = Number(split[2]);

        // 같은 매치 동시 확정(더블클릭) 시 read-modify-write 인터리브로 레이팅이 유실되던 문제 방지:
        // gameId 단위로 직렬화하고, 이미 같은 결과로 확정돼 있으면 재적용하지 않는다.
        const locked = await withLock(gameId, async () => {
          const matchData = await models.match.findOne({ where: { gameId } });
          const previousWinTeam = matchData.winTeam; // 이전 승리팀 저장 (되돌리기용)
          if (previousWinTeam === winTeam) {
            return { matchData, previousWinTeam, alreadyConfirmed: true };
          }
          await matchData.update({ winTeam });
          const matchResult = await matchController.applyMatchResult(matchData.gameId, previousWinTeam);
          return { matchData, previousWinTeam, matchResult, alreadyConfirmed: false };
        });

        if (locked.alreadyConfirmed) {
          await interaction.reply({ content: '이미 처리된 매치입니다.', ephemeral: true });
          return;
        }

        const { matchData, previousWinTeam, matchResult } = locked;
        const teamEmoji = winTeam == 1 ? '🐶' : '🐱';

        auditLog
          .log({
            groupId: group.id,
            actorDiscordId: interaction.user.id,
            actorName: interaction.member.nickname,
            action: 'match.confirm',
            details: { gameId: matchData.gameId, winTeam, previousWinTeam },
            source: 'discord',
          })
          .catch((e) => logger.error('감사 로그 오류:', e));

        // 업적 달성 알림
        if (matchResult.newAchievements?.length > 0) {
          const { sendAchievementNotification } = require('../services/achievement/notifier');
          sendAchievementNotification(interaction.channel, matchResult.newAchievements, matchData.groupId).catch((e) =>
            logger.error('업적 알림 오류:', e),
          );
        }

        // 승/패 버튼을 "승/패 변경하기" 버튼으로 교체
        const changeButton = new ActionRowBuilder().addComponents(
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

        // 명예 투표 시작 (수동/자동 확정 공용)
        await startHonorVote({ channel: interaction.channel, matchData, groupId: group.id });

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

        // 투표자 식별 (매치는 본캐 puuid로 진행되므로 본캐 우선)
        const voterUser = await models.user.findOne({
          where: { groupId: session.groupId, discordId: interaction.user.id, primaryPuuid: null },
        });

        if (!voterUser) {
          await interaction.reply({ content: '등록되지 않은 사용자입니다.', ephemeral: true });
          return;
        }

        const voterPuuid = voterUser.puuid;

        // 매치 참가자인지 확인
        const inTeam1 = session.team1.find((p) => p.puuid === voterPuuid);
        const inTeam2 = session.team2.find((p) => p.puuid === voterPuuid);

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
        const teammates = myTeam.filter((p) => p.puuid !== voterPuuid);

        const selectMenu = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`honorVote|${gameId}|${myTeamNumber}`)
            .setPlaceholder(session.category.question)
            .addOptions(teammates.map((p) => new StringSelectMenuOptionBuilder().setLabel(p.name).setValue(p.puuid))),
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
          const data = await matchCache.getConcept(`${groupName}/${time}`);
          if (!data) {
            await interaction.reply({
              content: '매칭 데이터가 만료되었습니다. 다시 매칭생성을 해주세요.',
              ephemeral: true,
            });
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
              await matchCache.setMatch(`${groupName}/${time}/concept_${i}`, output.conceptMatches[i]);
            }
            await interaction.update({ embeds: output.embeds, components: output.components });
            return;
          }
        }

        const match = await matchCache.getMatch(interaction.customId);
        if (match) {
          const customSplit = interaction.customId.split('/');
          const sessionKey = `${customSplit[0]}/${customSplit[1]}`;
          const planIndex = customSplit[2];
          const voteSession = matchVoteSessions.get(sessionKey);

          // 투표 모드
          if (voteSession) {
            // 이미 확정된 플랜이 있으면 해당 플랜 버튼은 즉시 매치 생성
            if (voteSession.confirmedPlan !== undefined) {
              if (planIndex !== voteSession.confirmedPlan) {
                await interaction.reply({ content: '비활성화된 플랜입니다.', ephemeral: true });
                return;
              }
              const matchMakeCommand = commandList.get('매칭생성');
              if (matchMakeCommand) {
                const output = await matchMakeCommand.reactButton(interaction, match);
                if (output) {
                  await interaction.reply(output);
                  await trackMatchMessage(await interaction.fetchReply(), output.gameId);
                }
              }
              return;
            }

            const userId = interaction.user.id;
            const voteResult = voteSession.addVote(userId, planIndex);

            if (!voteResult.success) {
              const errorMessages = {
                not_participant: '매칭 참가자만 투표할 수 있습니다.',
                already_voted: '이미 투표했습니다.',
                already_confirmed: '이미 투표가 확정되었습니다.',
              };
              await interaction.reply({ content: errorMessages[voteResult.error], ephemeral: true });
              return;
            }

            const status = voteResult.status;

            // 투표 현황 텍스트
            let statusText;
            if (voteSession.blind) {
              const bar = '█'.repeat(status.totalVoted) + '░'.repeat(Math.max(0, status.totalParticipants - status.totalVoted));
              statusText = `**📊 매칭 투표 (${status.totalVoted}/${status.totalParticipants})**\n🔒 투표 현황: ${bar}\n결과는 확정 후 공개됩니다.`;
            } else {
              const statusLines = [];
              for (let i = 0; i < voteSession.totalPlans; i++) {
                const count = status.voteCounts[String(i)] || 0;
                const barMax = status.totalParticipants;
                const bar = '█'.repeat(count) + '░'.repeat(Math.max(0, barMax - count));
                statusLines.push(`${i + 1}번: ${bar} ${count}표`);
              }
              statusText = `**📊 매칭 투표 (${status.totalVoted}/${status.totalParticipants})**\n${statusLines.join(
                '\n',
              )}`;
            }

            if (voteResult.confirmed) {
              const leadPlan = voteResult.confirmedPlan;
              const winnerMatch = await matchCache.getMatch(`${sessionKey}/${leadPlan}`);
              const matchMakeCommand = commandList.get('매칭생성');
              if (matchMakeCommand && winnerMatch) {
                interaction.customId = `${sessionKey}/${leadPlan}`;
                const output = await matchMakeCommand.reactButton(interaction, winnerMatch);
                if (output) {
                  // 확정된 플랜만 active, 나머지 disabled
                  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                  const newRows = [];
                  const origComponents = interaction.message.components;
                  for (const row of origComponents) {
                    const newRow = new ActionRowBuilder();
                    for (const btn of row.components) {
                      const btnSplit = btn.customId.split('/');
                      const btnPlanIndex = btnSplit[2];
                      newRow.addComponents(
                        new ButtonBuilder()
                          .setCustomId(btn.customId)
                          .setLabel(btn.label)
                          .setStyle(btnPlanIndex === leadPlan ? ButtonStyle.Success : ButtonStyle.Secondary)
                          .setDisabled(btnPlanIndex !== leadPlan),
                      );
                    }
                    newRows.push(newRow);
                  }

                  // 원본 메시지 버튼 업데이트
                  await interaction.update({ components: newRows });

                  // 확정 시에는 블라인드 여부 관계없이 플랜별 결과 공개
                  const finalLines = [];
                  for (let i = 0; i < voteSession.totalPlans; i++) {
                    const cnt = status.voteCounts[String(i)] || 0;
                    const barMax = status.totalParticipants;
                    const b = '█'.repeat(cnt) + '░'.repeat(Math.max(0, barMax - cnt));
                    finalLines.push(`${i + 1}번: ${b} ${cnt}표`);
                  }
                  const finalStatusText = `**📊 매칭 투표 (${status.totalVoted}/${status.totalParticipants})**\n${finalLines.join('\n')}`;
                  const finalText = `${finalStatusText}\n\n✅ **${Number(leadPlan) +
                    1}번이 확정되었습니다! 버튼을 다시 눌러 매치를 추가 생성할 수 있습니다.**`;
                  if (voteSession.statusMessage) {
                    await voteSession.statusMessage.edit(finalText);
                  } else {
                    await interaction.followUp(finalText);
                  }
                  const sentMatchMsg = await interaction.followUp(output);
                  await trackMatchMessage(sentMatchMsg, output.gameId);
                }
              }
              return;
            }

            // 투표 현황 메시지: 첫 투표 시 새 메시지, 이후 edit
            await interaction.deferUpdate();
            if (voteSession.statusMessage) {
              await voteSession.statusMessage.edit(statusText);
            } else {
              voteSession.statusMessage = await interaction.followUp(statusText);
            }
            return;
          }

          // 즉시 선택 모드 (기존)
          const matchMakeCommand = commandList.get('매칭생성');
          if (matchMakeCommand) {
            const output = await matchMakeCommand.reactButton(interaction, match);
            if (output) {
              await interaction.reply(output);
              await trackMatchMessage(await interaction.fetchReply(), output.gameId);
            }
            return;
          }
        } else {
          await interaction.reply({
            content: '매칭 데이터가 만료되었습니다. 다시 매칭생성을 해주세요.',
            ephemeral: true,
          });
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

    try {
      const split = interaction.customId.split('|');

      // 온보딩 SelectMenu 핸들러
      if (split[0] === 'onboard' || split[0] === 'onboardTest') {
        await handleOnboardSelectMenu(interaction);
        return;
      }

      const commandList = await commandListLoader();

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

        // 투표자 식별 (매치는 본캐 puuid로 진행되므로 본캐 우선)
        const voterUser = await models.user.findOne({
          where: { groupId: session.groupId, discordId: interaction.user.id, primaryPuuid: null },
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
          const targetPlayer = [...session.team1, ...session.team2].find((p) => p.puuid === selectedPuuid);
          const targetName = (targetPlayer && targetPlayer.name) || '알 수 없음';
          await interaction.update({ content: `✅ **${targetName}**에게 투표 완료!`, components: [] });

          // 투표 현황 갱신
          if (session.honorMessage) {
            const allPlayers = [...session.team1, ...session.team2];
            if (session.voters.size >= allPlayers.length) {
              // 전원 투표 보너스 지급
              await honorController.grantFullVoteBonus(gameId, session.groupId, allPlayers);
              honorVoteSessions.delete(gameId);
            }
            const results = await honorController.getVoteResults(gameId);
            await session.honorMessage.edit({
              content: formatHonorResults(results, session),
              components: session.voters.size >= allPlayers.length ? [] : undefined,
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
          components: [],
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
          components: [],
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
              where: {
                discordId: memberId,
                guildId,
                [Op.or]: [{ lastLeftAt: null }, { lastLeftAt: { [Op.lt]: models.sequelize.col('lastJoinedAt') } }],
              },
            });
            if (activity && activity.lastJoinedAt) {
              const now = new Date();
              // 비정상적으로 오래된 세션은 최대 7일까지만 처리
              const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
              const joinedAt = new Date(
                Math.max(new Date(activity.lastJoinedAt).getTime(), now.getTime() - MAX_DURATION_MS),
              );
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
              await Promise.all(
                dailyDurations.map(({ date, duration }) =>
                  models.sequelize.query(
                    `INSERT INTO voice_activity_dailies (discordId, guildId, date, duration, createdAt, updatedAt)
                   VALUES (:discordId, :guildId, :date, :duration, NOW(), NOW())
                   ON DUPLICATE KEY UPDATE duration = duration + :duration, updatedAt = NOW()`,
                    { replacements: { discordId: memberId, guildId, date, duration } },
                  ),
                ),
              );
              await activity.update({ lastLeftAt: now });

              // 보이스 업적 체크 (알림 없이 달성만 기록, 본캐에 누적)
              const group = await models.group.findOne({ where: { discordGuildId: guildId } });
              if (group) {
                const user = await models.user.findOne({
                  where: { groupId: group.id, discordId: memberId, primaryPuuid: null },
                });
                if (user) {
                  // 밤새기: 단일 세션 12시간 이상이면 stat 증가
                  const sessionMs = now.getTime() - new Date(activity.lastJoinedAt).getTime();
                  if (sessionMs >= 12 * 60 * 60 * 1000) {
                    const { STAT_TYPES } = require('../services/achievement/definitions');
                    const statsRepo = require('../services/achievement/stats');
                    await statsRepo.incrementStat(user.puuid, group.id, STAT_TYPES.NIGHT_OWL_SESSIONS);
                  }

                  const { processAchievements } = require('../services/achievement/engine');
                  await processAchievements('voice_leave', {
                    groupId: group.id,
                    userMap: { [user.puuid]: user },
                  });
                }
              }
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
          let nextCount = 1;
          if (generator.defaultName.includes('{count}')) {
            const escaped = generator.defaultName
              .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
              .replace('\\{username\\}', '.*')
              .replace('\\{count\\}', '(\\d+)');
            const pattern = new RegExp(`^${escaped}$`);
            const usedNumbers = new Set();
            const categoryChannels = guild.channels.cache.filter(
              (ch) => ch.type === ChannelType.GuildVoice && ch.parentId === (generator.categoryId || null),
            );
            categoryChannels.forEach((ch) => {
              const match = ch.name.match(pattern);
              if (match) usedNumbers.add(Number(match[1]));
            });
            while (usedNumbers.has(nextCount)) nextCount += 1;
          }
          const channelName = generator.defaultName
            .replace('{username}', member.displayName)
            .replace('{count}', nextCount);

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

          // 채널 개척자 업적: stat 증가 + 체크 (본캐에 누적)
          try {
            const ownerUser = await models.user.findOne({
              where: { groupId: generator.groupId, discordId: member.id, primaryPuuid: null },
            });
            if (ownerUser) {
              const { STAT_TYPES } = require('../services/achievement/definitions');
              const statsRepo = require('../services/achievement/stats');
              const { processAchievements } = require('../services/achievement/engine');
              await statsRepo.incrementStat(ownerUser.puuid, generator.groupId, STAT_TYPES.TEMP_VOICE_CREATED);
              await processAchievements('temp_voice_created', {
                groupId: generator.groupId,
                userMap: { [ownerUser.puuid]: ownerUser },
              });
            }
          } catch (e) {
            logger.error('채널 개척자 업적 처리 오류:', e);
          }

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

  // 온보딩 Modal 제출 핸들러
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;

    try {
      const split = interaction.customId.split('|');
      if (split[0] === 'onboard' || split[0] === 'onboardTest') {
        await handleOnboardModalSubmit(interaction, client);
        return;
      }

      // posTeamModal 제출 (팀 일괄 입력)
      if (split[0] === 'posTeamModal') {
        const timeKey = split[1];
        const data = pickUsersData.get(timeKey);

        if (!data) {
          await interaction.reply({ content: '데이터가 만료되었습니다. 다시 인원뽑기를 해주세요.', ephemeral: true });
          return;
        }

        const selected = interaction.fields.getStringSelectValues('team1');
        const commandList = await commandListLoader();
        const pickUsersCommand = commandList.get('인원뽑기');
        pickUsersCommand.applyTeamSelection(data.positionData, data.pickedUsers, selected);
        pickUsersData.set(timeKey, data);

        const mainUI = pickUsersCommand.buildPositionUI(data.pickedUsers, data.positionData, timeKey);
        if (data.mainMessage) {
          await data.mainMessage.edit(mainUI);
          await interaction.reply({ content: '✅ 팀을 반영했습니다.', ephemeral: true });
        } else {
          await interaction.update(mainUI);
        }
        return;
      }

      // posPosModal 제출 (포지션 입력 — 포지션별 5칸)
      if (split[0] === 'posPosModal') {
        const timeKey = split[1];
        const data = pickUsersData.get(timeKey);

        if (!data) {
          await interaction.reply({ content: '데이터가 만료되었습니다. 다시 인원뽑기를 해주세요.', ephemeral: true });
          return;
        }

        const LANES = ['탑', '정글', '미드', '원딜', '서폿'];
        const laneValues = {};
        LANES.forEach((lane) => {
          laneValues[lane] = interaction.fields.getStringSelectValues(`lane_${lane}`) || [];
        });

        const commandList = await commandListLoader();
        const pickUsersCommand = commandList.get('인원뽑기');

        // 같은 사람이 두 포지션에 든 충돌 검사 (모달은 실시간 차단 불가 → 제출 시 잡음)
        const conflict = pickUsersCommand.findLaneConflict(data.pickedUsers, laneValues);
        if (conflict) {
          data.laneDraft = laneValues; // 고른 값 보존
          pickUsersData.set(timeKey, data);
          const retryRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`posPosEdit|${timeKey}`)
              .setLabel('다시 입력')
              .setStyle(ButtonStyle.Primary),
          );
          await interaction.reply({
            content: `⚠️ **${conflict.nickname}**님이 ${conflict.lanes.join('·')}에 중복 배정됐습니다. 한 명은 한 포지션만 가능합니다. 다시 입력해주세요. (고른 값은 유지됩니다)`,
            components: [retryRow],
            ephemeral: true,
          });
          return;
        }

        pickUsersCommand.applyLaneSelection(data.positionData, data.pickedUsers, laneValues);
        delete data.laneDraft;
        pickUsersData.set(timeKey, data);

        const mainUI = pickUsersCommand.buildPositionUI(data.pickedUsers, data.positionData, timeKey);
        if (data.mainMessage) {
          await data.mainMessage.edit(mainUI);
          await interaction.reply({ content: '✅ 포지션을 반영했습니다.', ephemeral: true });
        } else {
          await interaction.update(mainUI);
        }
        return;
      }

    } catch (e) {
      logger.error('모달 처리 오류:', e);
    }
  });

  // 봇이 새 디스코드 서버에 초대되면 자동으로 그룹 등록 + 명령어 등록
  client.on('guildCreate', async (guild) => {
    try {
      const existing = await models.group.findOne({ where: { discordGuildId: guild.id } });
      if (existing) {
        logger.info(`봇 초대: 이미 등록된 서버 [${existing.groupName}] (${guild.id})`);
        return;
      }

      const newGroup = await models.group.create({
        groupName: guild.name,
        discordGuildId: guild.id,
      });
      logger.info(`봇 초대: 새 그룹 [${guild.name}] 자동 등록 (${guild.id})`);

      // 슬래시 명령어 등록
      const commandList = await commandListLoader();
      const commandJsons = commandList.getSlashCommands().map((cmd) => cmd.toJSON());
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
      await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID, guild.id),
        { body: commandJsons },
      );
      logger.info(`봇 초대: [${guild.name}] 슬래시 명령어 등록 완료`);

      // 기본 채널에 온보딩 공지 메시지 발송
      const defaultChannel = guild.systemChannel
        || guild.channels.cache.find(ch => ch.type === ChannelType.GuildText && ch.permissionsFor(guild.members.me).has('SendMessages'));

      if (defaultChannel) {
        const embed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('🎮 ZeroBoom 봇이 등록되었습니다!')
          .setDescription(
            `**${guild.name}** 내전 그룹이 생성되었습니다.\n\n` +
            '내전에 참가하려면 소환사 등록이 필요합니다.\n' +
            '아래 버튼을 눌러 간단한 등록을 진행해주세요!',
          );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`onboard|start|${guild.id}`)
            .setLabel('소환사 등록하기')
            .setEmoji('✏️')
            .setStyle(ButtonStyle.Primary),
        );

        await defaultChannel.send({ embeds: [embed], components: [row] });
        logger.info(`봇 초대: [${guild.name}] 온보딩 공지 메시지 전송`);

        // 폴백 안내가 동일 채널에 게시되도록 공지 채널 ID 저장
        await newGroup.update({
          settings: { ...(newGroup.settings || {}), onboardingChannelId: defaultChannel.id },
        });
      }
    } catch (e) {
      logger.error('봇 초대 자동 등록 오류:', e);
    }
  });

  // 디스코드 서버 탈퇴 감지 — 본캐 + 부캐 일괄 처리
  client.on('guildMemberRemove', async (member) => {
    try {
      const group = await models.group.findOne({ where: { discordGuildId: member.guild.id } });
      if (!group) return;
      const main = await models.user.findOne({
        where: { groupId: group.id, discordId: member.id, primaryPuuid: null },
        attributes: ['puuid'],
      });
      if (!main) return;
      await models.user.update(
        { leftGuildAt: new Date() },
        {
          where: {
            groupId: group.id,
            leftGuildAt: null,
            [Op.or]: [{ puuid: main.puuid }, { primaryPuuid: main.puuid }],
          },
        },
      );

      // 본캐가 admin이면 일반 member로 강등 — 서버에서 나갔으니 관리자 권한 박탈
      const [adminDemoted] = await models.user.update(
        { role: 'member' },
        { where: { groupId: group.id, puuid: main.puuid, role: 'admin' } },
      );
      if (adminDemoted > 0) {
        auditLog.log({
          groupId: group.id,
          actorDiscordId: null,
          actorName: 'system(guildMemberRemove)',
          action: 'user.role_demote_on_leave',
          details: { puuid: main.puuid, discordId: member.id, before: 'admin', after: 'member' },
          source: 'discord',
        });
      }

      logger.info(`서버 탈퇴 감지: ${member.displayName} (${member.id}) - 그룹 ${group.id}${adminDemoted > 0 ? ' (admin 강등)' : ''}`);
    } catch (e) {
      logger.error('서버 탈퇴 처리 오류:', e);
    }
  });

  // 디스코드 서버 가입/재가입 감지 + 온보딩
  client.on('guildMemberAdd', async (member) => {
    try {
      const group = await models.group.findOne({ where: { discordGuildId: member.guild.id } });
      if (!group) return;

      // 기존 본캐가 있으면 본캐+부캐의 leftGuildAt 리셋, 온보딩 생략
      const main = await models.user.findOne({
        where: { groupId: group.id, discordId: member.id, primaryPuuid: null },
        attributes: ['puuid'],
      });
      if (main) {
        await models.user.update(
          { leftGuildAt: null, discordNickname: member.displayName },
          {
            where: {
              groupId: group.id,
              [Op.or]: [{ puuid: main.puuid }, { primaryPuuid: main.puuid }],
            },
          },
        );
        logger.info(`서버 재가입 감지: ${member.displayName} (${member.id}) - 그룹 ${group.id}`);
        return;
      }

      // 온보딩 활성화 확인 (기본값: false, 그룹 설정에서 명시적으로 켜야 동작)
      if (!group.settings?.onboardingEnabled) return;

      // 온보딩 DM 전송 → 실패(DM 차단 등) 시 채널 폴백 안내
      const sent = await startOnboarding(member, group);
      if (!sent) {
        await sendOnboardingFallback(member, group);
      }
    } catch (e) {
      logger.error('서버 가입/온보딩 처리 오류:', e);
    }
  });

  // 역할/권한 변경 감지 → DB admin role 동기화
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
      const group = await models.group.findOne({ where: { discordGuildId: newMember.guild.id } });
      if (!group) return;

      // 닉네임(표시명) 변경 동기화 — DB 캐시(users.discordNickname) 갱신. 멤버 목록이 이 값을 읽는다.
      if (oldMember.displayName !== newMember.displayName) {
        await models.user.update(
          { discordNickname: newMember.displayName },
          { where: { groupId: group.id, discordId: newMember.id } },
        );
      }

      // 역할이 변경되지 않았으면 권한 동기화 스킵
      if (oldMember.roles.cache.size === newMember.roles.cache.size
        && oldMember.roles.cache.every((r) => newMember.roles.cache.has(r.id))) {
        return;
      }

      // 부캐는 항상 member 유지. 본캐 행만 권한 동기화 대상.
      const user = await models.user.findOne({
        where: { groupId: group.id, discordId: newMember.id, primaryPuuid: null },
      });
      if (!user || user.role === 'outsider') return;

      const shouldBeAdmin = isDiscordAdmin(newMember);
      const isAdmin = user.role === 'admin';

      if (shouldBeAdmin && !isAdmin) {
        await models.user.update({ role: 'admin' }, { where: { groupId: group.id, puuid: user.puuid } });
        logger.info(`관리자 권한 부여: ${newMember.displayName} (${newMember.id}) - 그룹 ${group.id}`);
      } else if (!shouldBeAdmin && isAdmin) {
        await models.user.update({ role: 'member' }, { where: { groupId: group.id, puuid: user.puuid } });
        logger.info(`관리자 권한 해제: ${newMember.displayName} (${newMember.id}) - 그룹 ${group.id}`);
      }
    } catch (e) {
      logger.error('역할 변경 처리 오류:', e);
    }
  });

  // 봇 시작 시 DB와 실제 Discord 채널 정합성 확인
  client.once('ready', async () => {
    // 봇 status 에 프론트 URL 노출 (사용자가 프론트 존재를 모르는 문제 완화)
    try {
      const rawUrl = process.env.FRONTEND_URL;
      const frontendDisplay = rawUrl
        ? rawUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')
        : null;
      if (frontendDisplay) {
        client.user.setActivity(`${frontendDisplay} | 전적·프로필`, {
          type: ActivityType.Watching,
        });
      }
    } catch (e) {
      logger.error('봇 status 설정 오류:', e);
    }

    // 커스텀 이모지 초기화
    try {
      await initEmojis(client);
    } catch (e) {
      logger.error('커스텀 이모지 초기화 오류:', e);
    }

    try {
      await tempVoiceController.cleanupOrphanedChannels(client);
      logger.info('임시 음성 채널 정합성 확인 완료');
    } catch (e) {
      logger.error('임시 음성 채널 정합성 확인 오류:', e);
    }

    // 서버 멤버 탈퇴 + 관리자 권한 동기화 (guild.members.fetch 1회로 통합)
    try {
      const groups = await models.group.findAll({ where: { discordGuildId: { [Op.ne]: null } } });
      for (const group of groups) {
        const guild = client.guilds.cache.get(group.discordGuildId);
        if (!guild) continue;

        const members = await guild.members.fetch();

        // 탈퇴/재입장 동기화 — 본캐만 검사하고, 본캐 + 부캐 일괄 처리.
        // 본캐를 한 번에 조회한 뒤 길드 재직 여부 × leftGuildAt 상태로 양방향 분리한다.
        const guildMemberIds = new Set(members.map((m) => m.id));
        const mainUsers = await models.user.findAll({
          where: {
            groupId: group.id,
            discordId: { [Op.ne]: null },
            primaryPuuid: null,
          },
          attributes: ['puuid', 'discordId', 'leftGuildAt'],
        });
        const leftUsers = mainUsers.filter((u) => !u.leftGuildAt && !guildMemberIds.has(u.discordId));
        if (leftUsers.length > 0) {
          const mainPuuids = leftUsers.map((u) => u.puuid);
          await models.user.update(
            { leftGuildAt: new Date() },
            {
              where: {
                groupId: group.id,
                leftGuildAt: null,
                [Op.or]: [
                  { puuid: { [Op.in]: mainPuuids } },
                  { primaryPuuid: { [Op.in]: mainPuuids } },
                ],
              },
            },
          );
          logger.info(`서버 멤버 동기화: 그룹 ${group.id} - ${leftUsers.length}명 탈퇴 반영`);
        }

        // 재입장 복구 — 봇 다운 중 재입장해 guildMemberAdd 이벤트를 놓친 케이스 감지.
        // 길드에 현재 존재하는데 leftGuildAt 이 남아 있는 본캐 → 본캐 + 부캐 일괄 해제.
        const rejoinedUsers = mainUsers.filter((u) => u.leftGuildAt && guildMemberIds.has(u.discordId));
        if (rejoinedUsers.length > 0) {
          const rejoinedPuuids = rejoinedUsers.map((u) => u.puuid);
          await models.user.update(
            { leftGuildAt: null },
            {
              where: {
                groupId: group.id,
                leftGuildAt: { [Op.ne]: null },
                [Op.or]: [
                  { puuid: { [Op.in]: rejoinedPuuids } },
                  { primaryPuuid: { [Op.in]: rejoinedPuuids } },
                ],
              },
            },
          );
          logger.info(`서버 멤버 동기화: 그룹 ${group.id} - ${rejoinedUsers.length}명 재입장 복구`);
        }

        // 관리자 권한 동기화
        const { promoted, demoted } = await syncAdminRoles(members, group);
        if (promoted > 0 || demoted > 0) {
          logger.info(`관리자 동기화: 그룹 ${group.id} - ${promoted}명 승격, ${demoted}명 해제`);
        }

        // 디스코드 닉네임 동기화 — 길드 표시명을 DB(users.discordNickname)에 캐시.
        // 멤버 목록 API가 매 요청 fetch 안 하도록 함(부팅 백필 + 이후 guildMemberAdd/Update가 실시간 유지).
        // 바뀐 행만 UPDATE. 떠난 멤버는 길드에 없으니 갱신 안 됨 → 마지막 닉 유지.
        const nickRows = await models.user.findAll({
          where: { groupId: group.id, discordId: { [Op.ne]: null } },
          attributes: ['puuid', 'discordId', 'discordNickname'],
        });
        let nickChanged = 0;
        for (const u of nickRows) {
          const gm = members.get(u.discordId);
          if (gm && gm.displayName !== u.discordNickname) {
            // eslint-disable-next-line no-await-in-loop
            await models.user.update(
              { discordNickname: gm.displayName },
              { where: { groupId: group.id, puuid: u.puuid } },
            );
            nickChanged += 1;
          }
        }
        if (nickChanged > 0) {
          logger.info(`디스코드 닉네임 동기화: 그룹 ${group.id} - ${nickChanged}명 갱신`);
        }
      }
      logger.info('서버 멤버 동기화 완료');
    } catch (e) {
      logger.error('서버 멤버 동기화 오류:', e);
    }

    // 봇 다운타임 중 가입한 유저에게 온보딩 DM 전송
    try {
      const lastHeartbeat = await models.app_status.findByPk('lastHeartbeat');
      const downSince = lastHeartbeat ? new Date(lastHeartbeat.value) : null;

      if (downSince) {
        const groups = await models.group.findAll({ where: { discordGuildId: { [Op.ne]: null } } });
        for (const group of groups) {
          if (!group.settings?.onboardingEnabled) continue;

          const guild = client.guilds.cache.get(group.discordGuildId);
          if (!guild) continue;

          const members = await guild.members.fetch();
          const missedMembers = members.filter((m) =>
            !m.user.bot && m.joinedAt && m.joinedAt > downSince,
          );

          for (const [, member] of missedMembers) {
            const existingUser = await models.user.findOne({
              where: { groupId: group.id, discordId: member.id },
            });
            if (existingUser) continue;

            await startOnboarding(member, group);
            logger.info(`다운타임 온보딩 DM 전송: ${member.displayName} (${member.id}) - 그룹 ${group.id}`);
          }
        }
      }
      logger.info('다운타임 온보딩 체크 완료');
    } catch (e) {
      logger.error('다운타임 온보딩 체크 오류:', e);
    }

    // 시작 시각 기록
    models.app_status.upsert({ key: 'startedAt', value: new Date().toISOString() })
      .catch((e) => logger.error('startedAt 기록 오류:', e));

    // Heartbeat 시작 (1분 간격)
    const updateHeartbeat = () => {
      models.app_status.upsert({ key: 'lastHeartbeat', value: new Date().toISOString() })
        .catch((e) => logger.error('Heartbeat 업데이트 오류:', e));
    };
    updateHeartbeat();
    setInterval(updateHeartbeat, 60 * 1000);
  });

  app.discordClient = client;

  client.login(process.env.DISCORD_BOT_TOKEN);

  const commandList = await commandListLoader();
  const commandJsons = commandList.getSlashCommands().map((command) => command.toJSON());
  // Discord는 길드당 하루 200개 명령어 생성 한도가 있고, bulk PUT은 내용이 같아도 개당 생성으로
  // 카운트한다. 배포(재시작)가 잦으면 한도가 소진되므로 등록된 명령어와 다를 때만 PUT한다.
  // 한도 초과(30034) 시 discord.js 기본 동작은 리셋까지 무기한 대기라 침묵 장애가 되므로,
  // 1분 이상 대기가 필요한 rate limit은 즉시 에러로 던져 로그에 남긴다.
  const rest = new REST({
    version: '10',
    rejectOnRateLimit: (data) => data.retryAfter > 60 * 1000,
  }).setToken(process.env.DISCORD_BOT_TOKEN);

  const groups = await models.group.findAll({
    where: { discordGuildId: { [Op.ne]: null } },
    attributes: ['discordGuildId'],
  });
  const serverIds = groups.map(g => g.discordGuildId);

  // 부팅을 막지 않도록 fire-and-forget, 내부는 rate limit 부담을 줄이기 위해 순차 처리
  (async () => {
    const desired = JSON.stringify(commandListLoader.normalizeCommands(commandJsons));
    for (let serverId of serverIds) {
      const route = Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID, serverId);
      try {
        const current = await rest.get(route);
        if (JSON.stringify(commandListLoader.normalizeCommands(current)) === desired) {
          logger.info(`[${serverId}] 슬래시 명령어 변경 없음 - 등록 생략`);
          continue;
        }
        const data = await rest.put(route, { body: commandJsons });
        logger.info(`[${serverId}] 슬래시 명령어 ${data.length}개 등록 완료`);
      } catch (e) {
        logger.error(`[${serverId}] 슬래시 명령어 등록 실패: ${e.message}`);
      }
    }
  })();
};
