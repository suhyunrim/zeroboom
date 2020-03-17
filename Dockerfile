FROM node:12
LABEL maintainer="Jongchan Kim <8eatles@naver.com>"

# Bundle APP files
COPY . .

# Install app dependencies
ENV NPM_CONFIG_LOGLEVEL warn
RUN npm install

EXPOSE 3000

CMD [ "npm", "run-script", "start" ]
