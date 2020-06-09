const matchController = require('../controller/match');
const matchingFormattor = require('../discord/embed-messages/matching-results');

exports.run = async (message, args) => {
	args = args.join(" ");
	args = args.split(",");

	var userPool = new Array();
	var team1 = new Array();
	var team2 = new Array();

	args.forEach(function(user){
		var userInfo = user.split("@");
		if(userInfo.length == 1)
		{
			userPool.push(userInfo[0]);
			return;
		}

		if(userInfo[1] == 1)
		{
			team1.push(userInfo[0]);
		}

		if(userInfo[1] == 2)
		{
			team2.push(userInfo[0]);
		}
	});

	var result = await matchController.generateMatch('휘핑크림', team1, team2, userPool, 6);

	return result ? matchingFormattor(result.result) : `잘못된 소환사 아이디가 포함되어있습니다. 띄어쓰기및 대소문자를 정확하게 입력해주세요.\n${args}`;
}

exports.conf = {
	enabled: true,
	aliases: ['매칭생성', '자동매칭', 'mm'],
};

exports.help = {
	name: 'match-make',
	description: 'rating-based auto matching.',
	usage: '/match-make [command]'
};
