const {
  formatTierBadge,
  formatAvgTierBadge,
  normalizePosition,
  POSITION_ABBR,
  getTierName,
  getTierStep,
  getTierPoint,
} = require('../../src/utils/tierUtils');

describe('tierUtils', () => {
  describe('formatTierBadge', () => {
    test('아이언 최저 레이팅', () => {
      expect(formatTierBadge(200)).toBe('[I4]');
    });

    test('골드 4 (500)', () => {
      expect(formatTierBadge(500)).toBe('[G4]');
    });

    test('골드 1 (575)', () => {
      expect(formatTierBadge(575)).toBe('[G1]');
    });

    test('다이아 4 (800)', () => {
      expect(formatTierBadge(800)).toBe('[D4]');
    });

    test('마스터 (900) - LP 표시', () => {
      expect(formatTierBadge(900)).toBe('[M 0LP]');
    });

    test('마스터 (920) - LP 계산', () => {
      expect(formatTierBadge(920)).toBe('[M 80LP]');
    });

    test('그랜드마스터 (1000) - GM 약어', () => {
      expect(formatTierBadge(1000)).toBe('[GM 0LP]');
    });

    test('챌린저 (1150)', () => {
      expect(formatTierBadge(1150)).toBe('[C 0LP]');
    });

    test('prefix 지정', () => {
      expect(formatTierBadge(500, '평균 ')).toBe('[평균 G4]');
    });

    test('prefix + 마스터', () => {
      expect(formatTierBadge(920, '평균 ')).toBe('[평균 M 80LP]');
    });
  });

  describe('formatAvgTierBadge', () => {
    test('정상 레이팅', () => {
      expect(formatAvgTierBadge(520)).toBe('[평균 G4]');
    });

    test('0이면 빈 문자열', () => {
      expect(formatAvgTierBadge(0)).toBe('');
    });

    test('null이면 빈 문자열', () => {
      expect(formatAvgTierBadge(null)).toBe('');
    });

    test('음수면 빈 문자열', () => {
      expect(formatAvgTierBadge(-100)).toBe('');
    });
  });

  describe('normalizePosition', () => {
    test('UTILITY → SUPPORT', () => {
      expect(normalizePosition('UTILITY')).toBe('SUPPORT');
    });

    test('다른 포지션은 그대로', () => {
      expect(normalizePosition('TOP')).toBe('TOP');
      expect(normalizePosition('JUNGLE')).toBe('JUNGLE');
      expect(normalizePosition('MIDDLE')).toBe('MIDDLE');
      expect(normalizePosition('BOTTOM')).toBe('BOTTOM');
      expect(normalizePosition('SUPPORT')).toBe('SUPPORT');
    });
  });

  describe('POSITION_ABBR', () => {
    test('모든 포지션 약어 매핑', () => {
      expect(POSITION_ABBR.TOP).toBe('TOP');
      expect(POSITION_ABBR.JUNGLE).toBe('JG');
      expect(POSITION_ABBR.MIDDLE).toBe('MID');
      expect(POSITION_ABBR.BOTTOM).toBe('AD');
      expect(POSITION_ABBR.UTILITY).toBe('SUP');
      expect(POSITION_ABBR.SUPPORT).toBe('SUP');
    });
  });

  describe('리팩토링 전후 동일성 검증', () => {
    // 리팩토링 전 인라인 로직을 그대로 재현하여 formatTierBadge와 비교
    const oldFormatTierDisplay = (rating) => {
      const tierName = getTierName(rating);
      const tierStep = getTierStep(rating);
      const isHighTier = tierName === 'MASTER' || tierName === 'GRANDMASTER' || tierName === 'CHALLENGER';
      if (isHighTier) {
        const tierPoint = getTierPoint(rating);
        const tierAbbr = tierName === 'GRANDMASTER' ? 'GM' : tierName.charAt(0);
        return `[${tierAbbr} ${tierPoint}LP]`;
      }
      return `[${tierName.charAt(0)}${tierStep}]`;
    };

    const testRatings = [200, 250, 300, 375, 400, 450, 500, 575, 600, 700, 800, 875, 900, 950, 1000, 1100, 1150, 1200];

    test.each(testRatings)('레이팅 %i: formatTierBadge === 기존 인라인 로직', (rating) => {
      expect(formatTierBadge(rating)).toBe(oldFormatTierDisplay(rating));
    });

    // formatAvgTierBadge vs 기존 formatAvgTier
    const oldFormatAvgTier = (avgRating) => {
      if (!avgRating || avgRating <= 0) return '';
      const tierName = getTierName(avgRating);
      const isHighTier = tierName === 'MASTER' || tierName === 'GRANDMASTER' || tierName === 'CHALLENGER';
      if (isHighTier) {
        const tierPoint = getTierPoint(avgRating);
        const tierAbbr = tierName === 'GRANDMASTER' ? 'GM' : tierName.charAt(0);
        return `[평균 ${tierAbbr} ${tierPoint}LP]`;
      }
      const tierStep = getTierStep(avgRating);
      return `[평균 ${tierName.charAt(0)}${tierStep}]`;
    };

    test.each(testRatings)('레이팅 %i: formatAvgTierBadge === 기존 formatAvgTier', (rating) => {
      expect(formatAvgTierBadge(rating)).toBe(oldFormatAvgTier(rating));
    });
  });
});
