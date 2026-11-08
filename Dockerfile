# Crema server: the optional AI add-on, on :8787. It also serves the web app.
# See docs/install.md.
#
#   docker build -t crema .
#   docker run -d -p 8787:8787 --env-file .env -v crema-images:/data crema
#
# To use a Claude or ChatGPT subscription instead of an API key, build with
# their CLIs included:
#   docker build --build-arg AI_CLIS="@anthropic-ai/claude-code @openai/codex" -t crema .
# Codex keeps its login in /home/node/.codex; give it a volume and log in once
# from inside the container (docs/install.md).
FROM node:22-slim

ARG AI_CLIS=""
# The slim image has no CA certificates. Node brings its own, but the CLIs are
# native binaries that use the system's, so without them every HTTPS call fails.
RUN if [ -n "$AI_CLIS" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && \
      npm install -g $AI_CLIS && npm cache clean --force; \
    fi

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY skin ./skin

# The only thing the server keeps is a cache of roaster product photos.
# The Codex login folder is created here so a new named volume mounted on it
# is owned by the node user; otherwise Docker creates it owned by root and
# Codex can't save its login or refreshed tokens.
RUN mkdir -p /data /home/node/.codex && chown node:node /data /home/node/.codex
USER node
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 CREMA_IMAGES=/data/images
VOLUME /data
EXPOSE 8787
CMD ["node_modules/.bin/tsx", "server/main.ts"]
