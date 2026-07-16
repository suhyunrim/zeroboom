// 수집 토큰 발급: node scripts/issue-collector-token.js <groupId> [label]
// 예: node scripts/issue-collector-token.js 4 "현수필 PC"
const crypto = require('crypto');
const models = require('../src/db/models');

(async () => {
  const groupId = Number(process.argv[2]);
  const label = process.argv[3] || null;
  if (!groupId) {
    console.error('사용법: node scripts/issue-collector-token.js <groupId> [label]');
    process.exit(1);
  }

  const group = await models.group.findOne({ where: { id: groupId } });
  if (!group) {
    console.error(`그룹 ${groupId}을(를) 찾을 수 없습니다.`);
    process.exit(1);
  }

  const token = crypto.randomBytes(24).toString('hex');
  await models.collector_token.create({ groupId, token, label, active: true });

  console.log(`그룹: ${group.groupName} (${groupId})`);
  console.log(`라벨: ${label || '(없음)'}`);
  console.log(`토큰: ${token}`);
  console.log('\nelise config.json에 이 토큰을 넣어주세요.');
  process.exit(0);
})().catch((e) => {
  console.error('실패:', e.message);
  process.exit(1);
});
