const { Router } = require('express');
const user = require ('./routes/user');
const summoner = require ('./routes/summoner');

// guaranteed to get dependencies
module.exports = () => {
	const app = Router();
	user(app);
	summoner(app);

	return app
}
