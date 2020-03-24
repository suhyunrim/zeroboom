import { Router } from 'express';
import summoner from './routes/summoner';
import chat from './routes/chat';

// guaranteed to get dependencies
export default () => {
  const app = Router();
  summoner(app);
  chat(app);

  return app;
};
