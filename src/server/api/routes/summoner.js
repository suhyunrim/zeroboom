// import moment from 'moment';
import { Router } from 'express';
// import middlewares from '../middlewares';
import models from '../../db/models';
import riotAPIService from '../../services/riot-api';

const route = Router();

export default (app) => {
  app.use('/summoners', route);

  route.get('/name/:name', async (req, res) => {
    const { name } = req.params;

    // find existed Data
    let result = await models.summoner.findOne({ where: { name } });

    // if not exists
    if (!result) {
      result = await riotAPIService.getSummonerByName(name);
    }

    // const term = moment().diff(moment(result.updatedAt), 'days')

    return res.json({ result }).status(200);
  });
};
