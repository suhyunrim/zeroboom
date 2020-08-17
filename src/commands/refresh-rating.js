const controller = require('../controller/match');

exports.run = async ({ message, groupName, args }) => {
  const ret = await controller.calculateRating(groupName);
  return ret.result;
};

exports.conf = {
  enabled: true,
  requireGroup: true,
  aliases: ['rr'],
};

exports.help = {
  name: 'refresh-rating',
  description: 'refresh rating.',
  usage: 'refresh-rating',
};
