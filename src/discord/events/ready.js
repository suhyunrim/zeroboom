const { logger } = require('../../loaders/logger');

module.exports = client => {
	logger.info(`Logged in as ${client.user.tag}!`);
};
