// live_dump.sql 을 대상 MySQL DB 로 import.
// 접속 정보는 환경변수로 받는다. DEST_PASSWORD는 필수.
// 사용법:
//   기본 (테섭, SSH 터널 3307 / zeroboom_bot_test):  DEST_PASSWORD=*** node scripts/import-to-test-db.js
//   로컬:  DEST_PORT=3306 DEST_DATABASE=zeroboom_bot DEST_PASSWORD=*** node scripts/import-to-test-db.js
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// 접속 정보는 scripts/.env에서 읽는다 (커맨드라인 inline env가 우선).
require('dotenv').config({ path: path.join(__dirname, '.env') });

const DUMP_PATH = process.env.DUMP_PATH || path.join(__dirname, '..', 'live_dump.sql');
const HOST = process.env.DEST_HOST || '127.0.0.1';
const PORT = Number(process.env.DEST_PORT || 3307);
const USER = process.env.DEST_USER || 'root';
const PASSWORD = process.env.DEST_PASSWORD;
const DATABASE = process.env.DEST_DATABASE || 'zeroboom_bot_test';

if (!PASSWORD) {
  console.error('DEST_PASSWORD 환경변수가 필요합니다.');
  process.exit(1);
}

(async () => {
  if (!fs.existsSync(DUMP_PATH)) {
    console.error('덤프 파일 없음:', DUMP_PATH);
    process.exit(1);
  }

  const sql = fs.readFileSync(DUMP_PATH, 'utf8');
  console.log(`덤프 로드: ${(sql.length / 1024 / 1024).toFixed(2)}MB → ${HOST}:${PORT}/${DATABASE}`);

  // 세미콜론 + 개행으로 단순 분리 (덤프가 각 statement 마다 끝에 ;\n 붙임)
  const stmts = sql.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s.length > 0);
  console.log(`총 ${stmts.length}개 statement`);

  const conn = await mysql.createConnection({
    host: HOST,
    port: PORT,
    user: USER,
    password: PASSWORD,
    database: DATABASE,
    multipleStatements: false,
  });

  // import는 groups 테이블을 통째로 덮어쓴다. 테섭의 기존 온보딩 설정을 보존하기 위해
  // import 전에 현재 onboardingEnabled 값을 그룹별로 읽어둔다. (라이브 봇과 테섭 봇이 같은
  // 디코 서버라, 라이브의 onboardingEnabled가 덮어써져 켜지면 테섭 봇도 guildMemberAdd에
  // 반응해 신규 유저가 온보딩 DM을 두 번 받게 됨)
  const prevOnboarding = new Map(); // groupId -> bool (테섭 원래 값)
  try {
    const [grpRows] = await conn.query('SELECT id, settings FROM `groups`');
    for (const g of grpRows) {
      const s = typeof g.settings === 'string' ? JSON.parse(g.settings || '{}') : g.settings || {};
      prevOnboarding.set(g.id, s.onboardingEnabled === true);
    }
    console.log(`  기존 온보딩 설정 캡처: groups ${grpRows.length}행`);
  } catch (e) {
    console.log(`  (기존 groups 온보딩 값 읽기 생략: ${e.message})`);
  }

  let done = 0;
  let lastTable = '';
  for (const stmt of stmts) {
    try {
      await conn.query(stmt);
    } catch (e) {
      console.error(`❌ statement ${done} 실패: ${e.message}`);
      console.error('  ', stmt.slice(0, 200));
      await conn.end();
      process.exit(1);
    }
    done++;

    // 진행상황 로그 (DROP/CREATE 마다)
    const dropMatch = stmt.match(/^DROP TABLE IF EXISTS `([^`]+)`/);
    const createMatch = stmt.match(/^CREATE TABLE `([^`]+)`/);
    if (dropMatch) {
      lastTable = dropMatch[1];
      process.stdout.write(`\r  처리중: ${lastTable} (${done}/${stmts.length})            `);
    } else if (createMatch) {
      lastTable = createMatch[1];
    }
  }
  process.stdout.write('\n');

  // 안전 확인: temp_voice 테이블은 비어있어야 함
  for (const t of ['temp_voice_channels', 'temp_voice_generators']) {
    const [rows] = await conn.query(`SELECT COUNT(*) c FROM \`${t}\``);
    console.log(`  ${t}: ${rows[0].c}행 (0이어야 정상)`);
    if (rows[0].c > 0) {
      console.log(`  → TRUNCATE 실행`);
      await conn.query(`TRUNCATE \`${t}\``);
    }
  }

  // 온보딩 설정 보존: import로 덮어쓴 라이브 값 대신, 위에서 캡처한 테섭의 원래 값으로 되돌린다.
  // 테섭에 없던(라이브에만 있는) 신규 그룹은 기본 false로 둬서 중복 DM을 막는다.
  // (대상이 라이브면 건드리지 않음 — 실서비스 온보딩 설정 보존)
  if (DATABASE !== 'zeroboom_bot') {
    const [grpRows] = await conn.query('SELECT id FROM `groups`');
    let restored = 0;
    for (const g of grpRows) {
      const desired = prevOnboarding.get(g.id) === true ? 'true' : 'false';
      await conn.query(
        "UPDATE `groups` SET settings = JSON_SET(COALESCE(settings, JSON_OBJECT()), '$.onboardingEnabled', CAST(? AS JSON)) WHERE id = ?",
        [desired, g.id],
      );
      restored++;
    }
    console.log(`  온보딩 설정 보존: groups ${restored}행 (테섭 원래 값 유지, 신규 그룹은 false)`);
  } else {
    console.log('  ⚠️ 대상이 라이브(zeroboom_bot) — 온보딩 설정 그대로 유지');
  }

  // import 검증
  const [u] = await conn.query('SELECT COUNT(*) c FROM users');
  const [m] = await conn.query('SELECT COUNT(*) c FROM matches');
  console.log(`✅ import 완료: users=${u[0].c}행, matches=${m[0].c}행`);

  await conn.end();
})();
