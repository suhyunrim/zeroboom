FROM node:12
LABEL maintainer="8eatles <8eatles@naver.com>"

# Bundle APP files
COPY . .

# Install app dependencies
RUN echo "export VERSION_INFO='$(git log --decorate --oneline -1)'" >> /root/.bashrc
ENV NPM_CONFIG_LOGLEVEL warn
RUN yarn

EXPOSE 3000

CMD [ "yarn", "start" ]
