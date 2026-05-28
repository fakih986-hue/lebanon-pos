FROM node:22-alpine AS builder
RUN npm install -g pnpm
WORKDIR /app

# Copy workspace root configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy shared package (used by all SPAs)
COPY packages/shared/ ./packages/shared/

# Copy all apps
COPY apps/ ./apps/

# Install all workspace dependencies (pnpm resolves workspace:* protocol)
RUN pnpm install --frozen-lockfile

# Build admin SPA
RUN cd apps/admin && npx vite build

# Build driver SPA
RUN cd apps/driver && npx vite build

# Build ordering SPA
RUN cd apps/ordering && npx vite build

# Build API server (generate prisma client, then compile TS)
RUN cd apps/api && npx prisma generate && npx tsc

FROM node:22-alpine
WORKDIR /app

# Copy API compiled output
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/src/generated ./dist/generated
COPY --from=builder /app/apps/api/prisma ./prisma

# Copy built SPAs
COPY --from=builder /app/apps/admin/dist ./public/admin
COPY --from=builder /app/apps/driver/dist ./public/driver
COPY --from=builder /app/apps/ordering/dist ./public/order

# Install only production dependencies for the API (npm, since deps are plain packages)
COPY --from=builder /app/apps/api/package.json ./package.json
RUN npm install --production

EXPOSE 3001
CMD ["node", "dist/index.js"]
