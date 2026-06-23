const { EmbedBuilder } = require('discord.js');
const { formatAvgTierBadge } = require('../../utils/tierUtils');

const formatPercentage = (value) => `${(value * 100).toFixed(2)}%`;

// 한글/이모지 등 double-width 문자를 고려한 시각적 너비 계산
const visualWidth = (str) => {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0);
    width += code > 0x7f ? 2 : 1;
  }
  return width;
};

const TARGET_WIDTH = 28;
// U+2800 (Braille Pattern Blank) — 디스코드에서 공백으로 렌더링되지만 축소되지 않는 문자
const INVISIBLE_SPACE = '⠀';

const rawFrontendUrl = process.env.FRONTEND_URL;
const FRONTEND_URL = rawFrontendUrl && !rawFrontendUrl.startsWith('http')
  ? `http://${rawFrontendUrl}`
  : rawFrontendUrl;

const profileLink = (display, puuid) => {
  if (!FRONTEND_URL || !puuid) return `\`${display}\``;
  // [`text`](url) 형태 — backtick 안은 마크다운 처리 안 되지만 전체를 링크로 감싸면 클릭 가능
  return `[\`${display}\`](${FRONTEND_URL}/userinfo/${puuid})`;
};

const frontendFooterField = () => {
  if (!FRONTEND_URL) return null;
  return {
    name: '​',
    value: `🌐 [전적·프로필 더 보기](${FRONTEND_URL})`,
    inline: false,
  };
};

// team: 배열, 각 원소는 { display, puuid } 또는 문자열(레거시)
// withLink=false면 프로필 링크 생략 (플랜 리스트처럼 줄 수 많아 embed 6000자 초과 우려 시)
const format = (label, team, winRate, emoji, avgRating = 0, withLink = true, positionScore = null) => {
  let message = team
    .map((p) => {
      const display = typeof p === 'string' ? p : p.display;
      const puuid = typeof p === 'string' ? null : p.puuid;
      const content = emoji + display;
      const padding = Math.max(0, TARGET_WIDTH - visualWidth(content));
      const linkOrPlain = withLink ? profileLink(content, puuid) : `\`${content}\``;
      return linkOrPlain + INVISIBLE_SPACE.repeat(padding);
    })
    .join('\n');
  const avgTierStr = formatAvgTierBadge(avgRating);
  const posStr = positionScore != null ? ` 🎯${positionScore}` : '';
  return {
    name: `**${label}** \`${emoji}${formatPercentage(winRate)}\` ${avgTierStr}${posStr}`,
    value: message,
    inline: true,
  };
};

module.exports.formatMatchWithRating = (label, team1, team1Rating, team2, team2Rating, team1WinRate) => {
  const fields = [];
  fields.push(
    format(
      label,
      team1.map((elem) => ({ display: elem.name, puuid: elem.puuid })),
      team1WinRate,
      '🐶',
      team1Rating,
    ),
  );
  fields.push(
    format(
      label,
      team2.map((elem) => ({ display: elem.name, puuid: elem.puuid })),
      1 - team1WinRate,
      '🐱',
      team2Rating,
    ),
  );
  const footer = frontendFooterField();
  if (footer) fields.push(footer);
  return new EmbedBuilder().addFields(fields);
};

module.exports.formatMatches = (matches) => {
  const fields = [];

  matches.forEach(
    (
      {
        team1,
        team2,
        team1WinRate,
        team1AvgRating,
        team2AvgRating,
        conceptLabel,
        conceptEmoji,
        conceptDesc,
        positionScore,
        team1PositionScore,
        team2PositionScore,
      },
      idx,
    ) => {
      // 🎯 종합 포지션 적합도 배지 (플랜 비교용, 산출 가능할 때만)
      const posBadge = positionScore != null ? `  ·  🎯 포지션 적합도 ${positionScore}점` : '';
      if (conceptDesc) {
        if (fields.length !== 0) {
          fields.push({ name: '​', value: '​' });
        }
        fields.push({ name: `${conceptEmoji} ${conceptLabel} - ${conceptDesc}${posBadge}`, value: '​', inline: false });
      } else {
        // 플랜 모드: 빈 구분줄 대신 점수 헤더로 각 안을 구분
        fields.push({ name: `Plan ${idx + 1}${posBadge}`, value: '​', inline: false });
      }
      // 플랜 리스트는 6안 × 2팀 × 10명 = 120줄까지 가능 → 줄당 링크 박으면 embed 6000자 한도 초과 (footer 링크로 대체)
      // 팀 헤더 끝의 🎯N = 해당 팀의 포지션 적합도 (종합과 별개)
      fields.push(format('Team 1', team1, team1WinRate, '🐶', team1AvgRating, false, team1PositionScore));
      fields.push(format('Team 2', team2, 1 - team1WinRate, '🐱', team2AvgRating, false, team2PositionScore));
    },
  );

  const footer = frontendFooterField();
  if (footer) fields.push(footer);

  return new EmbedBuilder().addFields(fields);
};
