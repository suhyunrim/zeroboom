const mockModels = {
  user: { findAll: jest.fn() },
  tournament: { findByPk: jest.fn() },
  tournament_team: { findAll: jest.fn() },
  tournament_match: { findAll: jest.fn(), findOne: jest.fn() },
  tournament_scrim: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() },
  tournament_match_prediction: { findAll: jest.fn(), bulkCreate: jest.fn(), destroy: jest.fn() },
};

jest.mock('../../src/db/models', () => mockModels);
jest.mock('../../src/loaders/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const tournamentController = require('../../src/controller/tournament');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('computeBracketSize', () => {
  test('2의 거듭제곱은 그대로', () => {
    expect(tournamentController.computeBracketSize(2)).toBe(2);
    expect(tournamentController.computeBracketSize(4)).toBe(4);
    expect(tournamentController.computeBracketSize(8)).toBe(8);
    expect(tournamentController.computeBracketSize(16)).toBe(16);
    expect(tournamentController.computeBracketSize(32)).toBe(32);
  });

  test('아닐 경우 다음 2의 거듭제곱', () => {
    expect(tournamentController.computeBracketSize(3)).toBe(4);
    expect(tournamentController.computeBracketSize(5)).toBe(8);
    expect(tournamentController.computeBracketSize(9)).toBe(16);
    expect(tournamentController.computeBracketSize(12)).toBe(16);
    expect(tournamentController.computeBracketSize(17)).toBe(32);
  });

  test('최소값 2', () => {
    expect(tournamentController.computeBracketSize(0)).toBe(2);
    expect(tournamentController.computeBracketSize(1)).toBe(2);
  });
});

describe('getWinningScore', () => {
  test('BO3는 2', () => {
    expect(tournamentController.getWinningScore(3)).toBe(2);
  });
  test('BO5는 3', () => {
    expect(tournamentController.getWinningScore(5)).toBe(3);
  });
  test('BO1은 1', () => {
    expect(tournamentController.getWinningScore(1)).toBe(1);
  });
});

describe('computeRoundLabels', () => {
  test('teamCount = bracketSize 인 8팀', () => {
    expect(tournamentController.computeRoundLabels(8, 8)).toEqual({ 1: '8강', 2: '4강', 3: '결승' });
  });

  test('teamCount = bracketSize 인 16팀', () => {
    expect(tournamentController.computeRoundLabels(16, 16)).toEqual({
      1: '16강',
      2: '8강',
      3: '4강',
      4: '결승',
    });
  });

  test('9팀(16강 브래킷)은 R1이 예선', () => {
    expect(tournamentController.computeRoundLabels(16, 9)).toEqual({
      1: '예선',
      2: '8강',
      3: '4강',
      4: '결승',
    });
  });

  test('5팀(8강 브래킷)은 R1이 예선', () => {
    expect(tournamentController.computeRoundLabels(8, 5)).toEqual({ 1: '예선', 2: '4강', 3: '결승' });
  });

  test('2팀은 결승만', () => {
    expect(tournamentController.computeRoundLabels(2, 2)).toEqual({ 1: '결승' });
  });
});

describe('getNextMatchPosition', () => {
  test('R1 slot 0은 R2 slot 0의 team1', () => {
    expect(tournamentController.getNextMatchPosition(1, 0)).toEqual({ round: 2, slot: 0, side: 'team1' });
  });
  test('R1 slot 1은 R2 slot 0의 team2', () => {
    expect(tournamentController.getNextMatchPosition(1, 1)).toEqual({ round: 2, slot: 0, side: 'team2' });
  });
  test('R1 slot 2는 R2 slot 1의 team1', () => {
    expect(tournamentController.getNextMatchPosition(1, 2)).toEqual({ round: 2, slot: 1, side: 'team1' });
  });
  test('R2 slot 3은 R3 slot 1의 team2', () => {
    expect(tournamentController.getNextMatchPosition(2, 3)).toEqual({ round: 3, slot: 1, side: 'team2' });
  });
});

describe('validateScore', () => {
  test('BO3 2-0 valid', () => {
    expect(tournamentController.validateScore(3, 2, 0)).toBe(true);
  });
  test('BO3 2-1 valid', () => {
    expect(tournamentController.validateScore(3, 2, 1)).toBe(true);
  });
  test('BO3 1-2 valid', () => {
    expect(tournamentController.validateScore(3, 1, 2)).toBe(true);
  });
  test('BO3 1-1 invalid (동점)', () => {
    expect(tournamentController.validateScore(3, 1, 1)).toBe(false);
  });
  test('BO3 3-0 invalid (오버슈팅)', () => {
    expect(tournamentController.validateScore(3, 3, 0)).toBe(false);
  });
  test('BO3 0-0 invalid', () => {
    expect(tournamentController.validateScore(3, 0, 0)).toBe(false);
  });
  test('BO5 3-2 valid', () => {
    expect(tournamentController.validateScore(5, 3, 2)).toBe(true);
  });
  test('BO5 3-3 invalid', () => {
    expect(tournamentController.validateScore(5, 3, 3)).toBe(false);
  });
  test('음수 invalid', () => {
    expect(tournamentController.validateScore(3, -1, 2)).toBe(false);
  });
  test('비정수 invalid', () => {
    expect(tournamentController.validateScore(3, 2.5, 1)).toBe(false);
  });
});

describe('validateTeamInput', () => {
  const validMembers = [
    { puuid: 'p1', position: 'top' },
    { puuid: 'p2', position: 'jungle' },
    { puuid: 'p3', position: 'mid' },
    { puuid: 'p4', position: 'adc' },
    { puuid: 'p5', position: 'support' },
  ];

  test('정상 입력', () => {
    expect(
      tournamentController.validateTeamInput({
        name: '제로붐파이터즈',
        captainPuuid: 'p1',
        members: validMembers,
      }),
    ).toBeNull();
  });

  test('팀명 누락', () => {
    expect(
      tournamentController.validateTeamInput({ name: '', captainPuuid: 'p1', members: validMembers }),
    ).toBe('팀명이 필요합니다.');
  });

  test('인원수 부족', () => {
    expect(
      tournamentController.validateTeamInput({
        name: 'X',
        captainPuuid: 'p1',
        members: validMembers.slice(0, 4),
      }),
    ).toBe('팀원은 5명이어야 합니다.');
  });

  test('puuid 중복', () => {
    const dup = [...validMembers];
    dup[1] = { puuid: 'p1', position: 'jungle' };
    expect(
      tournamentController.validateTeamInput({ name: 'X', captainPuuid: 'p1', members: dup }),
    ).toBe('같은 팀에 동일 인물이 중복되어 있습니다.');
  });

  test('잘못된 포지션', () => {
    const bad = [...validMembers];
    bad[0] = { puuid: 'p1', position: 'cooler' };
    expect(
      tournamentController.validateTeamInput({ name: 'X', captainPuuid: 'p1', members: bad }),
    ).toBe('유효하지 않은 포지션입니다.');
  });

  test('팀장이 멤버에 없음', () => {
    expect(
      tournamentController.validateTeamInput({
        name: 'X',
        captainPuuid: 'pX',
        members: validMembers,
      }),
    ).toBe('팀장은 팀원 중 한 명이어야 합니다.');
  });

  test('팀원 puuid 누락', () => {
    const bad = [...validMembers];
    bad[2] = { puuid: '', position: 'mid' };
    expect(
      tournamentController.validateTeamInput({ name: 'X', captainPuuid: 'p1', members: bad }),
    ).toBe('팀원의 puuid가 필요합니다.');
  });
});

describe('validateTrophyType', () => {
  test('null/undefined은 통과 (optional)', () => {
    expect(tournamentController.validateTrophyType(null)).toBeNull();
    expect(tournamentController.validateTrophyType(undefined)).toBeNull();
  });

  test('국제(worlds/msi/first_stand/ewc) + 한국(lck/kespa) 모두 통과', () => {
    expect(tournamentController.validateTrophyType('worlds')).toBeNull();
    expect(tournamentController.validateTrophyType('msi')).toBeNull();
    expect(tournamentController.validateTrophyType('first_stand')).toBeNull();
    expect(tournamentController.validateTrophyType('ewc')).toBeNull();
    expect(tournamentController.validateTrophyType('lck')).toBeNull();
    expect(tournamentController.validateTrophyType('kespa')).toBeNull();
  });

  test('알 수 없는 값은 에러', () => {
    expect(tournamentController.validateTrophyType('unknown')).toMatch(/trophyType은/);
    expect(tournamentController.validateTrophyType('WORLDS')).toMatch(/trophyType은/);
    expect(tournamentController.validateTrophyType('')).toMatch(/trophyType은/);
  });

  test('비문자열 거부', () => {
    expect(tournamentController.validateTrophyType(123)).toMatch(/trophyType은/);
    expect(tournamentController.validateTrophyType({})).toMatch(/trophyType은/);
  });
});

describe('validateScrimInput', () => {
  const teams = [{ id: 1 }, { id: 2 }, { id: 3 }];

  test('정상 입력', () => {
    expect(
      tournamentController.validateScrimInput(
        { team1Id: 1, team2Id: 2, team1Score: 2, team2Score: 1 },
        teams,
      ),
    ).toBeNull();
  });

  test('동점도 정상', () => {
    expect(
      tournamentController.validateScrimInput(
        { team1Id: 1, team2Id: 2, team1Score: 1, team2Score: 1 },
        teams,
      ),
    ).toBeNull();
  });

  test('같은 팀 매치업 거부', () => {
    expect(
      tournamentController.validateScrimInput(
        { team1Id: 1, team2Id: 1, team1Score: 2, team2Score: 0 },
        teams,
      ),
    ).toBe('같은 팀끼리 스크림을 할 수 없습니다.');
  });

  test('팀 ID 누락', () => {
    expect(
      tournamentController.validateScrimInput(
        { team1Id: null, team2Id: 2, team1Score: 0, team2Score: 0 },
        teams,
      ),
    ).toBe('team1Id, team2Id가 필요합니다.');
  });

  test('음수 점수 거부', () => {
    expect(
      tournamentController.validateScrimInput(
        { team1Id: 1, team2Id: 2, team1Score: -1, team2Score: 1 },
        teams,
      ),
    ).toBe('점수는 0 이상이어야 합니다.');
  });

  test('비정수 점수 거부', () => {
    expect(
      tournamentController.validateScrimInput(
        { team1Id: 1, team2Id: 2, team1Score: 1.5, team2Score: 0 },
        teams,
      ),
    ).toBe('점수는 정수여야 합니다.');
  });

  test('토너먼트 팀이 아님', () => {
    expect(
      tournamentController.validateScrimInput(
        { team1Id: 1, team2Id: 99, team1Score: 0, team2Score: 0 },
        teams,
      ),
    ).toBe('두 팀 모두 이 토너먼트의 팀이어야 합니다.');
  });
});

describe('computeTeamScrimRecord', () => {
  const scrims = [
    { team1Id: 1, team2Id: 2, team1Score: 3, team2Score: 0 },
    { team1Id: 1, team2Id: 3, team1Score: 2, team2Score: 3 },
    { team1Id: 2, team2Id: 1, team1Score: 1, team2Score: 1 },
    { team1Id: 4, team2Id: 5, team1Score: 5, team2Score: 5 },
  ];

  test('team1 등장 시 자기 점수가 승, 상대 점수가 패', () => {
    expect(tournamentController.computeTeamScrimRecord(1, scrims)).toEqual({
      won: 3 + 2 + 1,
      lost: 0 + 3 + 1,
      played: 3,
    });
  });

  test('team2 등장 시도 정확히 집계', () => {
    expect(tournamentController.computeTeamScrimRecord(3, scrims)).toEqual({
      won: 3,
      lost: 2,
      played: 1,
    });
  });

  test('전적 없는 팀은 0', () => {
    expect(tournamentController.computeTeamScrimRecord(99, scrims)).toEqual({
      won: 0,
      lost: 0,
      played: 0,
    });
  });

  test('빈 스크림 배열', () => {
    expect(tournamentController.computeTeamScrimRecord(1, [])).toEqual({
      won: 0,
      lost: 0,
      played: 0,
    });
  });
});

describe('computeHeadToHeadScrim', () => {
  const scrims = [
    { team1Id: 1, team2Id: 2, team1Score: 3, team2Score: 0 },
    { team1Id: 2, team2Id: 1, team1Score: 1, team2Score: 2 },
    { team1Id: 1, team2Id: 3, team1Score: 5, team2Score: 5 },
  ];

  test('양쪽 슬롯 다 합쳐서 집계 (team1 관점에서 5승 1패)', () => {
    expect(tournamentController.computeHeadToHeadScrim(1, 2, scrims)).toEqual({
      team1: { won: 3 + 2, lost: 0 + 1 },
      team2: { won: 0 + 1, lost: 3 + 2 },
      played: 2,
    });
  });

  test('상대 팀 입장에서도 똑같이 동작', () => {
    expect(tournamentController.computeHeadToHeadScrim(2, 1, scrims)).toEqual({
      team1: { won: 0 + 1, lost: 3 + 2 },
      team2: { won: 3 + 2, lost: 0 + 1 },
      played: 2,
    });
  });

  test('맞붙은 적 없으면 0', () => {
    expect(tournamentController.computeHeadToHeadScrim(2, 3, scrims)).toEqual({
      team1: { won: 0, lost: 0 },
      team2: { won: 0, lost: 0 },
      played: 0,
    });
  });
});

describe('validateSlotMapping', () => {
  const teams = [{ id: 10 }, { id: 11 }, { id: 12 }, { id: 13 }];

  test('정상 4팀 8슬롯 (모두 채움)', () => {
    expect(
      tournamentController.validateSlotMapping([10, 11, 12, 13], teams.slice(0, 4), 4, 4),
    ).toBeNull();
  });

  test('BYE 포함 정상', () => {
    expect(
      tournamentController.validateSlotMapping([10, null, 11, null], teams.slice(0, 2), 4, 2),
    ).toBeNull();
  });

  test('길이 불일치', () => {
    expect(
      tournamentController.validateSlotMapping([10, 11, 12], teams, 4, 4),
    ).toBe('slotMapping은 길이 4의 배열이어야 합니다.');
  });

  test('팀 수 불일치', () => {
    expect(
      tournamentController.validateSlotMapping([10, 11, null, null], teams, 4, 4),
    ).toBe('정확히 4개의 팀을 배치해야 합니다.');
  });

  test('중복 배치', () => {
    expect(
      tournamentController.validateSlotMapping([10, 10, 11, 12], teams, 4, 4),
    ).toBe('같은 팀이 여러 슬롯에 배치되었습니다.');
  });

  test('존재하지 않는 팀', () => {
    expect(
      tournamentController.validateSlotMapping([10, 11, 12, 99], teams, 4, 4),
    ).toBe('존재하지 않는 팀이 슬롯에 포함되어 있습니다.');
  });

  test('한 매치에 두 BYE', () => {
    expect(
      tournamentController.validateSlotMapping([10, 11, null, null], teams.slice(0, 2), 4, 2),
    ).toBe('한 매치에 두 BYE가 들어갈 수 없습니다.');
  });
});

describe('computeWinProbability', () => {
  test('동일 레이팅이면 50%', () => {
    expect(tournamentController.computeWinProbability(500, 500)).toBeCloseTo(0.5);
  });

  test('400점 높으면 약 90.9%', () => {
    expect(tournamentController.computeWinProbability(900, 500)).toBeCloseTo(0.909, 2);
  });

  test('400점 낮으면 약 9.1%', () => {
    expect(tournamentController.computeWinProbability(500, 900)).toBeCloseTo(0.091, 2);
  });

  test('합이 1', () => {
    const a = tournamentController.computeWinProbability(620, 480);
    const b = tournamentController.computeWinProbability(480, 620);
    expect(a + b).toBeCloseTo(1.0);
  });

  test('null 입력은 null 반환', () => {
    expect(tournamentController.computeWinProbability(null, 500)).toBeNull();
    expect(tournamentController.computeWinProbability(500, null)).toBeNull();
    expect(tournamentController.computeWinProbability(null, null)).toBeNull();
  });
});

describe('computeTeamAvgRating', () => {
  test('5명 평균', () => {
    const members = [
      { puuid: 'p1' },
      { puuid: 'p2' },
      { puuid: 'p3' },
      { puuid: 'p4' },
      { puuid: 'p5' },
    ];
    const ratings = { p1: 500, p2: 600, p3: 400, p4: 700, p5: 300 };
    expect(tournamentController.computeTeamAvgRating(members, ratings)).toBe(500);
  });

  test('일부 멤버만 레이팅 있으면 있는 것만 평균', () => {
    const members = [{ puuid: 'p1' }, { puuid: 'p2' }];
    const ratings = { p1: 500 };
    expect(tournamentController.computeTeamAvgRating(members, ratings)).toBe(500);
  });

  test('아무도 레이팅 없으면 null', () => {
    expect(tournamentController.computeTeamAvgRating([{ puuid: 'p1' }], {})).toBeNull();
  });

  test('빈 멤버 배열은 null', () => {
    expect(tournamentController.computeTeamAvgRating([], { p1: 500 })).toBeNull();
  });
});

describe('generateMatchRows', () => {
  test('8팀 브래킷은 7개 매치 (R1: 4 + R2: 2 + R3: 1)', () => {
    const rows = tournamentController.generateMatchRows(99, 8, 3, 5);
    expect(rows).toHaveLength(7);
    const r1 = rows.filter((r) => r.round === 1);
    const r2 = rows.filter((r) => r.round === 2);
    const r3 = rows.filter((r) => r.round === 3);
    expect(r1).toHaveLength(4);
    expect(r2).toHaveLength(2);
    expect(r3).toHaveLength(1);
  });

  test('결승만 finalBestOf, 나머지는 defaultBestOf', () => {
    const rows = tournamentController.generateMatchRows(99, 8, 3, 5);
    rows.forEach((r) => {
      if (r.round === 3) expect(r.bestOf).toBe(5);
      else expect(r.bestOf).toBe(3);
    });
  });

  test('16팀 브래킷은 15개 매치', () => {
    const rows = tournamentController.generateMatchRows(99, 16, 3, 5);
    expect(rows).toHaveLength(15);
  });

  test('모든 슬롯 인덱스가 0..matchCount-1', () => {
    const rows = tournamentController.generateMatchRows(99, 8, 3, 5);
    const r1Slots = rows.filter((r) => r.round === 1).map((r) => r.bracketSlot).sort();
    expect(r1Slots).toEqual([0, 1, 2, 3]);
  });

  test('초기 점수와 winnerTeamId는 비어있음', () => {
    const rows = tournamentController.generateMatchRows(99, 4, 3, 5);
    rows.forEach((r) => {
      expect(r.team1Score).toBe(0);
      expect(r.team2Score).toBe(0);
      expect(r.winnerTeamId).toBeNull();
      expect(r.team1Id).toBeNull();
      expect(r.team2Id).toBeNull();
    });
  });
});

describe('isTournamentLocked', () => {
  test('모든 매치가 시작 전이면 false', () => {
    const matches = [
      { team1Id: 1, team2Id: 2, team1Score: 0, team2Score: 0, winnerTeamId: null },
      { team1Id: 3, team2Id: 4, team1Score: 0, team2Score: 0, winnerTeamId: null },
    ];
    expect(tournamentController.isTournamentLocked(matches)).toBe(false);
  });

  test('한 매치라도 점수가 있으면 true', () => {
    const matches = [
      { team1Id: 1, team2Id: 2, team1Score: 0, team2Score: 0, winnerTeamId: null },
      { team1Id: 3, team2Id: 4, team1Score: 1, team2Score: 0, winnerTeamId: null },
    ];
    expect(tournamentController.isTournamentLocked(matches)).toBe(true);
  });

  test('한 매치라도 결과가 있으면 true', () => {
    const matches = [
      { team1Id: 1, team2Id: 2, team1Score: 0, team2Score: 0, winnerTeamId: null },
      { team1Id: 3, team2Id: 4, team1Score: 2, team2Score: 1, winnerTeamId: 3 },
    ];
    expect(tournamentController.isTournamentLocked(matches)).toBe(true);
  });

  test('BYE 매치(자동 winnerTeamId)는 락으로 인식하지 않음', () => {
    // 16강 9팀처럼 BYE가 있을 때 R1 BYE 매치는 winnerTeamId가 자동 채워지지만 매치는 시작 안 됨
    const matches = [
      { team1Id: 1, team2Id: 7, team1Score: 0, team2Score: 0, winnerTeamId: null },
      { team1Id: 3, team2Id: null, team1Score: 0, team2Score: 0, winnerTeamId: 3 },
      { team1Id: null, team2Id: 4, team1Score: 0, team2Score: 0, winnerTeamId: 4 },
    ];
    expect(tournamentController.isTournamentLocked(matches)).toBe(false);
  });

  test('다음 라운드 placeholder(team1Id/team2Id 모두 null)도 제외', () => {
    const matches = [
      { team1Id: 1, team2Id: 2, team1Score: 0, team2Score: 0, winnerTeamId: null },
      { team1Id: null, team2Id: null, team1Score: 0, team2Score: 0, winnerTeamId: null },
    ];
    expect(tournamentController.isTournamentLocked(matches)).toBe(false);
  });

  test('빈 배열은 false', () => {
    expect(tournamentController.isTournamentLocked([])).toBe(false);
  });

  test('scheduledAt이 미래면 락 X', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const now = new Date();
    const matches = [
      { team1Id: 1, team2Id: 2, team1Score: 0, team2Score: 0, winnerTeamId: null, scheduledAt: future },
    ];
    expect(tournamentController.isTournamentLocked(matches, now)).toBe(false);
  });

  test('scheduledAt이 과거면 락 O', () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const now = new Date();
    const matches = [
      { team1Id: 1, team2Id: 2, team1Score: 0, team2Score: 0, winnerTeamId: null, scheduledAt: past },
    ];
    expect(tournamentController.isTournamentLocked(matches, now)).toBe(true);
  });

  test('BYE 매치는 일정 지나도 락 X', () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const now = new Date();
    const matches = [
      { team1Id: 1, team2Id: null, team1Score: 0, team2Score: 0, winnerTeamId: 1, scheduledAt: past },
    ];
    expect(tournamentController.isTournamentLocked(matches, now)).toBe(false);
  });

  test('일부 매치만 일정 있어도 그중 과거가 있으면 락', () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const now = new Date();
    const matches = [
      { team1Id: 1, team2Id: 2, team1Score: 0, team2Score: 0, winnerTeamId: null, scheduledAt: null },
      { team1Id: 3, team2Id: 4, team1Score: 0, team2Score: 0, winnerTeamId: null, scheduledAt: past },
    ];
    expect(tournamentController.isTournamentLocked(matches, now)).toBe(true);
  });
});

describe('validatePredictionsInput', () => {
  const teams = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const matches = [
    { id: 10, team1Id: 1, team2Id: 2 },
    { id: 11, team1Id: 3, team2Id: 4 },
    { id: 12, team1Id: null, team2Id: null },
  ];
  // 모든 매치 다 채운 신규 제출 케이스용 helper
  const fullPreds = [
    { matchId: 10, predictedTeamId: 1 },
    { matchId: 11, predictedTeamId: 4 },
    { matchId: 12, predictedTeamId: 2 },
  ];

  test('전체 매치 다 채워서 제출하면 통과', () => {
    expect(tournamentController.validatePredictionsInput({ predictions: fullPreds, matches, teams })).toBeNull();
  });

  test('일부 매치만 빠지면 reject', () => {
    const predictions = [
      { matchId: 10, predictedTeamId: 1 },
      { matchId: 11, predictedTeamId: 4 },
    ];
    expect(tournamentController.validatePredictionsInput({ predictions, matches, teams })).toMatch(/모든 매치/);
  });

  test('빈 배열에 기존 예측도 없으면 reject', () => {
    expect(tournamentController.validatePredictionsInput({ predictions: [], matches, teams })).toMatch(/모든 매치/);
  });

  test('기존 예측이 전체 매치 커버하고 있으면 빈 배열도 통과', () => {
    const existingPredictions = [{ matchId: 10 }, { matchId: 11 }, { matchId: 12 }];
    expect(tournamentController.validatePredictionsInput({
      predictions: [], matches, teams, existingPredictions,
    })).toBeNull();
  });

  test('기존 예측 일부 + 변경분으로 합쳐서 전체 커버되면 통과', () => {
    const existingPredictions = [{ matchId: 10 }, { matchId: 11 }];
    const predictions = [{ matchId: 12, predictedTeamId: 2 }];
    expect(tournamentController.validatePredictionsInput({
      predictions, matches, teams, existingPredictions,
    })).toBeNull();
  });

  test('변경분에서 null로 삭제 시 전체가 안 차면 reject', () => {
    const existingPredictions = [{ matchId: 10 }, { matchId: 11 }, { matchId: 12 }];
    const predictions = [{ matchId: 10, predictedTeamId: null }];
    expect(tournamentController.validatePredictionsInput({
      predictions, matches, teams, existingPredictions,
    })).toMatch(/모든 매치/);
  });

  test('BYE 매치는 강제 대상에서 제외', () => {
    const matchesWithBye = [
      { id: 10, team1Id: 1, team2Id: 2 },
      { id: 11, team1Id: 3, team2Id: null }, // BYE
      { id: 12, team1Id: null, team2Id: null }, // placeholder는 강제 대상
    ];
    const predictions = [
      { matchId: 10, predictedTeamId: 1 },
      { matchId: 12, predictedTeamId: 2 },
    ];
    expect(tournamentController.validatePredictionsInput({
      predictions, matches: matchesWithBye, teams,
    })).toBeNull();
  });

  test('matchId 누락 reject', () => {
    const predictions = [{ predictedTeamId: 1 }];
    expect(tournamentController.validatePredictionsInput({ predictions, matches, teams })).toMatch(/matchId/);
  });

  test('이 토너먼트에 없는 매치 reject', () => {
    const predictions = [{ matchId: 999, predictedTeamId: 1 }];
    expect(tournamentController.validatePredictionsInput({ predictions, matches, teams })).toMatch(/속하지 않은 매치/);
  });

  test('중복 매치 reject', () => {
    const predictions = [
      { matchId: 10, predictedTeamId: 1 },
      { matchId: 10, predictedTeamId: 2 },
    ];
    expect(tournamentController.validatePredictionsInput({ predictions, matches, teams })).toMatch(/중복/);
  });

  test('이 토너먼트에 없는 팀 reject', () => {
    const predictions = [{ matchId: 10, predictedTeamId: 99 }];
    expect(tournamentController.validatePredictionsInput({ predictions, matches, teams })).toMatch(/속하지 않은 팀/);
  });

  test('두 팀이 정해진 매치에서 다른 팀 선택 reject', () => {
    const predictions = [{ matchId: 10, predictedTeamId: 3 }];
    expect(tournamentController.validatePredictionsInput({ predictions, matches, teams })).toMatch(/그중 한 팀/);
  });

  test('미정 매치는 어떤 토너먼트 팀도 허용', () => {
    const predictions = [...fullPreds, { matchId: 12, predictedTeamId: 4 }].filter(
      (v, i, a) => a.findIndex((x) => x.matchId === v.matchId) === i,
    );
    // 12번 매치를 4팀으로 (미정 매치라 토너먼트 팀 어느 거든 OK)
    const adjusted = predictions.map((p) => (p.matchId === 12 ? { matchId: 12, predictedTeamId: 4 } : p));
    expect(tournamentController.validatePredictionsInput({ predictions: adjusted, matches, teams })).toBeNull();
  });
});

describe('enrichMatchesWithPredictions', () => {
  test('매치별 카운트와 비율 계산', () => {
    const matches = [
      { id: 10, team1Id: 1, team2Id: 2, toJSON() { return { id: 10, team1Id: 1, team2Id: 2 }; } },
    ];
    const predictions = [
      { matchId: 10, userPuuid: 'a', predictedTeamId: 1, summonerName: 'A' },
      { matchId: 10, userPuuid: 'b', predictedTeamId: 1, summonerName: 'B' },
      { matchId: 10, userPuuid: 'c', predictedTeamId: 2, summonerName: 'C' },
    ];
    const result = tournamentController.enrichMatchesWithPredictions(matches, predictions);
    expect(result[0].team1PredictionCount).toBe(2);
    expect(result[0].team2PredictionCount).toBe(1);
    expect(result[0].team1PredictionPct).toBeCloseTo(2 / 3);
    expect(result[0].team2PredictionPct).toBeCloseTo(1 / 3);
    expect(result[0].predictions).toHaveLength(3);
  });

  test('예측이 없으면 비율은 null', () => {
    const matches = [
      { id: 10, team1Id: 1, team2Id: 2, toJSON() { return { id: 10, team1Id: 1, team2Id: 2 }; } },
    ];
    const result = tournamentController.enrichMatchesWithPredictions(matches, []);
    expect(result[0].team1PredictionCount).toBe(0);
    expect(result[0].team1PredictionPct).toBeNull();
    expect(result[0].team2PredictionPct).toBeNull();
  });

  test('매치 슬롯에 없는 팀에 대한 예측은 카운트 안함', () => {
    const matches = [
      { id: 10, team1Id: 1, team2Id: 2, toJSON() { return { id: 10, team1Id: 1, team2Id: 2 }; } },
    ];
    const predictions = [
      { matchId: 10, userPuuid: 'a', predictedTeamId: 99 },
    ];
    const result = tournamentController.enrichMatchesWithPredictions(matches, predictions);
    expect(result[0].team1PredictionCount).toBe(0);
    expect(result[0].team2PredictionCount).toBe(0);
    expect(result[0].predictions).toHaveLength(1);
  });
});

describe('buildLeaderboard', () => {
  test('정답수로 정렬, 동점은 settledCount 적은 쪽이 위', () => {
    const matches = [
      { id: 10, winnerTeamId: 1 },
      { id: 11, winnerTeamId: 3 },
      { id: 12, winnerTeamId: null },
    ];
    const predictions = [
      { matchId: 10, userPuuid: 'a', predictedTeamId: 1, summonerName: 'A' },
      { matchId: 11, userPuuid: 'a', predictedTeamId: 3, summonerName: 'A' },
      { matchId: 12, userPuuid: 'a', predictedTeamId: 5, summonerName: 'A' },
      { matchId: 10, userPuuid: 'b', predictedTeamId: 1, summonerName: 'B' },
      { matchId: 11, userPuuid: 'b', predictedTeamId: 4, summonerName: 'B' },
      { matchId: 10, userPuuid: 'c', predictedTeamId: 1, summonerName: 'C' },
    ];
    const board = tournamentController.buildLeaderboard(matches, predictions);
    expect(board[0]).toMatchObject({ userPuuid: 'a', correctCount: 2, settledCount: 2 });
    expect(board[1]).toMatchObject({ userPuuid: 'c', correctCount: 1, settledCount: 1 });
    expect(board[2]).toMatchObject({ userPuuid: 'b', correctCount: 1, settledCount: 2 });
  });

  test('미확정 매치는 settledCount에 포함 안 됨', () => {
    const matches = [{ id: 10, winnerTeamId: null }];
    const predictions = [{ matchId: 10, userPuuid: 'a', predictedTeamId: 1 }];
    expect(tournamentController.buildLeaderboard(matches, predictions)).toEqual([]);
  });
});

describe('findPerfectPredictors', () => {
  test('모든 정상 매치를 다 맞춘 사용자만 반환', () => {
    const matches = [
      { id: 1, team1Id: 1, team2Id: 2, winnerTeamId: 1 },
      { id: 2, team1Id: 3, team2Id: 4, winnerTeamId: 4 },
      { id: 3, team1Id: 1, team2Id: 4, winnerTeamId: 4 },
    ];
    const predictions = [
      { matchId: 1, userPuuid: 'a', predictedTeamId: 1 },
      { matchId: 2, userPuuid: 'a', predictedTeamId: 4 },
      { matchId: 3, userPuuid: 'a', predictedTeamId: 4 },
      { matchId: 1, userPuuid: 'b', predictedTeamId: 1 },
      { matchId: 2, userPuuid: 'b', predictedTeamId: 3 },
      { matchId: 3, userPuuid: 'b', predictedTeamId: 4 },
    ];
    expect(tournamentController.findPerfectPredictors(matches, predictions)).toEqual(['a']);
  });

  test('미예측 매치가 있으면 perfect 아님', () => {
    const matches = [
      { id: 1, team1Id: 1, team2Id: 2, winnerTeamId: 1 },
      { id: 2, team1Id: 3, team2Id: 4, winnerTeamId: 4 },
    ];
    const predictions = [{ matchId: 1, userPuuid: 'a', predictedTeamId: 1 }];
    expect(tournamentController.findPerfectPredictors(matches, predictions)).toEqual([]);
  });

  test('BYE 매치는 정답 판정에서 제외', () => {
    const matches = [
      { id: 1, team1Id: 1, team2Id: 2, winnerTeamId: 1 },
      { id: 2, team1Id: 3, team2Id: null, winnerTeamId: 3 },
      { id: 3, team1Id: 1, team2Id: 3, winnerTeamId: 1 },
    ];
    const predictions = [
      { matchId: 1, userPuuid: 'a', predictedTeamId: 1 },
      { matchId: 3, userPuuid: 'a', predictedTeamId: 1 },
    ];
    expect(tournamentController.findPerfectPredictors(matches, predictions)).toEqual(['a']);
  });

  test('아직 결과 없는 매치(winnerTeamId null)는 정답 판정에서 제외', () => {
    const matches = [
      { id: 1, team1Id: 1, team2Id: 2, winnerTeamId: 1 },
      { id: 2, team1Id: 3, team2Id: 4, winnerTeamId: null },
    ];
    const predictions = [
      { matchId: 1, userPuuid: 'a', predictedTeamId: 1 },
      { matchId: 2, userPuuid: 'a', predictedTeamId: 3 },
    ];
    expect(tournamentController.findPerfectPredictors(matches, predictions)).toEqual(['a']);
  });

  test('정상 매치가 0개면 빈 배열', () => {
    expect(tournamentController.findPerfectPredictors([], [])).toEqual([]);
  });

  test('여러 사용자가 perfect일 수 있음', () => {
    const matches = [{ id: 1, team1Id: 1, team2Id: 2, winnerTeamId: 1 }];
    const predictions = [
      { matchId: 1, userPuuid: 'a', predictedTeamId: 1 },
      { matchId: 1, userPuuid: 'b', predictedTeamId: 1 },
      { matchId: 1, userPuuid: 'c', predictedTeamId: 2 },
    ];
    const result = tournamentController.findPerfectPredictors(matches, predictions);
    expect(result.sort()).toEqual(['a', 'b']);
  });
});

describe('브래킷 일관성(A2) 룰', () => {
  // 4팀 토너먼트:
  //   R1: m1(team1=1, team2=2), m2(team1=3, team2=4)
  //   R2(결승): m3(team1=1, team2=3)  ← m1 winner=1, m2 winner=3 가정
  // 부모 매핑: m3.team1 ← m1, m3.team2 ← m2
  const makeMatches = (winnerOverrides = {}) => [
    {
      id: 1, round: 1, bracketSlot: 0, team1Id: 1, team2Id: 2,
      winnerTeamId: winnerOverrides.m1 ?? 1,
      toJSON() { return { id: 1, round: 1, bracketSlot: 0, team1Id: 1, team2Id: 2, winnerTeamId: winnerOverrides.m1 ?? 1 }; },
    },
    {
      id: 2, round: 1, bracketSlot: 1, team1Id: 3, team2Id: 4,
      winnerTeamId: winnerOverrides.m2 ?? 3,
      toJSON() { return { id: 2, round: 1, bracketSlot: 1, team1Id: 3, team2Id: 4, winnerTeamId: winnerOverrides.m2 ?? 3 }; },
    },
    {
      id: 3, round: 2, bracketSlot: 0, team1Id: 1, team2Id: 3,
      winnerTeamId: winnerOverrides.m3 ?? null,
      toJSON() { return { id: 3, round: 2, bracketSlot: 0, team1Id: 1, team2Id: 3, winnerTeamId: winnerOverrides.m3 ?? null }; },
    },
  ];

  test('enrich: 부모 매치를 틀린 사용자의 결승 예측은 카운트 안 됨', () => {
    const matches = makeMatches();
    const predictions = [
      // a: m1=1(정답), m2=3(정답), m3=1 → 결승 유효 카운트
      { matchId: 1, userPuuid: 'a', predictedTeamId: 1 },
      { matchId: 2, userPuuid: 'a', predictedTeamId: 3 },
      { matchId: 3, userPuuid: 'a', predictedTeamId: 1 },
      // b: m1=2(오답), m2=3(정답), m3=3 → m1 틀려서 결승 무효
      { matchId: 1, userPuuid: 'b', predictedTeamId: 2 },
      { matchId: 2, userPuuid: 'b', predictedTeamId: 3 },
      { matchId: 3, userPuuid: 'b', predictedTeamId: 3 },
      // c: m1=1(정답), m2=4(오답), m3=3 → m2 틀려서 결승 무효
      { matchId: 1, userPuuid: 'c', predictedTeamId: 1 },
      { matchId: 2, userPuuid: 'c', predictedTeamId: 4 },
      { matchId: 3, userPuuid: 'c', predictedTeamId: 3 },
    ];
    const result = tournamentController.enrichMatchesWithPredictions(matches, predictions);
    const final = result.find((m) => m.id === 3);
    expect(final.predictionsActive).toBe(true);
    // 유효 카운트: a만 (m3=1)
    expect(final.team1PredictionCount).toBe(1);
    expect(final.team2PredictionCount).toBe(0);
    // 전체 카운트(자세히 보기): a(1), c(3) → t1=1, b(3) → t2=1
    expect(final.team1PredictionCountTotal).toBe(1);
    expect(final.team2PredictionCountTotal).toBe(2);
    // 각 예측에 isValid 플래그
    const aPred = final.predictions.find((p) => p.userPuuid === 'a');
    const bPred = final.predictions.find((p) => p.userPuuid === 'b');
    const cPred = final.predictions.find((p) => p.userPuuid === 'c');
    expect(aPred.isValid).toBe(true);
    expect(bPred.isValid).toBe(false);
    expect(cPred.isValid).toBe(false);
  });

  test('enrich: 한쪽 미정 매치는 비활성화 — predictionsActive=false, isValid=null', () => {
    const matches = [
      {
        id: 10, round: 2, bracketSlot: 0, team1Id: null, team2Id: 5,
        toJSON() { return { id: 10, round: 2, bracketSlot: 0, team1Id: null, team2Id: 5 }; },
      },
    ];
    const predictions = [
      { matchId: 10, userPuuid: 'a', predictedTeamId: 5 },
    ];
    const result = tournamentController.enrichMatchesWithPredictions(matches, predictions);
    expect(result[0].predictionsActive).toBe(false);
    expect(result[0].team1PredictionCount).toBe(0);
    expect(result[0].team2PredictionCount).toBe(0);
    expect(result[0].team1PredictionCountTotal).toBe(0);
    expect(result[0].team2PredictionCountTotal).toBe(0);
    expect(result[0].predictions[0].isValid).toBeNull();
  });

  test('enrich: BYE 부모는 검증 패스 — 자동 진출이라 사용자 예측 불필요', () => {
    // R1: m1(team1=1, team2=2) 진짜 매치, m2(team1=3, team2=null) BYE
    // R2: m3(team1=1, team2=3)
    const matches = [
      {
        id: 1, round: 1, bracketSlot: 0, team1Id: 1, team2Id: 2, winnerTeamId: 1,
        toJSON() { return { id: 1, round: 1, bracketSlot: 0, team1Id: 1, team2Id: 2, winnerTeamId: 1 }; },
      },
      {
        id: 2, round: 1, bracketSlot: 1, team1Id: 3, team2Id: null, winnerTeamId: 3,
        toJSON() { return { id: 2, round: 1, bracketSlot: 1, team1Id: 3, team2Id: null, winnerTeamId: 3 }; },
      },
      {
        id: 3, round: 2, bracketSlot: 0, team1Id: 1, team2Id: 3, winnerTeamId: null,
        toJSON() { return { id: 3, round: 2, bracketSlot: 0, team1Id: 1, team2Id: 3, winnerTeamId: null }; },
      },
    ];
    const predictions = [
      // a: m1만 맞추고 m2(BYE)는 예측 없어도 m3 유효
      { matchId: 1, userPuuid: 'a', predictedTeamId: 1 },
      { matchId: 3, userPuuid: 'a', predictedTeamId: 1 },
    ];
    const result = tournamentController.enrichMatchesWithPredictions(matches, predictions);
    const final = result.find((m) => m.id === 3);
    expect(final.team1PredictionCount).toBe(1);
    expect(final.predictions[0].isValid).toBe(true);
  });

  test('성립 불가 예측은 분모(settled)에는 포함, 정답으론 인정 X', () => {
    const matches = makeMatches({ m3: 1 });
    const predictions = [
      // a: 전부 정답 → 3/3
      { matchId: 1, userPuuid: 'a', predictedTeamId: 1 },
      { matchId: 2, userPuuid: 'a', predictedTeamId: 3 },
      { matchId: 3, userPuuid: 'a', predictedTeamId: 1 },
      // b: m1 틀림, m2 정답, m3은 winner=1 과 같은 1 찍었지만 m1 틀려서 invalid → 정답 미인정
      //   settledCount 는 m3 포함해서 3, correctCount 는 m2 만 → 1
      { matchId: 1, userPuuid: 'b', predictedTeamId: 2 },
      { matchId: 2, userPuuid: 'b', predictedTeamId: 3 },
      { matchId: 3, userPuuid: 'b', predictedTeamId: 1 },
    ];
    const board = tournamentController.buildLeaderboard(matches, predictions);
    const a = board.find((e) => e.userPuuid === 'a');
    const b = board.find((e) => e.userPuuid === 'b');
    expect(a).toMatchObject({ correctCount: 3, settledCount: 3 });
    expect(b).toMatchObject({ correctCount: 1, settledCount: 3 });
  });
});

describe('validateTournamentType', () => {
  test('null/undefined 허용 (기본값 normal)', () => {
    expect(tournamentController.validateTournamentType(null)).toBeNull();
    expect(tournamentController.validateTournamentType(undefined)).toBeNull();
  });
  test('normal/auction 허용', () => {
    expect(tournamentController.validateTournamentType('normal')).toBeNull();
    expect(tournamentController.validateTournamentType('auction')).toBeNull();
  });
  test('그 외는 거부', () => {
    expect(tournamentController.validateTournamentType('hybrid')).toContain('type');
  });
});

describe('validateAuctionConfig', () => {
  const makeCandidates = (count) => ({
    top: Array.from({ length: count }, (_, i) => `top${i}`),
    jungle: Array.from({ length: count }, (_, i) => `jng${i}`),
    mid: Array.from({ length: count }, (_, i) => `mid${i}`),
    adc: Array.from({ length: count }, (_, i) => `adc${i}`),
    support: Array.from({ length: count }, (_, i) => `sup${i}`),
  });
  const validConfig = () => ({
    minBid: 5,
    bidDurationSeconds: 30,
    allowNegative: false,
    candidates: makeCandidates(5),
  });

  test('정상 config', () => {
    expect(tournamentController.validateAuctionConfig(validConfig())).toBeNull();
  });
  test('null/undefined 거부', () => {
    expect(tournamentController.validateAuctionConfig(null)).toContain('auctionConfig');
    expect(tournamentController.validateAuctionConfig(undefined)).toContain('auctionConfig');
  });
  test('minBid 0/음수 거부', () => {
    expect(tournamentController.validateAuctionConfig({ ...validConfig(), minBid: 0 })).toContain('minBid');
  });
  test('bidDurationSeconds 누락/음수 거부', () => {
    const c = validConfig();
    delete c.bidDurationSeconds;
    expect(tournamentController.validateAuctionConfig(c)).toContain('bidDurationSeconds');
    expect(tournamentController.validateAuctionConfig({ ...validConfig(), bidDurationSeconds: 0 }))
      .toContain('bidDurationSeconds');
  });
  test('allowNegative 불리언 아니면 거부', () => {
    expect(tournamentController.validateAuctionConfig({ ...validConfig(), allowNegative: 'yes' }))
      .toContain('allowNegative');
  });
  test('candidates 없으면 거부', () => {
    const config = validConfig();
    delete config.candidates;
    expect(tournamentController.validateAuctionConfig(config)).toContain('candidates');
  });
  test('포지션 누락 시 거부', () => {
    const candidates = makeCandidates(5);
    delete candidates.support;
    expect(tournamentController.validateAuctionConfig({ ...validConfig(), candidates })).toContain('support');
  });
  test('포지션별 인원 불일치 거부', () => {
    const candidates = makeCandidates(5);
    candidates.top = ['top0', 'top1', 'top2', 'top3'];
    expect(tournamentController.validateAuctionConfig({ ...validConfig(), candidates }))
      .toContain('동일');
  });
  test('빈 포지션 거부', () => {
    const candidates = makeCandidates(5);
    candidates.top = [];
    expect(tournamentController.validateAuctionConfig({ ...validConfig(), candidates }))
      .toContain('top');
  });
  test('한 사람이 여러 포지션에 등록되면 거부', () => {
    const candidates = makeCandidates(5);
    candidates.top[0] = candidates.mid[0];
    expect(tournamentController.validateAuctionConfig({ ...validConfig(), candidates }))
      .toContain('여러 포지션');
  });
});

describe('findCandidatePosition', () => {
  const candidates = {
    top: ['t1', 't2'],
    jungle: ['j1'],
    mid: ['m1'],
    adc: ['a1'],
    support: ['s1'],
  };
  test('puuid의 포지션 반환', () => {
    expect(tournamentController.findCandidatePosition(candidates, 't2')).toBe('top');
    expect(tournamentController.findCandidatePosition(candidates, 'j1')).toBe('jungle');
  });
  test('없는 puuid는 null', () => {
    expect(tournamentController.findCandidatePosition(candidates, 'x99')).toBeNull();
  });
  test('candidates가 null이면 null', () => {
    expect(tournamentController.findCandidatePosition(null, 't1')).toBeNull();
  });
});

describe('validateAuctionTeamInput', () => {
  test('정상 입력: 팀장 1명만', () => {
    expect(
      tournamentController.validateAuctionTeamInput({
        name: '경매팀',
        captainPuuid: 'p1',
        members: [{ puuid: 'p1', position: 'top' }],
      }),
    ).toBeNull();
  });
  test('멤버가 2명이면 거부', () => {
    expect(
      tournamentController.validateAuctionTeamInput({
        name: '경매팀',
        captainPuuid: 'p1',
        members: [
          { puuid: 'p1', position: 'top' },
          { puuid: 'p2', position: 'mid' },
        ],
      }),
    ).toContain('팀장 1명');
  });
  test('팀장 puuid와 멤버 puuid가 다르면 거부', () => {
    expect(
      tournamentController.validateAuctionTeamInput({
        name: '경매팀',
        captainPuuid: 'p1',
        members: [{ puuid: 'p2', position: 'top' }],
      }),
    ).toContain('팀장');
  });
  test('포지션 무효면 거부', () => {
    expect(
      tournamentController.validateAuctionTeamInput({
        name: '경매팀',
        captainPuuid: 'p1',
        members: [{ puuid: 'p1', position: 'midlaner' }],
      }),
    ).toContain('포지션');
  });
  test('팀명 빈 문자열 거부', () => {
    expect(
      tournamentController.validateAuctionTeamInput({
        name: '   ',
        captainPuuid: 'p1',
        members: [{ puuid: 'p1', position: 'top' }],
      }),
    ).toContain('팀명');
  });
});

describe('startAuction', () => {
  const defaultCandidates = () => ({
    top: ['cap1', 'cap2'],
    jungle: ['j1', 'j2'],
    mid: ['m1', 'm2'],
    adc: ['a1', 'a2'],
    support: ['s1', 's2'],
  });
  const makeTournament = (overrides = {}) => ({
    type: 'auction',
    status: 'preparing',
    auctionConfig: {
      minBid: 5,
      bidDurationSeconds: 30,
      allowNegative: false,
      candidates: defaultCandidates(),
    },
    save: jest.fn(),
    ...overrides,
  });
  const makeTeam = (overrides) => ({
    name: 'A',
    captainPuuid: 'cap1',
    members: [{ puuid: 'cap1', position: 'top' }],
    auctionBudget: 1000,
    save: jest.fn(),
    ...overrides,
  });

  test('팀 수 == 포지션별 후보 수와 일치하면 정상 시작', async () => {
    const tournament = makeTournament();
    const teams = [
      makeTeam(),
      makeTeam({ name: 'B', captainPuuid: 'cap2', members: [{ puuid: 'cap2', position: 'top' }] }),
    ];
    const result = await tournamentController.startAuction(tournament, teams);
    expect(result.ok).toBe(true);
    expect(tournament.status).toBe('auction');
  });

  test('팀 수가 포지션별 후보 수보다 많으면 거부', async () => {
    const tournament = makeTournament();
    const teams = [
      makeTeam(),
      makeTeam({ name: 'B', captainPuuid: 'cap2', members: [{ puuid: 'cap2', position: 'top' }] }),
      // 3번째 팀: 후보 풀에 없는 팀장 — 팀 수 검증이 captain 검증보다 먼저 실패해야 함
      makeTeam({ name: 'C', captainPuuid: 'cap3', members: [{ puuid: 'cap3', position: 'top' }] }),
    ];
    const result = await tournamentController.startAuction(tournament, teams);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('포지션별 후보 수');
  });

  test('팀 수가 포지션별 후보 수보다 적으면 거부 (후보 3, 팀 2)', async () => {
    const tournament = makeTournament({
      auctionConfig: {
        minBid: 5,
        bidDurationSeconds: 30,
        allowNegative: false,
        candidates: {
          top: ['cap1', 'cap2', 'cap3'],
          jungle: ['j1', 'j2', 'j3'],
          mid: ['m1', 'm2', 'm3'],
          adc: ['a1', 'a2', 'a3'],
          support: ['s1', 's2', 's3'],
        },
      },
    });
    const teams = [
      makeTeam(),
      makeTeam({ name: 'B', captainPuuid: 'cap2', members: [{ puuid: 'cap2', position: 'top' }] }),
    ];
    const result = await tournamentController.startAuction(tournament, teams);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('포지션별 후보 수');
  });
});

describe('recordAuctionBid', () => {
  const defaultCandidates = () => ({
    top: ['cap1', 'cap2'],
    jungle: ['j1', 'j2'],
    mid: ['m1', 'm2'],
    adc: ['a1', 'a2'],
    support: ['s1', 's2'],
  });
  const makeTournament = (overrides = {}) => ({
    status: 'auction',
    auctionConfig: {
      minBid: 5,
      allowNegative: false,
      candidates: defaultCandidates(),
    },
    save: jest.fn(),
    ...overrides,
  });
  const makeTeam = (overrides = {}) => ({
    id: 1,
    captainPuuid: 'cap1',
    members: [{ puuid: 'cap1', position: 'top' }],
    remainingBudget: 1000,
    save: jest.fn(),
    ...overrides,
  });

  test('정상 입찰: 후보 풀에서 포지션 자동 추출 + 멤버 추가 + 예산 차감', async () => {
    const tournament = makeTournament();
    const team = makeTeam();
    const result = await tournamentController.recordAuctionBid(
      tournament, team, [team],
      { puuid: 'm1', amount: 200 },
    );
    expect(result.ok).toBe(true);
    expect(result.position).toBe('mid');
    expect(team.members).toHaveLength(2);
    expect(team.members[1]).toEqual({ puuid: 'm1', position: 'mid', bidAmount: 200 });
    expect(team.remainingBudget).toBe(800);
  });

  test('경매 단계 아니면 거부', async () => {
    const tournament = makeTournament({ status: 'preparing' });
    const team = makeTeam();
    const result = await tournamentController.recordAuctionBid(
      tournament, team, [team],
      { puuid: 'm1', amount: 200 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('경매 단계');
  });

  test('최소 입찰 미달 거부', async () => {
    const tournament = makeTournament();
    const team = makeTeam();
    const result = await tournamentController.recordAuctionBid(
      tournament, team, [team],
      { puuid: 'm1', amount: 3 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('입찰가');
  });

  test('후보 풀에 없는 puuid 거부', async () => {
    const tournament = makeTournament();
    const team = makeTeam();
    const result = await tournamentController.recordAuctionBid(
      tournament, team, [team],
      { puuid: 'unknown', amount: 100 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('후보 풀');
  });

  test('이미 다른 팀 낙찰자 거부', async () => {
    const tournament = makeTournament();
    const teamA = makeTeam({ id: 1 });
    const teamB = makeTeam({ id: 2, captainPuuid: 'cap2', members: [
      { puuid: 'cap2', position: 'top' },
      { puuid: 'm1', position: 'mid', bidAmount: 100 },
    ] });
    const result = await tournamentController.recordAuctionBid(
      tournament, teamA, [teamA, teamB],
      { puuid: 'm1', amount: 200 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('다른 팀');
  });

  test('자기 팀에 이미 있는 포지션이면 거부', async () => {
    const tournament = makeTournament();
    const team = makeTeam({
      members: [
        { puuid: 'cap1', position: 'top' },
        { puuid: 'm1', position: 'mid', bidAmount: 100 },
      ],
      remainingBudget: 900,
    });
    const result = await tournamentController.recordAuctionBid(
      tournament, team, [team],
      { puuid: 'm2', amount: 50 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('mid');
  });

  test('잔여 예산 초과 거부 (allowNegative=false)', async () => {
    const tournament = makeTournament();
    const team = makeTeam({ remainingBudget: 100 });
    const result = await tournamentController.recordAuctionBid(
      tournament, team, [team],
      { puuid: 'm1', amount: 200 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('예산');
  });

  test('allowNegative=true면 마이너스 허용', async () => {
    const tournament = makeTournament({
      auctionConfig: {
        minBid: 5, allowNegative: true,
        candidates: defaultCandidates(),
      },
    });
    const team = makeTeam({ remainingBudget: 100 });
    const result = await tournamentController.recordAuctionBid(
      tournament, team, [team],
      { puuid: 'm1', amount: 200 },
    );
    expect(result.ok).toBe(true);
    expect(team.remainingBudget).toBe(-100);
  });

  test('팀 정원(5명) 가득찼으면 거부 — 6번째 입찰 시도', async () => {
    // candidates에 후보를 더 추가해서 6번째 입찰 가능한 상태 만들기
    const candidates = {
      top: ['cap1', 'cap2'],
      jungle: ['j1'],
      mid: ['m1'],
      adc: ['a1'],
      support: ['s1', 's2'],
    };
    const tournament = makeTournament({
      auctionConfig: { minBid: 5, allowNegative: false, candidates },
    });
    const team = makeTeam({
      members: [
        { puuid: 'cap1', position: 'top' },
        { puuid: 'j1', position: 'jungle' },
        { puuid: 'm1', position: 'mid' },
        { puuid: 'a1', position: 'adc' },
        { puuid: 's1', position: 'support' },
      ],
    });
    const result = await tournamentController.recordAuctionBid(
      tournament, team, [team],
      { puuid: 's2', amount: 50 },
    );
    expect(result.ok).toBe(false);
    // 이미 support 포지션이 있어서 그 검증이 먼저 걸림 (정원 검증 전에 포지션 중복으로 차단)
    expect(result.error).toContain('support');
  });
});

describe('pickRandomCandidate', () => {
  const candidates = {
    top: ['t1', 't2'],
    jungle: ['j1', 'j2'],
    mid: ['m1', 'm2'],
    adc: ['a1', 'a2'],
    support: ['s1', 's2'],
  };
  const makeTournament = () => ({ auctionConfig: { candidates } });

  test('이미 낙찰된 사람은 제외', () => {
    const teams = [
      { members: [{ puuid: 't1' }, { puuid: 'j1' }] },
      { members: [{ puuid: 'm1' }] },
    ];
    const picked = tournamentController.pickRandomCandidate(makeTournament(), teams);
    expect(picked).not.toBeNull();
    expect(['t1', 'j1', 'm1']).not.toContain(picked.puuid);
    expect(picked.position).toBe(tournamentController.findCandidatePosition(candidates, picked.puuid));
  });

  test('모두 낙찰됐으면 null', () => {
    const teams = [
      { members: [{ puuid: 't1' }, { puuid: 't2' }, { puuid: 'j1' }, { puuid: 'j2' }, { puuid: 'm1' }] },
      { members: [{ puuid: 'm2' }, { puuid: 'a1' }, { puuid: 'a2' }, { puuid: 's1' }, { puuid: 's2' }] },
    ];
    expect(tournamentController.pickRandomCandidate(makeTournament(), teams)).toBeNull();
  });

  test('auctionConfig 없으면 null', () => {
    expect(tournamentController.pickRandomCandidate({}, [])).toBeNull();
  });
});

describe('setCurrentAuction', () => {
  test('정상 세팅', async () => {
    const tournament = {
      status: 'auction',
      currentAuctionPuuid: null,
      currentAuctionDeadline: null,
      save: jest.fn(),
    };
    const result = await tournamentController.setCurrentAuction(tournament, 'm1');
    expect(result.ok).toBe(true);
    expect(tournament.currentAuctionPuuid).toBe('m1');
    expect(tournament.currentAuctionDeadline).toBeNull();
  });

  test('입찰 진행 중이면 거부 (deadline 미래)', async () => {
    const tournament = {
      status: 'auction',
      currentAuctionPuuid: 'm1',
      currentAuctionDeadline: new Date(Date.now() + 60000),
      save: jest.fn(),
    };
    const result = await tournamentController.setCurrentAuction(tournament, 'm2');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('입찰');
  });

  test('deadline 과거면 교체 허용', async () => {
    const tournament = {
      status: 'auction',
      currentAuctionPuuid: 'm1',
      currentAuctionDeadline: new Date(Date.now() - 1000),
      save: jest.fn(),
    };
    const result = await tournamentController.setCurrentAuction(tournament, 'm2');
    expect(result.ok).toBe(true);
    expect(tournament.currentAuctionPuuid).toBe('m2');
    expect(tournament.currentAuctionDeadline).toBeNull();
  });
});

describe('startBidTimer', () => {
  const baseTournament = () => ({
    status: 'auction',
    currentAuctionPuuid: 'm1',
    currentAuctionDeadline: null,
    auctionConfig: { bidDurationSeconds: 30 },
    save: jest.fn(),
  });

  test('정상 시작: auctionConfig.bidDurationSeconds 사용', async () => {
    const tournament = baseTournament();
    const before = Date.now();
    const result = await tournamentController.startBidTimer(tournament);
    expect(result.ok).toBe(true);
    expect(result.durationSeconds).toBe(30);
    expect(tournament.currentAuctionDeadline.getTime()).toBeGreaterThanOrEqual(before + 30000);
  });

  test('매물 없으면 거부', async () => {
    const tournament = { ...baseTournament(), currentAuctionPuuid: null };
    const result = await tournamentController.startBidTimer(tournament);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('매물');
  });

  test('config의 bidDurationSeconds가 없으면 거부', async () => {
    const tournament = { ...baseTournament(), auctionConfig: {} };
    const result = await tournamentController.startBidTimer(tournament);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('bidDurationSeconds');
  });
});

describe('extendBidTimer', () => {
  const baseTournament = () => ({
    status: 'auction',
    currentAuctionPuuid: 'm1',
    currentAuctionDeadline: new Date(Date.now() + 5000),
    auctionConfig: { bidDurationSeconds: 30 },
    save: jest.fn(),
  });

  test('정상 갱신: auctionConfig.bidDurationSeconds 사용', async () => {
    const tournament = baseTournament();
    const before = Date.now();
    const result = await tournamentController.extendBidTimer(tournament);
    expect(result.ok).toBe(true);
    expect(result.durationSeconds).toBe(30);
    expect(tournament.currentAuctionDeadline.getTime()).toBeGreaterThanOrEqual(before + 30000);
  });

  test('deadline 없으면 거부', async () => {
    const tournament = { ...baseTournament(), currentAuctionDeadline: null };
    const result = await tournamentController.extendBidTimer(tournament);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('진행 중');
  });

  test('config의 bidDurationSeconds가 없으면 거부', async () => {
    const tournament = { ...baseTournament(), auctionConfig: {} };
    const result = await tournamentController.extendBidTimer(tournament);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('bidDurationSeconds');
  });
});

describe('recordAuctionBid currentAuction 자동 클리어', () => {
  test('낙찰 puuid가 currentAuctionPuuid와 같으면 클리어', async () => {
    const tournament = {
      status: 'auction',
      currentAuctionPuuid: 'm1',
      currentAuctionDeadline: new Date(Date.now() + 30000),
      auctionConfig: {
        minBid: 5,
        allowNegative: false,
        candidates: {
          top: ['cap1'], jungle: ['j1'], mid: ['m1'], adc: ['a1'], support: ['s1'],
        },
      },
      save: jest.fn(),
    };
    const team = {
      id: 1,
      captainPuuid: 'cap1',
      members: [{ puuid: 'cap1', position: 'top' }],
      remainingBudget: 1000,
      save: jest.fn(),
    };
    const result = await tournamentController.recordAuctionBid(
      tournament, team, [team], { puuid: 'm1', amount: 200 },
    );
    expect(result.ok).toBe(true);
    expect(result.currentAuctionCleared).toBe(true);
    expect(tournament.currentAuctionPuuid).toBeNull();
    expect(tournament.currentAuctionDeadline).toBeNull();
  });

  test('낙찰 puuid가 currentAuctionPuuid와 다르면 클리어 안 함', async () => {
    const tournament = {
      status: 'auction',
      currentAuctionPuuid: 'm1',
      currentAuctionDeadline: new Date(Date.now() + 30000),
      auctionConfig: {
        minBid: 5,
        allowNegative: false,
        candidates: {
          top: ['cap1'], jungle: ['j1'], mid: ['m1'], adc: ['a1'], support: ['s1'],
        },
      },
      save: jest.fn(),
    };
    const team = {
      id: 1,
      captainPuuid: 'cap1',
      members: [{ puuid: 'cap1', position: 'top' }],
      remainingBudget: 1000,
      save: jest.fn(),
    };
    const result = await tournamentController.recordAuctionBid(
      tournament, team, [team], { puuid: 'a1', amount: 200 },
    );
    expect(result.ok).toBe(true);
    expect(result.currentAuctionCleared).toBe(false);
    expect(tournament.currentAuctionPuuid).toBe('m1');
  });
});

describe('validateAuctionTeamBudget', () => {
  test('양의 정수 통과', () => {
    expect(tournamentController.validateAuctionTeamBudget(1000)).toBeNull();
    expect(tournamentController.validateAuctionTeamBudget(1)).toBeNull();
  });
  test('0/음수/소수/비정수 거부', () => {
    expect(tournamentController.validateAuctionTeamBudget(0)).toContain('budget');
    expect(tournamentController.validateAuctionTeamBudget(-1)).toContain('budget');
    expect(tournamentController.validateAuctionTeamBudget(10.5)).toContain('budget');
    expect(tournamentController.validateAuctionTeamBudget('1000')).toContain('budget');
    expect(tournamentController.validateAuctionTeamBudget(null)).toContain('budget');
  });
});

describe('undoAuctionBid', () => {
  test('정상 취소: 멤버 제거 + 예산 환불', async () => {
    const tournament = { status: 'auction', save: jest.fn() };
    const team = {
      captainPuuid: 'cap1',
      members: [
        { puuid: 'cap1', position: 'top' },
        { puuid: 'p2', position: 'mid', bidAmount: 200 },
      ],
      remainingBudget: 800,
      save: jest.fn(),
    };
    const result = await tournamentController.undoAuctionBid(tournament, team, 'p2');
    expect(result.ok).toBe(true);
    expect(result.refund).toBe(200);
    expect(team.members).toHaveLength(1);
    expect(team.remainingBudget).toBe(1000);
  });

  test('팀장은 취소 불가', async () => {
    const tournament = { status: 'auction', save: jest.fn() };
    const team = {
      captainPuuid: 'cap1',
      members: [{ puuid: 'cap1', position: 'top' }],
      remainingBudget: 1000,
      save: jest.fn(),
    };
    const result = await tournamentController.undoAuctionBid(tournament, team, 'cap1');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('팀장');
  });

  test('없는 멤버 취소 거부', async () => {
    const tournament = { status: 'auction', save: jest.fn() };
    const team = {
      captainPuuid: 'cap1',
      members: [{ puuid: 'cap1', position: 'top' }],
      remainingBudget: 1000,
      save: jest.fn(),
    };
    const result = await tournamentController.undoAuctionBid(tournament, team, 'p99');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('후보');
  });
});
