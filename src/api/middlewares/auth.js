const jwt = require('jsonwebtoken');
const config = require('../../config');
const models = require('../../db/models');

/**
 * JWT 토큰 검증 미들웨어
 * req.user에 디코딩된 유저 정보를 설정
 */
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ result: '인증이 필요합니다.' });
  }

  try {
    const token = authHeader.split(' ')[1];
    req.user = jwt.verify(token, config.jwtSecret);
    return next();
  } catch (e) {
    return res.status(401).json({ result: '유효하지 않은 토큰입니다.' });
  }
};

/**
 * Authorization 헤더가 있으면 디코딩해서 req.user 세팅, 없거나 invalid면 그냥 통과.
 * 비로그인도 허용해야 하는 엔드포인트용 (예: 방명록 댓글 목록).
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
 * 그룹 관리자 권한 확인 미들웨어
 * 슈퍼 어드민은 모든 그룹 통과, 아니면 DB의 user.role === 'admin' 확인
 */
const requireGroupAdmin = async (req, res, next) => {
  const groupId = Number(req.params.groupId || req.body.groupId);
  const { discordId } = req.user;

  if (!groupId || !discordId) {
    return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
  }

  try {
    // 슈퍼 어드민이면 모든 그룹에 대해 통과
    const superAdmin = await models.super_admin.findByPk(discordId);
    if (superAdmin) return next();

    // 같은 discordId로 본캐+부캐가 등록된 경우 admin 행이 LIMIT 1에서 누락될 수 있어
    // role='admin'인 행이 하나라도 있는지로 판정한다.
    const adminRow = await models.user.findOne({
      where: { groupId, discordId, role: 'admin' },
      attributes: ['role'],
    });

    if (!adminRow) {
      return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
    }

    return next();
  } catch (e) {
    return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
  }
};

module.exports = { verifyToken, optionalAuth, requireGroupAdmin };
