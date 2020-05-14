const { logger } = require('../loaders/logger');
const ratingSystem = require('../rating-system/rating-system.js');

class Match {
	constructor(team1, team2) {
		this.team1 = team1;
		this.team2 = team2;

		this.team1Rating = 0;
		this.team2Rating = 0;
		for(var i = 0; i < 5; i++)
		{
			this.team1Rating += this.team1[i].rating;
			this.team2Rating += this.team2[i].rating;
		}

		this.diff = Math.abs(this.team1Rating - this.team2Rating);
		this.winRate = ratingSystem.getWinRate(this.team1.map(elem => elem), this.team2.map(elem => elem));
	}
}

exports.Match = Match;
