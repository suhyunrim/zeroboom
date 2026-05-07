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
  category: 'win_streak',
  trigger: 'match_result',
  goal,
}));
const loseStreaks = Object.entries(streakGoals).map(([tier, goal]) => ({
  id: `LOSE_STREAK_${tier}`,
  name: `${goal}연패`,
  description: `${goal}연패를 달성하세요`,
  emoji: '💀',
  tier,
  category: 'lose_streak',
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

/**
 * 티어-수치 맵을 받아 업적 정의 배열로 변환
 */
const makeTieredAchievements = ({ idPrefix, nameFn, descFn, emoji, category, trigger, goals }) =>
  Object.entries(goals).map(([tier, goal]) => ({
    id: `${idPrefix}_${tier}`,
    name: nameFn(goal),
    description: descFn(goal),
    emoji,
    tier,
    category,
    trigger,
    goal,
  }));

// 솔로신가요? (금 18시~월 06시 시간대 매치)
const soloCheck = makeTieredAchievements({
  idPrefix: 'SOLO_CHECK',
  nameFn: (g) => `솔로신가요? ${g}판`,
  descFn: (g) => `주말 시간대(금 18시~월 06시)에 ${g}판을 플레이하세요`,
  emoji: '🍺',
  category: 'weekend_games',
  trigger: 'match_result',
  goals: { BRONZE: 5, SILVER: 10, GOLD: 20, PLATINUM: 50, EMERALD: 100, DIAMOND: 200, MASTER: 300, GRANDMASTER: 500, CHALLENGER: 1000 },
});

const weekday = makeTieredAchievements({
  idPrefix: 'WEEKDAY_WORKER',
  nameFn: (g) => `평일 근로자 ${g}판`,
  descFn: (g) => `평일 시간대(월 06시~금 18시)에 ${g}판을 플레이하세요`,
  emoji: '💼',
  category: 'weekday_games',
  trigger: 'match_result',
  goals: { BRONZE: 5, SILVER: 10, GOLD: 20, PLATINUM: 50, EMERALD: 100, DIAMOND: 200, MASTER: 300, GRANDMASTER: 500, CHALLENGER: 1000 },
});

const gamesPerDay = makeTieredAchievements({
  idPrefix: 'GAMES_PER_DAY',
  nameFn: (g) => `하루 ${g}판`,
  descFn: (g) => `하루에 ${g}판 이상 참여하세요`,
  emoji: '🎯',
  category: 'games_per_day',
  trigger: 'match_result',
  goals: { BRONZE: 3, SILVER: 5, GOLD: 7, PLATINUM: 10, EMERALD: 12, DIAMOND: 15, MASTER: 20, GRANDMASTER: 25, CHALLENGER: 30 },
});

const welcomer = makeTieredAchievements({
  idPrefix: 'WELCOMER',
  nameFn: (g) => `환영위원회 ${g}승`,
  descFn: (g) => `등록 3주 이내 뉴비와 같은 팀으로 ${g}승을 거두세요`,
  emoji: '🤝',
  category: 'welcomer',
  trigger: 'match_result',
  goals: { BRONZE: 1, SILVER: 3, GOLD: 5, PLATINUM: 10, EMERALD: 20, DIAMOND: 50, MASTER: 100, GRANDMASTER: 200, CHALLENGER: 500 },
});

const consecutiveDays = makeTieredAchievements({
  idPrefix: 'CONSECUTIVE_DAYS',
  nameFn: (g) => `${g}일 연속 출석`,
  descFn: (g) => `${g}일 연속으로 매치에 참여하세요`,
  emoji: '📅',
  category: 'consecutive_days',
  trigger: 'match_result',
  goals: { BRONZE: 2, SILVER: 3, GOLD: 5, PLATINUM: 7, EMERALD: 10, DIAMOND: 14, MASTER: 21, GRANDMASTER: 30, CHALLENGER: 60 },
});

const honorReceived = makeTieredAchievements({
  idPrefix: 'HONOR_RECEIVED',
  nameFn: (g) => `명예왕 ${g}표`,
  descFn: (g) => `명예 투표를 누적 ${g}회 받으세요`,
  emoji: '🎖️',
  category: 'honor_received',
  trigger: 'honor_voted',
  goals: { BRONZE: 5, SILVER: 10, GOLD: 20, PLATINUM: 50, EMERALD: 100, DIAMOND: 200, MASTER: 500, GRANDMASTER: 1000, CHALLENGER: 2000 },
});

const honorVoted = makeTieredAchievements({
  idPrefix: 'HONOR_VOTED',
  nameFn: (g) => `투표러 ${g}표`,
  descFn: (g) => `명예 투표를 누적 ${g}회 참여하세요`,
  emoji: '🗳️',
  category: 'honor_voted_count',
  trigger: 'honor_voted',
  goals: { BRONZE: 3, SILVER: 10, GOLD: 20, PLATINUM: 50, EMERALD: 100, DIAMOND: 200, MASTER: 300, GRANDMASTER: 500, CHALLENGER: 1000 },
});

const matchMvp = makeTieredAchievements({
  idPrefix: 'MATCH_MVP',
  nameFn: (g) => `매치 MVP ${g}회`,
  descFn: (g) => `단일 매치에서 팀 내 3표 이상 받아 매치 MVP를 ${g}회 달성하세요`,
  emoji: '⭐',
  category: 'match_mvp',
  trigger: 'honor_voted',
  goals: { BRONZE: 1, SILVER: 3, GOLD: 5, PLATINUM: 10, EMERALD: 20, DIAMOND: 50, MASTER: 100, GRANDMASTER: 200, CHALLENGER: 500 },
});

const matchMvpStreak = makeTieredAchievements({
  idPrefix: 'MATCH_MVP_STREAK',
  nameFn: (g) => `팬 서비스 ${g}연속 MVP`,
  descFn: (g) => `참여 매치 ${g}연속 매치 MVP를 달성하세요`,
  emoji: '🌟',
  category: 'match_mvp_streak',
  trigger: 'honor_voted',
  goals: { BRONZE: 2, SILVER: 3, GOLD: 4, PLATINUM: 5, EMERALD: 7, DIAMOND: 10, MASTER: 15, GRANDMASTER: 20, CHALLENGER: 30 },
});

const reverseWin = makeTieredAchievements({
  idPrefix: 'REVERSE_WIN',
  nameFn: (g) => `역전승 ${g}회`,
  descFn: () => `3판2선 세트에서 2-1로 역전승을 거두세요`,
  emoji: '🔄',
  category: 'reverse_win',
  trigger: 'match_result',
  goals: { BRONZE: 1, SILVER: 3, GOLD: 5, PLATINUM: 10, EMERALD: 20, DIAMOND: 30, MASTER: 50, GRANDMASTER: 100, CHALLENGER: 200 },
});

const reverseLose = makeTieredAchievements({
  idPrefix: 'REVERSE_LOSE',
  nameFn: (g) => `역전패 ${g}회`,
  descFn: () => `3판2선 세트에서 1-2로 역전패를 당하세요`,
  emoji: '🔃',
  category: 'reverse_lose',
  trigger: 'match_result',
  goals: { BRONZE: 1, SILVER: 3, GOLD: 5, PLATINUM: 10, EMERALD: 20, DIAMOND: 30, MASTER: 50, GRANDMASTER: 100, CHALLENGER: 200 },
});

const sweepWin = makeTieredAchievements({
  idPrefix: 'SWEEP_WIN',
  nameFn: (g) => `완승 스윕 ${g}회`,
  descFn: () => `3판2선 세트에서 2-0 완승을 거두세요`,
  emoji: '🧹',
  category: 'sweep_win',
  trigger: 'match_result',
  goals: { BRONZE: 1, SILVER: 3, GOLD: 5, PLATINUM: 10, EMERALD: 20, DIAMOND: 30, MASTER: 50, GRANDMASTER: 100, CHALLENGER: 150 },
});

const sweepLose = makeTieredAchievements({
  idPrefix: 'SWEEP_LOSE',
  nameFn: (g) => `시련 ${g}회`,
  descFn: () => `3판2선 세트에서 0-2 완패를 당하세요`,
  emoji: '💧',
  category: 'sweep_lose',
  trigger: 'match_result',
  goals: { BRONZE: 3, SILVER: 5, GOLD: 10, PLATINUM: 20, EMERALD: 30, DIAMOND: 50, MASTER: 70, GRANDMASTER: 100, CHALLENGER: 150 },
});

const nightOwl = makeTieredAchievements({
  idPrefix: 'NIGHT_OWL',
  nameFn: (g) => `밤새기 ${g}회`,
  descFn: () => `보이스 채널에 12시간 이상 연속 체류하세요`,
  emoji: '🦉',
  category: 'night_owl',
  trigger: 'voice_leave',
  goals: { BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 5, EMERALD: 7, DIAMOND: 10, MASTER: 15, GRANDMASTER: 20, CHALLENGER: 30 },
});

const channelCreator = makeTieredAchievements({
  idPrefix: 'CHANNEL_CREATOR',
  nameFn: (g) => `채널 개척자 ${g}회`,
  descFn: (g) => `임시 보이스 채널을 ${g}회 생성하세요`,
  emoji: '🔊',
  category: 'channel_creator',
  trigger: 'temp_voice_created',
  goals: { BRONZE: 1, SILVER: 3, GOLD: 5, PLATINUM: 10, EMERALD: 20, DIAMOND: 50, MASTER: 100, GRANDMASTER: 200, CHALLENGER: 500 },
});

// 승부의신 (토너먼트 모든 정상 매치 적중)
const predictionPerfect = makeTieredAchievements({
  idPrefix: 'PREDICTION_PERFECT',
  nameFn: (g) => `승부의신 ${g}회`,
  descFn: (g) => `토너먼트 모든 매치를 적중시켜 ${g}회 달성하세요`,
  emoji: '🔮',
  category: 'prediction_perfect',
  trigger: 'tournament_end',
  goals: { DIAMOND: 1, MASTER: 2, GRANDMASTER: 3, CHALLENGER: 5 },
});

// 개근 도장 (연속 7일, DIAMOND 단일)
const attendanceStamp = [
  {
    id: 'ATTENDANCE_STAMP',
    name: '개근 도장',
    description: '한 주 안에 7일 모두 매치에 참여하세요',
    emoji: '📜',
    tier: 'DIAMOND',
    category: 'consecutive_days',
    trigger: 'match_result',
    goal: 7,
  },
];

// 기념일 (유저 등록일 기준 경과)
const anniversaryMilestones = [
  { id: 'ANNIVERSARY_1W', name: '첫 주', tier: 'BRONZE', days: 7, emoji: '🎂' },
  { id: 'ANNIVERSARY_1M', name: '한 달', tier: 'SILVER', days: 30, emoji: '🎂' },
  { id: 'ANNIVERSARY_3M', name: '3개월', tier: 'GOLD', days: 90, emoji: '🎂' },
  { id: 'ANNIVERSARY_6M', name: '반년', tier: 'PLATINUM', days: 180, emoji: '🎂' },
  { id: 'ANNIVERSARY_1Y', name: '1주년', tier: 'EMERALD', days: 365, emoji: '🎉' },
  { id: 'ANNIVERSARY_2Y', name: '2주년', tier: 'DIAMOND', days: 730, emoji: '🎉' },
];
const anniversary = anniversaryMilestones.map((m) => ({
  id: m.id,
  name: `${m.name} 기념일`,
  description: `등록 후 ${m.name}이 지났습니다`,
  emoji: m.emoji,
  tier: m.tier,
  category: 'anniversary',
  trigger: 'match_result',
  goal: m.days,
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
  ...soloCheck,
  ...weekday,
  ...gamesPerDay,
  ...welcomer,
  ...anniversary,
  ...consecutiveDays,
  ...attendanceStamp,
  ...honorReceived,
  ...honorVoted,
  ...matchMvp,
  ...matchMvpStreak,
  ...reverseWin,
  ...reverseLose,
  ...sweepWin,
  ...sweepLose,
  ...nightOwl,
  ...channelCreator,
  ...predictionPerfect,
];

const STAT_TYPES = {
  UNDERDOG_WINS: 'underdog_wins',
  LATE_NIGHT_GAMES: 'late_night_games',
  BEST_WIN_STREAK: 'best_win_streak',
  BEST_LOSE_STREAK: 'best_lose_streak',
  BEST_RATING: 'best_rating',
  WEEKEND_GAMES: 'weekend_games',
  WEEKDAY_GAMES: 'weekday_games',
  MAX_GAMES_PER_DAY: 'max_games_per_day',
  GAMES_IN_TODAY: 'games_in_today',
  TODAY_KEY: 'today_key',
  WELCOMER_WINS: 'welcomer_wins',
  CURRENT_CONSECUTIVE_DAYS: 'current_consecutive_days',
  BEST_CONSECUTIVE_DAYS: 'best_consecutive_days',
  MATCH_MVP_COUNT: 'match_mvp_count',
  CURRENT_MATCH_MVP_STREAK: 'current_match_mvp_streak',
  BEST_MATCH_MVP_STREAK: 'best_match_mvp_streak',
  REVERSE_WINS: 'reverse_wins',
  REVERSE_LOSES: 'reverse_loses',
  SWEEP_WINS: 'sweep_wins',
  SWEEP_LOSES: 'sweep_loses',
  NIGHT_OWL_SESSIONS: 'night_owl_sessions',
  TEMP_VOICE_CREATED: 'temp_voice_created',
  PREDICTION_PERFECT_COUNT: 'prediction_perfect_count',
};

module.exports = { definitions, TIERS, STAT_TYPES, getTierName };
