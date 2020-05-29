const matchController = require('../controller/match');

exports.run = async (message, args) => {
	args = args.join(" ");
	args = args.split(",");

	var result = await matchController.generateMatch('휘핑크림', [], [], args);
	var ret = "";
	if(!result)
	{
		ret += "잘못된 소환사 아이디가 포함되어있습니다. 띄어쓰기및 대소문자를 정확하게 입력해주세요.\n";
		for(var arg of args)
		{
			ret += `${arg}\n`;
		}
	}
	else
	{
		ret += `${result.result.length}개의 매칭을 찾았어요!\n`;
		var i = 1;
		for(var match of result.result)
		{
			ret += `${i}번째 매칭\n`;
			ret += "```1팀vs 2팀\n";
			for(var j = 0; j < 5; j++)
			{
				ret += `${match.team1[j]} vs ${match.team2[j]}\n`;
			}
			ret += `${match.team1WinRate} vs ${1 - match.team1WinRate}`
			ret += "```";
			i++;
		}
	}
	return ret;
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
