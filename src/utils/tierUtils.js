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

const isNonStepTier = (tierName) => {
  return tierName === 'MASTER' || tierName === 'GRANDMASTER' || tierName === 'CHALLENGER';
};

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

exports.convertAbbreviationTier = convertAbbreviationTier;

const getTierName = (rating) => {
  let entries = Object.entries(tierNames);
  entries = entries.filter((elem) => elem[0] !== 'UNRANKED');
  entries = entries.sort((a, b) => b[1] - a[1]);
  for (const [name, tierRating] of entries) {
    if (rating < tierRating) {
      continue;
    }
  
    return `${name}`;
  }
}
exports.getTierName = getTierName;

const getTierPoint = (rating) => {
  let entries = Object.entries(tierNames);
  entries = entries.filter((elem) => elem[0] !== 'UNRANKED');
  entries = entries.sort((a, b) => b[1] - a[1]);
  for (const [name, tierRating] of entries) {
    if (rating < tierRating) {
      continue;
    }
  
    if (isNonStepTier(name)) {
      return Math.floor((rating - tierRating) * 4);
    } else {
      return Math.floor((rating - tierRating) % 25 * 4);
    }
  }
}
exports.getTierPoint = getTierPoint;

const getTierStep = (rating) => {
  let entries = Object.entries(tierNames);
  entries = entries.filter((elem) => elem[0] !== 'UNRANKED');
  entries = entries.sort((a, b) => b[1] - a[1]);
  for (const [name, tierRating] of entries) {
    if (rating < tierRating) {
      continue;
    }

    if (isNonStepTier(name)) {
      return 1;
    }

    // 0~24: 4 (IV), 25~49: 3 (III), 50~74: 2 (II), 75~99: 1 (I)
    return 4 - Math.floor((rating - tierRating) / 25);
  }
}
exports.getTierStep = getTierStep;

const formatTier = (rating) => {
  const tierName = getTierName(rating);
  if (!tierName) return 'UNRANKED';

  if (isNonStepTier(tierName)) {
    return tierName;
  }

  const step = getTierStep(rating);
  // step: 4=IV, 3=III, 2=II, 1=I → tierSteps[4-step]
  return `${tierName} ${tierSteps[4 - step] || 'IV'}`;
};
exports.formatTier = formatTier;
