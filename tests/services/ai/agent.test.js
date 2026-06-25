const { sanitizeHistory } = require('../../../src/services/ai/agent');

describe('sanitizeHistory (멀티턴 컨텍스트 정규화)', () => {
  test('ai → assistant 매핑, 빈 내용 제거', () => {
    const r = sanitizeHistory([
      { role: 'user', content: '내 업적 더 따려면?' },
      { role: 'ai', content: '닉네임을 알려주세요' },
      { role: 'user', content: '   ' }, // 공백만 → 제거
    ]);
    expect(r).toEqual([
      { role: 'user', content: '내 업적 더 따려면?' },
      { role: 'assistant', content: '닉네임을 알려주세요' },
    ]);
  });

  test('첫 메시지가 assistant면 선행 제거(첫 메시지는 user여야 함)', () => {
    const r = sanitizeHistory([
      { role: 'assistant', content: '안녕하세요' },
      { role: 'user', content: '고인물 누구?' },
    ]);
    expect(r[0]).toEqual({ role: 'user', content: '고인물 누구?' });
    expect(r).toHaveLength(1);
  });

  test('배열 아니거나 잘못된 입력은 빈 배열', () => {
    expect(sanitizeHistory(null)).toEqual([]);
    expect(sanitizeHistory('x')).toEqual([]);
    expect(sanitizeHistory([{ role: 'user', content: 123 }])).toEqual([]);
  });

  test('최근 12턴만 유지', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `q${i}` }));
    const r = sanitizeHistory(many);
    expect(r).toHaveLength(12);
    expect(r[0].content).toBe('q8'); // 마지막 12개
  });
});
