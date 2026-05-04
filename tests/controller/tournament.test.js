const mockModels = {
  user: { findAll: jest.fn() },
  tournament: { findByPk: jest.fn() },
  tournament_team: { findAll: jest.fn() },
  tournament_match: { findAll: jest.fn(), findOne: jest.fn() },
  tournament_scrim: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() },
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
