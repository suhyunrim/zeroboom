const { MatchVoteSession } = require('../../src/services/match-vote');

describe('MatchVoteSession', () => {
  const makeSession = (participantCount = 10, totalPlans = 3) => {
    const participants = new Set();
    for (let i = 1; i <= participantCount; i++) {
      participants.add(`user${i}`);
    }
    return new MatchVoteSession(participants, totalPlans);
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
    session.addVote('user1', '0');
    const r = session.addVote('user2', '0');
    expect(r.confirmed).toBe(true);

    // 확정 후 추가 투표 시도
    const session2 = makeSession(3, 2);
    session2.addVote('user1', '0');
    session2.addVote('user2', '0');
    // 이미 확정됨
    const result = session2.addVote('user3', '1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('already_confirmed');
  });

  test('과반수 확정: 10명 중 6명이 같은 플랜 투표', () => {
    const session = makeSession(10, 3);

    for (let i = 1; i <= 5; i++) {
      const r = session.addVote(`user${i}`, '0');
      expect(r.confirmed).toBe(false);
    }

    // 6번째 투표: 남은 4명이 전부 다른 데 투표해도 5표를 넘을 수 없음
    const r = session.addVote('user6', '0');
    expect(r.confirmed).toBe(true);
    expect(r.confirmedPlan).toBe('0');
  });

  test('과반수 확정: 뒤집힐 수 없을 때만 확정', () => {
    const session = makeSession(10, 3);

    // 5명: 플랜0에 3표, 플랜1에 2표 → 남은 5명이 플랜1에 몰리면 뒤집힘
    session.addVote('user1', '0');
    session.addVote('user2', '0');
    session.addVote('user3', '0');
    session.addVote('user4', '1');
    const r = session.addVote('user5', '1');
    expect(r.confirmed).toBe(false);

    // 6번째: 플랜0에 4표, 플랜1에 2표, 남은 4명 → 4 > 2+4? No
    const r2 = session.addVote('user6', '0');
    expect(r2.confirmed).toBe(false);

    // 7번째: 플랜0에 5표, 플랜1에 2표, 남은 3명 → 5 > 2+3? No
    const r3 = session.addVote('user7', '0');
    expect(r3.confirmed).toBe(false);

    // 8번째: 플랜0에 6표, 플랜1에 2표, 남은 2명 → 6 > 2+2? Yes
    const r4 = session.addVote('user8', '0');
    expect(r4.confirmed).toBe(true);
    expect(r4.confirmedPlan).toBe('0');
  });

  test('2명 세션: 1표로 바로 확정', () => {
    const session = makeSession(2, 3);
    const r = session.addVote('user1', '2');
    // 1 > 0+1? No → 아직 미확정
    expect(r.confirmed).toBe(false);

    const r2 = session.addVote('user2', '2');
    // 2 > 0+0? Yes → 확정
    expect(r2.confirmed).toBe(true);
    expect(r2.confirmedPlan).toBe('2');
  });

  test('4명 세션: 과반수 테스트', () => {
    const session = makeSession(4, 2);

    session.addVote('user1', '0');  // 0:1, 남은 3
    const r1 = session.addVote('user2', '1');  // 0:1, 1:1, 남은 2 → 1 > 1+2? No
    expect(r1.confirmed).toBe(false);

    const r2 = session.addVote('user3', '0');  // 0:2, 1:1, 남은 1 → 2 > 1+1? No
    expect(r2.confirmed).toBe(false);

    const r3 = session.addVote('user4', '0');  // 0:3, 1:1, 남은 0 → 3 > 1+0? Yes
    expect(r3.confirmed).toBe(true);
    expect(r3.confirmedPlan).toBe('0');
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
