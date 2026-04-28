const { canViewComment, canDeleteComment, formatVisitDate } = require('../../src/controller/profile');

describe('canViewComment', () => {
  const publicComment = { isSecret: false, authorDiscordId: 'AUTHOR' };
  const secretComment = { isSecret: true, authorDiscordId: 'AUTHOR' };

  test('공개글은 비로그인도 보임', () => {
    expect(canViewComment({ comment: publicComment, viewerDiscordId: null })).toBe(true);
  });

  test('비밀글은 비로그인에게 안 보임', () => {
    expect(canViewComment({ comment: secretComment, viewerDiscordId: null })).toBe(false);
  });

  test('비밀글은 작성자에게 보임', () => {
    expect(canViewComment({ comment: secretComment, viewerDiscordId: 'AUTHOR', ownerDiscordId: 'OWNER' })).toBe(true);
  });

  test('비밀글은 프로필 주인에게 보임', () => {
    expect(canViewComment({ comment: secretComment, viewerDiscordId: 'OWNER', ownerDiscordId: 'OWNER' })).toBe(true);
  });

  test('비밀글은 그룹 어드민에게 보임', () => {
    expect(
      canViewComment({
        comment: secretComment,
        viewerDiscordId: 'ADMIN',
        ownerDiscordId: 'OWNER',
        isAdmin: true,
      }),
    ).toBe(true);
  });

  test('비밀글은 제3자에게 안 보임', () => {
    expect(
      canViewComment({
        comment: secretComment,
        viewerDiscordId: 'OTHER',
        ownerDiscordId: 'OWNER',
        isAdmin: false,
      }),
    ).toBe(false);
  });
});

describe('canDeleteComment', () => {
  const comment = { authorDiscordId: 'AUTHOR' };

  test('비로그인은 삭제 불가', () => {
    expect(canDeleteComment({ comment, viewerDiscordId: null })).toBe(false);
  });

  test('작성자 본인은 삭제 가능', () => {
    expect(canDeleteComment({ comment, viewerDiscordId: 'AUTHOR' })).toBe(true);
  });

  test('그룹 어드민은 삭제 가능', () => {
    expect(canDeleteComment({ comment, viewerDiscordId: 'OTHER', isAdmin: true })).toBe(true);
  });

  test('제3자는 삭제 불가', () => {
    expect(canDeleteComment({ comment, viewerDiscordId: 'OTHER', isAdmin: false })).toBe(false);
  });
});

describe('formatVisitDate', () => {
  test('YYYY-MM-DD 형식, 한 자리 월/일은 0 패딩', () => {
    expect(formatVisitDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  test('두 자리 월/일도 정상', () => {
    expect(formatVisitDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});
