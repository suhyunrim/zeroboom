const { logger } = require('../loaders/logger');
const matchMaker = require('./match-maker.js');
const User = matchMaker.User;

var preOrganizationTeam1 = [];
var preOrganizationTeam2 = [];
var userPool = [];
for(var i = 1; i <= 10; i++)
{
	userPool.push(new User(i, i * 100));
}

var matchCount = 10;
var matchingGames = matchMaker.matchMake(preOrganizationTeam1, preOrganizationTeam2, userPool, matchCount); 
if(matchingGames == null)
{
	logger.error("invalid params");
	return;
}

for(var i = 0; i < matchCount; i++)
{
	logger.info(i + " match total rating diff : " + matchingGames[i].diff)
	logger.info("team1");
	for(var j = 0; j < 5; j++)
	{
		logger.info("id : " + matchingGames[i].team1[j].id + ", rating : " + matchingGames[i].team1[j].rating );
	}

	logger.info("team2");
	for(var j = 0; j < 5; j++)
	{
		logger.info("id : " + matchingGames[i].team2[j].id + ", rating : " + matchingGames[i].team2[j].rating );
	}
}

// pre organization team, ex) Boom, Moon duo
logger.info("=============== preOrganizationTeam match =================");
var boom = new User(11, 1100);
var moon = new User(12, 800);

preOrganizationTeam1.push(boom);
preOrganizationTeam1.push(moon);

userPool.pop();
userPool.pop();

matchingGames = matchMaker.matchMake(preOrganizationTeam1, preOrganizationTeam2, userPool, matchCount); 


if(matchingGames == null)
{
	logger.error("invalid params");
	return;
}

for(var i = 0; i < matchCount; i++)
{
	logger.info(i + " match total rating diff : " + matchingGames[i].diff)
	logger.info("team1");
	for(var j = 0; j < 5; j++)
	{
		logger.info("id : " + matchingGames[i].team1[j].id + ", rating : " + matchingGames[i].team1[j].rating );
	}

	logger.info("team2");
	for(var j = 0; j < 5; j++)
	{
		logger.info("id : " + matchingGames[i].team2[j].id + ", rating : " + matchingGames[i].team2[j].rating );
	}
}
