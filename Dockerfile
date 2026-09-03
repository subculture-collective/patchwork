# ---------------------------------------------------------------------------
# Immutable image versioning (#109)
# Build args are injected by CI to produce deterministic, traceable images.
# ---------------------------------------------------------------------------
ARG GIT_SHA=unknown
ARG GIT_BRANCH=unknown
ARG BUILD_VERSION=0.0.0
ARG CI_RUN_ID=local

FROM node:22.22.2-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS deps

WORKDIR /app

RUN apk upgrade --no-cache \
    && wget -qO /tmp/npm.tgz https://registry.npmjs.org/npm/-/npm-12.0.1.tgz \
    && echo '5e02bea4c784df1c3bbea9e55c7d2232329e1d1920c254789833ed9e8b0a5f16  /tmp/npm.tgz' \
        | sha256sum -c - \
    && mkdir /tmp/npm \
    && tar -xzf /tmp/npm.tgz -C /tmp/npm \
    && rm -rf /usr/local/lib/node_modules/npm \
    && mv /tmp/npm/package /usr/local/lib/node_modules/npm \
    && rm -rf /tmp/npm /tmp/npm.tgz \
    && wget -qO /tmp/brace-expansion.tgz \
        https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.9.tgz \
    && echo '5d06001fddd25cbee90c96db4dc5b7b57711b984c3141e28d10f143deb52dbaf  /tmp/brace-expansion.tgz' \
        | sha256sum -c - \
    && mkdir /tmp/brace-expansion \
    && tar -xzf /tmp/brace-expansion.tgz -C /tmp/brace-expansion \
    && rm -rf /usr/local/lib/node_modules/npm/node_modules/brace-expansion \
    && mv /tmp/brace-expansion/package \
        /usr/local/lib/node_modules/npm/node_modules/brace-expansion \
    && rm -rf /tmp/brace-expansion /tmp/brace-expansion.tgz \
    && wget -qO /tmp/ip-address.tgz \
        https://registry.npmjs.org/ip-address/-/ip-address-10.4.0.tgz \
    && echo 'e1faffa2aa19b4382664fd78ab9e5bf06a6ddcc525bd9c82bd74522487be2932  /tmp/ip-address.tgz' \
        | sha256sum -c - \
    && mkdir /tmp/ip-address \
    && tar -xzf /tmp/ip-address.tgz -C /tmp/ip-address \
    && rm -rf /usr/local/lib/node_modules/npm/node_modules/ip-address \
    && mv /tmp/ip-address/package \
        /usr/local/lib/node_modules/npm/node_modules/ip-address \
    && rm -rf /tmp/ip-address /tmp/ip-address.tgz \
    && wget -qO /tmp/tar.tgz \
        https://registry.npmjs.org/tar/-/tar-7.5.21.tgz \
    && echo 'bcedf25a21daecd1a18fb5e19ab855b7d79ec8ef1da175e8ba85cfc0ed0069d1  /tmp/tar.tgz' \
        | sha256sum -c - \
    && mkdir /tmp/tar \
    && tar -xzf /tmp/tar.tgz -C /tmp/tar \
    && rm -rf /usr/local/lib/node_modules/npm/node_modules/tar \
    && mv /tmp/tar/package \
        /usr/local/lib/node_modules/npm/node_modules/tar \
    && rm -rf /tmp/tar /tmp/tar.tgz \
    && npm --version

COPY package.json package-lock.json ./
COPY apps/mobile/package.json ./apps/mobile/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY services/api/package.json ./services/api/package.json
COPY services/indexer/package.json ./services/indexer/package.json
COPY services/moderation-worker/package.json ./services/moderation-worker/package.json
COPY packages/at-lexicons/package.json ./packages/at-lexicons/package.json
COPY packages/at-client/package.json ./packages/at-client/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm ci --no-audit --no-fund

FROM deps AS source

WORKDIR /app
COPY . .

FROM source AS runtime-base

RUN npm prune --omit=dev --no-audit --no-fund

FROM runtime-base AS api-runtime

ARG GIT_SHA
ARG GIT_BRANCH
ARG BUILD_VERSION
ARG CI_RUN_ID
LABEL org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.ref.name="${GIT_BRANCH}" \
      com.patchwork.ci.run-id="${CI_RUN_ID}" \
      com.patchwork.service="api"
ENV NODE_ENV=production
EXPOSE 4000
CMD ["npm", "run", "start", "-w", "@patchwork/api"]

FROM runtime-base AS indexer-runtime

ARG GIT_SHA
ARG GIT_BRANCH
ARG BUILD_VERSION
ARG CI_RUN_ID
LABEL org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.ref.name="${GIT_BRANCH}" \
      com.patchwork.ci.run-id="${CI_RUN_ID}" \
      com.patchwork.service="indexer"
ENV NODE_ENV=production
EXPOSE 4100
CMD ["npm", "run", "start", "-w", "@patchwork/indexer"]

FROM runtime-base AS moderation-runtime

ARG GIT_SHA
ARG GIT_BRANCH
ARG BUILD_VERSION
ARG CI_RUN_ID
LABEL org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.ref.name="${GIT_BRANCH}" \
      com.patchwork.ci.run-id="${CI_RUN_ID}" \
      com.patchwork.service="moderation-worker"
ENV NODE_ENV=production
EXPOSE 4200
CMD ["npm", "run", "start", "-w", "@patchwork/moderation-worker"]

FROM source AS web-build

ARG VITE_APP_NAME=Patchwork
ARG VITE_API_BASE_URL=https://patchwork.subcult.tv/api
ARG VITE_DATA_MODE=api
ARG VITE_MAP_TILE_URL
ENV VITE_APP_NAME=${VITE_APP_NAME}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_DATA_MODE=${VITE_DATA_MODE}
ENV VITE_MAP_TILE_URL=${VITE_MAP_TILE_URL}

RUN npm run build -w @patchwork/web

FROM nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS web-runtime

ARG GIT_SHA
ARG GIT_BRANCH
ARG BUILD_VERSION
ARG CI_RUN_ID
LABEL org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.ref.name="${GIT_BRANCH}" \
      com.patchwork.ci.run-id="${CI_RUN_ID}" \
      com.patchwork.service="web"

RUN apk upgrade --no-cache

COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
COPY ./docker/nginx/patchwork-web.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
