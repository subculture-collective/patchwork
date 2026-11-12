# Disposable private-attachment test service. Community MinIO is source-only:
# https://github.com/minio/minio#source-only-distribution
ARG MINIO_SOURCE_REVISION=7aac2a2c5b7c882e68c1ce017d8256be2feea27f
FROM golang:1.27.0-alpine@sha256:4c9fe60190a2a3350ddc51de80d0224b8a6698d12bdfc999fee45ea9d6c46dbc AS build
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

FROM alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf
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
