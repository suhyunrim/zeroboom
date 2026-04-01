#!/bin/bash
set -e

# 프로젝트 루트 디렉토리로 이동
cd "$(dirname "$0")/.."

COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.test.yml"
TARGET=${1:-all}

echo "========================================="
echo " ZeroBoom Bot 배포 시작 (${TARGET})"
echo "========================================="

# 1. 최신 코드 pull
echo ""
echo "[1/4] git pull..."
if [ "$TARGET" = "test" ]; then
  git pull origin master
elif [ "$TARGET" = "live" ]; then
  git pull origin prod
else
  git pull
fi

# 2. 대상 컨테이너 빌드
echo ""
echo "[2/4] docker build..."
if [ "$TARGET" = "test" ]; then
  docker compose $COMPOSE_FILES build --no-cache app-test
elif [ "$TARGET" = "live" ]; then
  docker compose $COMPOSE_FILES build --no-cache app
else
  docker compose $COMPOSE_FILES build --no-cache app app-test
fi

# 3. 대상 컨테이너 재시작
echo ""
echo "[3/4] 컨테이너 재시작..."
if [ "$TARGET" = "test" ]; then
  docker compose $COMPOSE_FILES up -d app-test
elif [ "$TARGET" = "live" ]; then
  docker compose $COMPOSE_FILES up -d app
else
  docker compose $COMPOSE_FILES up -d app app-test
fi

# 4. 안 쓰는 이미지 정리
echo ""
echo "[4/4] 사용하지 않는 이미지 정리..."
docker image prune -f

echo ""
echo "========================================="
echo " 배포 완료! (${TARGET})"
echo "========================================="
echo ""

# 컨테이너 상태 확인
docker compose $COMPOSE_FILES ps
