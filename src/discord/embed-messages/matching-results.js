const { MessageEmbed } = require('discord.js');

const formatPercentage = (value) => `${(value * 100).toFixed(2)}%`

module.exports = (matches) => {
  const fields = [];

  matches.forEach(({ team1, team2, team1WinRate }, idx) => {
    if (fields.length !== 0) {
      // 여백 삽입
      fields.push({ name: '\u200B', value: '\u200B' });
    }

    fields.push({
      name: `**Plan ${idx + 1}** \`🐶${formatPercentage(team1WinRate)}\``,
      value: `\`🐶${team1[0]}\`\n\`🐶${team1[1]}\`\n\`🐶${team1[2]}\`\n\`🐶${team1[3]}\`\n\`🐶${team1[4]}\``,
      inline: true,
    });
    fields.push({
      name: `**Plan ${idx + 1}** \`🐱${formatPercentage(1 - team1WinRate)}\``,
      value: `\`🐱${team2[0]}\`\n\`🐱${team2[1]}\`\n\`🐱${team2[2]}\`\n\`🐱${team2[3]}\`\n\`🐱${team2[4]}\``,
      inline: true,
    });
  });

  return new MessageEmbed().addFields(...fields);
}
