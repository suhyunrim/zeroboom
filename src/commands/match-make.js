const matchController = require('../controller/match');
const matchingFormattor = require('../discord/embed-messages/matching-results');

exports.run = async ({ message, groupName, args }) => {
  args = args.join(' ');
  args = args.split(',');

  var userPool = new Array();
  var team1 = new Array();
  var team2 = new Array();

  args.forEach(function(user) {
    var userInfo = user.split('@');
    if (userInfo.length == 1) {
      userPool.push(userInfo[0]);
      return;
    }

    if (userInfo[1] == 1) {
      team1.push(userInfo[0]);
    }

    if (userInfo[1] == 2) {
      team2.push(userInfo[0]);
    }
  });

  var result = await matchController.generateMatch(
    groupName,
    team1,
    team2,
    userPool,
    6,
  );

  if (result.status !== 200) {
    return result.result;
  }

  return matchingFormattor(result.result);
};

exports.conf = {
  enabled: true,
  requireGroup: true,
  aliases: ['매칭생성', '자동매칭', 'mm'],
};

exports.help = {
  name: 'match-make',
  description: 'rating-based auto matching.',
  usage: '/match-make [command]',
};
