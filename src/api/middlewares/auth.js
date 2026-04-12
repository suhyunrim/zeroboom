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
 * 그룹 관리자 권한 확인 미들웨어
 * DB의 user.role === 'admin' 으로 확인 (Discord 권한은 이벤트/시작 시 동기화)
 */
const requireGroupAdmin = async (req, res, next) => {
  const groupId = Number(req.params.groupId || req.body.groupId);
  const { discordId } = req.user;

  if (!groupId || !discordId) {
    return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
  }

  try {
    const user = await models.user.findOne({
      where: { groupId, discordId },
      attributes: ['role'],
    });

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
    }

    return next();
  } catch (e) {
    return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
  }
};

module.exports = { verifyToken, requireGroupAdmin };
