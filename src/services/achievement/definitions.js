const { getTierName } = require('../../utils/tierUtils');

const TIERS = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];

// 첫 승리
const firstWin = [
  { id: 'FIRST_WIN_BRONZE', name: '첫 승리', description: '첫 번째 승리를 거두세요', emoji: '🏆', tier: 'BRONZE', category: 'match', trigger: 'match_result', goal: 1 },
];

// 판수
const gamesGoals = { BRONZE: 10, SILVER: 30, GOLD: 50, PLATINUM: 100, EMERALD: 200, DIAMOND: 300, MASTER: 500, GRANDMASTER: 1000 };
const games = Object.entries(gamesGoals).map(([tier, goal]) => ({
  id: `GAMES_${tier}`, name: `${goal}판 달성`, description: `내전 ${goal}판을 플레이하세요`, emoji: '📊', tier, category: 'games', trigger: 'match_result', goal,
}));

// 연승
const winStreakGoals = { BRONZE: 3, SILVER: 5, GOLD: 7, PLATINUM: 10, EMERALD: 13, DIAMOND: 16, MASTER: 20, GRANDMASTER: 25 };
const winStreaks = Object.entries(winStreakGoals).map(([tier, goal]) => ({
  id: `WIN_STREAK_${tier}`, name: `${goal}연승`, description: `${goal}연승을 달성하세요`, emoji: '🔥', tier, category: 'streak', trigger: 'match_result', goal,
}));

// 연패
const loseStreakGoals = { BRONZE: 3, SILVER: 5, GOLD: 7, PLATINUM: 10, EMERALD: 13, DIAMOND: 16, MASTER: 20, GRANDMASTER: 25 };
const loseStreaks = Object.entries(loseStreakGoals).map(([tier, goal]) => ({
  id: `LOSE_STREAK_${tier}`, name: `${goal}연패`, description: `${goal}연패를 달성하세요`, emoji: '💀', tier, category: 'streak', trigger: 'match_result', goal,
}));

// 챌린저
const tierChallenger = [
  { id: 'TIER_CHALLENGER', name: '챌린저 도달', description: '내전 티어 챌린저에 도달하세요', emoji: '👑', tier: 'CHALLENGER', category: 'tier', trigger: 'match_result', goal: null },
];

const definitions = [...firstWin, ...games, ...winStreaks, ...loseStreaks, ...tierChallenger];

module.exports = { definitions, TIERS, getTierName };
