const { Router } = require('express');
const { logger } = require('../../loaders/logger');
const { verifyToken, optionalAuth } = require('../middlewares/auth');
const models = require('../../db/models');
const auditLog = require('../../controller/audit-log');
const profileController = require('../../controller/profile');
const notificationController = require('../../controller/notification');

const { NOTIFICATION_TYPES } = notificationController;
const { fetchProfileIconMap } = require('../../utils/profileIcon');

const route = Router();

const COMMENT_MAX_LENGTH = 500;

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

/**
 * 같은 그룹 본캐 puuid를 discordId로 일괄 조회.
 * 부캐(primaryPuuid != null)는 제외 — 클릭 시 본캐 프로필로 이동.
 */
const fetchAuthorPuuidMap = async (groupId, discordIds) => {
  if (!groupId || !discordIds || discordIds.length === 0) return {};
  const rows = await models.user.findAll({
    where: { groupId, discordId: discordIds, primaryPuuid: null },
    attributes: ['discordId', 'puuid'],
  });
  const map = {};
  rows.forEach((u) => {
    map[u.discordId] = u.puuid;
  });
  return map;
};

module.exports = (app) => {
  app.use('/profile', route);

  /**
   * GET /api/profile/:groupId/:puuid/comments
   * 댓글 목록을 트리 구조로 반환 (top-level + 그 밑 replies).
   * 비밀글: 작성자/프로필주인/어드민, 답글은 부모 댓글 작성자도 추가로 봄.
   * 부모가 삭제된 경우 답글이 있으면 isDeleted: true placeholder로 표시.
   * 각 댓글의 author는 { discordId, name, puuid, profileIconId } 객체로 옴.
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

      // paranoid: false — soft-deleted 부모도 가져와서 답글 그룹핑에 사용
      const all = await models.profile_comment.findAll({
        where: { targetPuuid: puuid, targetGroupId: groupId },
        order: [['createdAt', 'DESC']],
        paranoid: false,
      });

      // 살아있는 댓글의 좋아요만 집계
      const aliveIds = all.filter((c) => !c.deletedAt).map((c) => c.id);
      const likeRows = aliveIds.length
        ? await models.comment_like.findAll({
            where: { commentId: aliveIds },
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

      // author batch enrichment: 같은 그룹 본캐 puuid + profileIconId 일괄 조회
      const authorDiscordIds = [
        ...new Set(all.filter((c) => c.authorDiscordId && !c.deletedAt).map((c) => c.authorDiscordId)),
      ];
      const authorPuuidMap = await fetchAuthorPuuidMap(groupId, authorDiscordIds);
      const iconMap = await fetchProfileIconMap(Object.values(authorPuuidMap));
      const buildAuthor = (discordId, name) => {
        if (!discordId) return null;
        const authorPuuid = authorPuuidMap[discordId] || null;
        return {
          discordId,
          name: name || null,
          puuid: authorPuuid,
          profileIconId: authorPuuid ? iconMap[authorPuuid] || null : null,
        };
      };

      const mapAlive = (c) => ({
        id: c.id,
        parentId: c.parentId || null,
        author: buildAuthor(c.authorDiscordId, c.authorName),
        content: c.content,
        isSecret: c.isSecret,
        isDeleted: false,
        likeCount: likeCountMap[c.id] || 0,
        likedByMe: likedByViewer.has(c.id),
        createdAt: c.createdAt,
      });

      // 답글: parentId별 그룹핑, 오래된 순(ASC)으로 정렬
      const repliesByParent = {};
      all
        .filter((c) => c.parentId)
        .forEach((r) => {
          if (!repliesByParent[r.parentId]) repliesByParent[r.parentId] = [];
          repliesByParent[r.parentId].push(r);
        });
      Object.keys(repliesByParent).forEach((k) => {
        repliesByParent[k].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      });

      const buildReplies = (parentId, parentAuthorDiscordId) =>
        (repliesByParent[parentId] || [])
          .filter((r) => !r.deletedAt)
          .filter((r) =>
            profileController.canViewComment({
              comment: r,
              viewerDiscordId,
              ownerDiscordId,
              isAdmin,
              parentAuthorDiscordId,
            }),
          )
          .map(mapAlive);

      // top-level (parentId === null)만 결과로
      const result = all
        .filter((c) => !c.parentId)
        .map((top) => {
          const replyList = buildReplies(top.id, top.authorDiscordId);
          if (top.deletedAt) {
            // 답글이 하나도 없으면 노출 안 함
            if (replyList.length === 0) return null;
            return {
              id: top.id,
              parentId: null,
              author: null,
              content: null,
              isSecret: false,
              isDeleted: true,
              likeCount: 0,
              likedByMe: false,
              createdAt: top.createdAt,
              replies: replyList,
            };
          }
          if (
            !profileController.canViewComment({
              comment: top,
              viewerDiscordId,
              ownerDiscordId,
              isAdmin,
            })
          ) {
            return null;
          }
          return { ...mapAlive(top), replies: replyList };
        })
        .filter((x) => x !== null);

      return res.status(200).json({ result });
    } catch (e) {
      logger.error(e);
      return res.status(500).json({ result: '서버 오류가 발생했습니다.' });
    }
  });

  /**
   * POST /api/profile/:groupId/:puuid/comments
   * 댓글 작성 (인증 필요).
   * body: { content, isSecret, parentId? }
   * parentId가 다른 답글이면 평탄화해서 root parentId로 저장.
   */
  route.post('/:groupId/:puuid/comments', verifyToken, async (req, res) => {
    const groupId = Number(req.params.groupId);
    const { puuid } = req.params;
    const { content, isSecret, parentId: rawParentId } = req.body;
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
        attributes: ['puuid', 'discordId'],
      });
      if (!owner) {
        return res.status(404).json({ result: '대상 유저가 그룹에 없습니다.' });
      }

      // parentId 검증 + 평탄화
      let parentId = null;
      let parentAuthorDiscordId = null;
      if (rawParentId !== undefined && rawParentId !== null) {
        const pid = Number(rawParentId);
        if (!pid) {
          return res.status(400).json({ result: 'parentId가 올바르지 않습니다.' });
        }
        const parent = await models.profile_comment.findByPk(pid);
        if (!parent || parent.targetPuuid !== puuid || parent.targetGroupId !== groupId) {
          return res.status(400).json({ result: '답글 대상 댓글을 찾을 수 없습니다.' });
        }
        if (parent.deletedAt) {
          return res.status(400).json({ result: '삭제된 댓글에는 답글을 달 수 없습니다.' });
        }
        // 답글의 답글이면 root로 평탄화 (단, root parent의 deletedAt도 검증해야 함)
        if (parent.parentId) {
          const rootParent = await models.profile_comment.findByPk(parent.parentId);
          if (!rootParent || rootParent.deletedAt) {
            return res.status(400).json({ result: '삭제된 댓글에는 답글을 달 수 없습니다.' });
          }
          parentId = parent.parentId;
        } else {
          parentId = parent.id;
        }
        parentAuthorDiscordId = parent.authorDiscordId;
      }

      const authorName = globalName || username || null;
      const created = await models.profile_comment.create({
        targetPuuid: puuid,
        targetGroupId: groupId,
        authorDiscordId: discordId,
        authorName,
        content: content.trim(),
        isSecret: !!isSecret,
        parentId,
      });

      auditLog.log({
        groupId,
        actorDiscordId: discordId,
        actorName: authorName,
        action: 'profile.comment_create',
        details: {
          commentId: created.id,
          targetPuuid: puuid,
          isSecret: !!isSecret,
          parentId,
        },
        source: 'web',
      });

      // 알림 발행
      const textPreview = notificationController.buildTextPreview(content);
      if (parentId) {
        const recipientIds = [...new Set([parentAuthorDiscordId, owner.discordId].filter(Boolean))];
        const replyPayload = {
          commentId: created.id,
          parentCommentId: parentId,
          profileGroupId: groupId,
          profilePuuid: puuid,
          textPreview,
          isSecret: !!isSecret,
        };
        notificationController.createMany(
          recipientIds
            .filter((rid) => rid !== discordId)
            .map((rid) => ({
              recipientDiscordId: rid,
              groupId,
              type: NOTIFICATION_TYPES.GUESTBOOK_REPLY,
              targetKey: `reply:${parentId}`,
              actorDiscordId: discordId,
              actorName: authorName,
              payload: replyPayload,
            })),
        );
      } else if (owner.discordId) {
        notificationController.create({
          recipientDiscordId: owner.discordId,
          groupId,
          type: NOTIFICATION_TYPES.GUESTBOOK_COMMENT,
          targetKey: null,
          actorDiscordId: discordId,
          actorName: authorName,
          payload: {
            commentId: created.id,
            profileGroupId: groupId,
            profilePuuid: puuid,
            textPreview,
            isSecret: !!isSecret,
          },
        });
      }

      // 멘션 알림 (비밀글이면 가시성 누설 방지로 skip)
      if (!isSecret) {
        const mentionedPuuids = profileController.extractMentionPuuids(content);
        if (mentionedPuuids.length > 0) {
          const validMentioned = await models.user.findAll({
            where: { groupId, puuid: mentionedPuuids, primaryPuuid: null },
            attributes: ['discordId'],
          });
          const mentionPayload = {
            commentId: created.id,
            parentCommentId: created.parentId || null,
            profileGroupId: groupId,
            profilePuuid: puuid,
            textPreview,
          };
          notificationController.createMany(
            validMentioned
              .map((u) => u.discordId)
              .filter((rid) => rid && rid !== discordId)
              .map((rid) => ({
                recipientDiscordId: rid,
                groupId,
                type: NOTIFICATION_TYPES.GUESTBOOK_MENTION,
                targetKey: null,
                actorDiscordId: discordId,
                actorName: authorName,
                payload: mentionPayload,
              })),
          );
        }
      }

      const puuidMap = await fetchAuthorPuuidMap(groupId, [discordId]);
      const myPuuid = puuidMap[discordId] || null;
      const myIconMap = await fetchProfileIconMap([myPuuid]);
      return res.status(200).json({
        result: {
          id: created.id,
          parentId: created.parentId || null,
          author: {
            discordId,
            name: authorName,
            puuid: myPuuid,
            profileIconId: myPuuid ? myIconMap[myPuuid] || null : null,
          },
          content: created.content,
          isSecret: created.isSecret,
          isDeleted: false,
          likeCount: 0,
          likedByMe: false,
          createdAt: created.createdAt,
          replies: [],
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

      // findOrCreate로 race 안전성 확보 (동시 더블클릭 시 unique 위반 방지)
      const [like, created] = await models.comment_like.findOrCreate({
        where: { commentId, likerDiscordId: discordId },
        defaults: {
          commentId,
          likerDiscordId: discordId,
          likerName: globalName || username || null,
        },
      });

      let liked;
      if (created) {
        liked = true;
        if (comment.authorDiscordId) {
          notificationController.createIfNotPending({
            recipientDiscordId: comment.authorDiscordId,
            groupId: comment.targetGroupId,
            type: NOTIFICATION_TYPES.GUESTBOOK_LIKE,
            targetKey: `like:${comment.id}`,
            actorDiscordId: discordId,
            actorName: globalName || username || null,
            payload: {
              commentId: comment.id,
              parentCommentId: comment.parentId || null,
              profileGroupId: comment.targetGroupId,
              profilePuuid: comment.targetPuuid,
              commentPreview: notificationController.buildTextPreview(comment.content),
              isReply: !!comment.parentId,
            },
          });
        }
      } else {
        await like.destroy();
        liked = false;
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
      // 댓글의 그룹 컨텍스트 확보 (puuid 매핑용)
      const comment = await models.profile_comment.findByPk(commentId, { paranoid: false });
      if (!comment) {
        return res.status(404).json({ result: '댓글을 찾을 수 없습니다.' });
      }

      const likes = await models.comment_like.findAll({
        where: { commentId },
        order: [['createdAt', 'DESC']],
      });

      const likerDiscordIds = [...new Set(likes.map((l) => l.likerDiscordId).filter(Boolean))];
      const puuidMap = await fetchAuthorPuuidMap(comment.targetGroupId, likerDiscordIds);
      const iconMap = await fetchProfileIconMap(Object.values(puuidMap));

      const result = likes.map((l) => {
        const likerPuuid = puuidMap[l.likerDiscordId] || null;
        return {
          liker: {
            discordId: l.likerDiscordId,
            name: l.likerName || null,
            puuid: likerPuuid,
            profileIconId: likerPuuid ? iconMap[likerPuuid] || null : null,
          },
          createdAt: l.createdAt,
        };
      });

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
