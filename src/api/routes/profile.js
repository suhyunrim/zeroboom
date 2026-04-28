const { Router } = require('express');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const { logger } = require('../../loaders/logger');
const { verifyToken } = require('../middlewares/auth');
const models = require('../../db/models');
const auditLog = require('../../controller/audit-log');
const profileController = require('../../controller/profile');

const route = Router();

const COMMENT_MAX_LENGTH = 500;

/**
 * Authorization 헤더가 있으면 디코딩해서 req.user 세팅, 없거나 invalid면 그냥 통과.
 * 댓글 목록 / 방문 기록 등에서 비로그인도 허용해야 하는 엔드포인트용.
 */
const optionalAuth = (req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();
  try {
    req.user = jwt.verify(authHeader.split(' ')[1], config.jwtSecret);
  } catch (e) {
    // 무효 토큰은 그냥 비로그인 취급
  }
  return next();
};

/**
 * 그룹 어드민 여부 확인 (슈퍼 어드민 또는 user.role === 'admin')
 */
const isGroupAdmin = async (groupId, discordId) => {
  if (!discordId) return false;
  const superAdmin = await models.super_admin.findByPk(discordId);
  if (superAdmin) return true;
  const u = await models.user.findOne({
    where: { groupId, discordId },
    attributes: ['role'],
  });
  return !!u && u.role === 'admin';
};

/**
 * 프로필 주인 puuid의 discordId 조회 (비밀글 가시성 판단용)
 */
const getProfileOwnerDiscordId = async (groupId, puuid) => {
  const u = await models.user.findOne({
    where: { groupId, puuid },
    attributes: ['discordId'],
  });
  return u ? u.discordId : null;
};

module.exports = (app) => {
  app.use('/profile', route);

  /**
   * GET /api/profile/:groupId/:puuid/comments
   * 댓글 목록 (비밀글은 작성자/프로필주인/어드민만 보임)
   */
  route.get('/:groupId/:puuid/comments', optionalAuth, async (req, res) => {
    const groupId = Number(req.params.groupId);
    const { puuid } = req.params;
    if (!groupId || !puuid) {
      return res.status(400).json({ result: 'groupId, puuid가 필요합니다.' });
    }

    try {
      const viewerDiscordId = req.user ? req.user.discordId : null;
      const ownerDiscordId = await getProfileOwnerDiscordId(groupId, puuid);
      const isAdmin = viewerDiscordId ? await isGroupAdmin(groupId, viewerDiscordId) : false;

      const comments = await models.profile_comment.findAll({
        where: { targetPuuid: puuid, targetGroupId: groupId },
        order: [['createdAt', 'DESC']],
      });

      const commentIds = comments.map((c) => c.id);
      const likeRows = commentIds.length
        ? await models.comment_like.findAll({
            where: { commentId: commentIds },
            attributes: ['commentId', 'likerDiscordId'],
          })
        : [];

      const likeCountMap = {};
      const likedByViewer = new Set();
      likeRows.forEach((l) => {
        likeCountMap[l.commentId] = (likeCountMap[l.commentId] || 0) + 1;
        if (viewerDiscordId && l.likerDiscordId === viewerDiscordId) {
          likedByViewer.add(l.commentId);
        }
      });

      const result = comments
        .filter((c) =>
          profileController.canViewComment({
            comment: c,
            viewerDiscordId,
            ownerDiscordId,
            isAdmin,
          }),
        )
        .map((c) => ({
          id: c.id,
          authorDiscordId: c.authorDiscordId,
          authorName: c.authorName,
          content: c.content,
          isSecret: c.isSecret,
          likeCount: likeCountMap[c.id] || 0,
          likedByMe: likedByViewer.has(c.id),
          createdAt: c.createdAt,
        }));

      return res.status(200).json({ result });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * POST /api/profile/:groupId/:puuid/comments
   * 댓글 작성 (인증 필요)
   * body: { content, isSecret }
   */
  route.post('/:groupId/:puuid/comments', verifyToken, async (req, res) => {
    const groupId = Number(req.params.groupId);
    const { puuid } = req.params;
    const { content, isSecret } = req.body;
    const { discordId, globalName, username } = req.user;

    if (!groupId || !puuid) {
      return res.status(400).json({ result: 'groupId, puuid가 필요합니다.' });
    }
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ result: '내용을 입력해주세요.' });
    }
    if (content.length > COMMENT_MAX_LENGTH) {
      return res.status(400).json({ result: `댓글은 ${COMMENT_MAX_LENGTH}자 이하로 작성해주세요.` });
    }

    try {
      const owner = await models.user.findOne({
        where: { groupId, puuid },
        attributes: ['puuid'],
      });
      if (!owner) {
        return res.status(404).json({ result: '대상 유저가 그룹에 없습니다.' });
      }

      const authorName = globalName || username || null;
      const created = await models.profile_comment.create({
        targetPuuid: puuid,
        targetGroupId: groupId,
        authorDiscordId: discordId,
        authorName,
        content: content.trim(),
        isSecret: !!isSecret,
      });

      auditLog.log({
        groupId,
        actorDiscordId: discordId,
        actorName: authorName,
        action: 'profile.comment_create',
        details: { commentId: created.id, targetPuuid: puuid, isSecret: !!isSecret },
        source: 'web',
      });

      return res.status(200).json({
        result: {
          id: created.id,
          authorDiscordId: created.authorDiscordId,
          authorName: created.authorName,
          content: created.content,
          isSecret: created.isSecret,
          likeCount: 0,
          likedByMe: false,
          createdAt: created.createdAt,
        },
      });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * DELETE /api/profile/comments/:commentId
   * 댓글 삭제 (작성자 본인 또는 그룹 어드민)
   */
  route.delete('/comments/:commentId', verifyToken, async (req, res) => {
    const commentId = Number(req.params.commentId);
    const { discordId, globalName, username } = req.user;

    if (!commentId) {
      return res.status(400).json({ result: 'commentId가 필요합니다.' });
    }

    try {
      const comment = await models.profile_comment.findByPk(commentId);
      if (!comment) {
        return res.status(404).json({ result: '댓글을 찾을 수 없습니다.' });
      }

      const isAdmin = await isGroupAdmin(comment.targetGroupId, discordId);
      const allowed = profileController.canDeleteComment({
        comment,
        viewerDiscordId: discordId,
        isAdmin,
      });
      if (!allowed) {
        return res.status(403).json({ result: '삭제 권한이 없습니다.' });
      }
      const isAuthor = comment.authorDiscordId === discordId;

      await comment.destroy();

      auditLog.log({
        groupId: comment.targetGroupId,
        actorDiscordId: discordId,
        actorName: globalName || username || null,
        action: 'profile.comment_delete',
        details: {
          commentId,
          targetPuuid: comment.targetPuuid,
          authorDiscordId: comment.authorDiscordId,
          deletedByAdmin: !isAuthor && isAdmin,
        },
        source: 'web',
      });

      return res.status(200).json({ result: '삭제되었습니다.' });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * POST /api/profile/comments/:commentId/like
   * 좋아요 토글 (인증 필요). 응답에 토글 후 상태 반환.
   */
  route.post('/comments/:commentId/like', verifyToken, async (req, res) => {
    const commentId = Number(req.params.commentId);
    const { discordId, globalName, username } = req.user;

    if (!commentId) {
      return res.status(400).json({ result: 'commentId가 필요합니다.' });
    }

    try {
      const comment = await models.profile_comment.findByPk(commentId);
      if (!comment) {
        return res.status(404).json({ result: '댓글을 찾을 수 없습니다.' });
      }

      const existing = await models.comment_like.findOne({
        where: { commentId, likerDiscordId: discordId },
      });

      let liked;
      if (existing) {
        await existing.destroy();
        liked = false;
      } else {
        await models.comment_like.create({
          commentId,
          likerDiscordId: discordId,
          likerName: globalName || username || null,
        });
        liked = true;
      }

      const likeCount = await models.comment_like.count({ where: { commentId } });

      return res.status(200).json({ result: { liked, likeCount } });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * GET /api/profile/comments/:commentId/likes
   * 좋아요 누른 사람 목록
   */
  route.get('/comments/:commentId/likes', async (req, res) => {
    const commentId = Number(req.params.commentId);
    if (!commentId) {
      return res.status(400).json({ result: 'commentId가 필요합니다.' });
    }

    try {
      const likes = await models.comment_like.findAll({
        where: { commentId },
        order: [['createdAt', 'DESC']],
      });

      const result = likes.map((l) => ({
        likerDiscordId: l.likerDiscordId,
        likerName: l.likerName,
        createdAt: l.createdAt,
      }));

      return res.status(200).json({ result });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * POST /api/profile/:groupId/:puuid/visit
   * 방문 기록 (인증 필요, 본인 방문은 무시, 1인 1일 1카운트)
   */
  route.post('/:groupId/:puuid/visit', verifyToken, async (req, res) => {
    const groupId = Number(req.params.groupId);
    const { puuid } = req.params;
    const { discordId } = req.user;

    if (!groupId || !puuid) {
      return res.status(400).json({ result: 'groupId, puuid가 필요합니다.' });
    }

    try {
      // 본인 프로필 방문은 카운트하지 않음 (본캐 puuid 또는 본인이 등록한 부캐 puuid)
      const ownerUsers = await models.user.findAll({
        where: { groupId, discordId },
        attributes: ['puuid'],
      });
      const ownPuuids = new Set(ownerUsers.map((u) => u.puuid));
      if (ownPuuids.has(puuid)) {
        return res.status(200).json({ result: { counted: false } });
      }

      const visitDate = profileController.formatVisitDate();

      const [, created] = await models.profile_visit.findOrCreate({
        where: {
          targetPuuid: puuid,
          targetGroupId: groupId,
          visitorDiscordId: discordId,
          visitDate,
        },
        defaults: {
          targetPuuid: puuid,
          targetGroupId: groupId,
          visitorDiscordId: discordId,
          visitDate,
        },
      });

      return res.status(200).json({ result: { counted: created } });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * GET /api/profile/:groupId/:puuid/stats
   * 방문자 통계 (today / total)
   */
  route.get('/:groupId/:puuid/stats', async (req, res) => {
    const groupId = Number(req.params.groupId);
    const { puuid } = req.params;
    if (!groupId || !puuid) {
      return res.status(400).json({ result: 'groupId, puuid가 필요합니다.' });
    }

    try {
      const visitDate = profileController.formatVisitDate();

      const [todayCount, totalCount] = await Promise.all([
        models.profile_visit.count({
          where: { targetPuuid: puuid, targetGroupId: groupId, visitDate },
        }),
        models.profile_visit.count({
          where: { targetPuuid: puuid, targetGroupId: groupId },
        }),
      ]);

      return res.status(200).json({ result: { today: todayCount, total: totalCount } });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });
};
