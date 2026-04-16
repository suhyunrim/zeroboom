module.exports = {
  up: async (queryInterface) => {
    const groups = await queryInterface.sequelize.query('SELECT id, settings FROM `groups`', {
      type: queryInterface.sequelize.QueryTypes.SELECT,
    });

    await Promise.all(
      groups.map((group) => {
        const settings = typeof group.settings === 'string' ? JSON.parse(group.settings) : (group.settings || {});
        settings.currentSeason = 1;
        return queryInterface.sequelize.query('UPDATE `groups` SET settings = ? WHERE id = ?', {
          replacements: [JSON.stringify(settings), group.id],
        });
      }),
    );
  },

  down: async (queryInterface) => {
    const groups = await queryInterface.sequelize.query('SELECT id, settings FROM `groups`', {
      type: queryInterface.sequelize.QueryTypes.SELECT,
    });

    await Promise.all(
      groups.map((group) => {
        const settings = typeof group.settings === 'string' ? JSON.parse(group.settings) : (group.settings || {});
        delete settings.currentSeason;
        return queryInterface.sequelize.query('UPDATE `groups` SET settings = ? WHERE id = ?', {
          replacements: [JSON.stringify(settings), group.id],
        });
      }),
    );
  },
};
