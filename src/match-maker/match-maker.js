const { logger } = require('../loaders/logger');
const ratingSystem = require('../rating-system/rating-system');
const Match = require('../entity/match.js').Match;

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
	// 양팀 모두 비어있으면 첫 유저를 team1에 고정하여 미러 중복 방지
	var isFirstPick = preOrganizationTeam1.length === 0 && preOrganizationTeam2.length === 0;

	if(preOrganizationTeam1.length < 5)
	{
		preOrganizationTeam1.push(pop);
		ret = ret.concat(matchMake(preOrganizationTeam1, preOrganizationTeam2, userPool, -1));
		preOrganizationTeam1.pop();
	}

	if(!isFirstPick && preOrganizationTeam2.length < 5)
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
