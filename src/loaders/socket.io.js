const http = require('http');
const socketio = require('socket.io');
const { logger } = require('./logger');

module.exports = (app) => {
  const io = socketio();

  io.on('connection', (socket) => {
    logger.info('a user connected');
    // socket.broadcast.emit('hi');
    socket.on('disconnect', () => {
      logger.info('user disconnected');
    });
    socket.on('kakao_message', (msg) => {
      io.emit('server_message', msg);
    });
  });

  const server = http.createServer(app);
  io.attach(server);

  return server;
};
