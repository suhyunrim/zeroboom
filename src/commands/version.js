const { version } = require('../../package.json');

exports.run = async (groupName, interaction) => {
  return version;
};

exports.conf = {
  enabled: true,
  aliases: ['v', '버전'],
  args: [],
};

exports.help = {
  name: 'version',
  description: 'version info',
  usage: 'version',
};
