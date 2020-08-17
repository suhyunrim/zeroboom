const { celebrate, Joi, Segments } = require('celebrate');

// const getValidator = celebrate({
//   [Segments.BODY]: Joi.object()
//     .keys({
//       type: Joi.string(),
//       typeId: Joi.number().integer(),
//     })
//     .xor('type', 'typeId'),
// });

module.exports.get = celebrate({
  [Segments.PARAMS]: Joi.object().keys({
    id: Joi.number()
      .integer()
      .required(),
  }),
});

module.exports.getByDiscordGuildId = celebrate({
  [Segments.PARAMS]: Joi.object().keys({
    id: Joi.string()
      .regex(/^\d+$/)
      .required(),
  }),
});
