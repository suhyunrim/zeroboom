#!/bin/bash
set -e

# 프로젝트 루트 디렉토리로 이동
cd "$(dirname "$0")/.."

echo "========================================="
echo " ZeroBoom Bot 배포 시작"
echo "========================================="

# 1. 최신 코드 pull
echo ""
echo "[1/4] git pull..."
git pull origin master

# 2. app 컨테이너만 새로 빌드 (캐시 없이)
echo ""
echo "[2/4] docker build..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache app

# 3. app 컨테이너만 재시작 (db, nginx, certbot은 유지)
echo ""
echo "[3/4] app 컨테이너 재시작..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d app

# 4. 안 쓰는 이미지 정리
echo ""
echo "[4/4] 사용하지 않는 이미지 정리..."
docker image prune -f

echo ""
echo "========================================="
echo " 배포 완료!"
echo "========================================="
echo ""

# 컨테이너 상태 확인
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
