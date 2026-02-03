exports.run = async (groupName, interaction) => {
  const max = interaction.options?.getInteger('최대값') || 6;
  const min = 1;
  const result = Math.floor(Math.random() * max) + min;

  return `🎲 주사위 결과: **${result}**`;
};

exports.conf = {
  enabled: true,
  aliases: ['주사위'],
  args: [
    {
      name: '최대값',
      description: '주사위 최대값 (기본: 6)',
      type: 'INTEGER',
      required: false,
    },
  ],
};

exports.help = {
  name: '주사위',
  description: '주사위를 굴려 랜덤 숫자를 반환합니다',
  usage: '주사위 [최대값]',
};
