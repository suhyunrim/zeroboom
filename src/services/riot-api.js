const { logger } = require('../loaders/logger');

const axios = require('axios');
const RIOT_API_KEY = process.env.RIOT_API_KEY;

/// v5
const getMatchIdsFromSummonerName = async (summonerName, beginIndex, count = 20) => {
  const summoner = await getSummonerByName(summonerName);
  const puuid = summoner.puuid;
  const result = await getMatchIdsFromPuuid(puuid, beginIndex, count);

  if (result.status !== 200)
    throw new Error(
      `riotAPI.match.v5.getMatchIdsFromSummonerName(${puuid}) => ${result.status}`,
    );

  return result.data;
}
exports.getMatchIdsFromSummonerName = getMatchIdsFromSummonerName;

const getMatchIdsFromPuuid = async (puuid, beginIndex, count = 20) => {
  const result = await axios({
    method:'get',
    url:`https://asia.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids`,
    params: {
      api_key: RIOT_API_KEY,
      start: beginIndex,
      count,
    }
  });

  if (result.status !== 200)
    throw new Error(
      `riotAPI.match.v5.getMatchIdsFromPuuid(${puuid}) => ${result.status}`,
    );

  return result.data;
}
exports.getMatchIdsFromPuuid = getMatchIdsFromPuuid;

const getMatchData = async (matchId) => {
  const result = await axios({
    method:'get',
    url:`https://asia.api.riotgames.com/lol/match/v5/matches/${matchId}`,
    params: {
      api_key: RIOT_API_KEY,
    }
  });

  if (result.status !== 200)
    throw new Error(
      `riotAPI.getMatchData(${matchId}) => ${result.status}`,
    );

  return result.data;
}
exports.getMatchData = getMatchData;

/// V4
const getSummonerByName = async (summonerName) => {
  const split = summonerName.split('#');
  const name = split[0];
  const tagLine = split[1];
  const rsoResult = await axios({
    method:'get',
    url:`https://asia.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${name}/${tagLine}`,
    params: {
      api_key: RIOT_API_KEY,
    }
  });

  if (rsoResult.status !== 200)
    throw new Error(
      `riotAPI.getSummonerByName(${summonerName}) rsoResult => ${rsoResult.status}`,
    );

  const result = await axios({
    method:'get',
    url:`https://kr.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${rsoResult.data.puuid}`,
    params: {
      api_key: RIOT_API_KEY,
    }
  });

  return result.data;
};

exports.getSummonerByName = getSummonerByName;

const getRankDataByPuuid = async (puuid) => {
  const result = await axios({
    method:'get',
    url:`https://kr.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`,
    params: {
      api_key: RIOT_API_KEY,
    }
  });

  if (result.status !== 200)
    throw new Error(
      `riotAPI.getRankDataByPuuid(${puuid}) => ${result.status}`,
    );

  return result.data;
};

exports.getRankDataByPuuid = getRankDataByPuuid;

// 이하 동작 안함 (by zeroboom)

// /// V1
// const getSummonerByName_V1 = async (tokenId, summonerName) => {
//   const result = await riotAPI.v1.summoner.getByName(tokenId, summonerName)();

//   if (result.status !== 200)
//     throw new Error(
//       `riotAPI.v1.summoner.getByName(${summonerName}) => ${result.status}`,
//     );

//   result.data.accountId = String(result.data.accountId);
//   return result.data;
// };

// exports.getSummonerByName_V1 = getSummonerByName_V1;

// const getCustomGames = async (tokenId, accountId, until) => {
//   let customGames = [];

//   try {
//     let beginIndex = 0;
//     let isFinished = false;
//     until = until ? until : Date.now() - 86400 * 30 * 3 * 1000;
//     while (!isFinished) {
//       const result = await riotAPI.v1.match.getCustomMatchHistory(
//         tokenId,
//         accountId,
//         beginIndex,
//       )();
//       if (result.status != 200)
//         throw new Error(
//           `riotAPI.v1.match.getCustomMatchHistory(${accountId}) => ${result.status}`,
//         );

//       if (result.data.games.games.length === 0) {
//         break;
//       }

//       const matches = result.data.games.games;
//       // index가 뒤로 갈 수록 나중 매치기 때문에 뒤에서부터 인덱싱
//       for (let i = matches.length - 1; i >= 0; --i) {
//         const match = matches[i];
//         if (match.gameCreation <= until) {
//           isFinished = true;
//           break;
//         }

//         if (
//           match.gameMode !== 'CLASSIC' ||
//           match.gameType !== 'CUSTOM_GAME' ||
//           match.mapId !== 11
//         )
//           continue;

//         customGames.push(match);
//       }

//       beginIndex += 20;
//     }
//   } catch (e) {
//     logger.error(e.stack);
//     logger.error(`getCustomGames(${accountId})`);
//   }

//   return customGames;
// };

// exports.getCustomGames = getCustomGames;

// const getCustomGameIds = async (tokenId, accountId, until) => {
//   let customGames = await getCustomGames(tokenId, accountId, until);
//   return customGames.map((elem) => elem.gameId);
// };

// exports.getCustomGameIds = getCustomGameIds;

// const getMatchData = async (tokenId, gameId) => {
//   try {
//     const result = await riotAPI.v1.match.getMatchData(tokenId, gameId)();
//     if (result.status != 200)
//       throw new Error(
//         `riotAPI.v1.match.getMatchData(${gameId}) => ${result.status}`,
//       );

//     const data = result.data;
//     let matchData = {
//       gameId: data.gameId,
//       gameCreation: new Date(data.gameCreation),
//       winTeam: data.teams[0].win == 'Win' ? 1 : 2,
//       team1: [],
//       team2: [],
//     };

//     data.participantIdentities.forEach((identity) => {
//       const participantData = data.participants.find(
//         (elem) => elem.participantId == identity.participantId,
//       );
//       if (participantData) {
//         const team =
//           participantData.teamId == 100 ? matchData.team1 : matchData.team2;
//         team.push([
//           String(identity.player.accountId),
//           identity.player.summonerName,
//         ]);
//       }
//     });

//     return matchData;
//   } catch (e) {
//     logger.error(e.stack);
//     logger.error(`getMatchData(${gameId})`);
//   }
// };

// exports.getMatchData = getMatchData;
