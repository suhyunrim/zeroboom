const { validateSelect, formatSchemaDoc } = require('../../../src/services/ai/readonly-sql');

describe('validateSelect (읽기 전용 SQL 가드 — 순수 코어)', () => {
  const ok = (sql) => expect(validateSelect(sql).ok).toBe(true);
  const bad = (sql) => expect(validateSelect(sql).ok).toBe(false);

  test('정상 SELECT / WITH 허용', () => {
    ok('SELECT name, win FROM ai_players ORDER BY win DESC LIMIT 5');
    ok('select * from ai_match_players where won = 1');
    ok('WITH t AS (SELECT * FROM ai_players) SELECT * FROM t');
    ok('SELECT name FROM ai_players;'); // 맨 끝 세미콜론 1개는 허용
    ok('SELECT position, AVG(won) FROM ai_match_players GROUP BY position'); // OFFSET 아님, set 오탐 없음 확인용
  });

  test('쓰기/DDL 거부', () => {
    bad('UPDATE ai_players SET win = 0');
    bad('DELETE FROM ai_players');
    bad('DROP VIEW ai_players');
    bad('INSERT INTO ai_players VALUES (1)');
    bad('TRUNCATE ai_players');
    bad('GRANT SELECT ON x TO y');
  });

  test('SELECT로 시작해도 중간에 위험 키워드 있으면 거부', () => {
    bad('SELECT * FROM ai_players INTO OUTFILE "/tmp/x"');
    bad('SELECT * FROM ai_players LOCK IN SHARE MODE');
  });

  test('다중문(세미콜론) 거부', () => {
    bad('SELECT 1; DROP TABLE users');
    bad('SELECT 1; SELECT 2');
  });

  test('사용자 변수(@) 거부 — 그룹 격리 우회 차단', () => {
    bad('SELECT * FROM ai_players WHERE 1=(@ai_group_id := 2)');
    bad('SELECT @ai_group_id');
  });

  test('주석 거부', () => {
    bad('SELECT 1 -- comment');
    bad('SELECT 1 /* x */');
  });

  test('SELECT/WITH 로 시작 안 하면 거부', () => {
    bad('SHOW TABLES');
    bad('DESCRIBE ai_players');
    bad('   ');
    bad('');
    bad(null);
  });

  test('너무 긴 SQL 거부', () => {
    bad(`SELECT ${'a'.repeat(2100)}`);
  });
});

describe('formatSchemaDoc (스키마 자동발견 — 순수 코어)', () => {
  test('뷰별로 컬럼을 묶어 한 줄씩 만든다', () => {
    const rows = [
      { t: 'ai_players', c: 'name', dt: 'varchar' },
      { t: 'ai_players', c: 'win', dt: 'int' },
      { t: 'ai_trophies', c: 'player_name', dt: 'varchar' },
      { t: 'ai_trophies', c: 'trophy_type', dt: 'varchar' },
    ];
    const doc = formatSchemaDoc(rows);
    expect(doc).toContain('- ai_players(name varchar, win int)');
    expect(doc).toContain('- ai_trophies(player_name varchar, trophy_type varchar)');
  });

  test('빈/잘못된 입력은 빈 문자열', () => {
    expect(formatSchemaDoc([])).toBe('');
    expect(formatSchemaDoc(null)).toBe('');
    expect(formatSchemaDoc([{ t: '', c: 'x' }])).toBe('');
  });
});
