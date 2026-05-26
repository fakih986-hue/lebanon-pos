FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npx prisma generate && npx tsc

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY start.sh .
RUN chmod +x start.sh
EXPOSE 3001
CMD ["./start.sh"]
