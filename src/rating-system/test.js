const { logger } = require('../loaders/logger');
const ratingSystem = require('./rating-system.js');
const User = require('../entity/user.js').User;

var team1 = new Array();
var team2 = new Array();

for(var i = 0; i < 5; i++)
{
	var user1 = new User();
	var user2 = new User();

	user1.set(i, 120 + i * 10);
	user2.set(i + 5, 170 + i * 10);

	team1.push(user1);
	team2.push(user2);
}

var team1WinRate = ratingSystem.getWinRate(team1, team2);
logger.info('team1WinRate:'.concat(team1WinRate)); // 0.428537...

var team2WinRate = 1 - team1WinRate; // or ratingSystem.getWinRate(team2, team1);
logger.info('team2WinRate:'.concat(team2WinRate)); // 0.571463...

var winner = team1;
// var winner = team2;

var winScore = 0;
if(winner == team1)
{
	winScore = ratingSystem.getWinScore(team1, team2); // 18.286820...
	// winScore = ratingSystem.getWinScoreByWinRate(team1WinRate); // 18.286820...
}
else if(winner == team2)
{
	winScore = ratingSystem.getWinScore(team1, team2); // 13.713180...
	// winScore = ratingSystem.getWinScoreByWinRate(team2WinRate); // 13.713180...
}

logger.info('winScore:'.concat(winScore));
