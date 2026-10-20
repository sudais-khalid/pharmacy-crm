# Production image (roadmap 9.2): build in one stage, run the self-contained server folder in another,
# as the unprivileged "node" user. The same folder is what the desktop app ships (scripts/build-standalone.mjs):
# the Next.js server, dist/ (worker and ops), the migrations and the local photo reader.
FROM node:22-slim AS build
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN node scripts/build-standalone.mjs

FROM node:22-slim
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /src/.next/standalone ./
# backups written by the worker (mount a volume here)
RUN mkdir -p /backups && chown node:node /backups
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
# Apply database migrations, then start the server. The worker service runs `node dist/worker.js` instead.
CMD ["sh", "-c", "node dist/ops.js migrate && exec node server.js"]
