FROM node:20-alpine AS builder
RUN npm install -g pnpm
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @ai-sdr/database build
RUN pnpm --filter @ai-sdr/core build
RUN pnpm --filter @ai-sdr/integrations build
RUN pnpm --filter @ai-sdr/mcp-server build

FROM node:20-alpine AS runner
RUN npm install -g pnpm
WORKDIR /app
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/mcp-server/package.json ./apps/mcp-server/
COPY --from=builder /app/packages/database/package.json ./packages/database/
COPY --from=builder /app/packages/core/package.json ./packages/core/
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/apps/mcp-server/dist ./apps/mcp-server/dist
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist

EXPOSE 3001
CMD ["node", "apps/mcp-server/dist/server.js"]
