import { Router } from 'express';
import summoner from './routes/summoner';

// guaranteed to get dependencies
export default () => {
  const app = Router();
  summoner(app);

  return app;
};
