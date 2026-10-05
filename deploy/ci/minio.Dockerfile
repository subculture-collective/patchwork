# Disposable private-attachment test service. Community MinIO is source-only:
# https://github.com/minio/minio#source-only-distribution
ARG MINIO_SOURCE_REVISION=7aac2a2c5b7c882e68c1ce017d8256be2feea27f
FROM golang:1.26.6-alpine@sha256:3889b425f035be855a72fb4755265311293b6d414521f0a519d819df32222d83 AS build
ARG MINIO_SOURCE_REVISION
RUN apk add --no-cache git ca-certificates
WORKDIR /src
RUN git init . \
    && git remote add origin https://github.com/minio/minio.git \
    && git fetch --depth=1 origin "$MINIO_SOURCE_REVISION" \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "$MINIO_SOURCE_REVISION"
RUN CGO_ENABLED=0 go build -p=2 -trimpath -o /out/minio . \
    && go mod verify

FROM alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce
ARG MINIO_SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.revision="$MINIO_SOURCE_REVISION" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
RUN apk add --no-cache ca-certificates curl \
    && addgroup -g 10001 minio \
    && adduser -D -H -u 10001 -G minio minio \
    && mkdir /data \
    && chown minio:minio /data
COPY --from=build /out/minio /usr/local/bin/minio
COPY --from=build /src/LICENSE /src/NOTICE /usr/share/licenses/minio/
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["server", "/data"]
