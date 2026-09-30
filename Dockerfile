FROM node:24.19.0-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24.19.0-alpine
ENV NODE_ENV=production
WORKDIR /app

# Source and dependencies stay root-owned (read-only for the app user);
# only /app/secrets is writable so the token can be generated and persisted.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
RUN mkdir -p /app/secrets && chown node:node /app/secrets && chmod 700 /app/secrets

USER node
EXPOSE 3000
VOLUME ["/app/secrets"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "require('net').connect(process.env.PORT||3000,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]
