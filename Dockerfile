FROM node:12
LABEL maintainer="8eatles <8eatles@naver.com>"

# Bundle APP files
COPY . .

# Install app dependencies
RUN echo "$(git log --decorate --oneline -1)" >> version_info.txt
ENV NPM_CONFIG_LOGLEVEL warn
RUN yarn

EXPOSE 3000

CMD [ "yarn", "start" ]
