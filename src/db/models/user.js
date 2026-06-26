module.exports = (sequelize, DataTypes) => {
  const user = sequelize.define(
    'user',
    {
      puuid: {
        type: DataTypes.STRING,
        primaryKey: true,
      },
      accountId: {
        type: DataTypes.STRING,
      },
      encryptedAccountId: {
        type: DataTypes.STRING,
      },
      groupId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
      },
      discordId: {
        type: DataTypes.STRING,
      },
      win: {
        type: DataTypes.INTEGER,
      },
      lose: {
        type: DataTypes.INTEGER,
      },
      defaultRating: {
        type: DataTypes.INTEGER,
      },
      additionalRating: {
        type: DataTypes.INTEGER,
      },
      role: {
        type: DataTypes.STRING,
        defaultValue: 'member',
        allowNull: false,
      },
      latestMatchDate: {
        type: DataTypes.DATE,
      },
      firstMatchDate: {
        type: DataTypes.DATE,
      },
      revisionDate: {
        type: DataTypes.DATE,
      },
      primaryPuuid: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      leftGuildAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      statusMessage: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      statusMessageUpdatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // 디스코드 서버 표시명(닉네임). 봇 이벤트/부팅 정합성 루프로 동기화한다.
      // 멤버 관리 목록 등에서 매 요청 guild.members.fetch 하지 않고 이 값을 읽는다(100개 fetch 제한 회피).
      discordNickname: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      indexes: [
        {
          name: 'uniq_group_discord',
          unique: true,
          fields: ['groupId', 'discordId'],
        },
      ],
    },
  );
  user.associate = (/* models */) => {
    // associations can be defined here
  };
  return user;
};
