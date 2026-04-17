const cron = require('node-cron');
const { logger } = require('./logger');
const { updateActiveUsersPositions } = require('../controller/summoner');
const { syncAllActiveChallenges, initSnapshotSchedulers } = require('../controller/challenge');
const seasonController = require('../controller/season');
const models = require('../db/models');
const { getKSTYear, getKSTMonth } = require('../utils/timeUtils');

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

  // 매일 00:05 KST에 시즌 자동 리셋 체크
  // group.settings.seasonEndMonth (YYYY-MM)가 오늘 이전이면 리셋 실행
  cron.schedule('5 0 * * *', async () => {
    try {
      const year = getKSTYear();
      const month = getKSTMonth() + 1; // 1-indexed
      const todayYm = `${year}-${String(month).padStart(2, '0')}`;

      const groups = await models.group.findAll();
      for (const group of groups) {
        const endMonth = group.settings?.seasonEndMonth;
        if (!endMonth) continue;
        if (endMonth >= todayYm) continue; // 아직 시즌 중

        logger.info(`[스케줄러] 시즌 자동 리셋: group=${group.id} (${group.groupName}), endMonth=${endMonth}`);
        try {
          await seasonController.resetSeason(group.id, null, 'scheduler');
          const updatedSettings = { ...(group.settings || {}), seasonEndMonth: null };
          await group.update({ settings: updatedSettings });
        } catch (e) {
          logger.error(`[스케줄러] 시즌 리셋 실패 group=${group.id}: ${e.message}`);
        }
      }
    } catch (e) {
      logger.error(`[스케줄러] 시즌 자동 리셋 에러: ${e.message}`);
    }
  }, {
    timezone: 'Asia/Seoul',
  });

  logger.info('📅 스케줄러 등록: 매일 00:05 시즌 자동 리셋 체크');

  // 서버 시작 시 챌린지 스냅샷 스케줄러 등록
  initSnapshotSchedulers();
};
