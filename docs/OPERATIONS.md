# Lebanon POS — Operations Manual

## Railway Deployment

### Environment Variables (Railway Dashboard)
| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | Auto-set by Railway PostgreSQL plugin |
| `JWT_SECRET` | Yes | Random 32+ char string for JWT signing |
| `ADMIN_PASSWORD` | Yes | Master password for owner/admin portal |
| `ADMIN_PASSWORD_HASH` | Recommended | bcrypt hash of ADMIN_PASSWORD. Auto-generated on first login if missing |
| `CORS_ORIGINS` | No | Comma-separated allowed origins |
| `CLOUD_API_KEY` | No | For cloud sync bridge only |
| `PORT` | No | Defaults to 3001 |

### Deploy Command
```
// Railway auto-deploys from GitHub push.
// Dockerfile handles build + start automatically.
// Manual restart: click "Redeploy" in Railway dashboard.
```

### Migration Recovery
```bash
# Apply pending migrations (auto-runs on Railway start)
npx prisma migrate deploy

# If migration fails (P3008/P3009/P3018):
# 1. Check migration history:
npx prisma migrate status

# 2. Resolve stalled migration:
npx prisma migrate resolve --applied MIGRATION_NAME
npx prisma migrate resolve --rolled-back MIGRATION_NAME

# 3. Force re-apply (use with caution):
npx prisma migrate deploy --force
```

## Admin Operations

### Create New Store
```
POST /api/admin/tenants
Body: { storeName, subdomain, adminName, adminMobile, adminPin }
Auth: Owner Portal JWT
```

### Suspend/Resume Store
```
// Suspend (immediate effect + 7-day grace):
PUT /api/admin/tenants/:id
Body: { suspended: true }

// Resume:
PUT /api/admin/tenants/:id
Body: { suspended: false }
```

### Rotate Cloud API Key
```
POST /api/admin/tenants/:id/rotate-key
// Returns new key once — invalidates old key immediately
```

### Reset Admin PIN
```
POST /api/admin/tenants/:tenantId/users/:userId/reset-pin
Body: { pin: "new-pin" }  // optional — auto-generates 6-digit PIN if omitted
// Increments pinVersion + tokenVersion — invalidates all existing sessions
```

### Check License Status
```
GET /api/setup/diagnostics
// Returns: dbConnected, tenantCount, syncPending, syncFailed, license status, cloud config
```

## Desktop Setup

### Fresh Laptop Activation (with internet)
1. Open Lebanon POS desktop app
2. Enter store subdomain and admin PIN
3. App auto-discovers tenant ID + cloud API key
4. Pulls all data from Railway

### Offline Recovery
1. Open app — works with cached local data
2. Reconnect to internet — automatic sync resumes
3. For broken laptop: fresh install + activation + pull from Railway

### Emergency Recovery Export
1. Settings → Export Recovery Pack
2. Saves JSON with all local data (PINs masked)
3. Works in suspended/read-only mode
4. Works offline

### Desktop Update Path
- Auto-updater checks GitHub releases 10s after boot
- Manual: download latest EXE from GitHub releases
- Updates preserve: local PostgreSQL data, sync config, license state
- `%APPDATA%/Lebanon POS/pgdata` — all local data
- `%APPDATA%/Lebanon POS/.env` — server config (auto-preserved)

## Backup & Recovery

### Create Backup
```
Desktop: Settings → Export Recovery Pack
API: Manual pg_dump of Railway PostgreSQL
```

### Restore From Cloud
1. Fresh laptop → activation wizard → enter subdomain + admin PIN
2. Full pull from Railway restores all data

### Restore From Local Backup
1. Import recovered .env + pgdata directory
2. Start app — all data available locally
3. Connect to internet — sync catches up

## Health & Monitoring

### API Health Check
```
GET /api/health → { status: "ok", timestamp }
// No auth required
// Used by Railway, Electron boot polling, desktop SPA
```

### Admin Diagnostics
```
GET /api/setup/diagnostics
Returns: dbConnected, tenantCount, syncPending, syncFailed, cloudConfig
Secrets masked — no raw keys, PINs, or tokens
```

### Local Development
```bash
# Start API
cd apps/api
pnpm dev

# Start desktop SPA
cd apps/desktop
pnpm dev

# API on localhost:3001, desktop on localhost:5173

# Run tests
cd apps/api
pnpm test

# Typecheck all
pnpm typecheck:all
```
