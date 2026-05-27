// 소스 DB(보통 SSH 터널로 연결된 라이브)를 덤프해 live_dump.sql 생성.
// 접속 정보는 환경변수로 받는다. SRC_PASSWORD는 필수.
// 사용법:
//   SRC_PASSWORD=*** node scripts/clone-live-db.js
//   SRC_HOST=127.0.0.1 SRC_PORT=3307 SRC_USER=root SRC_DATABASE=zeroboom_bot SRC_PASSWORD=*** node scripts/clone-live-db.js
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// 접속 정보는 scripts/.env에서 읽는다 (커맨드라인 inline env가 우선).
require('dotenv').config({ path: path.join(__dirname, '.env') });

// 데이터 복사 스킵 (스키마는 유지). 라이브/테섭 봇이 같은 디코 서버에 상주 → 임시 보이스 테이블 복사하면 중복 생성됨
const SKIP_DATA_TABLES = new Set(['temp_voice_generators', 'temp_voice_channels']);

const HOST = process.env.SRC_HOST || '127.0.0.1';
const PORT = Number(process.env.SRC_PORT || 3307);
const USER = process.env.SRC_USER || 'root';
const PASSWORD = process.env.SRC_PASSWORD;
const DATABASE = process.env.SRC_DATABASE || 'zeroboom_bot';
const OUT_PATH = process.env.DUMP_PATH || path.join(__dirname, '..', 'live_dump.sql');

if (!PASSWORD) {
  console.error('SRC_PASSWORD 환경변수가 필요합니다.');
  process.exit(1);
}

(async () => {
  const src = await mysql.createConnection({
    host: HOST, port: PORT, user: USER, password: PASSWORD, database: DATABASE,
  });
  console.log(`소스 접속: ${HOST}:${PORT}/${DATABASE}`);

  const [tables] = await src.execute('SHOW TABLES');
  const tableNames = tables.map(t => Object.values(t)[0]);

  let dump = 'SET FOREIGN_KEY_CHECKS=0;\n\n';

  for (const table of tableNames) {
    const skipData = SKIP_DATA_TABLES.has(table);
    console.log(`덤프 중: ${table}${skipData ? ' (데이터 스킵)' : ''}`);
    const [createResult] = await src.execute(`SHOW CREATE TABLE \`${table}\``);
    dump += `DROP TABLE IF EXISTS \`${table}\`;\n`;
    dump += createResult[0]['Create Table'] + ';\n\n';

    if (skipData) continue;

    const [rows] = await src.execute(`SELECT * FROM \`${table}\``);
    if (rows.length > 0) {
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const cols = Object.keys(chunk[0]);
        const colStr = cols.map(c => `\`${c}\``).join(',');
        const valStrs = chunk.map(row => {
          const vals = cols.map(c => {
            const v = row[c];
            if (v === null) return 'NULL';
            if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
            if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`;
            if (typeof v === 'object') {
              const s = JSON.stringify(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
              return `'${s}'`;
            }
            if (typeof v === 'number') return v;
            const s = String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            return `'${s}'`;
          });
          return '(' + vals.join(',') + ')';
        });
        dump += `INSERT INTO \`${table}\` (${colStr}) VALUES\n${valStrs.join(',\n')};\n`;
      }
      dump += '\n';
    }
  }

  dump += 'SET FOREIGN_KEY_CHECKS=1;\n';
  fs.writeFileSync(OUT_PATH, dump);
  console.log(`덤프 완료: ${OUT_PATH} (${(dump.length / 1024 / 1024).toFixed(2)}MB)`);
  await src.end();
})().catch(e => console.error('에러:', e));
