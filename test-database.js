const mysql = require('mysql2/promise');
const logger = require('./src/logger');
const config = require('./src/config');

class DatabaseTester {
  constructor() {
    this.connection = null;
    this.testResults = [];
  }

  async connect() {
    try {
      this.connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'cricket_data',
        port: process.env.DB_PORT || 3306,
        multipleStatements: true,
        timezone: 'Z',
        connectTimeout: 10000
      });
      
      logger.info('✅ Connected to database successfully');
      return true;
    } catch (error) {
      logger.error('❌ Failed to connect to database:', error.message);
      return false;
    }
  }

  async disconnect() {
    if (this.connection) {
      await this.connection.end();
      logger.info('✅ Database connection closed');
    }
  }

  async runTest(testName, testFn) {
    logger.info(`\n🧪 Running test: ${testName}`);
    const startTime = Date.now();
    
    try {
      const result = await testFn();
      const duration = Date.now() - startTime;
      
      this.testResults.push({
        name: testName,
        status: 'PASS',
        duration,
        result
      });
      
      logger.info(`✅ ${testName} - PASSED (${duration}ms)`);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.testResults.push({
        name: testName,
        status: 'FAIL',
        duration,
        error: error.message
      });
      
      logger.error(`❌ ${testName} - FAILED (${duration}ms): ${error.message}`);
      throw error;
    }
  }

  // ============================================================
  // TABLE CREATION TESTS
  // ============================================================

  async testCreateTables() {
    return this.runTest('Create Tables', async () => {
      // Drop existing tables if they exist (for clean test)
      try {
        await this.connection.query(`
          SET FOREIGN_KEY_CHECKS = 0;
          DROP TABLE IF EXISTS commentary;
          DROP TABLE IF EXISTS match_details;
          DROP TABLE IF EXISTS matches;
          DROP TABLE IF EXISTS points_table;
          DROP TABLE IF EXISTS news;
          SET FOREIGN_KEY_CHECKS = 1;
        `);
        logger.info('✅ Dropped existing tables');
      } catch (error) {
        logger.warn('⚠️ Could not drop tables (may not exist):', error.message);
      }

      // Create matches table with all columns including source
      await this.connection.query(`
        CREATE TABLE IF NOT EXISTS matches (
          id VARCHAR(255) PRIMARY KEY,
          title VARCHAR(500),
          match_type VARCHAR(50),
          status VARCHAR(50),
          venue VARCHAR(255),
          team1 VARCHAR(255),
          team2 VARCHAR(255),
          score1 VARCHAR(50),
          score2 VARCHAR(50),
          result VARCHAR(255),
          match_date DATETIME,
          source VARCHAR(50) DEFAULT 'crex',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_status (status),
          INDEX idx_match_type (match_type),
          INDEX idx_match_date (match_date),
          INDEX idx_team1 (team1(100)),
          INDEX idx_team2 (team2(100)),
          INDEX idx_source (source)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      logger.info('✅ Matches table created/verified');

      // Create match_details table
      await this.connection.query(`
        CREATE TABLE IF NOT EXISTS match_details (
          id VARCHAR(255) PRIMARY KEY,
          match_id VARCHAR(255) NOT NULL,
          details JSON,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
          INDEX idx_match_id (match_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      logger.info('✅ Match details table created/verified');

      // Create commentary table
      await this.connection.query(`
        CREATE TABLE IF NOT EXISTS commentary (
          id VARCHAR(255) PRIMARY KEY,
          match_id VARCHAR(255) NOT NULL,
          \`over\` VARCHAR(10),
          ball VARCHAR(10),
          commentary_text TEXT,
          commentary_json JSON,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_match_id (match_id),
          INDEX idx_over (\`over\`),
          FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      logger.info('✅ Commentary table created/verified');

      // Create points_table table
      await this.connection.query(`
        CREATE TABLE IF NOT EXISTS points_table (
          id VARCHAR(255) PRIMARY KEY,
          series VARCHAR(255),
          team VARCHAR(255),
          matches_played INT DEFAULT 0,
          won INT DEFAULT 0,
          lost INT DEFAULT 0,
          tied INT DEFAULT 0,
          no_result INT DEFAULT 0,
          points INT DEFAULT 0,
          net_run_rate DECIMAL(10,3) DEFAULT 0,
          position INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_series (series(100)),
          INDEX idx_team (team(100)),
          INDEX idx_position (position)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      logger.info('✅ Points table created/verified');

      // Create news table
      await this.connection.query(`
        CREATE TABLE IF NOT EXISTS news (
          id VARCHAR(255) PRIMARY KEY,
          title VARCHAR(500),
          content TEXT,
          link VARCHAR(500),
          source VARCHAR(100),
          published_at DATETIME,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_source (source),
          INDEX idx_published_at (published_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      logger.info('✅ News table created/verified');

      return { 
        success: true, 
        tables: ['matches', 'match_details', 'commentary', 'points_table', 'news'] 
      };
    });
  }

  // ============================================================
  // INSERT TEST DATA
  // ============================================================

  async testInsertMatch() {
    return this.runTest('Insert Match', async () => {
      const matchId = `test_match_${Date.now()}`;
      
      await this.connection.query(`
        INSERT INTO matches (
          id, title, match_type, status, venue, team1, team2, 
          score1, score2, result, match_date, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        matchId,
        'India vs Australia - Test Match',
        'Test',
        'Completed',
        'Melbourne Cricket Ground',
        'India',
        'Australia',
        '456/10',
        '320/10',
        'India won by 136 runs',
        '2026-07-30 10:00:00',
        'crex-test'
      ]);

      // Insert match details
      await this.connection.query(`
        INSERT INTO match_details (id, match_id, details)
        VALUES (?, ?, ?)
      `, [
        `detail_${matchId}`,
        matchId,
        JSON.stringify({
          match_id: matchId,
          teams: {
            home: { name: 'India', short: 'IND' },
            away: { name: 'Australia', short: 'AUS' }
          },
          scoreboard: {
            batting_team: { name: 'India', score: '456/10' },
            bowling_team: { name: 'Australia', score: '320/10' }
          },
          players: {
            man_of_match: 'Virat Kohli'
          }
        })
      ]);

      return { success: true, matchId };
    });
  }

  async testInsertCommentary() {
    return this.runTest('Insert Commentary', async () => {
      const matchId = `test_match_${Date.now()}`;
      
      // Insert a match first
      await this.connection.query(`
        INSERT INTO matches (id, title, match_type, status, venue, team1, team2, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        matchId,
        'Test Match for Commentary',
        'T20',
        'Live',
        'Wankhede Stadium',
        'Mumbai Indians',
        'Chennai Super Kings',
        'crex-test'
      ]);

      // Insert commentary items
      const commentaryItems = [
        { over: '1', ball: '1', text: 'Dot ball, well bowled' },
        { over: '1', ball: '2', text: 'Four runs! Driven through covers' },
        { over: '1', ball: '3', text: 'Single taken' },
        { over: '1', ball: '4', text: 'Wide! Down the leg side' },
        { over: '1', ball: '5', text: 'Six! Huge hit over long-on' }
      ];

      for (const item of commentaryItems) {
        const id = `commentary_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        await this.connection.query(`
          INSERT INTO commentary (id, match_id, \`over\`, ball, commentary_text, commentary_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
          id,
          matchId,
          item.over,
          item.ball,
          item.text,
          JSON.stringify(item)
        ]);
      }

      const [count] = await this.connection.query(
        'SELECT COUNT(*) as count FROM commentary WHERE match_id = ?',
        [matchId]
      );

      return { success: true, matchId, commentaryCount: count[0].count };
    });
  }

  async testInsertPoints() {
    return this.runTest('Insert Points Table', async () => {
      const seriesId = `series_${Date.now()}`;
      
      const teams = [
        { name: 'India', played: 5, won: 4, lost: 1, points: 8, nrr: 1.234 },
        { name: 'Australia', played: 5, won: 3, lost: 2, points: 6, nrr: 0.876 },
        { name: 'England', played: 5, won: 2, lost: 3, points: 4, nrr: -0.432 },
        { name: 'New Zealand', played: 5, won: 1, lost: 4, points: 2, nrr: -1.678 }
      ];

      for (let i = 0; i < teams.length; i++) {
        const team = teams[i];
        const id = `point_${Date.now()}_${i}`;
        
        await this.connection.query(`
          INSERT INTO points_table (
            id, series, team, matches_played, won, lost, tied, no_result,
            points, net_run_rate, position
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          id,
          seriesId,
          team.name,
          team.played,
          team.won,
          team.lost,
          0,
          0,
          team.points,
          team.nrr,
          i + 1
        ]);
      }

      const [count] = await this.connection.query(
        'SELECT COUNT(*) as count FROM points_table WHERE series = ?',
        [seriesId]
      );

      return { success: true, seriesId, pointsCount: count[0].count };
    });
  }

  async testInsertNews() {
    return this.runTest('Insert News', async () => {
      const newsItems = [
        {
          title: 'India wins the Test Series',
          content: 'India defeated Australia in the final test to win the series 3-1.',
          source: 'ESPN Cricinfo'
        },
        {
          title: 'New T20 League Announced',
          content: 'A new T20 league with 8 teams will start next year.',
          source: 'Cricbuzz'
        }
      ];

      for (const item of newsItems) {
        const id = `news_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        await this.connection.query(`
          INSERT INTO news (id, title, content, source, published_at)
          VALUES (?, ?, ?, ?, ?)
        `, [
          id,
          item.title,
          item.content,
          item.source,
          new Date()
        ]);
      }

      const [count] = await this.connection.query(
        'SELECT COUNT(*) as count FROM news WHERE source IN (?, ?)',
        ['ESPN Cricinfo', 'Cricbuzz']
      );

      return { success: true, newsCount: count[0].count };
    });
  }

  // ============================================================
  // QUERY TESTING
  // ============================================================

  async testQueryMatches() {
    return this.runTest('Query Matches', async () => {
      // Test various queries
      const queries = [
        {
          name: 'Get all matches',
          query: 'SELECT * FROM matches ORDER BY created_at DESC LIMIT 5'
        },
        {
          name: 'Get matches by status',
          query: 'SELECT * FROM matches WHERE status = "Live"'
        },
        {
          name: 'Get matches by type',
          query: 'SELECT * FROM matches WHERE match_type = "Test"'
        },
        {
          name: 'Get matches by team',
          query: 'SELECT * FROM matches WHERE team1 LIKE "%India%" OR team2 LIKE "%India%"'
        },
        {
          name: 'Get recent matches with details',
          query: `
            SELECT m.*, md.details 
            FROM matches m 
            LEFT JOIN match_details md ON m.id = md.match_id 
            ORDER BY m.match_date DESC 
            LIMIT 5
          `
        }
      ];

      const results = [];
      for (const q of queries) {
        const [rows] = await this.connection.query(q.query);
        results.push({
          name: q.name,
          count: rows.length,
          sample: rows.length > 0 ? rows[0] : null
        });
        logger.info(`   📊 ${q.name}: ${rows.length} rows`);
      }

      return results;
    });
  }

  async testQueryStatistics() {
    return this.runTest('Query Statistics', async () => {
      const stats = {};

      // Count by status
      const [statusCount] = await this.connection.query(`
        SELECT status, COUNT(*) as count 
        FROM matches 
        GROUP BY status
      `);
      stats.byStatus = statusCount;

      // Count by type
      const [typeCount] = await this.connection.query(`
        SELECT match_type, COUNT(*) as count 
        FROM matches 
        GROUP BY match_type
      `);
      stats.byType = typeCount;

      // Get total counts
      const [total] = await this.connection.query(`
        SELECT 
          COUNT(*) as total_matches,
          COUNT(DISTINCT team1) as total_teams,
          COUNT(DISTINCT source) as total_sources,
          COUNT(DISTINCT venue) as total_venues
        FROM matches
      `);
      stats.total = total[0];

      // Get points table summary
      const [pointsSummary] = await this.connection.query(`
        SELECT 
          series,
          COUNT(*) as teams,
          MAX(points) as max_points,
          MIN(points) as min_points,
          AVG(points) as avg_points
        FROM points_table
        GROUP BY series
        LIMIT 5
      `);
      stats.pointsSummary = pointsSummary;

      // Get commentary stats
      const [commentaryStats] = await this.connection.query(`
        SELECT 
          COUNT(DISTINCT match_id) as matches_with_commentary,
          COUNT(*) as total_commentary_items
        FROM commentary
      `);
      stats.commentaryStats = commentaryStats[0];

      return stats;
    });
  }

  // ============================================================
  // UPDATE AND DELETE TESTS
  // ============================================================

  async testUpdateMatch() {
    return this.runTest('Update Match', async () => {
      // Insert a test match
      const matchId = `update_test_${Date.now()}`;
      await this.connection.query(`
        INSERT INTO matches (id, title, match_type, status, venue, team1, team2, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        matchId,
        'Test Match for Update',
        'ODI',
        'Scheduled',
        'Lord\'s',
        'England',
        'Australia',
        'crex-test'
      ]);

      // Update the match
      await this.connection.query(`
        UPDATE matches 
        SET status = ?, result = ?, match_date = NOW()
        WHERE id = ?
      `, [
        'Completed',
        'Match drawn',
        matchId
      ]);

      const [updated] = await this.connection.query(
        'SELECT * FROM matches WHERE id = ?',
        [matchId]
      );

      return { 
        success: true, 
        matchId, 
        updatedStatus: updated[0].status,
        updatedResult: updated[0].result
      };
    });
  }

  async testDeleteMatch() {
    return this.runTest('Delete Match', async () => {
      // Insert a test match
      const matchId = `delete_test_${Date.now()}`;
      await this.connection.query(`
        INSERT INTO matches (id, title, match_type, status, venue, team1, team2, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        matchId,
        'Test Match for Delete',
        'T20',
        'Cancelled',
        'Wankhede Stadium',
        'India',
        'Pakistan',
        'crex-test'
      ]);

      // Insert details
      await this.connection.query(`
        INSERT INTO match_details (id, match_id, details)
        VALUES (?, ?, ?)
      `, [
        `detail_${matchId}`,
        matchId,
        JSON.stringify({ test: 'delete' })
      ]);

      // Delete the match (should cascade)
      await this.connection.query('DELETE FROM matches WHERE id = ?', [matchId]);

      // Verify deletion
      const [matchCheck] = await this.connection.query(
        'SELECT * FROM matches WHERE id = ?',
        [matchId]
      );
      
      const [detailsCheck] = await this.connection.query(
        'SELECT * FROM match_details WHERE match_id = ?',
        [matchId]
      );

      return { 
        success: true, 
        matchDeleted: matchCheck.length === 0,
        detailsDeleted: detailsCheck.length === 0
      };
    });
  }

  // ============================================================
  // PERFORMANCE TESTS
  // ============================================================

  async testBulkInsert() {
    return this.runTest('Bulk Insert Performance', async () => {
      const startTime = Date.now();
      const count = 100;

      // Generate test data
      const matches = [];
      for (let i = 0; i < count; i++) {
        matches.push([
          `bulk_${Date.now()}_${i}`,
          `Test Match ${i}`,
          'T20',
          'Completed',
          `Venue ${i}`,
          `Team A${i}`,
          `Team B${i}`,
          `${Math.floor(Math.random() * 200)}/${Math.floor(Math.random() * 10)}`,
          `${Math.floor(Math.random() * 200)}/${Math.floor(Math.random() * 10)}`,
          `Team A${i} won`,
          new Date(),
          'bulk-test'
        ]);
      }

      // Bulk insert
      await this.connection.query(`
        INSERT INTO matches (
          id, title, match_type, status, venue, team1, team2, 
          score1, score2, result, match_date, source
        ) VALUES ?
      `, [matches]);

      const duration = Date.now() - startTime;
      
      return {
        success: true,
        recordsInserted: count,
        durationMs: duration,
        avgPerRecord: duration / count
      };
    });
  }

  // ============================================================
  // RUN ALL TESTS
  // ============================================================

  async runAllTests() {
    logger.info('\n' + '='.repeat(80));
    logger.info('🧪 DATABASE TEST SUITE');
    logger.info('='.repeat(80));

    let connected = false;
    
    try {
      connected = await this.connect();
      if (!connected) {
        logger.error('❌ Cannot run tests without database connection');
        return;
      }

      // Run tests in order
      await this.testCreateTables();
      await this.testInsertMatch();
      await this.testInsertCommentary();
      await this.testInsertPoints();
      await this.testInsertNews();
      await this.testQueryMatches();
      await this.testQueryStatistics();
      await this.testUpdateMatch();
      await this.testDeleteMatch();
      await this.testBulkInsert();

      // Print summary
      this.printSummary();

    } catch (error) {
      logger.error('❌ Test suite failed:', error);
    } finally {
      await this.disconnect();
    }
  }

  // ============================================================
  // PRINT SUMMARY
  // ============================================================

  printSummary() {
    logger.info('\n' + '='.repeat(80));
    logger.info('📊 TEST SUMMARY');
    logger.info('='.repeat(80));

    const total = this.testResults.length;
    const passed = this.testResults.filter(r => r.status === 'PASS').length;
    const failed = this.testResults.filter(r => r.status === 'FAIL').length;
    const totalDuration = this.testResults.reduce((sum, r) => sum + r.duration, 0);

    logger.info(`Total Tests: ${total}`);
    logger.info(`✅ Passed: ${passed}`);
    logger.info(`❌ Failed: ${failed}`);
    logger.info(`⏱️  Total Duration: ${totalDuration}ms`);
    logger.info(`📈 Success Rate: ${Math.round((passed / total) * 100)}%`);

    logger.info('\n📋 Detailed Results:');
    for (const result of this.testResults) {
      const status = result.status === 'PASS' ? '✅' : '❌';
      logger.info(`  ${status} ${result.name} - ${result.duration}ms`);
      if (result.error) {
        logger.info(`     Error: ${result.error}`);
      }
    }

    logger.info('='.repeat(80));
  }
}

// ============================================================
// RUN TESTS
// ============================================================

if (require.main === module) {
  const tester = new DatabaseTester();
  tester.runAllTests().catch(console.error);
}

module.exports = DatabaseTester;