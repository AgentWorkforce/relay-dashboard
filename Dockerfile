# syntax=docker/dockerfile:1.7
# Self-hosted Agent Relay dashboard: the static SPA served by unprivileged
# nginx on :8080. The chart (helm-charts charts/relay-dashboard) copies
# /usr/share/nginx/html into an emptyDir, runs with a read-only root
# filesystem as uid 101, and sets the DASHBOARD_* env this image turns into
# /runtime-config.js at start-up.

# The bundle is platform-independent, so build it once on the build platform.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Self-host build: served at / and loading the runtime config script.
ENV DASHBOARD_BASE_PATH=/ \
    DASHBOARD_RUNTIME_CONFIG_URL=/runtime-config.js
RUN npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03
ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.title="Agent Relay dashboard" \
      org.opencontainers.image.description="Self-hosted Agent Relay dashboard (static SPA on unprivileged nginx)" \
      org.opencontainers.image.source="https://github.com/AgentWorkforce/relay-dashboard" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.revision="${SOURCE_REVISION}"
USER root
# The entrypoint writes runtime-config.js next to the app (an emptyDir in the
# chart); without a volume the image's own html directory must be writable.
RUN chown 101:101 /usr/share/nginx/html
COPY --chmod=0644 docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=0755 docker/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
COPY --chmod=0644 LICENSE /usr/share/licenses/relay-dashboard/LICENSE
COPY --from=build --chown=101:101 /src/dist/ /usr/share/nginx/html/
USER 101
EXPOSE 8080
