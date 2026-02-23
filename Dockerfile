# Agent Recorder Docker Image
# Local-first flight recorder for Claude Code and MCP servers

FROM node:20-alpine AS base

# Install dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/service/package.json ./packages/service/
COPY packages/cli/package.json ./packages/cli/
COPY packages/hooks/package.json ./packages/hooks/
COPY packages/stdio-proxy/package.json ./packages/stdio-proxy/
COPY packages/dist/package.json ./packages/dist/

# Install pnpm and dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build all packages
RUN pnpm build && pnpm build:dist

# Production image
FROM node:20-alpine AS production

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache libstdc++

WORKDIR /app

# Copy built distribution
COPY --from=base /app/packages/dist/dist ./dist
COPY --from=base /app/packages/dist/vendor ./vendor
COPY --from=base /app/packages/dist/package.json ./
COPY --from=base /app/node_modules ./node_modules

# Create data directory
RUN mkdir -p /data

# Environment variables
ENV AR_LISTEN_PORT=8787
ENV AR_UI_PORT=8788
ENV AR_DB_PATH=/data/agent-recorder.sqlite
ENV NODE_ENV=production

# Expose ports
EXPOSE 8787 8788

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8787/api/health || exit 1

# Run the service
ENTRYPOINT ["node", "dist/index.js"]
CMD ["start"]
