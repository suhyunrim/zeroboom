const controller = require('../controller/match');

exports.run = async (message, args) => {
	var ret = await controller.calculateRating('휘핑크림');
	return ret.result;
}

exports.conf = {
	enabled: true,
	aliases: ['rr'],
};

exports.help = {
	name: 'refresh-rating',
	description: 'refresh rating.',
	usage: 'refresh-rating'
};
