// AI 승부예측 저장 서비스 — 마감선(rolling=매치 시작/bracket=대회 잠금) 준수와
// 트리 시뮬레이션, upsert 행 구성을 검증한다.
const mockModels = {
  tournament: { findByPk: jest.fn() },
  tournament_match: { findAll: jest.fn() },
  tournament_match_ai_prediction: { bulkCreate: jest.fn() },
  tournament_team: { findAll: jest.fn() },
  tournament_scrim: { findAll: jest.fn() },
  user: { findAll: jest.fn() },
  summoner: { findAll: jest.fn() },
  match: { findAll: jest.fn() }, // 시너지 스캔용 그룹 완료 매치
};

jest.mock('../../src/db/models', () => mockModels);

const service = require('../../src/services/tournament-ai-prediction');

// 팀 4개(팀당 1명): A(700) > C(650) > D(600) > B(500)
const TEAMS = [
  { id: 1, name: 'A팀', captainPuuid: 'puuid-a', members: [{ puuid: 'puuid-a', position: 'top' }] },
  { id: 2, name: 'B팀', captainPuuid: 'puuid-b', members: [{ puuid: 'puuid-b', position: 'top' }] },
  { id: 3, name: 'C팀', captainPuuid: 'puuid-c', members: [{ puuid: 'puuid-c', position: 'top' }] },
  { id: 4, name: 'D팀', captainPuuid: 'puuid-d', members: [{ puuid: 'puuid-d', position: 'top' }] },
];
const RATINGS = {
  'puuid-a': 700, 'puuid-b': 500, 'puuid-c': 650, 'puuid-d': 600,
};

const M = (over = {}) => ({
  id: 0, round: 1, bracketSlot: 0, team1Id: null, team2Id: null,
  team1Score: 0, team2Score: 0, winnerTeamId: null, bestOf: 3, scheduledAt: null, ...over,
});

beforeEach(() => {
  mockModels.tournament_team.findAll.mockResolvedValue(TEAMS);
  mockModels.tournament_scrim.findAll.mockResolvedValue([]);
  mockModels.user.findAll.mockImplementation(({ where }) => Promise.resolve(
    (where.puuid || []).filter((p) => RATINGS[p] != null).map((p) => ({ puuid: p, defaultRating: RATINGS[p], additionalRating: 0 })),
  ));
  mockModels.summoner.findAll.mockImplementation(({ where }) => Promise.resolve(
    (where.puuid || []).map((p) => ({ puuid: p, name: `유저${p.slice(-1)}#KR1` })),
  ));
  mockModels.match.findAll.mockResolvedValue([]); // 시너지 스캔 — 매치 없음(synergyPct=null 폴백)
  mockModels.tournament_match_ai_prediction.bulkCreate.mockImplementation((rows) => Promise.resolve(rows));
});
afterEach(() => jest.clearAllMocks());

describe('refreshAiPredictions — rolling', () => {
  const t = { id: 25, groupId: 4, status: 'in_progress', predictionMode: 'rolling' };

  test('예측 가능 매치만 기록하고, 시작된 매치(동결)와 대진 미정 매치는 건너뛴다', async () => {
    mockModels.tournament_match.findAll.mockResolvedValue([
      M({ id: 500, bracketSlot: 0, team1Id: 1, team2Id: 2 }), // 예측 가능
      M({ id: 501, bracketSlot: 1, team1Id: 3, team2Id: 4, team1Score: 1 }), // 시작됨 → 동결
      M({ id: 502, round: 2 }), // 대진 미정
    ]);
    const r = await service.refreshAiPredictions(t);
    expect(r.written).toBe(1);
    const rows = mockModels.tournament_match_ai_prediction.bulkCreate.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tournamentId: 25, matchId: 500, predictedTeamId: 1 }); // A(700) > B(500)
    expect(rows[0].team1WinProb).toBeGreaterThan(50);
    expect(rows[0].team1WinProb + rows[0].team2WinProb).toBeCloseTo(100, 1);
    expect(rows[0].factors.team1.name).toBe('A팀');
    expect(rows[0].computedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(rows[0].factors)).not.toContain('puuid-'); // puuid 비노출
  });

  test('기록할 매치가 없으면 bulkCreate를 호출하지 않는다', async () => {
    mockModels.tournament_match.findAll.mockResolvedValue([
      M({ id: 501, team1Id: 3, team2Id: 4, winnerTeamId: 3, team1Score: 2, team2Score: 0 }),
    ]);
    const r = await service.refreshAiPredictions(t);
    expect(r.written).toBe(0);
    expect(mockModels.tournament_match_ai_prediction.bulkCreate).not.toHaveBeenCalled();
  });
});

describe('refreshAiPredictions — bracket', () => {
  const t = { id: 26, groupId: 4, status: 'in_progress', predictionMode: 'bracket' };

  test('전체 트리 시뮬레이션: 예측 승자가 진출해 미래 라운드까지 기록한다', async () => {
    mockModels.tournament_match.findAll.mockResolvedValue([
      M({ id: 601, round: 1, bracketSlot: 0, team1Id: 1, team2Id: 2 }), // A vs B
      M({ id: 602, round: 1, bracketSlot: 1, team1Id: 3, team2Id: 4 }), // C vs D
      M({ id: 603, round: 2, bracketSlot: 0 }), // 결승(미정 → 예측 승자끼리)
    ]);
    const r = await service.refreshAiPredictions(t);
    expect(r.written).toBe(3);
    const rows = mockModels.tournament_match_ai_prediction.bulkCreate.mock.calls[0][0];
    const final = rows.find((x) => x.matchId === 603);
    expect(final.predictedTeamId).toBe(1); // 예측 결승 = A(700) vs C(650) → A
    expect(final.factors.team1.name).toBe('A팀');
    expect(final.factors.team2.name).toBe('C팀');
  });

  test('BYE 매치는 예측 없이 실제 승자가 진출한다', async () => {
    mockModels.tournament_match.findAll.mockResolvedValue([
      M({ id: 601, round: 1, bracketSlot: 0, team1Id: 1, team2Id: 2 }),
      M({ id: 602, round: 1, bracketSlot: 1, team1Id: 3, winnerTeamId: 3 }), // BYE(부전승)
      M({ id: 603, round: 2, bracketSlot: 0 }),
    ]);
    const r = await service.refreshAiPredictions(t);
    expect(r.written).toBe(2); // 601 + 603 (602는 BYE라 제외)
    const rows = mockModels.tournament_match_ai_prediction.bulkCreate.mock.calls[0][0];
    const final = rows.find((x) => x.matchId === 603);
    expect(final.factors.team2.name).toBe('C팀'); // BYE 진출자
  });

  test('대회가 잠기면(첫 매치 시작) 전체 동결 — 아무것도 쓰지 않는다', async () => {
    mockModels.tournament_match.findAll.mockResolvedValue([
      M({ id: 601, round: 1, bracketSlot: 0, team1Id: 1, team2Id: 2, team1Score: 1 }), // 시작됨
      M({ id: 602, round: 1, bracketSlot: 1, team1Id: 3, team2Id: 4 }),
      M({ id: 603, round: 2, bracketSlot: 0 }),
    ]);
    const r = await service.refreshAiPredictions(t);
    expect(r.written).toBe(0);
    expect(mockModels.tournament_match_ai_prediction.bulkCreate).not.toHaveBeenCalled();
  });
});

describe('refreshAiPredictions — 공통 가드', () => {
  test('종료된 대회는 no-op', async () => {
    const r = await service.refreshAiPredictions({ id: 20, groupId: 4, status: 'finished', predictionMode: 'rolling' });
    expect(r.written).toBe(0);
    expect(mockModels.tournament_match.findAll).not.toHaveBeenCalled();
  });

  test('id로 호출하면 findByPk로 로드한다', async () => {
    mockModels.tournament.findByPk.mockResolvedValue(null);
    const r = await service.refreshAiPredictions(999);
    expect(r.written).toBe(0);
    expect(mockModels.tournament.findByPk).toHaveBeenCalledWith(999);
  });
});

describe('toPredictionEntries', () => {
  test('저장 행을 리더보드 주입용 유저 예측 형태로 변환한다', () => {
    const entries = service.toPredictionEntries([
      { matchId: 500, predictedTeamId: 1, computedAt: new Date('2026-07-13') },
    ]);
    expect(entries).toEqual([{
      matchId: 500,
      userPuuid: service.AI_USER_PUUID,
      predictedTeamId: 1,
      summonerName: service.AI_DISPLAY_NAME,
      updatedAt: new Date('2026-07-13'),
      isAi: true,
    }]);
  });
});
