FROM node:22-alpine AS admin-builder
WORKDIR /app
COPY apps/admin/package.json apps/admin/package-lock.json ./
RUN npm ci
COPY apps/admin/ ./
RUN npx vite build

FROM node:22-alpine AS api-builder
WORKDIR /app
COPY apps/api/package.json ./
RUN npm install
COPY apps/api/ ./
COPY --from=admin-builder /app/dist ./public/admin
RUN npx prisma generate && npx tsc

FROM node:22-alpine
WORKDIR /app
COPY --from=api-builder /app/dist ./dist
COPY --from=api-builder /app/src/generated ./dist/generated
COPY --from=api-builder /app/node_modules ./node_modules
COPY --from=api-builder /app/prisma ./prisma
COPY --from=api-builder /app/public ./public
EXPOSE 3001
CMD ["node", "dist/index.js"]
