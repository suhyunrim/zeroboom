const { Op } = require('sequelize');
const { logger } = require('../loaders/logger');
const models = require('../db/models');

const summonerController = require('../controller/summoner');

const tierNames = {
  IRON: 200,
  BRONZE: 300,
  SILVER: 400,
  GOLD: 500,
  PLATINUM: 600,
  EMERALD: 700,
  DIAMOND: 800,
  MASTER: 900,
  GRANDMASTER: 1000,
  CHALLENGER: 1150,
  UNRANKED: 500,
};
const tierSteps = ['IV', 'III', 'II', 'I'];

const convertAbbreviationTier = (tier) => {
  // GM4, GM3 등 GRANDMASTER 약어 처리
  if (tier.toUpperCase().startsWith('GM') && tier.length === 3) {
    const step = Number(tier.charAt(2));
    return `GRANDMASTER ${tierSteps[tierSteps.length - step]}`;
  }

  if (tier.length > 2) return tier;

  let result = '';
  const firstLetter = tier.charAt(0).toUpperCase();
  for (const tierName of Object.keys(tierNames)) {
    if (firstLetter.startsWith(tierName.charAt(0))) {
      result = tierName;
      break;
    }
  }

  result += ' ';

  const secondLetter = Number(tier.charAt(1));
  result += tierSteps[tierSteps.length - secondLetter];

  return result;
};

const isValidTier = (tier) => {
  const split = tier.split(' ');
  const tierName = split[0].toUpperCase();
  const tierStep = split[1].toUpperCase();
  return tierNames[tierName] && tierSteps.indexOf(tierStep) != -1;
};

const isNonStepTier = (tierName) => {
  return tierName === 'MASTER' || tierName === 'GRANDMASTER' || tierName === 'CHALLENGER';
};

const getRating = (tier) => {
  if (!isValidTier(tier)) return 400;

  const split = tier.split(' ');
  const tierName = split[0].toUpperCase();
  const rating = tierNames[tierName];
  const tierStep = split[1].toUpperCase();
  const tierMultiplier = tierSteps.indexOf(tierStep);
  return rating + tierMultiplier * 25;
};

const registerUser = async (groupName, summonerName, tier, discordId = null, { asOutsider = false } = {}) => {
  if (!groupName) return { result: 'invalid group name', status: 501 };

  if (!summonerName) return { result: 'invalid summoner name', status: 501 };

  const group = await models.group.findOne({ where: { groupName } });
  if (!group) return { result: 'group is not exist', status: 501 };

  if (tier) tier = convertAbbreviationTier(tier);

  if (tier && !isValidTier(tier)) return { result: 'invalid tier', status: 501 };

  const summonerResult = await summonerController.getSummonerByName(summonerName);
  if (summonerResult.status != 200) return { result: summonerResult.result, status: summonerResult.status };

  const summoner = summonerResult.result;
  if (!tier && (summoner.rankTier == 'UNRANKED' || summoner.rankWin + summoner.rankLose < 100))
    return { result: 'enter the tier explicitly', status: 501 };

  try {
    // (groupId, discordId) UNIQUE 제약 & "조용한 계정 갈아탐" 방지:
    // 같은 디스코드가 이미 다른 본캐에 연결돼 있으면, 그 계정을 말없이 orphan 시키지 않고
    // 등록을 막고 안내한다. 본캐 이동/부캐 편입은 관리자가 /유저디코연결로 명시적으로 처리한다.
    // (같은 puuid 재등록은 홀더 조회에서 제외되므로 정상 통과)
    if (discordId) {
      const holder = await models.user.findOne({
        where: {
          groupId: group.id,
          discordId,
          primaryPuuid: null,
          puuid: { [Op.ne]: summoner.puuid },
        },
        attributes: ['puuid'],
      });
      if (holder) {
        const holderSummoner = await models.summoner.findOne({
          where: { puuid: holder.puuid },
          attributes: ['name'],
        });
        const holderName = holderSummoner ? holderSummoner.name : '다른 계정';
        return {
          result: `이 디스코드는 이미 [${holderName}]에 연결돼 있습니다. 계정을 옮기려면 관리자가 '/유저디코연결 @유저 ${summonerName}'로 이동해주세요.`,
          status: 409,
        };
      }
    }

    // 외부인 등록(asOutsider)은 신규 생성된 경우에만 role을 outsider로 지정한다.
    // 이미 존재하는 row의 role은 건드리지 않아 활동 멤버가 실수로 강등되지 않게 한다.
    const existing = asOutsider
      ? await models.user.findOne({
          where: { groupId: group.id, puuid: summoner.puuid },
          attributes: ['puuid'],
        })
      : null;

    await models.user.upsert({
      encryptedAccountId: summoner.encryptedAccountId,
      puuid: summoner.puuid,
      groupId: group.id,
      defaultRating: getRating(tier ? tier : summoner.rankTier),
      discordId: discordId,
    });

    if (asOutsider && !existing) {
      await models.user.update(
        { role: 'outsider' },
        { where: { groupId: group.id, puuid: summoner.puuid } },
      );
    }

    // 포지션 정보 수집 (비동기로 처리, 실패해도 등록은 완료)
    summonerController.getPositions(summonerName).catch((e) => {
      logger.error(`포지션 수집 실패 [${summonerName}]: ${e.message}`);
    });
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }

  return { result: `[**${summonerName}**] - \`${tier}\` 로 등록되었습니다.`, status: 200, group };
};

exports.registerUser = registerUser;
exports.getRating = getRating;
exports.convertAbbreviationTier = convertAbbreviationTier;
exports.isValidTier = isValidTier;

const getRatingTier = (rating) => {
  let entries = Object.entries(tierNames);
  entries = entries.filter((elem) => elem[0] !== 'UNRANKED');
  entries = entries.sort((a, b) => b[1] - a[1]);
  for (const [name, tierRating] of entries) {
    if (rating < tierRating) continue;

    if (isNonStepTier(name)) return `${name} ${rating - tierRating} LP`;
    else return `${name} ${tierSteps[Math.floor((rating - tierRating) / 25)]}`;
  }
};

exports.getRatingTier = getRatingTier;
