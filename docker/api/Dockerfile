# API Service Dockerfile
FROM node:20-alpine AS base

# Install dependencies for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# Build stage
FROM base AS builder

# Copy package files
COPY packages/api/package.json ./packages/api/
COPY packages/translator/package.json ./packages/translator/

# Install dependencies
WORKDIR /app/packages/translator
RUN npm install

WORKDIR /app/packages/api
RUN npm install

# Copy source code
WORKDIR /app
COPY packages/translator ./packages/translator
COPY packages/api ./packages/api

# Build translator first (dependency)
WORKDIR /app/packages/translator
RUN npm run build

# Generate Prisma client and build API
WORKDIR /app/packages/api
RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl

WORKDIR /app

# Copy built files and dependencies
COPY --from=builder /app/packages/api/dist ./dist
COPY --from=builder /app/packages/api/prisma ./prisma
COPY --from=builder /app/packages/api/node_modules ./node_modules
COPY --from=builder /app/packages/api/package.json ./package.json

# Copy translator package with its dependencies
COPY --from=builder /app/packages/translator/dist ./node_modules/@web3-test/translator/dist
COPY --from=builder /app/packages/translator/package.json ./node_modules/@web3-test/translator/package.json
COPY --from=builder /app/packages/translator/node_modules ./node_modules/@web3-test/translator/node_modules
COPY --from=builder /app/packages/translator/knowledge ./node_modules/@web3-test/translator/knowledge

# Set environment
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1

CMD ["node", "dist/server.js"]
