# syntax=docker/dockerfile:1

# --- Front-end build --------------------------------------------------------
FROM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG APP_VERSION=dev
# Strip a leading "v" so the UI shows "v0.2.8" once, not "vv0.2.8".
RUN VITE_APP_VERSION="${APP_VERSION#v}" npm run build

# --- Backend build ----------------------------------------------------------
FROM golang:1.23-alpine AS backend
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
# Stage the freshly built front-end so go:embed picks up the current UI.
COPY --from=frontend /src/frontend/dist/. /src/backend/web/dist/
ARG APP_VERSION=dev
ARG APP_COMMIT=none
ARG APP_DATE=unknown
RUN CGO_ENABLED=0 go build -trimpath \
      -ldflags "-s -w -X main.version=${APP_VERSION} -X main.commit=${APP_COMMIT} -X main.date=${APP_DATE}" \
      -o /out/mongoui .

# --- Runtime ----------------------------------------------------------------
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -u 10001 mongoui \
    && mkdir -p /data && chown mongoui:mongoui /data
COPY --from=backend /out/mongoui /usr/local/bin/mongoui
USER mongoui
WORKDIR /data
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["mongoui"]
CMD ["-addr", ":8080", "-data", "/data"]
