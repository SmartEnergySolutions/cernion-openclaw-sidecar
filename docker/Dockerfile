FROM node:24-bookworm-slim

ARG OPENCLAW_VERSION=2026.6.9-beta.1

ENV NODE_ENV=production \
    OPENCLAW_PROFILE=sidecar-it \
    OPENCLAW_GATEWAY_PORT=19101 \
    CERNION_BASE_URL=http://10.0.0.8:3900 \
    CERNION_READONLY_TOKEN_FILE=/run/secrets/cernion-readonly-token \
    CERNION_SIDECAR_TIMEOUT_MS=15000

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git jq tini \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g "openclaw@${OPENCLAW_VERSION}"

WORKDIR /opt/cernion-openclaw-sidecar

COPY --chown=node:node package*.json ./
RUN npm ci --include=dev

COPY --chown=node:node . .
RUN npm run build \
  && npm test \
  && npm run plugin:validate

COPY docker/entrypoint.sh /usr/local/bin/cernion-openclaw-sidecar
RUN chmod +x /usr/local/bin/cernion-openclaw-sidecar

USER node
ENV HOME=/home/node

EXPOSE 19101

ENTRYPOINT ["tini", "--", "/usr/local/bin/cernion-openclaw-sidecar"]
CMD ["gateway"]
