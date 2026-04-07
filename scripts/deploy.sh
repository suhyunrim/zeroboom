#!/bin/bash
set -e

TARGET=${1:-all}

LIVE_DIR=${PROJECT_DIR_LIVE:-/home/ubuntu/zeroboom-live}
TEST_DIR=${PROJECT_DIR_TEST:-/home/ubuntu/zeroboom-test}

echo "========================================="
echo " ZeroBoom Bot 배포 시작 (${TARGET})"
echo "========================================="

deploy_test() {
  echo ""
  echo "[테섭] 배포 시작..."
  cd "$TEST_DIR"
  git pull origin master
  docker compose -f docker-compose.yml -f docker-compose.test.yml build --no-cache app-test
  docker compose -f docker-compose.yml -f docker-compose.test.yml up -d app-test
  echo "[테섭] 배포 완료"
}

deploy_live() {
  echo ""
  echo "[라이브] 배포 시작..."
  cd "$LIVE_DIR"
  git pull origin prod
  docker compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache app
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d app
  echo "[라이브] 배포 완료"
}

if [ "$TARGET" = "test" ]; then
  deploy_test
elif [ "$TARGET" = "live" ]; then
  deploy_live
else
  deploy_test
  deploy_live
fi

# 컨테이너 IP 변경에 대응하여 nginx DNS 캐시 갱신
docker restart zeroboom-nginx

# 안 쓰는 이미지 정리
echo ""
echo "이미지 정리..."
docker image prune -f

echo ""
echo "========================================="
echo " 배포 완료! (${TARGET})"
echo "========================================="
