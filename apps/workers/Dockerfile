FROM node:20-alpine AS base
RUN npm install -g pnpm
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/workers/package.json ./apps/workers/
COPY packages/database/package.json ./packages/database/
COPY packages/integrations/package.json ./packages/integrations/
COPY packages/core/package.json ./packages/core/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/workers/node_modules ./apps/workers/node_modules
COPY . .
RUN pnpm --filter @ai-sdr/database build
RUN pnpm --filter @ai-sdr/core build
RUN pnpm --filter @ai-sdr/integrations build
RUN pnpm --filter @ai-sdr/workers build

FROM node:20-alpine AS runner
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/workers/package.json ./apps/workers/
COPY packages/database/package.json ./packages/database/
COPY packages/integrations/package.json ./packages/integrations/
COPY packages/core/package.json ./packages/core/
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/apps/workers/dist ./apps/workers/dist
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/integrations/dist ./packages/integrations/dist

CMD ["node", "apps/workers/dist/index.js"]
