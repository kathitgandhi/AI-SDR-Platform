FROM node:20-alpine AS builder
RUN npm install -g pnpm
WORKDIR /app
COPY . .
RUN pnpm install --no-frozen-lockfile --shamefully-hoist
RUN NODE_OPTIONS="--max-old-space-size=512" pnpm --filter @ai-sdr/database build
RUN NODE_OPTIONS="--max-old-space-size=512" pnpm --filter @ai-sdr/core build
RUN NODE_OPTIONS="--max-old-space-size=512" pnpm --filter @ai-sdr/integrations build
RUN NODE_OPTIONS="--max-old-space-size=512" pnpm --filter @ai-sdr/workers build

FROM node:20-alpine AS runner
RUN npm install -g pnpm
WORKDIR /app
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/workers/package.json ./apps/workers/
COPY --from=builder /app/packages/database/package.json ./packages/database/
COPY --from=builder /app/packages/integrations/package.json ./packages/integrations/
COPY --from=builder /app/packages/core/package.json ./packages/core/
RUN pnpm install --no-frozen-lockfile --prod --shamefully-hoist
COPY --from=builder /app/apps/workers/dist ./apps/workers/dist
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/integrations/dist ./packages/integrations/dist

CMD ["node", "apps/workers/dist/index.js"]
