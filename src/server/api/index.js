const { Router } = require('express');
const user = require ('./routes/user');

// guaranteed to get dependencies
module.exports = () => {
	const app = Router();
	user(app);

	return app
}
