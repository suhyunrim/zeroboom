FROM node:18
LABEL maintainer="ZeroBoom"

WORKDIR /app

# package.json 먼저 복사하여 캐시 활용
COPY package*.json ./

# 의존성 설치
RUN npm install

# 소스코드 복사
COPY . .

EXPOSE 3000

CMD [ "npm", "start" ]
