const http = require('http');
const socketio = require('socket.io');
const { logger } = require('./logger');

module.exports = (app) => {
  const io = socketio();

  io.on('connection', (socket) => {
    logger.info('a user connected');
    socket.on('disconnect', () => {
      logger.info('user disconnected');
    });
    socket.on('kakao_message', (msg) => {
      io.emit('server_message', msg);
    });
    // 토너먼트 경매 페이지 등에서 실시간 업데이트를 받기 위해 룸 join/leave
    socket.on('tournament:join', (tournamentId) => {
      const id = Number(tournamentId);
      if (!Number.isInteger(id) || id <= 0) return;
      socket.join(`tournament:${id}`);
    });
    socket.on('tournament:leave', (tournamentId) => {
      const id = Number(tournamentId);
      if (!Number.isInteger(id) || id <= 0) return;
      socket.leave(`tournament:${id}`);
    });
  });

  const server = http.createServer(app);
  io.attach(server);

  // 라우트에서 req.app.get('io')로 접근하여 emit할 수 있게 등록
  app.set('io', io);

  return server;
};
