const { logger } = require('../loaders/logger');
const { pickCount } = require('../config');
const TEAM_SIZE = pickCount / 2;

const reducer = (total, user) => {
  total += user.rating;
  return total;
};

exports.getWinRate = (team1, team2) => {
  if (team1.length != TEAM_SIZE || team2.length != TEAM_SIZE) {
    logger.error(`[rating-system.getWinRate] invalid team length: ${team1.length} vs ${team2.length}, expected ${TEAM_SIZE}`);
    return;
  }

  var ratingAvg1 = team1.reduce(reducer, 0.0) / TEAM_SIZE;
  var ratingAvg2 = team2.reduce(reducer, 0.0) / TEAM_SIZE;

  return ELO_getWinRate(ratingAvg1, ratingAvg2);
};

exports.getWinScore = (winTeam, loseTeam) => {
  if (winTeam.length != TEAM_SIZE || loseTeam.length != TEAM_SIZE) {
    logger.error(`[rating-system.getWinScore] invalid team length: ${winTeam.length} vs ${loseTeam.length}, expected ${TEAM_SIZE}`);
    return;
  }

  var winTeamExpectedRate = this.getWinRate(winTeam, loseTeam);
  return ELO_getMatchScore(winTeamExpectedRate);
};

exports.getWinScoreByWinRate = (winRate) => {
  return ELO_getMatchScore(winRate);
};

// ELO Rating System
const k_factor = 16;
const ELO_getMatchScore = (winRate) => {
  return k_factor * (1 - winRate);
};

const ELO_getWinRate = (rating1, rating2) => {
  return 1 / (1 + Math.pow(10, (rating2 - rating1) / 400));
};
