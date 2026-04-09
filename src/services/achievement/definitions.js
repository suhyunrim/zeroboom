const { getTierName } = require('../../utils/tierUtils');

const TIERS = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
];

// 첫 승리
const firstWin = [
  {
    id: 'FIRST_WIN_BRONZE',
    name: '첫 승리',
    description: '첫 번째 승리를 거두세요',
    emoji: '🏆',
    tier: 'BRONZE',
    category: 'match',
    trigger: 'match_result',
    goal: 1,
  },
];

// 판수
const gamesGoals = {
  BRONZE: 10,
  SILVER: 30,
  GOLD: 50,
  PLATINUM: 100,
  EMERALD: 200,
  DIAMOND: 300,
  MASTER: 500,
  GRANDMASTER: 1000,
};
const games = Object.entries(gamesGoals).map(([tier, goal]) => ({
  id: `GAMES_${tier}`,
  name: `${goal}판 달성`,
  description: `내전 ${goal}판을 플레이하세요`,
  emoji: '📊',
  tier,
  category: 'games',
  trigger: 'match_result',
  goal,
}));

// 연승/연패
const streakGoals = {
  BRONZE: 2,
  SILVER: 4,
  GOLD: 6,
  PLATINUM: 8,
  EMERALD: 10,
  DIAMOND: 12,
  MASTER: 15,
  GRANDMASTER: 20,
};
const winStreaks = Object.entries(streakGoals).map(([tier, goal]) => ({
  id: `WIN_STREAK_${tier}`,
  name: `${goal}연승`,
  description: `${goal}연승을 달성하세요`,
  emoji: '🔥',
  tier,
  category: 'streak',
  trigger: 'match_result',
  goal,
}));
const loseStreaks = Object.entries(streakGoals).map(([tier, goal]) => ({
  id: `LOSE_STREAK_${tier}`,
  name: `${goal}연패`,
  description: `${goal}연패를 달성하세요`,
  emoji: '💀',
  tier,
  category: 'streak',
  trigger: 'match_result',
  goal,
}));

// 티어 달성
const tierAchievements = [
  {
    id: 'TIER_IRON',
    name: '아이언 도달',
    description: '내전 티어 아이언에 도달하세요',
    emoji: null,
    tier: 'BRONZE',
    category: 'tier',
    trigger: 'match_result',
    goal: 'IRON',
  },
  {
    id: 'TIER_BRONZE',
    name: '브론즈 도달',
    description: '내전 티어 브론즈에 도달하세요',
    emoji: null,
    tier: 'BRONZE',
    category: 'tier',
    trigger: 'match_result',
    goal: 'BRONZE',
  },
  {
    id: 'TIER_SILVER',
    name: '실버 도달',
    description: '내전 티어 실버에 도달하세요',
    emoji: null,
    tier: 'SILVER',
    category: 'tier',
    trigger: 'match_result',
    goal: 'SILVER',
  },
  {
    id: 'TIER_GOLD',
    name: '골드 도달',
    description: '내전 티어 골드에 도달하세요',
    emoji: null,
    tier: 'GOLD',
    category: 'tier',
    trigger: 'match_result',
    goal: 'GOLD',
  },
  {
    id: 'TIER_PLATINUM',
    name: '플래티넘 도달',
    description: '내전 티어 플래티넘에 도달하세요',
    emoji: null,
    tier: 'PLATINUM',
    category: 'tier',
    trigger: 'match_result',
    goal: 'PLATINUM',
  },
  {
    id: 'TIER_EMERALD',
    name: '에메랄드 도달',
    description: '내전 티어 에메랄드에 도달하세요',
    emoji: null,
    tier: 'EMERALD',
    category: 'tier',
    trigger: 'match_result',
    goal: 'EMERALD',
  },
  {
    id: 'TIER_DIAMOND',
    name: '다이아몬드 도달',
    description: '내전 티어 다이아몬드에 도달하세요',
    emoji: null,
    tier: 'DIAMOND',
    category: 'tier',
    trigger: 'match_result',
    goal: 'DIAMOND',
  },
  {
    id: 'TIER_MASTER',
    name: '마스터 도달',
    description: '내전 티어 마스터에 도달하세요',
    emoji: null,
    tier: 'MASTER',
    category: 'tier',
    trigger: 'match_result',
    goal: 'MASTER',
  },
  {
    id: 'TIER_GRANDMASTER',
    name: '그랜드마스터 도달',
    description: '내전 티어 그랜드마스터에 도달하세요',
    emoji: null,
    tier: 'GRANDMASTER',
    category: 'tier',
    trigger: 'match_result',
    goal: 'GRANDMASTER',
  },
  {
    id: 'TIER_CHALLENGER',
    name: '챌린저 도달',
    description: '내전 티어 챌린저에 도달하세요',
    emoji: null,
    tier: 'CHALLENGER',
    category: 'tier',
    trigger: 'match_result',
    goal: 'CHALLENGER',
  },
];

// 보이스 체류 시간 (시간 단위)
const voiceGoals = {
  BRONZE: 10,
  SILVER: 30,
  GOLD: 50,
  PLATINUM: 100,
  EMERALD: 200,
  DIAMOND: 500,
  MASTER: 1000,
  GRANDMASTER: 2000,
};
const voice = Object.entries(voiceGoals).map(([tier, goal]) => ({
  id: `VOICE_${tier}`,
  name: `${goal}시간 체류`,
  description: `보이스 채널에 ${goal}시간 체류하세요`,
  emoji: '🎙️',
  tier,
  category: 'voice',
  trigger: 'voice_leave',
  goal,
}));

// 챌린지 메달
const challengeMedals = [
  {
    id: 'CHALLENGE_BRONZE_MEDAL',
    name: '동메달',
    description: '챌린지에서 3등을 달성하세요',
    emoji: '🥉',
    tier: 'EMERALD',
    category: 'challenge',
    trigger: 'challenge_end',
    goal: 1,
  },
  {
    id: 'CHALLENGE_SILVER_MEDAL',
    name: '은메달',
    description: '챌린지에서 2등을 달성하세요',
    emoji: '🥈',
    tier: 'DIAMOND',
    category: 'challenge',
    trigger: 'challenge_end',
    goal: 1,
  },
  {
    id: 'CHALLENGE_GOLD_MEDAL',
    name: '금메달',
    description: '챌린지에서 1등을 달성하세요',
    emoji: '🏅',
    tier: 'MASTER',
    category: 'challenge',
    trigger: 'challenge_end',
    goal: 1,
  },
  {
    id: 'CHALLENGE_TRIPLE_GOLD',
    name: '금메달 3관왕',
    description: '챌린지에서 1등을 3번 달성하세요',
    emoji: '👑',
    tier: 'GRANDMASTER',
    category: 'challenge',
    trigger: 'challenge_end',
    goal: 3,
  },
];

// 언더독 승리 (예상 승률 45% 이하에서 승리)
const underdogGoals = {
  BRONZE: 1,
  SILVER: 2,
  GOLD: 3,
  PLATINUM: 4,
  EMERALD: 5,
  DIAMOND: 6,
  MASTER: 8,
  GRANDMASTER: 10,
};
const underdog = Object.entries(underdogGoals).map(([tier, goal]) => ({
  id: `UNDERDOG_${tier}`,
  name: `언더독 승리 ${goal}회`,
  description: `팀 예상 승률 45% 이하인 매치에서 ${goal}회 승리하세요`,
  emoji: '💪',
  tier,
  category: 'underdog',
  trigger: 'match_result',
  goal,
}));

// 야식 (KST 00:00~05:00 심야 매치)
const lateNightGoals = {
  BRONZE: 1,
  SILVER: 5,
  GOLD: 10,
  PLATINUM: 30,
  EMERALD: 50,
  DIAMOND: 100,
  MASTER: 200,
  GRANDMASTER: 500,
};
const lateNight = Object.entries(lateNightGoals).map(([tier, goal]) => ({
  id: `LATE_NIGHT_${tier}`,
  name: `야식 ${goal}판`,
  description: `심야 시간대에 ${goal}판을 플레이하세요`,
  emoji: '🌙',
  tier,
  category: 'late_night',
  trigger: 'match_result',
  goal,
}));

const definitions = [
  ...firstWin,
  ...games,
  ...winStreaks,
  ...loseStreaks,
  ...tierAchievements,
  ...voice,
  ...challengeMedals,
  ...underdog,
  ...lateNight,
];

const STAT_TYPES = {
  UNDERDOG_WINS: 'underdog_wins',
  LATE_NIGHT_GAMES: 'late_night_games',
  BEST_WIN_STREAK: 'best_win_streak',
  BEST_LOSE_STREAK: 'best_lose_streak',
  BEST_RATING: 'best_rating',
};

module.exports = { definitions, TIERS, STAT_TYPES, getTierName };
