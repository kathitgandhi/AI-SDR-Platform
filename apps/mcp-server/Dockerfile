FROM node:20-alpine AS base
RUN npm install -g pnpm
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/mcp-server/package.json ./apps/mcp-server/
COPY packages/database/package.json ./packages/database/
COPY packages/core/package.json ./packages/core/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @ai-sdr/database build
RUN pnpm --filter @ai-sdr/core build
RUN pnpm --filter @ai-sdr/mcp-server build

FROM node:20-alpine AS runner
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/mcp-server/package.json ./apps/mcp-server/
COPY packages/database/package.json ./packages/database/
COPY packages/core/package.json ./packages/core/
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/apps/mcp-server/dist ./apps/mcp-server/dist
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist

EXPOSE 3001
CMD ["node", "apps/mcp-server/dist/server.js"]
