/**
 * result.json의 승/패에서 DB에 있는 기존 승/패를 빼서
 * 차이값만 externalRecord에 반영하는 스크립트
 *
 * externalRecord 승 = result.json win - user.win
 * externalRecord 패 = result.json loss - user.lose
 */
const fs = require('fs');
const path = require('path');
const models = require('../src/db/models');
const { sequelize } = require('../src/db/models');
const { addDays } = require('../src/utils/timeUtils');

const GROUP_ID = 4;
const EXPIRE_DAYS = 60;
const DESCRIPTION = '외부 데이터 일괄 import (DB 차감)';

async function main() {
  try {
    // 테이블 동기화 (없으면 생성)
    await sequelize.sync();
    console.log('DB 동기화 완료\n');

    // result.json 읽기
    const resultPath = path.join(__dirname, '..', 'result.json');
    const data = JSON.parse(fs.readFileSync(resultPath, 'utf8'));

    console.log(`총 ${data.length}명의 데이터를 처리합니다.\n`);

    const expiresAt = addDays(new Date(), EXPIRE_DAYS);

    let successCount = 0;
    let skipCount = 0;
    let notFoundCount = 0;
    let noExternalCount = 0;
    const notFoundList = [];
    const noExternalList = [];

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

      // user 테이블에서 현재 승/패 조회
      const user = await models.user.findOne({
        where: {
          puuid: summoner.puuid,
          groupId: GROUP_ID,
        },
        attributes: ['win', 'lose'],
      });

      const dbWin = user ? (user.win || 0) : 0;
      const dbLose = user ? (user.lose || 0) : 0;

      // 차이값 계산
      const externalWin = win - dbWin;
      const externalLose = loss - dbLose;

      // 차이가 없으면 스킵
      if (externalWin <= 0 && externalLose <= 0) {
        noExternalCount++;
        noExternalList.push(`${nickname} (json: ${win}/${loss}, db: ${dbWin}/${dbLose})`);
        continue;
      }

      // externalRecord 생성 (음수는 0으로 처리)
      await models.externalRecord.create({
        puuid: summoner.puuid,
        groupId: GROUP_ID,
        win: Math.max(0, externalWin),
        lose: Math.max(0, externalLose),
        description: DESCRIPTION,
        expiresAt,
      });

      successCount++;
      console.log(`[성공] ${nickname} (json: ${win}/${loss}, db: ${dbWin}/${dbLose} → external: ${Math.max(0, externalWin)}/${Math.max(0, externalLose)})`);
    }

    console.log('\n========== 결과 ==========');
    console.log(`성공: ${successCount}명`);
    console.log(`스킵 (0승 0패): ${skipCount}명`);
    console.log(`스킵 (외부 데이터 없음): ${noExternalCount}명`);
    console.log(`미발견: ${notFoundCount}명`);

    if (noExternalList.length > 0) {
      console.log('\n[외부 데이터 없음 목록]');
      noExternalList.forEach((item) => console.log(`  - ${item}`));
    }

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
