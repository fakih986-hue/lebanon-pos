#!/bin/sh
echo "Running migrations..."
npx prisma db push --accept-data-loss 2>&1
echo "Running seed..."
npx tsx prisma/seed.ts 2>&1
echo "Starting app..."
exec node dist/index.js
