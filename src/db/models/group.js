module.exports = (sequelize, DataTypes) => {
  const group = sequelize.define(
    'group',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      groupName: {
        type: DataTypes.STRING,
      },
      revisionDate: {
        type: DataTypes.DATE,
      },
    },
    {},
  );
  group.associate = (/* models */) => {
    // associations can be defined here
  };
  return group;
};
