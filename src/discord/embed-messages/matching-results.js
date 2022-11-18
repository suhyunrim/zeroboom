const { EmbedBuilder } = require('discord.js');

const formatPercentage = (value) => `${(value * 100).toFixed(2)}%`;

const format = (idx, team, winRate, emoji, teamRating = 0) => {
  let message = `\`${emoji}${team[0]}\`\n\`${emoji}${team[1]}\`\n\`${emoji}${team[2]}\`\n\`${emoji}${team[3]}\`\n\`${emoji}${team[4]}\``;
  if (teamRating > 0) {
    message += `\n\`=> ${teamRating}\``;
  }
  return {
    name: `**Plan ${idx}** \`${emoji}${formatPercentage(winRate)}\``,
    value: message,
    inline: true,
  };
};

module.exports.formatMatchWithRating = (idx, team1, team1Rating, team2, team2Rating, team1WinRate) => {
  const fields = [];
  fields.push(format(idx + 1, team1, team1WinRate, '🐶', team1Rating));
  fields.push(format(idx + 1, team2, 1 - team1WinRate, '🐱', team2Rating));
  return new EmbedBuilder().addFields(fields);
};

module.exports.formatMatch = (idx, team1, team2, team1WinRate) => {
  const fields = [];
  fields.push(format(idx + 1, team1, team1WinRate, '🐶'));
  fields.push(format(idx + 1, team2, 1 - team1WinRate, '🐱'));
  return new EmbedBuilder().addFields(fields);
};

module.exports.formatMatches = (matches) => {
  const fields = [];

  matches.forEach(({ team1, team2, team1WinRate }, idx) => {
    if (fields.length !== 0) {
      // 여백 삽입
      fields.push({ name: '\u200B', value: '\u200B' });
    }
    fields.push(format(idx + 1, team1, team1WinRate, '🐶'));
    fields.push(format(idx + 1, team2, 1 - team1WinRate, '🐱'));
  });

  return new EmbedBuilder().addFields(fields);
};
