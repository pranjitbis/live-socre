// scratch/test-db-connection.js
require('dotenv').config();
const db = require('../src/database');
const logger = require('../src/logger');

async function testDB() {
  console.log('============================================================');
  console.log('Testing MySQL Database Connection');
  console.log('DATABASE_URL:', process.env.DATABASE_URL);
  console.log('============================================================');

  try {
    const pool = await db.init();
    if (db.isMemoryMode()) {
      console.log('⚠️ Running in MEMORY mode (Could not connect to Railway internal host from local network)');
      console.log('ℹ️ NOTE: "mysql.railway.internal" is only accessible inside Railway cloud container deployments.');
    } else {
      console.log('✅ Database connected successfully to Railway MySQL database!');
      const health = await db.healthCheck();
      console.log('Health check:', health);
    }
  } catch (err) {
    console.error('❌ Connection error:', err.message);
  } finally {
    await db.close();
  }
}

testDB().catch(console.error);
