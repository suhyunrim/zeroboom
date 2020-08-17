const handler = (callback, successCode = 200) => {
  return async (req, res, next) => {
    let result;

    try {
      result = await callback(req);
    } catch (err) {
      return next(err);
    }

    return res.json(result).status(successCode);
  };
};

module.exports = handler;
