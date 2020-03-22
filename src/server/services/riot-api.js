import riotAPI from 'sample-node-package';
import { summoner as summonerModel } from '../db/models';

export const getSummonerByName = async (summonerName) => {
  const result = await riotAPI.summoner.getByName(summonerName)();

  if (result.status !== 200)
    throw new Error(
      `riotAPI.summoner.getByName(${summonerName}) => ${result.status}`,
    );

  const {
    id,
    accountId,
    puuid,
    name,
    profileIconId,
    revisionDate,
    summonerLevel,
  } = result.data;

  // result.data needs a validation checking...
  // example
  //   id: 'cNDxJdqeqRZvWs6mx2D37Ek17hx-du2DC6IFHvBl2CMWCA',
  //   accountId: 'PqyTUMIdc-KC9rX0Q4NQnftJPQZDGdYs1teOpqxeZi_L',
  //   puuid: 'lIFhkChvuDAUgq6h0vo6TKof_806lp8kOG6ymQ5Wd_VPZwmZQH_sEPXDldovb_0B8xi0s7zoVnnhaA',
  //   name: 'Hide on bush',
  //   profileIconId: 6,
  //   revisionDate: 1584824571000,
  //   summonerLevel: 297

  const dbResult = await summonerModel.create({
    riotId: id,
    accountId,
    puuid,
    name,
    profileIconId,
    revisionDate,
    summonerLevel,
  });

  return dbResult;
};

export const getEntriesBySummonerId = async (summonerId) => {
  const result = await riotAPI.league.getEntriesBySummonerId(summonerId)();

  return result;
};
