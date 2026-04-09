module.exports = {
  up: async (queryInterface) => {
    // matches: groupId, gameCreation
    await queryInterface.addIndex('matches', ['groupId'], {
      name: 'matches_groupId',
    });
    await queryInterface.addIndex('matches', ['gameCreation'], {
      name: 'matches_gameCreation',
    });

    // users: discordId
    await queryInterface.addIndex('users', ['discordId'], {
      name: 'users_discordId',
    });

    // summoners: simplifiedName
    await queryInterface.addIndex('summoners', ['simplifiedName'], {
      name: 'summoners_simplifiedName',
    });

    // challenges: groupId, (startAt, endAt) 복합 인덱스
    await queryInterface.addIndex('challenges', ['groupId'], {
      name: 'challenges_groupId',
    });
    await queryInterface.addIndex('challenges', ['startAt', 'endAt'], {
      name: 'challenges_startAt_endAt',
    });

    // externalRecords: (puuid, groupId) 복합 인덱스, expiresAt
    await queryInterface.addIndex('externalRecords', ['puuid', 'groupId'], {
      name: 'externalRecords_puuid_groupId',
    });
    await queryInterface.addIndex('externalRecords', ['expiresAt'], {
      name: 'externalRecords_expiresAt',
    });

    // riot_matches: gameCreation
    await queryInterface.addIndex('riot_matches', ['gameCreation'], {
      name: 'riot_matches_gameCreation',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('matches', 'matches_groupId');
    await queryInterface.removeIndex('matches', 'matches_gameCreation');
    await queryInterface.removeIndex('users', 'users_discordId');
    await queryInterface.removeIndex('summoners', 'summoners_simplifiedName');
    await queryInterface.removeIndex('challenges', 'challenges_groupId');
    await queryInterface.removeIndex('challenges', 'challenges_startAt_endAt');
    await queryInterface.removeIndex('externalRecords', 'externalRecords_puuid_groupId');
    await queryInterface.removeIndex('externalRecords', 'externalRecords_expiresAt');
    await queryInterface.removeIndex('riot_matches', 'riot_matches_gameCreation');
  },
};
