// import moment from 'moment';
import { Router } from 'express';
// import middlewares from '../middlewares';

const route = Router();

export default (app) => {
  app.use('/chats', route);

  route.get('/', async (req, res) => {
    return res.json({ test: 'test' }).status(200);
  });
};
