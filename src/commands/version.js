const { version } = require('../../package.json');

exports.run = async (message, args) => {
  return version;
};

exports.conf = {
  enabled: true,
  aliases: ['v', '버전'],
};

exports.help = {
  name: 'version',
  description: 'version info',
  usage: 'version',
};
