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

# Runtime dependencies (libstdc++ for better-sqlite3 native addon)
RUN apk add --no-cache libstdc++

WORKDIR /app

# Copy all compiled workspace packages (preserves pnpm symlink structure)
COPY --from=base /app/packages/core/dist ./packages/core/dist
COPY --from=base /app/packages/core/package.json ./packages/core/package.json
COPY --from=base /app/packages/service/dist ./packages/service/dist
COPY --from=base /app/packages/service/package.json ./packages/service/package.json
COPY --from=base /app/packages/cli/dist ./packages/cli/dist
COPY --from=base /app/packages/cli/package.json ./packages/cli/package.json
COPY --from=base /app/packages/hooks/dist ./packages/hooks/dist
COPY --from=base /app/packages/hooks/package.json ./packages/hooks/package.json
COPY --from=base /app/packages/stdio-proxy/dist ./packages/stdio-proxy/dist
COPY --from=base /app/packages/stdio-proxy/package.json ./packages/stdio-proxy/package.json

# Copy per-package node_modules (pnpm creates local symlinks for each package's deps)
COPY --from=base /app/packages/cli/node_modules ./packages/cli/node_modules
COPY --from=base /app/packages/service/node_modules ./packages/service/node_modules

# Copy root node_modules (contains the .pnpm virtual store that symlinks point into)
COPY --from=base /app/node_modules ./node_modules

# Create data directory
RUN mkdir -p /data

ENV NODE_ENV=production
EXPOSE 8789

CMD ["node", "packages/cli/dist/index.js", "mcp-server"]
