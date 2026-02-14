const { EmbedBuilder } = require('discord.js');
const { getTierName, getTierStep, getTierPoint } = require('../../utils/tierUtils');

const formatPercentage = (value) => `${(value * 100).toFixed(2)}%`;

const formatAvgTier = (avgRating) => {
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

// 한글/이모지 등 double-width 문자를 고려한 시각적 너비 계산
const visualWidth = (str) => {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0);
    width += code > 0x7F ? 2 : 1;
  }
  return width;
};

const TARGET_WIDTH = 28;
// U+2800 (Braille Pattern Blank) — 디스코드에서 공백으로 렌더링되지만 축소되지 않는 문자
const INVISIBLE_SPACE = '\u2800';

const format = (idx, team, winRate, emoji, avgRating = 0) => {
  let message = team.map((name) => {
    const content = emoji + name;
    const padding = Math.max(0, TARGET_WIDTH - visualWidth(content));
    return `\`${content}\`` + INVISIBLE_SPACE.repeat(padding);
  }).join('\n');
  const avgTierStr = formatAvgTier(avgRating);
  return {
    name: `**Plan ${idx}** \`${emoji}${formatPercentage(winRate)}\` ${avgTierStr}`,
    value: message,
    inline: true,
  };
};

module.exports.formatMatchWithRating = (idx, team1, team1Rating, team2, team2Rating, team1WinRate) => {
  const fields = [];
  fields.push(format(idx + 1, team1.map(elem => elem.name), team1WinRate, '🐶', team1Rating));
  fields.push(format(idx + 1, team2.map(elem => elem.name), 1 - team1WinRate, '🐱', team2Rating));
  return new EmbedBuilder().addFields(fields);
};

module.exports.formatMatches = (matches) => {
  const fields = [];

  matches.forEach(({ team1, team2, team1WinRate, team1AvgRating, team2AvgRating }, idx) => {
    if (fields.length !== 0) {
      // 여백 삽입
      fields.push({ name: '\u200B', value: '\u200B' });
    }
    fields.push(format(idx + 1, team1, team1WinRate, '🐶', team1AvgRating));
    fields.push(format(idx + 1, team2, 1 - team1WinRate, '🐱', team2AvgRating));
  });

  return new EmbedBuilder().addFields(fields);
};
