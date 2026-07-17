jest.mock('../../src/loaders/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
// normalizeCommands는 discord.js를 쓰지 않지만 command.js가 톱레벨에서 require하므로 스텁 처리
jest.mock('discord.js', () => ({ SlashCommandBuilder: class {} }));

const { normalizeCommands } = require('../../src/loaders/command');

describe('normalizeCommands (슬래시 명령어 등록 비교)', () => {
  // 빌더 toJSON 형태: false 필드도 명시됨
  const builderSide = [
    {
      name: 'test_매칭생성',
      description: '팀 매칭',
      options: [{ type: 3, name: '유저1', description: '유저', required: false, autocomplete: true }],
    },
    { name: 'test_주사위', description: '주사위', options: [] },
  ];
  // Discord GET 응답 형태: id/version 등 부가 필드 포함, false 필드는 생략, 순서 다름
  const apiSide = [
    {
      id: '1',
      application_id: '2',
      version: '3',
      type: 1,
      default_member_permissions: null,
      name: 'test_주사위',
      description: '주사위',
    },
    {
      id: '4',
      application_id: '2',
      version: '5',
      type: 1,
      name: 'test_매칭생성',
      description: '팀 매칭',
      options: [{ type: 3, name: '유저1', description: '유저', autocomplete: true }],
    },
  ];

  test('같은 명령어면 빌더 JSON과 Discord 응답이 동일하게 정규화됨', () => {
    expect(JSON.stringify(normalizeCommands(builderSide))).toBe(
      JSON.stringify(normalizeCommands(apiSide)),
    );
  });

  test('이름(프리픽스) 변경을 감지', () => {
    const renamed = [{ ...builderSide[0], name: '테스트_매칭생성' }, builderSide[1]];
    expect(JSON.stringify(normalizeCommands(renamed))).not.toBe(
      JSON.stringify(normalizeCommands(apiSide)),
    );
  });

  test('옵션 변경(required 토글)을 감지', () => {
    const changed = [
      { ...builderSide[0], options: [{ ...builderSide[0].options[0], required: true }] },
      builderSide[1],
    ];
    expect(JSON.stringify(normalizeCommands(changed))).not.toBe(
      JSON.stringify(normalizeCommands(apiSide)),
    );
  });

  test('명령어 추가/삭제를 감지', () => {
    const added = [...builderSide, { name: 'test_v', description: '버전', options: [] }];
    expect(JSON.stringify(normalizeCommands(added))).not.toBe(
      JSON.stringify(normalizeCommands(apiSide)),
    );
  });
});
