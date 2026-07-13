// AI 대회 브릿지(listTournaments / predictTournament) DB 배선 통합 테스트.
// models를 목킹해 멤버 shape({puuid,position}) → 레이팅 조회 → 예상 순위 계산, puuid 비노출을 검증한다.
const mockModels = {
  tournament: { findAll: jest.fn() },
  tournament_team: { findAll: jest.fn() },
  tournament_match: { findAll: jest.fn() },
  tournament_scrim: { findAll: jest.fn() },
  match: { findAll: jest.fn() },
  user: { findAll: jest.fn() },
  summoner: { findAll: jest.fn() },
};

jest.mock('../../../src/db/models', () => mockModels);

const bridges = require('../../../src/services/ai/bridges');

// 대회들: 7차 CK(진행 전, 준비중) + 6차 CK(종료)
const TOURNAMENTS = [
  { id: 25, name: '7차 CK', type: 'auction', status: 'preparing', teamCount: 2, bracketSize: 2, heldAt: null, championTeamId: null },
  { id: 20, name: '6차 CK', type: 'normal', status: 'finished', teamCount: 8, bracketSize: 8, heldAt: new Date('2026-05-01'), championTeamId: 100 },
];

// 7차 CK 대진표: 결승 1매치(양팀 확정, 경기 전)
const MATCHES_25 = [
  { round: 1, bracketSlot: 0, team1Id: 1, team2Id: 2, team1Score: 0, team2Score: 0, winnerTeamId: null, bestOf: 5, scheduledAt: null },
];

// 7차 CK 팀: A팀(평균 700) > B팀(평균 500)
const TEAMS_25 = [
  { id: 1, name: 'A팀', captainPuuid: 'p1', members: [{ puuid: 'p1', position: 'top' }, { puuid: 'p2', position: 'jungle' }] },
  { id: 2, name: 'B팀', captainPuuid: 'p3', members: [{ puuid: 'p3', position: 'mid' }, { puuid: 'p4', position: 'adc' }] },
];

const USERS = {
  p1: { puuid: 'p1', defaultRating: 800, additionalRating: 0 },
  p2: { puuid: 'p2', defaultRating: 600, additionalRating: 0 },
  p3: { puuid: 'p3', defaultRating: 500, additionalRating: 0 },
  p4: { puuid: 'p4', defaultRating: 500, additionalRating: 0 },
};
const NAMES = { p1: '철수#KR1', p2: '영희#KR1', p3: '민수#KR1', p4: '지수#KR1' };

beforeEach(() => {
  mockModels.tournament.findAll.mockResolvedValue(TOURNAMENTS);
  mockModels.tournament_team.findAll.mockImplementation(({ where }) => Promise.resolve(where.tournamentId === 25 ? TEAMS_25 : []));
  mockModels.tournament_match.findAll.mockImplementation(({ where }) => Promise.resolve(where.tournamentId === 25 ? MATCHES_25 : []));
  mockModels.tournament_scrim.findAll.mockResolvedValue([]);
  mockModels.match.findAll.mockResolvedValue([]);
  mockModels.user.findAll.mockImplementation(({ where }) => Promise.resolve((where.puuid || []).map((p) => USERS[p]).filter(Boolean)));
  mockModels.summoner.findAll.mockImplementation(({ where }) => Promise.resolve((where.puuid || []).map((p) => ({ puuid: p, name: NAMES[p] })).filter((s) => s.name)));
});
afterEach(() => jest.clearAllMocks());

describe('listTournaments', () => {
  test('진행 중/준비 중 대회도 포함하고 statusLabel을 붙인다', async () => {
    const r = await bridges.listTournaments(4, {});
    expect(r.count).toBe(2);
    const names = r.tournaments.map((t) => t.name);
    expect(names).toContain('7차 CK');
    const ck7 = r.tournaments.find((t) => t.name === '7차 CK');
    expect(ck7.statusLabel).toBe('준비중');
    expect(ck7.championDecided).toBe(false);
    // 내부 식별자(id/championTeamId)는 노출하지 않는다
    expect(ck7.id).toBeUndefined();
    expect(ck7.championTeamId).toBeUndefined();
  });

  test('status로 거른다', async () => {
    const r = await bridges.listTournaments(4, { status: 'finished' });
    expect(r.count).toBe(1);
    expect(r.tournaments[0].name).toBe('6차 CK');
  });
});

describe('predictTournament', () => {
  test('이름 부분일치로 대회를 찾아 예상 순위를 매긴다(강팀 1위)', async () => {
    const r = await bridges.predictTournament(4, { name: '7차' });
    expect(r.tournament.name).toBe('7차 CK');
    expect(r.tournament.teamCount).toBe(2);
    expect(r.standings.map((t) => t.name)).toEqual(['A팀', 'B팀']);
    expect(r.standings[0].predictedRank).toBe(1);
    expect(r.standings[0].expectedWinRate).toBeGreaterThan(50);
    expect(r.note).toBeTruthy();
  });

  test('멤버 로스터에 이름/티어/주장 표시가 있고 raw 레이팅/puuid는 없다', async () => {
    const r = await bridges.predictTournament(4, { name: '7차 CK' });
    const a = r.standings.find((t) => t.name === 'A팀');
    expect(a.teamRatingTier).toBeTruthy();
    expect(a.avgRating).toBeUndefined(); // raw 평균 레이팅 비노출
    const captain = a.members.find((m) => m.isCaptain);
    expect(captain.name).toBe('철수#KR1');
    expect(a.members.every((m) => m.ratingTier)).toBe(true);
    // 응답 전체에 puuid가 새지 않는다
    expect(JSON.stringify(r)).not.toContain('p1');
  });

  test('이름 없이 호출하면 진행 중(준비중) 대회를 자동 선택한다', async () => {
    const r = await bridges.predictTournament(4, {});
    expect(r.tournament.name).toBe('7차 CK');
  });

  test('없는 대회면 error와 available 후보 목록을 반환한다', async () => {
    const r = await bridges.predictTournament(4, { name: '없는대회' });
    expect(r.error).toBeTruthy();
    expect(r.available).toEqual(expect.arrayContaining(['7차 CK', '6차 CK']));
  });
});

describe('getTournamentBracket', () => {
  test('대진표: 라운드 라벨/팀명/상태를 반환하고 puuid·팀id는 노출하지 않는다', async () => {
    const r = await bridges.getTournamentBracket(4, { name: '7차' });
    expect(r.tournament.name).toBe('7차 CK');
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({
      roundLabel: '결승', team1: 'A팀', team2: 'B팀', score: '0:0', bestOf: 5, status: 'scheduled', winner: null,
    });
    expect(r.note).toBeTruthy();
    expect(JSON.stringify(r)).not.toContain('p1');
    expect(r.matches[0].team1Id).toBeUndefined();
  });

  test('대진표가 아직 없으면 error를 반환한다', async () => {
    const r = await bridges.getTournamentBracket(4, { name: '6차 CK' });
    expect(r.error).toContain('대진표');
    expect(r.tournament.name).toBe('6차 CK');
  });
});
