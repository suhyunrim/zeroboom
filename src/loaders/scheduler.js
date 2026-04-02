const cron = require('node-cron');
const { logger } = require('./logger');
const { updateActiveUsersPositions } = require('../controller/summoner');
const { syncAllActiveChallenges, initSnapshotSchedulers } = require('../controller/challenge');

module.exports = () => {
  // 매일 새벽 5시에 포지션 업데이트
  cron.schedule('0 5 * * *', async () => {
    logger.info('[스케줄러] 포지션 배치 업데이트 시작');

    try {
      const results = await updateActiveUsersPositions({
        withinDays: 30,
        force: false,  // 캐시 있으면 스킵
        delayBetweenSummoners: 2000,
      });

      logger.info(`[스케줄러] 포지션 배치 완료 - 성공: ${results.success.length}, 실패: ${results.failed.length}, 스킵: ${results.skipped.length}`);
    } catch (e) {
      logger.error(`[스케줄러] 포지션 배치 에러: ${e.message}`);
    }
  }, {
    timezone: 'Asia/Seoul',
  });

  logger.info('📅 스케줄러 등록: 매일 05:00 포지션 업데이트');

  // 매일 새벽 4시에 챌린지 전적 동기화
  cron.schedule('0 4 * * *', async () => {
    logger.info('[스케줄러] 챌린지 전적 배치 동기화 시작');

    try {
      await syncAllActiveChallenges();
      logger.info('[스케줄러] 챌린지 전적 배치 동기화 완료');
    } catch (e) {
      logger.error(`[스케줄러] 챌린지 전적 배치 에러: ${e.message}`);
    }
  }, {
    timezone: 'Asia/Seoul',
  });

  logger.info('📅 스케줄러 등록: 매일 04:00 챌린지 전적 동기화');

  // 서버 시작 시 챌린지 스냅샷 스케줄러 등록
  initSnapshotSchedulers();
};
