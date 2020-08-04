const redis = require('redis');

const client = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASS,
  retry_strategy: function(options) {
    if (options.error && options.error.code === 'ECONNREFUSED') {
      // End reconnecting on a specific error and flush all commands with
      // a individual error
      return new Error('The server refused the connection');
    }
    if (options.total_retry_time > 1000 * 60 * 60) {
      // End reconnecting after a specific timeout and flush all commands
      // with a individual error
      return new Error('Retry time exhausted');
    }
    if (options.attempt > 10) {
      // End reconnecting with built in error
      return new Error('Retry attempt exceed');
    }
    // reconnect after
    return Math.min(options.attempt * 100, 3000);
  },
});

client.on('error', (error) => {
  logger.error(error);
});

const { promisify } = require('util');
client.getAsync = promisify(client.get).bind(client);
client.hgetAsync = promisify(client.hget).bind(client);

module.exports = client;
