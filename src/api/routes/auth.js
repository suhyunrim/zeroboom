const { Router } = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const models = require('../../db/models');
const { Op } = require('sequelize');
const { logger } = require('../../loaders/logger');
const userController = require('../../controller/user');

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
      const ADMINISTRATOR = 0x8;
      const guildPermMap = {};
      userGuilds.forEach((g) => {
        guildPermMap[g.id] = (Number(g.permissions) & ADMINISTRATOR) === ADMINISTRATOR;
      });

      // 4. discordId로 유저 정보 조회 → puuid 확인
      const users = await models.user.findAll({
        where: { discordId: discordUser.id },
      });
      const puuid = users.length > 0 ? users[0].puuid : null;

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
      groups = groups.map((g) => ({
        ...g,
        isAdmin: !!guildPermMap[groupGuildMap[g.groupId]],
      }));

      // 7. JWT 발급
      const payload = {
        discordId: discordUser.id,
        puuid,
        username: discordUser.username,
        globalName: discordUser.global_name,
        avatar: discordUser.avatar,
        groups,
      };

      const token = jwt.sign(payload, config.jwtSecret, { expiresIn: '7d' });

      // 6. 프론트엔드로 리다이렉트 (토큰 전달)
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
  route.get('/me', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ result: '인증이 필요합니다.' });
    }

    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, config.jwtSecret);
      return res.status(200).json({ result: decoded });
    } catch (e) {
      return res.status(401).json({ result: '유효하지 않은 토큰입니다.' });
    }
  });
};
