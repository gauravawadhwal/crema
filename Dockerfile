# Crema server. Serves the phone app and the API on :8787.
#
#   docker build -t crema .
#   docker run -d -p 8787:8787 -v crema-data:/data -e DECAID_URL=http://<tablet-ip>:8080 crema
#
# To use a Claude or ChatGPT subscription instead of an API key, build with the
# CLIs included and give the container their credentials (see docs/install.md):
#   docker build --build-arg AI_CLIS="@anthropic-ai/claude-code @openai/codex" -t crema .
FROM node:22-slim

ARG AI_CLIS=""
RUN if [ -n "$AI_CLIS" ]; then npm install -g $AI_CLIS && npm cache clean --force; fi

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY skin ./skin

RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 CREMA_DATA=/data/crema.json CREMA_IMAGES=/data/images
VOLUME /data
EXPOSE 8787
CMD ["node_modules/.bin/tsx", "server/main.ts"]
