module.exports = (sequelize, DataTypes) => {
  const profileVisit = sequelize.define(
    'profile_visit',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      targetPuuid: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      targetGroupId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      visitorDiscordId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      visitDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
    },
    {},
  );
  profileVisit.associate = (/* models */) => {};
  return profileVisit;
};
