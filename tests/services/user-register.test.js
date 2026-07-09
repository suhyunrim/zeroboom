// registerUser: 조용한 "계정 갈아탐" 제거 — 같은 디코가 다른 본캐에 이미 연결돼 있으면
// 말없이 orphan 시키지 않고 등록을 막는다(409). 충돌 없으면 정상 등록.
const mockModels = {
  group: { findOne: jest.fn() },
  user: { findOne: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  summoner: { findOne: jest.fn() },
};
jest.mock('../../src/db/models', () => mockModels);

const mockSummonerController = {
  getSummonerByName: jest.fn(),
  getPositions: jest.fn(),
};
jest.mock('../../src/controller/summoner', () => mockSummonerController);

const { registerUser } = require('../../src/services/user');

beforeEach(() => {
  jest.clearAllMocks();
  mockModels.group.findOne.mockResolvedValue({ id: 1, groupName: 'G' });
  mockSummonerController.getSummonerByName.mockResolvedValue({
    status: 200,
    result: {
      puuid: 'PB',
      encryptedAccountId: 'enc',
      rankTier: 'DIAMOND I',
      rankWin: 100,
      rankLose: 100,
    },
  });
  mockSummonerController.getPositions.mockResolvedValue(undefined);
  mockModels.user.upsert.mockResolvedValue([{}, true]);
});

describe('registerUser 디스코드 충돌 처리', () => {
  test('같은 디코가 다른 본캐에 연결돼 있으면 409, upsert 안 함', async () => {
    mockModels.user.findOne.mockResolvedValue({ puuid: 'PA' }); // 홀더 존재(다른 puuid)
    mockModels.summoner.findOne.mockResolvedValue({ name: '따거창#KR3' });

    const r = await registerUser('G', '찌르레기1#KR3', 'D1', 'DISC');

    expect(r.status).toBe(409);
    expect(r.result).toContain('따거창#KR3');
    expect(mockModels.user.upsert).not.toHaveBeenCalled();
    // 홀더 조회는 (본캐, 다른 puuid) 스코프로만
    expect(mockModels.user.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ groupId: 1, discordId: 'DISC', primaryPuuid: null }),
      }),
    );
  });

  test('충돌 없으면 정상 등록(200) + upsert 호출', async () => {
    mockModels.user.findOne.mockResolvedValue(null); // 홀더 없음

    const r = await registerUser('G', '찌르레기1#KR3', 'D1', 'DISC');

    expect(r.status).toBe(200);
    expect(mockModels.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ puuid: 'PB', groupId: 1, discordId: 'DISC' }),
    );
  });

  test('discordId 없이 등록하면 충돌검사 스킵하고 진행', async () => {
    const r = await registerUser('G', '아무개', 'D1', null);

    expect(r.status).toBe(200);
    expect(mockModels.user.findOne).not.toHaveBeenCalled();
    expect(mockModels.user.upsert).toHaveBeenCalled();
  });

  test('같은 puuid 재등록은 홀더 조회에서 제외되어 통과', async () => {
    // findOne 이 홀더를 찾지 못하도록(=본인 제외) null 반환
    mockModels.user.findOne.mockResolvedValue(null);

    const r = await registerUser('G', '찌르레기1#KR3', 'D1', 'DISC');

    expect(r.status).toBe(200);
    // 홀더 조회 시 자기 자신(PB)은 제외 조건에 포함돼야 함
    const call = mockModels.user.findOne.mock.calls[0][0];
    expect(call.where.puuid).toBeDefined(); // { [Op.ne]: 'PB' }
  });
});
