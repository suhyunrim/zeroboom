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
};
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
      return Math.floor(((rating - tierRating) % 25) * 4);
    }
  }
};
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
};
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

/**
 * 레이팅을 티어 뱃지 문자열로 변환 (prefix 지정 가능)
 * 예: 520 → "[G4]", 920 → "[M 80LP]", prefix='평균 ' → "[평균 G4]"
 */
const formatTierBadge = (rating, prefix = '') => {
  const tierName = getTierName(rating);
  if (isNonStepTier(tierName)) {
    const tierPoint = getTierPoint(rating);
    const tierAbbr = tierName === 'GRANDMASTER' ? 'GM' : tierName.charAt(0);
    return `[${prefix}${tierAbbr} ${tierPoint}LP]`;
  }
  const tierStep = getTierStep(rating);
  return `[${prefix}${tierName.charAt(0)}${tierStep}]`;
};
exports.formatTierBadge = formatTierBadge;

/**
 * 평균 레이팅을 티어 뱃지 문자열로 변환
 * 예: 520 → "[평균 G4]", 920 → "[평균 M 80LP]"
 */
const formatAvgTierBadge = (avgRating) => {
  if (!avgRating || avgRating <= 0) return '';
  return formatTierBadge(avgRating, '평균 ');
};
exports.formatAvgTierBadge = formatAvgTierBadge;

/**
 * 포지션 약어 매핑 (Riot API 포지션명 → 표시용 약어)
 */
const POSITION_ABBR = {
  TOP: 'TOP',
  JUNGLE: 'JG',
  MIDDLE: 'MID',
  BOTTOM: 'AD',
  UTILITY: 'SUP',
  SUPPORT: 'SUP',
};
exports.POSITION_ABBR = POSITION_ABBR;

/**
 * Riot API 포지션명을 position-optimizer 포지션명으로 변환
 * (UTILITY → SUPPORT, 나머지는 그대로)
 */
const normalizePosition = (pos) => (pos === 'UTILITY' ? 'SUPPORT' : pos);
exports.normalizePosition = normalizePosition;
