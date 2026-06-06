const { Client } = require('pg');
const { readFileSync } = require('fs');
const { join } = require('path');

const pw = readFileSync(join(process.env.APPDATA, 'lebanon-pos', '.pgpass'), 'utf-8').trim();
const c = new Client({ host: 'localhost', port: 5434, user: 'lbpos', password: pw, database: 'postgres' });
c.connect().then(() => {
  return c.query("SELECT 1 FROM pg_database WHERE datname = $1", ['lebanonpos']);
}).then(({ rows }) => {
  console.log('rows:', rows.length);
  if (rows.length === 0) {
    return c.query('CREATE DATABASE "lebanonpos"').then(() => console.log('created'));
  } else {
    console.log('exists');
  }
}).then(() => c.end()).then(() => console.log('OK')).catch(e => console.log('ERROR:', e.message));
