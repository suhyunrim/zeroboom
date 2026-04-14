/**
 * 매칭 투표 세션 관리 (순수 로직, 디스코드 의존성 없음)
 */

class MatchVoteSession {
  /**
   * @param {Set<string>} participants - 투표 가능한 유저 discordId Set
   * @param {number} totalPlans - 플랜 수
   */
  constructor(participants, totalPlans) {
    this.participants = participants;
    this.totalPlans = totalPlans;
    this.votes = {};       // { discordId: planIndex }
    this.voteCounts = {};  // { planIndex: count }
    this.confirmedPlan = undefined;
  }

  /**
   * 투표 추가
   * @returns {{ success: boolean, error?: string, confirmed?: boolean, confirmedPlan?: string, status: object }}
   */
  addVote(userId, planIndex) {
    if (this.confirmedPlan !== undefined) {
      return { success: false, error: 'already_confirmed' };
    }

    if (!this.participants.has(userId)) {
      return { success: false, error: 'not_participant' };
    }

    if (this.votes[userId] !== undefined) {
      return { success: false, error: 'already_voted' };
    }

    this.votes[userId] = planIndex;
    this.voteCounts[planIndex] = (this.voteCounts[planIndex] || 0) + 1;

    const confirmed = this.checkConfirmation();
    return {
      success: true,
      confirmed,
      confirmedPlan: this.confirmedPlan,
      status: this.getStatus(),
    };
  }

  /**
   * 확정 체크: 최다득표가 뒤집힐 수 없는지
   * @returns {boolean}
   */
  checkConfirmation() {
    const totalVoted = Object.keys(this.votes).length;
    const remaining = this.participants.size - totalVoted;

    const counts = Object.entries(this.voteCounts).sort((a, b) => b[1] - a[1]);
    const [leadPlan, leadCount] = counts[0] || [null, 0];
    const secondCount = counts.length > 1 ? counts[1][1] : 0;

    if (leadCount > secondCount + remaining) {
      this.confirmedPlan = leadPlan;
      return true;
    }

    return false;
  }

  /**
   * 현재 투표 현황
   */
  getStatus() {
    const totalVoted = Object.keys(this.votes).length;
    return {
      totalVoted,
      totalParticipants: this.participants.size,
      remaining: this.participants.size - totalVoted,
      voteCounts: { ...this.voteCounts },
      confirmedPlan: this.confirmedPlan,
    };
  }
}

module.exports = { MatchVoteSession };
