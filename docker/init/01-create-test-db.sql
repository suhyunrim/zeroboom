-- 테스트 환경용 DB 스키마 생성
CREATE DATABASE IF NOT EXISTS mydb_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 기존 유저에 테스트 DB 권한 부여
GRANT ALL PRIVILEGES ON mydb_test.* TO 'zeroboom'@'%';
FLUSH PRIVILEGES;
