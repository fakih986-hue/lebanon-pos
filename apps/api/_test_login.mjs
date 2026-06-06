// Test full flow: create staff user via sync push → login
const BASE = 'http://localhost:3001'
async function main() {
  // 1. Login as admin first to get a token
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subdomain: 'bendo2', pin: '3333' })
  })
  if (!loginRes.ok) { const e = await loginRes.json(); console.log('ADMIN LOGIN FAILED:', e); return }
  const { token, user } = await loginRes.json()
  console.log('Admin login OK:', user.name, user.role, 'token prefix:', token.substring(0, 20))

  // 2. Create a test staff user via sync push
  const testPin = '5678'
  const createRes = await fetch(`${BASE}/api/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      operations: [{
        id: crypto.randomUUID(),
        entity: 'staff',
        action: 'create',
        payload: {
          id: crypto.randomUUID(),
          name: 'Test Staff',
          mobile: 'test-mobile-' + Date.now(),
          pin: testPin,
          role: 'Cashier',
          code: '',
          active: true
        }
      }]
    })
  })
  if (!createRes.ok) { const e = await createRes.json(); console.log('CREATE USER FAILED:', e); return }
  console.log('Staff user created successfully')

  // 3. Try logging in as the new staff user
  const staffLoginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subdomain: 'bendo2', pin: testPin })
  })
  if (!staffLoginRes.ok) {
    const e = await staffLoginRes.json();
    console.log('STAFF LOGIN FAILED:', JSON.stringify(e));
    // Check the stored pin in DB to debug
    const dbCheck = await fetch(`${BASE}/api/sync/pull?since=2026-01-01T00:00:00.000Z`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (dbCheck.ok) {
      const data = await dbCheck.json()
      const staffUsers = data.users || []
      console.log('Staff users in pull response:', staffUsers.length)
      staffUsers.forEach(u => console.log(`  ${u.name}: role=${u.role}, pin_prefix=${u.pin?.substring(0,20)}, active=${u.active}`))
    }
    return
  }
  const staffData = await staffLoginRes.json()
  console.log('Staff login OK:', staffData.user.name, staffData.user.role)
}
main()
