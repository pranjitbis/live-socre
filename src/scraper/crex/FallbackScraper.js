// src/scraper/crex/FallbackScraper.js
const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../../logger');

class FallbackScraper {
  constructor() {
    this.baseUrl = 'https://crex.com';
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }

  async discoverLiveMatches() {
    try {
      logger.info('🔍 Discovering live matches via HTTP...');
      
      const response = await axios.get(`${this.baseUrl}/cricket-live-score`, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
        },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);
      const matches = [];

      // Find all team tabs or match containers
      const teamTabs = $('.team-tab, .team-innig, .score-card, .match-card, .live-card, .c-2');
      
      if (teamTabs.length === 0) {
        logger.warn('No team tabs found, trying alternative selectors...');
        // Try to find team names from any elements
        const teamNames = [];
        $('.team-name, h2 .team-name, .name, .team').each((i, el) => {
          const name = $(el).text().trim();
          if (name && name.length > 0 && name.length < 20) {
            teamNames.push(name);
          }
        });
        
        // Try to find scores
        const scores = [];
        $('.score-over, .runs, .score, .team-score').each((i, el) => {
          const text = $(el).text().trim();
          const match = text.match(/(\d+)\s*[-/]\s*(\d+)/);
          if (match) {
            scores.push({ runs: match[1], wickets: match[2] });
          }
        });
        
        if (teamNames.length >= 2) {
          matches.push({
            url: `${this.baseUrl}/cricket-live-score`,
            status: 'LIVE',
            team1: {
              name: teamNames[0],
              short: teamNames[0].substring(0, 3).toUpperCase(),
              flag: '',
              score: scores[0]?.runs || '',
              wickets: scores[0]?.wickets || '',
              overs: '',
            },
            team2: {
              name: teamNames[1],
              short: teamNames[1].substring(0, 3).toUpperCase(),
              flag: '',
              score: scores[1]?.runs || '',
              wickets: scores[1]?.wickets || '',
              overs: '',
            },
            series: '',
          });
        }
      } else {
        // Process team tabs
        for (let i = 0; i < teamTabs.length; i += 2) {
          if (i + 1 < teamTabs.length) {
            const homeEl = teamTabs.eq(i);
            const awayEl = teamTabs.eq(i + 1);
            
            const homeName = homeEl.find('.team-name, h2 .team-name, .name').first().text().trim();
            const awayName = awayEl.find('.team-name, h2 .team-name, .name').first().text().trim();
            
            if (homeName && awayName && homeName.length > 0 && awayName.length > 0) {
              const homeScoreText = homeEl.find('.score-over, .runs, .score').first().text().trim();
              const awayScoreText = awayEl.find('.score-over, .runs, .score').first().text().trim();
              
              const homeScoreMatch = homeScoreText.match(/(\d+)\s*[-/]\s*(\d+)/);
              const awayScoreMatch = awayScoreText.match(/(\d+)\s*[-/]\s*(\d+)/);
              
              const homeOverMatch = homeScoreText.match(/\(?\s*(\d+\.?\d*)\s*[bB]?\)?/);
              const awayOverMatch = awayScoreText.match(/\(?\s*(\d+\.?\d*)\s*[bB]?\)?/);
              
              let url = '';
              const link = homeEl.find('a[href*="cricket-live-score"]');
              if (link.length > 0) {
                const href = link.attr('href');
                if (href) {
                  url = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
                }
              }
              
              matches.push({
                url: url || `${this.baseUrl}/cricket-live-score`,
                status: 'LIVE',
                team1: {
                  name: homeName,
                  short: homeName.substring(0, 3).toUpperCase(),
                  flag: '',
                  score: homeScoreMatch ? homeScoreMatch[1] : '',
                  wickets: homeScoreMatch ? homeScoreMatch[2] : '',
                  overs: homeOverMatch ? homeOverMatch[1] : '',
                },
                team2: {
                  name: awayName,
                  short: awayName.substring(0, 3).toUpperCase(),
                  flag: '',
                  score: awayScoreMatch ? awayScoreMatch[1] : '',
                  wickets: awayScoreMatch ? awayScoreMatch[2] : '',
                  overs: awayOverMatch ? awayOverMatch[1] : '',
                },
                series: '',
              });
            }
          }
        }
      }

      logger.info(`✅ Found ${matches.length} matches via HTTP`);
      return matches;
      
    } catch (error) {
      logger.error(`❌ HTTP scraper error: ${error.message}`);
      return [];
    }
  }

  async getMatchDetails(match) {
    try {
      logger.info(`📡 Fetching match details for ${match.team1.name} vs ${match.team2.name}`);
      
      const response = await axios.get(match.url, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);
      
      // Extract scoreboard
      const scoreboard = {
        batting_team: { 
          name: match.team1.name, 
          score: match.team1.score || '0', 
          runs: parseInt(match.team1.score) || 0, 
          wickets: parseInt(match.team1.wickets) || 0, 
          overs: match.team1.overs || '' 
        },
        bowling_team: { 
          name: match.team2.name, 
          score: match.team2.score || '0', 
          runs: parseInt(match.team2.score) || 0, 
          wickets: parseInt(match.team2.wickets) || 0, 
          overs: match.team2.overs || '' 
        },
        target: null,
        crr: null,
        rrr: null,
      };

      // Extract score from page
      $('.score-over, .runs, .score').each((i, el) => {
        const text = $(el).text().trim();
        const scoreMatch = text.match(/(\d+)\s*[-/]\s*(\d+)/);
        if (scoreMatch) {
          const runs = parseInt(scoreMatch[1]);
          const wickets = parseInt(scoreMatch[2]);
          if (i === 0) {
            scoreboard.batting_team.runs = runs;
            scoreboard.batting_team.wickets = wickets;
            scoreboard.batting_team.score = `${runs}-${wickets}`;
          } else if (i === 1) {
            scoreboard.bowling_team.runs = runs;
            scoreboard.bowling_team.wickets = wickets;
            scoreboard.bowling_team.score = `${runs}-${wickets}`;
          }
        }
        
        const overMatch = text.match(/\(?\s*(\d+\.?\d*)\s*[bB]?\)?/);
        if (overMatch) {
          if (i === 0) {
            scoreboard.batting_team.overs = overMatch[1];
          } else if (i === 1) {
            scoreboard.bowling_team.overs = overMatch[1];
          }
        }
      });

      // Extract target
      $('.target, .match-target, .chase-target').each((i, el) => {
        const text = $(el).text().trim();
        const match = text.match(/(\d+)/);
        if (match) scoreboard.target = parseInt(match[1]);
      });

      // Extract CRR/RRR
      $('.crr, .current-run-rate').each((i, el) => {
        const text = $(el).text().trim();
        const match = text.match(/(\d+\.\d+)/);
        if (match) scoreboard.crr = parseFloat(match[1]);
      });
      $('.rrr, .required-run-rate').each((i, el) => {
        const text = $(el).text().trim();
        const match = text.match(/(\d+\.\d+)/);
        if (match) scoreboard.rrr = parseFloat(match[1]);
      });

      // Extract batsmen
      const batsmen = [];
      $('.batsmen-info-wrapper, .player-card-wrapper, .player-card, .batsman-item').each((i, el) => {
        const name = $(el).find('.batsmen-name, .name, .player-name, a[href*="/player/"] p').first().text().trim();
        if (name && batsmen.length < 2) {
          const stats = $(el).find('.batsmen-score, .score, .runs').text().trim();
          const runsMatch = stats.match(/(\d+)/);
          const ballsMatch = stats.match(/\((\d+)\)/);
          batsmen.push({
            name: name,
            runs: runsMatch ? runsMatch[1] : '0',
            balls: ballsMatch ? ballsMatch[1] : '0',
            is_striker: i === 0,
          });
        }
      });

      // Extract bowler
      let bowler = { name: '', runs: null, wickets: null, balls: null };
      $('.batsmen-score.bowler, .bowling-figures, .bowler-info').each((i, el) => {
        const text = $(el).text().trim();
        const figuresMatch = text.match(/(\d+)\s*[-/]\s*(\d+)\s*\(?\s*(\d+)\s*[bB]?\)?/);
        if (figuresMatch) {
          bowler.wickets = parseInt(figuresMatch[1]);
          bowler.runs = parseInt(figuresMatch[2]);
          bowler.balls = parseInt(figuresMatch[3]);
          const nameEl = $(el).closest('.player-card, .player-info').find('.name, .player-name');
          bowler.name = nameEl.text().trim() || 'Bowler';
        }
      });

      // Extract overs timeline
      const overs = [];
      $('.overs-slide, .over-item, .overs-container .content').each((i, el) => {
        const balls = [];
        $(el).find('.over-ball, .ball, .ml-o-b-1').each((j, b) => {
          let val = $(b).text().trim();
          if (val) {
            if (val === 'W' || val === 'w') val = 'W';
            else if (val === 'wd') val = 'wd';
            else if (val === 'nb') val = 'nb';
            balls.push(val);
          }
        });
        if (balls.length > 0) {
          const overNum = $(el).find('.over-number, .over-title').text().trim();
          overs.push({
            over: overNum || String(i + 1),
            balls: balls,
            total: $(el).find('.total, .over-total').text().trim() || '',
          });
        }
      });

      // Extract commentary
      const commentary = [];
      const font1s = $('.font1');
      const font3s = $('.font3');
      
      const font1Texts = font1s.map((i, el) => $(el).text().trim()).get();
      const font3Texts = font3s.map((i, el) => $(el).text().trim()).get();
      
      for (let i = 0; i < Math.max(font1Texts.length, font3Texts.length); i++) {
        const ball = i < font1Texts.length ? font1Texts[i] : '';
        const text = i < font3Texts.length ? font3Texts[i] : '';
        if (ball || text) {
          commentary.push({ ball, text });
        }
      }

      // Extract toss
      let tossStatus = 'Not Started';
      $('.toss-wrap p, .toss-wrap, [class*="toss"] p').each((i, el) => {
        const text = $(el).text().trim();
        if (text.includes('won the toss')) {
          tossStatus = text;
        }
      });

      // Extract venue
      let venue = 'TBD';
      $('.venue, .match-venue, .venue-name, .location').each((i, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 3) {
          venue = text;
          return false;
        }
      });

      // Extract series
      let series = 'Live Match';
      $('.series-name, .match-series, .series-title, .tournament').each((i, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 0) {
          series = text;
          return false;
        }
      });

      return {
        match_id: `fallback_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        match_url: match.url,
        series: { 
          name: series, 
          short_name: series.substring(0, 20), 
          season: new Date().getFullYear().toString() 
        },
        match: { 
          number: 'Match', 
          format: 'T20', 
          status: 'Live', 
          start_time: new Date().toISOString() 
        },
        venue: { name: venue },
        teams: {
          home: { 
            name: match.team1.name, 
            short_name: match.team1.short, 
            logo: '' 
          },
          away: { 
            name: match.team2.name, 
            short_name: match.team2.short, 
            logo: '' 
          },
        },
        scoreboard: scoreboard,
        current_batsmen: batsmen,
        current_bowler: bowler,
        overs: overs,
        commentary: commentary,
        prediction: { home_probability: null, away_probability: null },
        toss: { status: tossStatus },
        result: null,
        weather: null,
        _lastUpdated: new Date().toISOString(),
        _updateCount: 1,
      };
      
    } catch (error) {
      logger.error(`❌ Match details error: ${error.message}`);
      return this.createFallbackMatch(match);
    }
  }

  createFallbackMatch(match) {
    return {
      match_id: `fallback_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      match_url: match.url,
      series: { name: match.series || 'Live Match', short_name: '', season: new Date().getFullYear().toString() },
      match: { number: 'Match', format: 'T20', status: 'Live', start_time: new Date().toISOString() },
      venue: { name: 'TBD' },
      teams: {
        home: { name: match.team1.name, short_name: match.team1.short, logo: '' },
        away: { name: match.team2.name, short_name: match.team2.short, logo: '' },
      },
      scoreboard: {
        batting_team: { 
          name: match.team1.name, 
          score: match.team1.score || '0', 
          runs: parseInt(match.team1.score) || 0, 
          wickets: parseInt(match.team1.wickets) || 0, 
          overs: match.team1.overs || '' 
        },
        bowling_team: { 
          name: match.team2.name, 
          score: match.team2.score || '0', 
          runs: parseInt(match.team2.score) || 0, 
          wickets: parseInt(match.team2.wickets) || 0, 
          overs: match.team2.overs || '' 
        },
        target: null,
        crr: null,
        rrr: null,
      },
      current_batsmen: [],
      current_bowler: { name: '', runs: null, wickets: null, balls: null },
      overs: [],
      commentary: [],
      prediction: { home_probability: null, away_probability: null },
      toss: { status: 'Not Started' },
      result: null,
      weather: null,
      _lastUpdated: new Date().toISOString(),
      _updateCount: 1,
    };
  }
}

module.exports = FallbackScraper;