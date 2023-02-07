const tierNames = {
  IRON: 200,
  BRONZE: 300,
  SILVER: 400,
  GOLD: 500,
  PLATINUM: 600,
  DIAMOND: 700,
  MASTER: 800,
  GRANDMASTER: 900,
  CHALLENGER: 1050,
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
  
    return Math.floor((rating - tierRating) % 25 * 4);
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
  
    return Math.ceil((100 - (rating - tierRating)) / 25);
  }
}
exports.getTierStep = getTierStep;
