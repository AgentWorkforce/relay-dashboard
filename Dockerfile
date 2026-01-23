# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3888

# Copy built assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/out ./out
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 dashboard

USER dashboard

EXPOSE 3888

CMD ["node", "dist/server/start.js"]
