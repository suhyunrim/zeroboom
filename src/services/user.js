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

const registerUser = async (groupName, summonerName, tier, discordId = null) => {
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
    await models.user.upsert({
      encryptedAccountId: summoner.encryptedAccountId,
      puuid: summoner.puuid,
      groupId: group.id,
      defaultRating: getRating(tier ? tier : summoner.rankTier),
      discordId: discordId,
    });
  } catch (e) {
    logger.error(e.stack);
    return { result: e.message, status: 501 };
  }

  return { result: `[**${summonerName}**] - \`${tier}\` 로 등록되었습니다.`, status: 200 };
};

exports.registerUser = registerUser;

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
