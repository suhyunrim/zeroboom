const { logger } = require('../loaders/logger');
const ratingSystem = require('../rating-system/rating-system.js');
const reducer = (total, user) => {
	total += user.rating;
	return total;
};

class Match {
	constructor(team1, team2) {
		this.team1 = team1;
		this.team2 = team2;

		this.team1Rating = this.team1.reduce(reducer, 0);
		this.team2Rating = this.team2.reduce(reducer, 0);

		this.diff = Math.abs(this.team1Rating - this.team2Rating);
		this.winRate = ratingSystem.getWinRate(this.team1, this.team2);
	}
}

exports.Match = Match;
