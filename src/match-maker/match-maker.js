const { logger } = require('../loaders/logger');
const ratingSystem = require('../rating-system/rating-system');

class User {
	constructor(id, rating) {
		this.id = id;
		this.rating = rating;
	}
}

exports.User = User;

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
		this.winRate = ratingSystem.getWinRate(this.team1.map(elem => elem.rating), this.team2.map(elem => elem.rating));
	}
}

exports.Match = Match;

const matchMake = (preOrganizationTeam1, preOrganizationTeam2, userPool, count) => {
	if(preOrganizationTeam1.length + preOrganizationTeam2.length + userPool.length != 10)
	{
		logger.error("[match-maker.matchMake] invalid team length, team1Len :" + preOrganizationTeam1.length + ", team2Len :" + preOrganizationTeam2.length + ", userPoolLen :" + userPool.length);
		return;
	}

	var ret = new Array();
	if(userPool.length == 0)
	{
		var team1 = JSON.parse(JSON.stringify(preOrganizationTeam1));
		var team2 = JSON.parse(JSON.stringify(preOrganizationTeam2));
		ret.push(new Match(team1, team2));
		return ret;
	}

	var pop = userPool.pop();
	if(preOrganizationTeam1.length < 5)
	{
		preOrganizationTeam1.push(pop);
		ret = ret.concat(matchMake(preOrganizationTeam1, preOrganizationTeam2, userPool, -1));
		preOrganizationTeam1.pop();
	}

	if(preOrganizationTeam2.length < 5)
	{
		preOrganizationTeam2.push(pop);
		ret = ret.concat(matchMake(preOrganizationTeam1, preOrganizationTeam2, userPool, -1));
		preOrganizationTeam2.pop();
	}
	userPool.push(pop);

	if(count > 0)
	{
		ret.sort(function(match1, match2) {
			return match1.diff - match2.diff;
		});

		var end = ret.length < count ? ret.length : count;
		ret = ret.slice(0, end);
	}
	return ret;
}

exports.matchMake = matchMake;

const foo = (param1) => {
	if(param1 == 0)
	{
		return [0, 1];
	}

	var ret = new Array();
	ret = ret.concat(foo(0));
	return ret;
}

exports.foo = foo;
