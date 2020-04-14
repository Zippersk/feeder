FROM node:12-alpine

WORKDIR /usr/src/app


COPY *.json ./

RUN npm install -g typescript
RUN apk add \
    python \
    make \
    g++ \
    git
RUN npm install
COPY . .
RUN npm run build

WORKDIR /usr/src/app/dist
CMD [ "node", "src/server.js" ]