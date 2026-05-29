FROM node:22-alpine AS builder
RUN npm install -g pnpm
WORKDIR /app

# Layer 1: Lockfile + manifests only (changes rarely → caches the next layer)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/admin/package.json ./apps/admin/
COPY apps/driver/package.json ./apps/driver/
COPY apps/ordering/package.json ./apps/ordering/
COPY apps/api/package.json ./apps/api/

# Layer 2: Install — cached unless lockfile or a manifest changes
RUN pnpm install --frozen-lockfile

# Layer 3: Source code (changes every deploy)
COPY packages/shared/ ./packages/shared/
COPY apps/ ./apps/

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

# Install only production dependencies for the API
COPY --from=builder /app/apps/api/package.json ./package.json
RUN npm install --production

EXPOSE 3001
CMD ["node", "dist/index.js"]
