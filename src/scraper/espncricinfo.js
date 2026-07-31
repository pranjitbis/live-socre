const BaseScraper = require('./base');
const logger = require('../logger');

class ESPNCricinfoScraper extends BaseScraper {
  constructor(config = {}) {
    super(config);
  }

  async scrape(page) {
    try {
      // Wait for page to load
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      
      // Get the page content
      const html = await this.getHtml(page);
      const $ = this.parseHtml(html);
      
      // Try to extract data using multiple strategies
      const data = {
        url: page.url(),
        timestamp: new Date().toISOString(),
      };

      // Extract match data
      const matchData = this.extractMatchData($);
      data.match = matchData;

      // Extract score data
      const scoreData = this.extractScoreData($);
      data.score = scoreData;

      // Extract batsmen data
      const batsmenData = this.extractBatsmenData($);
      data.batsmen = batsmenData;

      // Extract bowler data
      const bowlerData = this.extractBowlerData($);
      data.bowler = bowlerData;

      // Extract commentary
      const commentaryData = this.extractCommentaryData($);
      data.commentary = commentaryData;

      // Extract fixtures
      const fixturesData = this.extractFixturesData($, page.url());
      data.fixtures = fixturesData;

      // Extract news
      const newsData = this.extractNewsData($, page.url());
      data.news = newsData;

      // Extract points table
      const pointsData = this.extractPointsData($);
      data.pointsTable = pointsData;

      return this.sanitizeData(data);
    } catch (error) {
      logger.error('ESPNCricinfo scraping failed:', error);
      return this.getEmptyData(page.url());
    }
  }

  extractMatchData($) {
    try {
      // Try multiple selectors for match title
      const titleSelectors = [
        '.ds-text-title-m.ds-font-bold',
        '.ds-text-title-s.ds-font-bold',
        '.ds-text-tight-m.ds-font-bold',
        '.match-title',
        'h1.ds-text-title-m',
        'h1'
      ];

      let title = '';
      for (const selector of titleSelectors) {
        const el = $(selector).first();
        if (el.length) {
          title = el.text().trim();
          if (title) break;
        }
      }

      // Try multiple selectors for match status
      const statusSelectors = [
        '.ds-text-tight-m.ds-font-regular',
        '.ds-text-tight-s.ds-font-regular',
        '.match-status',
        '.status-text'
      ];

      let status = '';
      for (const selector of statusSelectors) {
        const el = $(selector).first();
        if (el.length) {
          status = el.text().trim();
          if (status) break;
        }
      }

      return {
        title: title || '',
        status: status || '',
        venue: this.extractVenue($),
        series: this.extractSeries($),
      };
    } catch (error) {
      logger.warn('Extract match data failed:', error);
      return {};
    }
  }

  extractVenue($) {
    const selectors = ['.ds-text-tight-s', '.venue', '.match-venue'];
    for (const selector of selectors) {
      const el = $(selector).filter((i, el) => {
        const text = $(el).text().toLowerCase();
        return text.includes('stadium') || text.includes('ground') || text.includes('venue');
      }).first();
      if (el.length) {
        return el.text().trim();
      }
    }
    return '';
  }

  extractSeries($) {
    const selectors = ['.ds-text-tight-s.ds-font-bold', '.series-name', '.ds-text-tight-s'];
    for (const selector of selectors) {
      const el = $(selector).first();
      if (el.length) {
        const text = el.text().trim();
        if (text && (text.includes('Series') || text.includes('Tournament') || text.includes('Cup'))) {
          return text;
        }
      }
    }
    return '';
  }

  extractScoreData($) {
    try {
      const score = {
        batting: { team: '', score: '', overs: '', runRate: '' },
        bowling: { team: '', score: '', overs: '', runRate: '' }
      };

      // Find score elements
      const scoreElements = $('.ds-text-title-m.ds-font-bold, .ds-text-tight-m.ds-font-bold');
      
      // Get all text content
      const texts = scoreElements.map((i, el) => $(el).text().trim()).get();
      
      // Find score patterns like "245/3" or "245-3"
      const scorePattern = /(\d+)\/(\d+)/;
      const oversPattern = /(\d+\.?\d*)\s*(?:ov|overs)/i;
      
      let foundScore = false;
      for (const text of texts) {
        if (scorePattern.test(text)) {
          if (!foundScore) {
            score.batting.score = text;
            foundScore = true;
          } else {
            score.bowling.score = text;
          }
        }
        
        // Check for overs
        const oversMatch = text.match(oversPattern);
        if (oversMatch) {
          if (!score.batting.overs) {
            score.batting.overs = oversMatch[1];
          } else if (!score.bowling.overs) {
            score.bowling.overs = oversMatch[1];
          }
        }
      }

      // Find team names
      const teamElements = $('.ds-text-tight-m.ds-font-bold.ds-capitalize, .team-name, .ds-text-tight-s');
      const teamNames = teamElements.map((i, el) => $(el).text().trim()).get();
      
      // Filter team names (remove common non-team words)
      const filteredTeams = teamNames.filter(t => 
        t && 
        t.length > 1 && 
        !t.match(/^\d/) && 
        !['vs', 'v', 'live', 'score', 'overs', 'run rate'].includes(t.toLowerCase())
      );

      if (filteredTeams.length >= 2) {
        score.batting.team = filteredTeams[0];
        score.bowling.team = filteredTeams[1];
      } else if (filteredTeams.length === 1) {
        score.batting.team = filteredTeams[0];
      }

      // Try to find run rate
      const rrElements = $('.ds-text-tight-m, .run-rate');
      for (const el of rrElements) {
        const text = $(el).text().trim();
        if (text.match(/^\d+\.\d+$/)) {
          if (!score.batting.runRate) {
            score.batting.runRate = text;
          } else if (!score.bowling.runRate) {
            score.bowling.runRate = text;
          }
        }
      }

      return score;
    } catch (error) {
      logger.warn('Extract score data failed:', error);
      return { batting: { team: '', score: '', overs: '', runRate: '' }, bowling: { team: '', score: '', overs: '', runRate: '' } };
    }
  }

  extractBatsmenData($) {
    try {
      const batsmen = [];
      
      // Find batsmen rows
      const rows = $('.ds-flex.ds-flex-col.ds-gap-1, .batsman-row, .ds-flex');
      
      for (const row of rows) {
        const $row = $(row);
        const text = $row.text().trim();
        
        // Check if this is a batsman row (contains name and runs)
        const nameMatch = text.match(/^([A-Za-z\s]+(?:\s+[A-Za-z]+)*)/);
        const runsMatch = text.match(/(\d+)\s*(?:\((\d+)\))?/);
        
        if (nameMatch && runsMatch) {
          const name = nameMatch[1].trim();
          const runs = runsMatch[1] || '0';
          const balls = runsMatch[2] || '0';
          
          if (name && !name.includes('Extras') && !name.includes('Total')) {
            batsmen.push({
              name: name,
              runs: runs,
              balls: balls,
              fours: this.extractFours($row.text()),
              sixes: this.extractSixes($row.text()),
              strikeRate: this.extractStrikeRate($row.text()),
              isOnStrike: $row.find('.on-strike, .batsman-striker').length > 0,
            });
          }
        }
      }

      return batsmen.slice(0, 2); // Return only current batsmen
    } catch (error) {
      logger.warn('Extract batsmen data failed:', error);
      return [];
    }
  }

  extractFours(text) {
    const match = text.match(/(\d+)\s*4s/);
    return match ? match[1] : '0';
  }

  extractSixes(text) {
    const match = text.match(/(\d+)\s*6s/);
    return match ? match[1] : '0';
  }

  extractStrikeRate(text) {
    const match = text.match(/(\d+\.\d+)\s*SR/);
    return match ? match[1] : '0.00';
  }

  extractBowlerData($) {
    try {
      const bowler = { name: '', overs: '', runs: '', wickets: '', economy: '' };
      
      // Find bowler information
      const bowlerTexts = $('.ds-flex.ds-flex-col, .bowler-info').text().trim();
      const lines = bowlerTexts.split('\n').map(l => l.trim()).filter(l => l);
      
      for (const line of lines) {
        // Match pattern: Name Overs-Runs-Wickets Economy
        const match = line.match(/^([A-Za-z\s]+)\s+(\d+\.?\d*)-(\d+)-(\d+)\s+(\d+\.\d+)/);
        if (match) {
          bowler.name = match[1].trim();
          bowler.overs = match[2];
          bowler.runs = match[3];
          bowler.wickets = match[4];
          bowler.economy = match[5];
          break;
        }
        
        // Alternative pattern: Name Overs Runs Wickets Economy
        const altMatch = line.match(/^([A-Za-z\s]+)\s+(\d+\.?\d*)\s+(\d+)\s+(\d+)\s+(\d+\.\d+)/);
        if (altMatch) {
          bowler.name = altMatch[1].trim();
          bowler.overs = altMatch[2];
          bowler.runs = altMatch[3];
          bowler.wickets = altMatch[4];
          bowler.economy = altMatch[5];
          break;
        }
      }
      
      return bowler;
    } catch (error) {
      logger.warn('Extract bowler data failed:', error);
      return { name: '', overs: '', runs: '', wickets: '', economy: '' };
    }
  }

  extractCommentaryData($) {
    try {
      const commentary = [];
      
      // Find commentary items
      const items = $('.ds-px-4, .commentary-item, .ds-flex.ds-flex-col');
      
      for (const item of items) {
        const $item = $(item);
        const text = $item.text().trim();
        
        // Filter for meaningful commentary
        if (text && text.length > 20 && !text.includes('Score') && !text.includes('Overs')) {
          // Check if it's a ball-by-ball comment
          const overMatch = text.match(/^(\d+\.\d+)/);
          const textMatch = text.replace(/^\d+\.\d+\s*/, '');
          
          commentary.push({
            over: overMatch ? overMatch[1] : '',
            ball: '',
            text: textMatch || text,
            type: 'normal',
            timestamp: new Date().toISOString(),
          });
        }
      }

      return commentary.slice(0, 20);
    } catch (error) {
      logger.warn('Extract commentary data failed:', error);
      return [];
    }
  }

  extractFixturesData($, baseUrl) {
    try {
      const fixtures = [];
      
      // Find fixture links
      const links = $('a[href*="/match/"], a[href*="/series/"]');
      
      for (const link of links) {
        const $link = $(link);
        const href = $link.attr('href') || '';
        const text = $link.text().trim();
        
        // Check if it's a fixture (contains "vs" or "v")
        if (text.match(/\s+(vs|v)\s+/i)) {
          const teams = text.split(/\s+(vs|v)\s+/i);
          if (teams.length >= 3) {
            fixtures.push({
              id: this.extractId(href) || `fixture_${Date.now()}`,
              title: text,
              team1: teams[0].trim(),
              team2: teams[2].trim(),
              venue: '',
              matchType: '',
              series: '',
              matchDate: '',
              time: '',
              url: href.startsWith('http') ? href : `${baseUrl}${href}`,
            });
          }
        }
      }

      // Remove duplicates
      const seen = new Set();
      return fixtures.filter(f => {
        const key = f.team1 + f.team2;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 20);
    } catch (error) {
      logger.warn('Extract fixtures data failed:', error);
      return [];
    }
  }

  extractNewsData($, baseUrl) {
    try {
      const news = [];
      
      // Find news links
      const links = $('a[href*="/story/"], a[href*="/news/"]');
      
      for (const link of links) {
        const $link = $(link);
        const href = $link.attr('href') || '';
        const title = $link.text().trim();
        
        if (title && title.length > 10 && !title.includes('//')) {
          news.push({
            id: this.extractId(href) || `news_${Date.now()}`,
            title: title,
            content: title,
            publishedDate: '',
            source: 'ESPNcricinfo',
            category: '',
            imageUrl: '',
            url: href.startsWith('http') ? href : `${baseUrl}${href}`,
          });
        }
      }

      // Remove duplicates
      const seen = new Set();
      return news.filter(n => {
        if (seen.has(n.title)) return false;
        seen.add(n.title);
        return true;
      }).slice(0, 10);
    } catch (error) {
      logger.warn('Extract news data failed:', error);
      return [];
    }
  }

  extractPointsData($) {
    try {
      const standings = [];
      
      // Find points table rows
      const rows = $('.ds-border-b, .points-row, .ds-flex');
      
      for (const row of rows) {
        const $row = $(row);
        const cells = $row.find('.ds-text-tight-m, .ds-text-tight-s');
        const values = cells.map((i, el) => $(el).text().trim()).get().filter(v => v);
        
        if (values.length >= 4) {
          // Try to determine if this is a standings row
          const firstVal = values[0];
          if (firstVal && !firstVal.match(/^\d+$/) && !['Team', 'P', 'W', 'L'].includes(firstVal)) {
            standings.push({
              position: standings.length + 1,
              team: firstVal,
              played: parseInt(values[1]) || 0,
              won: parseInt(values[2]) || 0,
              lost: parseInt(values[3]) || 0,
              tied: parseInt(values[4]) || 0,
              noResult: parseInt(values[5]) || 0,
              points: parseInt(values[values.length - 2]) || 0,
              netRunRate: parseFloat(values[values.length - 1]) || 0,
            });
          }
        }
      }

      return standings;
    } catch (error) {
      logger.warn('Extract points data failed:', error);
      return [];
    }
  }

  extractId(url) {
    const match = url.match(/\/([a-f0-9-]+)(?:\/|$)/);
    return match ? match[1] : null;
  }

  getEmptyData(url) {
    return {
      url: url,
      timestamp: new Date().toISOString(),
      match: { title: '', status: '', venue: '', series: '' },
      score: { batting: { team: '', score: '', overs: '', runRate: '' }, bowling: { team: '', score: '', overs: '', runRate: '' } },
      batsmen: [],
      bowler: { name: '', overs: '', runs: '', wickets: '', economy: '' },
      commentary: [],
      fixtures: [],
      news: [],
      pointsTable: [],
    };
  }
}

module.exports = ESPNCricinfoScraper;