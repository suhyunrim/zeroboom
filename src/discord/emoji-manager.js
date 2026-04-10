const axios = require('axios');
const { logger } = require('../loaders/logger');

// 이모지를 등록할 서버 ID
const EMOJI_GUILD_ID = '1235540411230191626';

const CDRAGON_POS = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions';
const CDRAGON_TIER = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests';

// 포지션 이모지 정의
const POSITION_EMOJIS = {
  TOP: { name: 'pos_top', url: `${CDRAGON_POS}/icon-position-top.png` },
  JUNGLE: { name: 'pos_jungle', url: `${CDRAGON_POS}/icon-position-jungle.png` },
  MIDDLE: { name: 'pos_middle', url: `${CDRAGON_POS}/icon-position-middle.png` },
  BOTTOM: { name: 'pos_bottom', url: `${CDRAGON_POS}/icon-position-bottom.png` },
  UTILITY: { name: 'pos_utility', url: `${CDRAGON_POS}/icon-position-utility.png` },
};

// 티어 이모지 정의 (ranked-mini-crests: Discord 이모지 크기에 적합)
const TIER_EMOJIS = {
  IRON: { name: 'tier_iron', url: `${CDRAGON_TIER}/iron.png` },
  BRONZE: { name: 'tier_bronze', url: `${CDRAGON_TIER}/bronze.png` },
  SILVER: { name: 'tier_silver', url: `${CDRAGON_TIER}/silver.png` },
  GOLD: { name: 'tier_gold', url: `${CDRAGON_TIER}/gold.png` },
  PLATINUM: { name: 'tier_platinum', url: `${CDRAGON_TIER}/platinum.png` },
  EMERALD: { name: 'tier_emerald', url: `${CDRAGON_TIER}/emerald.png` },
  DIAMOND: { name: 'tier_diamond', url: `${CDRAGON_TIER}/diamond.png` },
  MASTER: { name: 'tier_master', url: `${CDRAGON_TIER}/master.png` },
  GRANDMASTER: { name: 'tier_grandmaster', url: `${CDRAGON_TIER}/grandmaster.png` },
  CHALLENGER: { name: 'tier_challenger', url: `${CDRAGON_TIER}/challenger.png` },
};

// 등록된 이모지 캐시 { name: { id, name, animated } }
const emojiCache = {};

/**
 * 봇 시작 시 커스텀 이모지 등록/캐싱
 */
async function initEmojis(client) {
  const guild = client.guilds.cache.get(EMOJI_GUILD_ID);
  if (!guild) {
    logger.warn(`이모지 서버를 찾을 수 없습니다: ${EMOJI_GUILD_ID}`);
    return;
  }

  const allEmojis = { ...POSITION_EMOJIS, ...TIER_EMOJIS };

  for (const [key, def] of Object.entries(allEmojis)) {
    const existing = guild.emojis.cache.find((e) => e.name === def.name);
    if (existing) {
      emojiCache[key] = { id: existing.id, name: existing.name, animated: existing.animated };
      continue;
    }

    try {
      const response = await axios.get(def.url, { responseType: 'arraybuffer' });
      const emoji = await guild.emojis.create({
        attachment: Buffer.from(response.data),
        name: def.name,
      });
      emojiCache[key] = { id: emoji.id, name: emoji.name, animated: emoji.animated };
      logger.info(`이모지 등록 완료: ${def.name}`);
    } catch (e) {
      logger.error(`이모지 등록 실패 [${def.name}]: ${e.message}`);
    }
  }

  logger.info(`이모지 초기화 완료: ${Object.keys(emojiCache).length}개 캐싱됨`);
}

/**
 * 커스텀 이모지 문자열 반환 (없으면 폴백 유니코드 이모지)
 */
function getEmoji(key, fallback) {
  const cached = emojiCache[key];
  if (cached) {
    return `<:${cached.name}:${cached.id}>`;
  }
  return fallback || '';
}

/**
 * 커스텀 이모지 객체 반환 (버튼/SelectMenu용, 없으면 null)
 */
function getEmojiObject(key) {
  const cached = emojiCache[key];
  if (cached) {
    return { id: cached.id, name: cached.name, animated: cached.animated };
  }
  return null;
}

module.exports = {
  initEmojis,
  getEmoji,
  getEmojiObject,
  POSITION_EMOJIS,
  TIER_EMOJIS,
};
