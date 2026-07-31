const mysql = require('mysql2/promise');
const logger = require('../logger');
const config = require('../config');

let pool = null;
let initialized = false;
let memoryMode = false;

async function initDatabase() {
  try {
    // Check if database config exists
    if (!config.database || !config.database.host || !config.database.database) {
      logger.warn('⚠️ Database configuration missing, running in memory mode');
      memoryMode = true;
      initialized = true;
      return null;
    }

    pool = mysql.createPool({
      host: config.database.host,
      user: config.database.user || 'root',
      password: config.database.password || '',
      database: config.database.database,
      port: config.database.port || 3306,
      connectionLimit: config.database.connectionLimit || 10,
      waitForConnections: true,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: 10000,
    });

    // Test connection
    const connection = await pool.getConnection();
    await connection.query('SELECT 1');
    connection.release();

    logger.info('✅ Database connection established successfully');
    await createTables();
    logger.info('✅ Database tables verified/created');
    
    initialized = true;
    return pool;
  } catch (error) {
    logger.warn(`⚠️ Database initialization failed: ${error.message}`);
    logger.warn('⚠️ Running in memory mode (data will not be persisted)');
    memoryMode = true;
    initialized = true;
    return null;
  }
}

async function createTables() {
  if (!pool || memoryMode) {
    logger.info('📝 Memory mode: Skipping table creation');
    return;
  }

  const queries = [
    `
    CREATE TABLE IF NOT EXISTS matches (
      id VARCHAR(50) PRIMARY KEY,
      title VARCHAR(255),
      match_type VARCHAR(50),
      status VARCHAR(50),
      venue VARCHAR(255),
      team1 VARCHAR(100),
      team2 VARCHAR(100),
      score1 VARCHAR(100),
      score2 VARCHAR(100),
      result VARCHAR(255),
      match_date DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_match_date (match_date),
      INDEX idx_status (status),
      INDEX idx_team1 (team1),
      INDEX idx_team2 (team2)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,

    `
    CREATE TABLE IF NOT EXISTS match_details (
      id VARCHAR(50) PRIMARY KEY,
      match_id VARCHAR(50) NOT NULL,
      details JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
      INDEX idx_match_id (match_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,

    `
    CREATE TABLE IF NOT EXISTS scorecards (
      id INT AUTO_INCREMENT PRIMARY KEY,
      match_id VARCHAR(50) NOT NULL,
      scorecard JSON,
      innings INT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
      INDEX idx_match_innings (match_id, innings)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,

    `
    CREATE TABLE IF NOT EXISTS commentary (
      id INT AUTO_INCREMENT PRIMARY KEY,
      match_id VARCHAR(50) NOT NULL,
      \`over\` VARCHAR(20),
      ball VARCHAR(10),
      commentary_text TEXT,
      commentary_json JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
      INDEX idx_match_over (match_id, \`over\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,

    `
    CREATE TABLE IF NOT EXISTS news (
      id VARCHAR(50) PRIMARY KEY,
      title VARCHAR(255),
      content TEXT,
      link VARCHAR(500),
      source VARCHAR(100),
      published_at DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_published_at (published_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,

    `
    CREATE TABLE IF NOT EXISTS points_table (
      id INT AUTO_INCREMENT PRIMARY KEY,
      series VARCHAR(100),
      team VARCHAR(100),
      matches_played INT DEFAULT 0,
      won INT DEFAULT 0,
      lost INT DEFAULT 0,
      tied INT DEFAULT 0,
      no_result INT DEFAULT 0,
      points INT DEFAULT 0,
      net_run_rate DECIMAL(5,3) DEFAULT 0.000,
      position INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_series (series),
      INDEX idx_position (position)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  ];

  for (const query of queries) {
    try {
      await pool.query(query);
    } catch (error) {
      logger.error('Failed to create table:', { query: query.substring(0, 100), error: error.message });
      throw error;
    }
  }
}

function getConnection() {
  if (!initialized) {
    throw new Error('Database not initialized');
  }
  
  if (memoryMode || !pool) {
    // Return a mock connection for memory mode
    return {
      query: async (sql, params) => {
        logger.debug('📝 Memory DB query:', { sql: sql.substring(0, 100), params });
        return [[]];
      },
      execute: async (sql, params) => {
        logger.debug('📝 Memory DB execute:', { sql: sql.substring(0, 100), params });
        return [{ affectedRows: 0 }];
      },
      getConnection: () => this,
      release: () => {},
    };
  }
  
  return pool;
}

async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('✅ Database connections closed');
  }
  initialized = false;
}

// Export a simplified cache interface
const db = {
  init: initDatabase,
  getConnection: getConnection,
  close: closeDatabase,
  isMemoryMode: () => memoryMode,
  isInitialized: () => initialized,
  healthCheck: async () => {
    if (memoryMode || !pool) {
      return { healthy: true, mode: 'memory' };
    }
    try {
      const conn = await pool.getConnection();
      await conn.query('SELECT 1');
      conn.release();
      return { healthy: true, mode: 'database' };
    } catch (error) {
      return { healthy: false, mode: 'database', error: error.message };
    }
  }
};

module.exports = db;