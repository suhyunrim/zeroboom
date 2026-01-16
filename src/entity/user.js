const { logger } = require('../loaders/logger');

class User {
	setFromUserModel(userModel) {
		this.id = userModel.puuid;
		this.rating = userModel.defaultRating + userModel.additionalRating;
	}

	set(id, rating) {
		this.id = id;
		this.rating = rating;
	}
}

exports.User = User;
