const { logger } = require('../loaders/logger');

exports.getWinRate = (team1, team2) => {
	if(team1.length != 5 || team2.length != 5)
	{		
		logger.error("[rating-system.getWinRate]inavalid team length");
		return;
	}

	var ratingAvg1 = 0.0;
	var ratingAvg2 = 0.0;

	for(var i = 0; i < 5; i++)
	{
		ratingAvg1 += team1[i].rating;
		ratingAvg2 += team2[i].rating;
	}

	ratingAvg1 /= 5;
	ratingAvg2 /= 5;

	return ELO_getWinRate(ratingAvg1, ratingAvg2);
}

exports.getWinScore = (winTeam, loseTeam) => {
	if(winTeam.length != 5 || loseTeam.length != 5)
	{		
		logger.error("[rating-system.getWinScroe]inavalid team length");
		return;
	}

	var winTeamExpectedRate = this.getWinRate(winTeam, loseTeam);
	return ELO_getMatchScore(winTeamExpectedRate);
}	

exports.getWinScoreByWinRate = (winRate) => {
	return ELO_getMatchScore(winRate);
}

// ELO Rating System
const k_factor = 32;
const ELO_getMatchScore = (winRate) => {
	return k_factor * (1 - winRate);
}

const ELO_getWinRate = (rating1, rating2) => {
	return 1 / (1 + Math.pow(10, (rating2 - rating1)/400));
}
