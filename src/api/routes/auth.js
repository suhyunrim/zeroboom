const { Router } = require('express');
const axios = require('axios');
const config = require('../../config');
const models = require('../../db/models');
const { getGuildIconUrl } = require('../../utils/discordUtils');
const { Op } = require('sequelize');
const { logger } = require('../../loaders/logger');
const userController = require('../../controller/user');
const {
  verifyToken,
  RENEWED_TOKEN_HEADER,
  signSessionToken,
  setSessionCookie,
  clearSessionCookie,
} = require('../middlewares/auth');

const route = Router();

const DISCORD_API = 'https://discord.com/api/v10';
const SCOPES = 'identify guilds';

module.exports = (app) => {
  app.use('/auth', route);

  /**
   * GET /api/auth/discord
   * Discord OAuth2 인증 페이지로 리다이렉트
   */
  route.get('/discord', (req, res) => {
    const params = new URLSearchParams({
      client_id: config.discord.clientId,
      redirect_uri: config.discord.redirectUri,
      response_type: 'code',
      scope: SCOPES,
    });
    res.redirect(`${DISCORD_API}/oauth2/authorize?${params}`);
  });

  /**
   * GET /api/auth/discord/callback
   * Discord 콜백 → access_token 교환 → 유저 정보 조회 → JWT 발급
   */
  route.get('/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
      return res.status(400).json({ result: 'code가 없습니다.' });
    }

    try {
      // 1. code → access_token 교환
      const tokenRes = await axios.post(
        `${DISCORD_API}/oauth2/token`,
        new URLSearchParams({
          client_id: config.discord.clientId,
          client_secret: config.discord.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: config.discord.redirectUri,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      const { access_token } = tokenRes.data;

      // 2. Discord 유저 정보 조회
      const userRes = await axios.get(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const discordUser = userRes.data;

      // 3. Discord 길드(서버) 목록 조회
      const guildsRes = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const userGuilds = guildsRes.data;
      const guildIds = userGuilds.map((g) => g.id);

      // guildId → permissions 매핑 (ADMINISTRATOR = 0x8)
      const ADMINISTRATOR = BigInt(0x8);
      const guildPermMap = {};
      userGuilds.forEach((g) => {
        const isOwner = g.owner === true;
        const isAdmin = (BigInt(g.permissions) & ADMINISTRATOR) === ADMINISTRATOR;
        guildPermMap[g.id] = isOwner || isAdmin;
      });

      // 4. discordId로 유저 정보 조회 → puuid 확인
      // 본캐(primaryPuuid: null)를 우선 선택. 부캐가 먼저 잡히면 세션 puuid가
      // 부캐로 발급되어 이후 모든 API가 부캐 시점 데이터를 참조하게 된다.
      const users = await models.user.findAll({
        where: { discordId: discordUser.id },
      });
      const mainUser = users.find((u) => !u.primaryPuuid) || users[0];
      const puuid = mainUser ? mainUser.puuid : null;

      // 5. 그룹 목록 조회 (puuid 있으면 최근 매치 정렬 포함)
      let groups;
      if (puuid) {
        const groupList = await userController.getGroupList(puuid);
        groups = groupList.result;
      } else {
        // puuid 없으면 Discord 서버 매칭으로 폴백
        const matchedGroups = await models.group.findAll({
          where: { discordGuildId: guildIds },
        });
        groups = matchedGroups.map((g) => ({ groupId: g.id, groupName: g.groupName }));
      }

      // 6. 각 그룹에 isAdmin 플래그 추가
      const allGroups = await models.group.findAll({
        where: { id: groups.map((g) => g.groupId) },
        attributes: ['id', 'discordGuildId'],
      });
      const groupGuildMap = allGroups.reduce((acc, g) => {
        acc[g.id] = g.discordGuildId;
        return acc;
      }, {});
      const client = req.app.discordClient;

      // 슈퍼 어드민 여부 확인 (모든 그룹 관리 권한 부여)
      const superAdmin = await models.super_admin.findByPk(discordUser.id);
      const isSuperAdmin = !!superAdmin;

      groups = groups.map((g) => {
        const guildId = groupGuildMap[g.groupId];
        return {
          ...g,
          isAdmin: isSuperAdmin || !!guildPermMap[guildId],
          iconUrl: getGuildIconUrl(client, guildId),
        };
      });

      // 7. JWT 발급
      const payload = {
        discordId: discordUser.id,
        puuid,
        username: discordUser.username,
        globalName: discordUser.global_name,
        avatar: discordUser.avatar,
        isSuperAdmin,
        groups,
      };

      const token = signSessionToken(payload);

      // 세션 쿠키 설정: 모바일 Safari ITP가 localStorage(헤더 토큰)를 비워도
      // 쿠키로 세션이 유지되어 새로고침 시 로그인이 풀리지 않는다.
      setSessionCookie(res, token);

      // 6. 프론트엔드로 리다이렉트 (토큰 전달 — 쿠키와 병행)
      const frontendUrl = config.frontendUrl || 'http://localhost:5173';
      res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
    } catch (e) {
      logger.error('Discord OAuth2 에러:', e.response?.data || e.message);
      return res.status(500).json({ result: 'Discord 인증에 실패했습니다.' });
    }
  });

  /**
   * GET /api/auth/me
   * JWT로 현재 로그인 유저 정보 조회
   */
  route.get('/me', verifyToken, async (req, res) => {
    const decoded = req.user;
    try {
      let subPuuid = null;
      if (decoded.puuid) {
        const subUser = await models.user.findOne({
          where: { primaryPuuid: decoded.puuid },
          attributes: ['puuid'],
        });
        if (subUser) subPuuid = subUser.puuid;
      }

      // 부팅 시 프론트 localStorage가 비어있어도(모바일 ITP 등) 쿠키 세션으로 /me에 도달한다.
      // 이때 새 토큰을 재발급해 헤더+쿠키로 내려주면 프론트가 localStorage를 다시 채워
      // 디스코드 토큰에 의존하는 UI(예: 승부예측 게이트)가 정상 동작한다.
      const { iat, exp, ...payload } = decoded;
      const fresh = signSessionToken(payload);
      res.setHeader(RENEWED_TOKEN_HEADER, fresh);
      setSessionCookie(res, fresh);

      return res.status(200).json({ result: { ...decoded, subPuuid } });
    } catch (e) {
      return res.status(401).json({ result: '유효하지 않은 토큰입니다.' });
    }
  });

  /**
   * POST /api/auth/logout
   * 세션 쿠키 제거. httpOnly 쿠키라 프론트 JS로는 못 지우므로 서버가 처리한다.
   */
  route.post('/logout', (req, res) => {
    clearSessionCookie(res);
    return res.status(200).json({ result: 'ok' });
  });
};
