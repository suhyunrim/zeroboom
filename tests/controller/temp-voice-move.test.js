jest.mock('discord.js', () => ({ ChannelType: { GuildVoice: 2 } }));
jest.mock('../../src/db/models', () => ({}));
jest.mock('../../src/loaders/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { summarizeMoveResults } = require('../../src/controller/temp-voice');

describe('summarizeMoveResults', () => {
  it('전원 이동하면 인원수만 알린다', () => {
    const results = Array.from({ length: 10 }, (_, i) => ({ discordId: `${i}`, status: 'moved' }));
    expect(summarizeMoveResults(results)).toBe('🔊 팀 보이스 채널로 이동했습니다! (10명)');
  });

  it('스킵된 인원을 사유별로 묶어 알린다', () => {
    const results = [
      { discordId: '1', name: '리즈', status: 'moved' },
      { discordId: '2', name: '더 피', status: 'other_category', detail: '2번방' },
      { discordId: '3', name: '쥬티키스', status: 'not_in_voice' },
      { discordId: '4', name: '현수필', status: 'other_category', detail: '3번방' },
    ];
    const text = summarizeMoveResults(results);
    expect(text).toContain('(1/4명)');
    expect(text).toContain('다른 카테고리 음성 채널에 있음: 더 피, 현수필');
    expect(text).toContain('음성 채널 미접속: 쥬티키스');
  });

  it('디스코드 미연동도 스킵 사유로 드러난다 (예전에는 조용히 걸러졌다)', () => {
    const results = [
      { discordId: '1', name: '리즈', status: 'moved' },
      { discordId: null, status: 'no_discord_id' },
    ];
    expect(summarizeMoveResults(results)).toContain('디스코드 계정 미연동');
  });
});
