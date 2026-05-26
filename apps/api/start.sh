#!/bin/sh
set -e
echo "Running migrations..."
npx prisma migrate deploy
echo "Running seed..."
npx tsx prisma/seed.ts
echo "Starting app..."
exec node dist/index.js
