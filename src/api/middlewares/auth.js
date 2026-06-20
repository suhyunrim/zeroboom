const jwt = require('jsonwebtoken');
const config = require('../../config');
const models = require('../../db/models');

const TOKEN_TTL = '7d';
// express.js의 CORS exposedHeaders가 참조 (현재 X-Renewed-Token 자체는 사용 안 함)
const RENEWED_TOKEN_HEADER = 'X-Renewed-Token';

// 세션 쿠키 설정
// 모바일 Safari는 zeroboom.lol 도메인 패밀리(서브도메인 graves.zeroboom.lol 포함)의
// localStorage에 추적방지 만료 캡을 걸어 새로고침 시 토큰이 사라진다. 서버가 Set-Cookie로
// 심는 httpOnly 쿠키는 script-writable 저장소가 아니라 이 캡 대상이 아니므로 세션이 유지된다.
// graves.zeroboom.lol ↔ zeroboom.lol은 same-site라 SameSite=Lax 쿠키가 /api 요청에 실린다.
//
// ★ 헤더 크기 주의: nginx proxy_buffer_size(기본 ~4k)를 넘기면 502가 난다. JWT(~1.5KB)를
//   응답 헤더에 2개 실으면 초과하므로, 한 응답에 큰 JWT 헤더는 최대 1개만 둔다.
//   - 콜백: Location의 ?token= 만 (쿠키 안 심음)
//   - /me: Set-Cookie 만 (프론트 재시드 토큰은 응답 body로 전달)
const SESSION_COOKIE = 'zb_session';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};

const signSessionToken = (payload) => jwt.sign(payload, config.jwtSecret, { expiresIn: TOKEN_TTL });

const setSessionCookie = (res, token) => {
  res.cookie(SESSION_COOKIE, token, { ...SESSION_COOKIE_OPTIONS, maxAge: COOKIE_MAX_AGE_MS });
};

const clearSessionCookie = (res) => {
  res.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
};

// Authorization 헤더(Bearer)를 우선 사용하고, 없으면 세션 쿠키로 폴백한다.
const getTokenFromReq = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.split(' ')[1];
  return (req.cookies && req.cookies[SESSION_COOKIE]) || null;
};

/**
 * JWT 토큰 검증 미들웨어
 * req.user에 디코딩된 유저 정보를 설정
 */
const verifyToken = (req, res, next) => {
  const token = getTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ result: '인증이 필요합니다.' });
  }

  try {
    req.user = jwt.verify(token, config.jwtSecret);
    return next();
  } catch (e) {
    return res.status(401).json({ result: '유효하지 않은 토큰입니다.' });
  }
};

/**
 * Authorization 헤더 또는 세션 쿠키가 있으면 디코딩해서 req.user 세팅, 없거나 invalid면 그냥 통과.
 * 비로그인도 허용해야 하는 엔드포인트용 (예: 방명록 댓글 목록).
 */
const optionalAuth = (req, res, next) => {
  const token = getTokenFromReq(req);
  if (!token) return next();
  try {
    req.user = jwt.verify(token, config.jwtSecret);
  } catch (e) {
    // 무효 토큰은 그냥 비로그인 취급
  }
  return next();
};

/**
 * 그룹 어드민 여부를 boolean으로 반환. 슈퍼 어드민이면 모든 그룹 통과.
 * 같은 discordId로 본캐+부캐가 등록된 경우 admin 행이 LIMIT 1에서 누락될 수 있어
 * role='admin'인 행이 하나라도 있는지로 판정한다.
 */
const isGroupAdmin = async (groupId, discordId) => {
  if (!groupId || !discordId) return false;
  const superAdmin = await models.super_admin.findByPk(discordId);
  if (superAdmin) return true;
  const adminRow = await models.user.findOne({
    where: { groupId, discordId, role: 'admin' },
    attributes: ['role'],
  });
  return !!adminRow;
};

const requireGroupAdmin = async (req, res, next) => {
  const groupId = Number(req.params.groupId || req.body.groupId);
  const { discordId } = req.user;

  try {
    if (await isGroupAdmin(groupId, discordId)) return next();
    return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
  } catch (e) {
    return res.status(403).json({ result: '관리자 권한이 필요합니다.' });
  }
};

module.exports = {
  verifyToken,
  optionalAuth,
  requireGroupAdmin,
  isGroupAdmin,
  RENEWED_TOKEN_HEADER,
  TOKEN_TTL,
  SESSION_COOKIE,
  signSessionToken,
  setSessionCookie,
  clearSessionCookie,
};
