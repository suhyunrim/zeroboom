const moment = require('moment');
const { Router } = require('express');
// const middlewares = require('../middlewares');
const models = require('../../db/models');
const riotAPIService = require('../../services/riot-api');

const route = Router();

module.exports = (app) => {
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
