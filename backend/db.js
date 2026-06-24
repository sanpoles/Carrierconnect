const { Pool } = require('pg')

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'postgres',
  password: 'NewStrongPassword123',
  database: 'career_support',
})

module.exports = pool