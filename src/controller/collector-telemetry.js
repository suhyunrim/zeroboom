// elise 수집기 진단 — 클라가 보내는 생존/종료/크래시 신호를 설치 단위로 접어서 보관한다.
// 목적은 "왜 수집이 멈췄는가"를 추측이 아니라 기록으로 답하는 것.
const models = require('../db/models');
const { logger } = require('../loaders/logger');

// heartbeat는 이력으로 남기지 않고 설치 상태(lastHeartbeatAt)만 갱신한다 — 행 수만 늘고 정보가 없다
const STORED_TYPES = new Set(['start', 'quit', 'crash', 'lcu']);
const ACCEPTED_TYPES = new Set([...STORED_TYPES, 'heartbeat']);

const MAX_EVENTS_PER_REQUEST = 50;
const MAX_MESSAGE_LENGTH = 4000;

// 클라 하트비트 20분 주기 → 2회 연속 결번이면 앱이 살아있지 않다고 본다
const HEARTBEAT_INTERVAL_MS = 20 * 60 * 1000;
const ALIVE_WINDOW_MS = HEARTBEAT_INTERVAL_MS * 2 + 5 * 60 * 1000;

const clamp = (value, length) =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, length) : null;

const toDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// 뒤늦게 도착한 이벤트가 최신 상태를 되돌리지 않도록, 항상 더 최근 시각만 반영한다
const laterOf = (current, next) => {
  if (!next) return current;
  if (!current) return next;
  return next > current ? next : current;
};

function applyEvent(patch, event) {
  const at = event.occurredAt;
  if (event.version) patch.version = event.version;
  if (event.riotId) patch.riotId = event.riotId;

  switch (event.type) {
    case 'start':
      patch.appStartedAt = laterOf(patch.appStartedAt, at);
      patch.lastEventAt = laterOf(patch.lastEventAt, at);
      break;
    case 'quit':
      if (!patch.lastQuitAt || at > patch.lastQuitAt) {
        patch.lastQuitAt = at;
        patch.lastQuitReason = event.reason || 'unknown';
      }
      patch.lastEventAt = laterOf(patch.lastEventAt, at);
      patch.lcuConnected = false;
      break;
    case 'crash':
      if (!patch.lastCrashAt || at > patch.lastCrashAt) {
        patch.lastCrashAt = at;
        patch.lastCrashMessage = event.message;
      }
      patch.lastEventAt = laterOf(patch.lastEventAt, at);
      break;
    case 'lcu':
      patch.lcuConnected = event.reason === 'connected';
      patch.lastEventAt = laterOf(patch.lastEventAt, at);
      break;
    case 'heartbeat':
      patch.lastHeartbeatAt = laterOf(patch.lastHeartbeatAt, at);
      if (typeof event.lcuConnected === 'boolean') patch.lcuConnected = event.lcuConnected;
      patch.lastScanAt = laterOf(patch.lastScanAt, toDate(event.lastScanAt));
      patch.lastUploadAt = laterOf(patch.lastUploadAt, toDate(event.lastUploadAt));
      break;
    default:
      break;
  }
}

function normalizeEvents(rawEvents, fallback) {
  const list = Array.isArray(rawEvents) ? rawEvents.slice(0, MAX_EVENTS_PER_REQUEST) : [];
  return list
    .filter((e) => e && ACCEPTED_TYPES.has(e.type))
    .map((e) => ({
      type: e.type,
      reason: clamp(e.reason, 32),
      message: clamp(e.message, MAX_MESSAGE_LENGTH),
      version: clamp(e.version, 32) || fallback.version,
      riotId: clamp(e.riotId, 64) || fallback.riotId,
      lcuConnected: typeof e.lcuConnected === 'boolean' ? e.lcuConnected : undefined,
      lastScanAt: e.lastScanAt,
      lastUploadAt: e.lastUploadAt,
      occurredAt: toDate(e.occurredAt) || new Date(),
    }))
    .sort((a, b) => a.occurredAt - b.occurredAt);
}

/**
 * 클라가 보낸 이벤트 묶음을 저장하고 설치 상태를 갱신한다.
 * 종료·크래시 직전 전송은 실패하는 게 정상이라 클라가 파일 큐에 쌓았다가 다음 기동 때 몰아 보낸다
 * → 한 요청에 과거 이벤트가 여러 개 섞여 오는 것을 전제로 시각순으로 접는다.
 */
async function recordEvents({ installId, version, platform, riotId, puuid, events }) {
  const id = clamp(installId, 64);
  if (!id) return { status: 'rejected', reason: 'installId 없음' };

  const fallback = { version: clamp(version, 32), riotId: clamp(riotId, 64) };
  const normalized = normalizeEvents(events, fallback);
  if (normalized.length === 0) return { status: 'ok', accepted: 0 };

  const patch = {
    version: fallback.version,
    platform: clamp(platform, 32),
    riotId: fallback.riotId,
    puuid: clamp(puuid, 128),
  };
  normalized.forEach((event) => applyEvent(patch, event));

  const [install, created] = await models.collector_install.findOrCreate({
    where: { installId: id },
    defaults: { installId: id, ...patch },
  });

  // 새로 만든 경우 defaults로 이미 반영됨 — 기존 행일 때만 갱신
  if (!created) {
    const update = {};
    Object.entries(patch).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      // 시각 컬럼은 과거 이벤트가 최신값을 덮지 않도록 비교 후 반영
      if (value instanceof Date && install[key] instanceof Date && value <= install[key]) return;
      update[key] = value;
    });
    if (Object.keys(update).length > 0) await install.update(update);
  }

  const stored = normalized.filter((e) => STORED_TYPES.has(e.type));
  if (stored.length > 0) {
    await models.collector_telemetry_event.bulkCreate(
      stored.map((e) => ({
        installId: id,
        type: e.type,
        reason: e.reason,
        version: e.version,
        riotId: e.riotId,
        message: e.message,
        occurredAt: e.occurredAt,
      })),
    );
  }

  return { status: 'ok', accepted: normalized.length, stored: stored.length };
}

/**
 * 설치별 현재 상태.
 * stale = 아무 말 없이 신호가 끊긴 상태(강제 종료·전원 차단·전송 불가). 종료도 크래시도 아닌 제3의 경우라
 * 따로 이름을 붙였다 — 이전에는 이 셋이 전부 "그냥 조용함"으로 뭉뚱그려져 원인 추정만 가능했다.
 */
function deriveStatus(install, now) {
  const lastSeenAt = laterOf(install.lastHeartbeatAt, install.lastEventAt);
  if (lastSeenAt && now - lastSeenAt < ALIVE_WINDOW_MS) return 'running';

  const quitAt = install.lastQuitAt ? install.lastQuitAt.getTime() : 0;
  const crashAt = install.lastCrashAt ? install.lastCrashAt.getTime() : 0;
  if (quitAt && quitAt >= crashAt) return 'quit';
  if (crashAt) return 'crashed';
  return 'stale';
}

async function listInstalls() {
  const installs = await models.collector_install.findAll({ order: [['lastEventAt', 'DESC']] });
  const now = Date.now();
  return installs.map((install) => {
    const status = deriveStatus(install, now);
    return {
      installId: install.installId,
      riotId: install.riotId,
      puuid: install.puuid, // 업로드 원본(lcu_game_raws.uploaderPuuid)과 설치를 잇는 키
      version: install.version,
      platform: install.platform,
      status,
      lastSeenAt: laterOf(install.lastHeartbeatAt, install.lastEventAt),
      // 앱이 멈춘 뒤의 연결 상태는 마지막 값에 고정돼 "크래시했는데 LCU는 연결됨" 같은 모순을 만든다.
      // status와 같은 스냅샷만 말하도록 조회 시점에 맞춘다.
      lcuConnected: status === 'running' ? install.lcuConnected : false,
      appStartedAt: install.appStartedAt,
      lastScanAt: install.lastScanAt,
      lastUploadAt: install.lastUploadAt,
      lastQuitAt: install.lastQuitAt,
      lastQuitReason: install.lastQuitReason,
      lastCrashAt: install.lastCrashAt,
      lastCrashMessage: install.lastCrashMessage,
    };
  });
}

async function listEvents({ installId, limit = 50 }) {
  const where = {};
  if (installId) where.installId = clamp(installId, 64);
  try {
    return await models.collector_telemetry_event.findAll({
      where,
      order: [['occurredAt', 'DESC']],
      limit: Math.min(Number(limit) || 50, 200),
    });
  } catch (e) {
    logger.error(`[collector-telemetry] 이벤트 조회 실패: ${e.message}`);
    return [];
  }
}

module.exports = { recordEvents, listInstalls, listEvents, deriveStatus, normalizeEvents };
