const { logger } = require('../loaders/logger');
const matchMaker = require('./match-maker.js');
const User = require('../entity/user.js').User;

var preOrganizationTeam1 = [];
var preOrganizationTeam2 = [];
var userPool = [];
for(var i = 1; i <= 10; i++)
{
	var user = new User();
	user.set(i, i * 100 + i % 7);
	userPool.push(user);
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
	logger.info(JSON.stringify(matchingGames[i]));
}

// pre organization team, ex) Boom, Moon duo
logger.info("=============== preOrganizationTeam match =================");
var jungler1 = new User(11, 1100);
jungler1.set(11, 1100);
var jungler2 = new User();
jungler2.set(12, 800);

preOrganizationTeam1.push(jungler1);
preOrganizationTeam1.push(jungler2);

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
	logger.info(JSON.stringify(matchingGames[i]));
}

