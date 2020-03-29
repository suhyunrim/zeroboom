import http from 'http';
import socketio from 'socket.io';
import { logger } from './logger';

export default (app) => {
  const io = socketio();

  io.on('connection', (socket) => {
    logger.info('a user connected');
    // socket.broadcast.emit('hi');
    socket.on('connected', 'hi');
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
