const fs = require('fs');
const path = require('path');
const models = require('../src/db/models');
const { sequelize } = require('../src/db/models');

const GROUP_ID = 4;
const EXPIRE_DAYS = 60;
const DESCRIPTION = '외부 데이터 일괄 import';

async function main() {
  try {
    // 테이블 동기화 (없으면 생성)
    await sequelize.sync();
    console.log('DB 동기화 완료\n');

    // result.json 읽기
    const resultPath = path.join(__dirname, '..', 'result.json');
    const data = JSON.parse(fs.readFileSync(resultPath, 'utf8'));

    console.log(`총 ${data.length}명의 데이터를 처리합니다.\n`);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + EXPIRE_DAYS);

    let successCount = 0;
    let skipCount = 0;
    let notFoundCount = 0;
    const notFoundList = [];

    for (const record of data) {
      const { nickname, win, loss } = record;

      // 승/패가 둘 다 0이면 스킵
      if (win === 0 && loss === 0) {
        skipCount++;
        continue;
      }

      // summoner 테이블에서 simplifiedName으로 puuid 조회 (대소문자, 공백 무시)
      const simplifiedNickname = nickname.toLowerCase().replace(/ /g, '');
      const summoner = await models.summoner.findOne({
        where: sequelize.where(
          sequelize.fn('LOWER', sequelize.fn('REPLACE', sequelize.col('simplifiedName'), ' ', '')),
          simplifiedNickname
        ),
        attributes: ['puuid', 'name'],
      });

      if (!summoner) {
        notFoundCount++;
        notFoundList.push(nickname);
        continue;
      }

      // externalRecord 생성
      await models.externalRecord.create({
        puuid: summoner.puuid,
        groupId: GROUP_ID,
        win: win || 0,
        lose: loss || 0,
        description: DESCRIPTION,
        expiresAt,
      });

      successCount++;
      console.log(`[성공] ${nickname} (승: ${win}, 패: ${loss})`);
    }

    console.log('\n========== 결과 ==========');
    console.log(`성공: ${successCount}명`);
    console.log(`스킵 (0승 0패): ${skipCount}명`);
    console.log(`미발견: ${notFoundCount}명`);

    if (notFoundList.length > 0) {
      console.log('\n[미발견 목록]');
      notFoundList.forEach((name) => console.log(`  - ${name}`));
    }

    process.exit(0);
  } catch (error) {
    console.error('에러 발생:', error);
    process.exit(1);
  }
}

main();
