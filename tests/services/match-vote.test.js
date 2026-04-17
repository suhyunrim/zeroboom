const { MatchVoteSession } = require('../../src/services/match-vote');

describe('MatchVoteSession', () => {
  const makeSession = (participantCount = 10, totalPlans = 3, options = {}) => {
    const participants = new Set();
    for (let i = 1; i <= participantCount; i++) {
      participants.add(`user${i}`);
    }
    return new MatchVoteSession(participants, totalPlans, options);
  };

  test('참가자가 투표하면 성공', () => {
    const session = makeSession();
    const result = session.addVote('user1', '0');
    expect(result.success).toBe(true);
    expect(result.status.totalVoted).toBe(1);
    expect(result.status.voteCounts['0']).toBe(1);
  });

  test('비참가자는 투표 불가', () => {
    const session = makeSession();
    const result = session.addVote('outsider', '0');
    expect(result.success).toBe(false);
    expect(result.error).toBe('not_participant');
  });

  test('중복 투표 불가', () => {
    const session = makeSession();
    session.addVote('user1', '0');
    const result = session.addVote('user1', '1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('already_voted');
  });

  test('확정 후 투표 불가', () => {
    const session = makeSession(2, 2); // 2명, 2플랜
    const r = session.addVote('user1', '0');
    // 1 >= 0+1 → 바로 확정
    expect(r.confirmed).toBe(true);

    // 확정 후 추가 투표 시도
    const result = session.addVote('user2', '0');
    expect(result.success).toBe(false);
    expect(result.error).toBe('already_confirmed');
  });

  test('과반수 확정: 10명 중 동률 불가능 시점에서 확정 (선착순)', () => {
    const session = makeSession(10, 3);

    for (let i = 1; i <= 4; i++) {
      const r = session.addVote(`user${i}`, '0');
      expect(r.confirmed).toBe(false);
    }

    // 5번째 투표: 5표, 남은 5명 → 5 >= 0+5? Yes → 동률까지 가능하지만 선착순 확정
    const r = session.addVote('user5', '0');
    expect(r.confirmed).toBe(true);
    expect(r.confirmedPlan).toBe('0');
  });

  test('과반수 확정: 경합 시 동률 가능하면 미확정', () => {
    const session = makeSession(10, 3);

    // 플랜0에 3표, 플랜1에 2표, 남은 5명 → 3 >= 2+5? No
    session.addVote('user1', '0');
    session.addVote('user2', '0');
    session.addVote('user3', '0');
    session.addVote('user4', '1');
    const r = session.addVote('user5', '1');
    expect(r.confirmed).toBe(false);

    // 플랜0에 4표, 플랜1에 2표, 남은 4명 → 4 >= 2+4? No
    const r2 = session.addVote('user6', '0');
    expect(r2.confirmed).toBe(false);

    // 플랜0에 5표, 플랜1에 2표, 남은 3명 → 5 >= 2+3? Yes → 확정
    const r3 = session.addVote('user7', '0');
    expect(r3.confirmed).toBe(true);
    expect(r3.confirmedPlan).toBe('0');
  });

  test('2명 세션: 1표로 바로 확정 (동률 선착순)', () => {
    const session = makeSession(2, 3);
    const r = session.addVote('user1', '2');
    // 1 >= 0+1? Yes → 확정
    expect(r.confirmed).toBe(true);
    expect(r.confirmedPlan).toBe('2');
  });

  test('4명 세션: 과반수 테스트', () => {
    const session = makeSession(4, 2);

    session.addVote('user1', '0');  // 0:1, 남은 3 → 1 >= 0+3? No
    const r1 = session.addVote('user2', '1');  // 0:1, 1:1, 남은 2 → 1 >= 1+2? No
    expect(r1.confirmed).toBe(false);

    const r2 = session.addVote('user3', '0');  // 0:2, 1:1, 남은 1 → 2 >= 1+1? Yes → 확정
    expect(r2.confirmed).toBe(true);
    expect(r2.confirmedPlan).toBe('0');
  });

  test('blind 모드: 옵션이 세션에 저장됨', () => {
    const session = makeSession(4, 2, { blind: true });
    expect(session.blind).toBe(true);

    const normalSession = makeSession(4, 2);
    expect(normalSession.blind).toBe(false);
  });

  test('blind 모드: 투표/확정 로직은 일반 모드와 동일', () => {
    const session = makeSession(4, 2, { blind: true });
    session.addVote('user1', '0');
    session.addVote('user2', '1');
    const r = session.addVote('user3', '0'); // 0:2, 1:1, 남은 1 → 2 >= 1+1 → 확정
    expect(r.confirmed).toBe(true);
    expect(r.confirmedPlan).toBe('0');
  });

  test('getStatus 현황 확인', () => {
    const session = makeSession(5, 2);
    session.addVote('user1', '0');
    session.addVote('user2', '1');
    session.addVote('user3', '0');

    const status = session.getStatus();
    expect(status.totalVoted).toBe(3);
    expect(status.totalParticipants).toBe(5);
    expect(status.remaining).toBe(2);
    expect(status.voteCounts['0']).toBe(2);
    expect(status.voteCounts['1']).toBe(1);
    expect(status.confirmedPlan).toBeUndefined();
  });
});
