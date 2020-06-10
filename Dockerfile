FROM node:12
LABEL maintainer="8eatles <8eatles@naver.com>"

# Bundle APP files
COPY . .

# Install app dependencies

RUN sed s/%VERSION%/"$(echo $(git log --decorate --oneline -1)|sed -r 's/([\$\.\*\/\[\\^])/\\\1/g'|sed 's/[]]/\[]]/g')"/ package.json > package.json
ENV NPM_CONFIG_LOGLEVEL warn
RUN yarn

EXPOSE 3000

CMD [ "yarn", "start" ]
