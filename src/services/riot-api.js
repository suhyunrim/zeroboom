const axios = require('axios');
const RIOT_API_KEY = process.env.RIOT_API_KEY;

/// v5
const getMatchIdsFromPuuid = async (puuid, beginIndex, count = 20, queue = null, startTime = null, endTime = null) => {
  const params = {
    api_key: RIOT_API_KEY,
    start: beginIndex,
    count,
  };

  // queue가 지정되면 해당 큐만 필터링 (420: 솔로랭크)
  if (queue) {
    params.queue = queue;
  }

  // epoch seconds 단위 시간 범위 필터
  if (startTime) {
    params.startTime = startTime;
  }
  if (endTime) {
    params.endTime = endTime;
  }

  const result = await axios({
    method: 'get',
    url: `https://asia.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids`,
    params,
  });

  if (result.status !== 200) {
    throw new Error(
      `riotAPI.match.v5.getMatchIdsFromPuuid(${puuid}) => ${result.status}`,
    );
  }

  return result.data;
};
exports.getMatchIdsFromPuuid = getMatchIdsFromPuuid;

const getMatchData = async (matchId) => {
  const result = await axios({
    method: 'get',
    url: `https://asia.api.riotgames.com/lol/match/v5/matches/${matchId}`,
    params: {
      api_key: RIOT_API_KEY,
    },
  });

  if (result.status !== 200) {
    throw new Error(
      `riotAPI.getMatchData(${matchId}) => ${result.status}`,
    );
  }

  return result.data;
};
exports.getMatchData = getMatchData;

/// V4
const getSummonerByName = async (summonerName) => {
  const split = summonerName.split('#');
  const name = split[0];
  const tagLine = split[1];
  const rsoResult = await axios({
    method: 'get',
    url: `https://asia.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${name}/${tagLine}`,
    params: {
      api_key: RIOT_API_KEY,
    },
  });

  if (rsoResult.status !== 200) {
    throw new Error(
      `riotAPI.getSummonerByName(${summonerName}) rsoResult => ${rsoResult.status}`,
    );
  }

  const result = await axios({
    method: 'get',
    url: `https://kr.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${rsoResult.data.puuid}`,
    params: {
      api_key: RIOT_API_KEY,
    },
  });

  // RSO에서 가져온 실제 닉네임 정보 추가
  result.data.riotId = `${rsoResult.data.gameName}#${rsoResult.data.tagLine}`;

  return result.data;
};
exports.getSummonerByName = getSummonerByName;

const getAccountByPuuid = async (puuid) => {
  const rsoResult = await axios({
    method: 'get',
    url: `https://asia.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}`,
    params: {
      api_key: RIOT_API_KEY,
    },
  });

  if (rsoResult.status !== 200) {
    throw new Error(
      `riotAPI.getAccountByPuuid(${puuid}) => ${rsoResult.status}`,
    );
  }

  return {
    puuid: rsoResult.data.puuid,
    gameName: rsoResult.data.gameName,
    tagLine: rsoResult.data.tagLine,
    riotId: `${rsoResult.data.gameName}#${rsoResult.data.tagLine}`,
  };
};
exports.getAccountByPuuid = getAccountByPuuid;

const getRankDataByPuuid = async (puuid) => {
  const result = await axios({
    method: 'get',
    url: `https://kr.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`,
    params: {
      api_key: RIOT_API_KEY,
    },
  });

  if (result.status !== 200) {
    throw new Error(
      `riotAPI.getRankDataByPuuid(${puuid}) => ${result.status}`,
    );
  }

  return result.data;
};
exports.getRankDataByPuuid = getRankDataByPuuid;
