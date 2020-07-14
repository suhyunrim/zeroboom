const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const controller = require('../../controller/match');

const route = Router();

module.exports = (app) => {
	app.use('/match', route);

	route.post('/register', async (req, res) => {
		const { tokenId, summonerName } = req.body;
		const result = await controller.registerMatch(tokenId, summonerName);
		return res.json(result).status(result.statusCode);
	});

	route.post('/calculate', async (req, res) => {
		const { groupName } = req.body;
		const ret = await controller.calculateRating(groupName);
		return res.json(ret);
	});
};
