# Crema server: the optional AI add-on, on :8787. It also serves the web app.
# See docs/install.md.
#
#   docker build -t crema .
#   docker run -d -p 8787:8787 --env-file .env -v crema-images:/data crema
#
# To use a Claude or ChatGPT subscription instead of an API key, build with
# their CLIs included:
#   docker build --build-arg AI_CLIS="@anthropic-ai/claude-code @openai/codex" -t crema .
FROM node:22-slim

ARG AI_CLIS=""
RUN if [ -n "$AI_CLIS" ]; then npm install -g $AI_CLIS && npm cache clean --force; fi

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY skin ./skin

# The only thing the server keeps is a cache of roaster product photos.
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 CREMA_IMAGES=/data/images
VOLUME /data
EXPOSE 8787
CMD ["node_modules/.bin/tsx", "server/main.ts"]
