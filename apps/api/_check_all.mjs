import pg from 'pg'
const { Client } = pg
const c = new Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
const tenants = await c.query('SELECT id, name, subdomain FROM "Tenant"')
console.log('TENANTS:', JSON.stringify(tenants.rows, null, 2))
const staff = await c.query('SELECT id, name, role, pin FROM "StaffUser"')
staff.rows.forEach(u => {
  const isBcrypt = u.pin.startsWith('$2')
  console.log(`STAFF: ${u.name} role=${u.role} pin_prefix=${u.pin.substring(0,25)} isBcrypt=${isBcrypt}`)
})
await c.end()
