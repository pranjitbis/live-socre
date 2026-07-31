const BaseScraper = require('./base');
const logger = require('../logger');
const { sources, getMockMatches } = require('../config/sources');

class UniversalScraper extends BaseScraper {
  constructor(config = {}) {
    super(config);
    this.currentSourceIndex = 0;
    this.sourceKeys = Object.keys(sources).filter(key => sources[key].enabled);
    this.failedSources = new Set();
  }

  async scrape(page, sourceKey) {
    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await this.delay(2000);
      
      const html = await this.getHtml(page);
      const $ = this.parseHtml(html);
      
      const source = sources[sourceKey];
      const matches = await this.extractMatches($, page.url(), source);
      
      return {
        source: source.name,
        sourceKey: sourceKey,
        matches: matches,
        total: matches.length,
        timestamp: new Date().toISOString(),
        url: page.url(),
        message: matches.length === 0 ? 'No matches found' : `${matches.length} matches found`
      };
    } catch (error) {
      logger.error(`Scraping failed for ${sourceKey}:`, error.message);
      this.failedSources.add(sourceKey);
      throw error;
    }
  }

  async extractMatches($, baseUrl, source) {
    try {
      const matches = [];
      const selectors = source.selectors;
      
      const matchCards = this.findMatchCards($, selectors);
      
      for (const card of matchCards) {
        const matchData = this.extractMatchData($, card, baseUrl, selectors);
        if (matchData && matchData.team1 && matchData.team1.name) {
          matches.push(matchData);
        }
      }

      return matches;
    } catch (error) {
      logger.error('Extract matches failed:', error);
      return [];
    }
  }

  findMatchCards($, selectors) {
    const cards = [];
    const seen = new Set();
    
    const selector = selectors.matchCard || 'div, section, article, li';
    const elements = $(selector);
    
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const $el = $(el);
      const html = $el.html();
      if (!html || seen.has(html)) continue;
      
      const text = $el.text();
      
      const hasStatus = /LIVE|UPCOMING|RESULT|Stumps|Innings Break/i.test(text);
      const hasTeams = /[A-Z]{2,4}\s+(?:vs|v)\s+[A-Z]{2,4}/i.test(text);
      const hasScore = /\d{1,3}\/\d{1,2}/.test(text);
      
      let indicatorCount = 0;
      if (hasStatus) indicatorCount++;
      if (hasTeams) indicatorCount++;
      if (hasScore) indicatorCount++;
      
      if (indicatorCount >= 2) {
        seen.add(html);
        cards.push($el);
      }
    }
    
    return cards;
  }

  extractMatchData($, $card, baseUrl, selectors) {
    try {
      const text = $card.text();
      
      let status = 'UNKNOWN';
      if (/LIVE/i.test(text)) status = 'LIVE';
      else if (/UPCOMING/i.test(text)) status = 'UPCOMING';
      else if (/RESULT/i.test(text)) status = 'RESULT';
      
      const teams = this.extractTeams($, $card, selectors);
      const scores = this.extractScores(text);
      const overs = this.extractOvers(text);
      
      let series = '';
      const seriesMatch = text.match(/([A-Za-z\s]+(?:\d{4})?)(?=\s*(?:UPCOMING|RESULT|LIVE|Stumps))/i);
      if (seriesMatch) {
        series = seriesMatch[1].trim();
      }
      
      let url = '';
      if (selectors.matchLink) {
        const matchLink = $card.find(selectors.matchLink).first();
        if (matchLink.length) {
          const href = matchLink.attr('href');
          url = href && href.startsWith('http') ? href : `${baseUrl}${href}`;
        }
      }
      
      const matchId = this.extractMatchId(url);
      
      if (!teams.team1 && !teams.team2) {
        return null;
      }
      
      return {
        matchId: matchId || `match_${Date.now()}`,
        url: url || '',
        series: series || '',
        status: status,
        format: '',
        venue: '',
        team1: {
          name: teams.team1 || '',
          short: teams.team1Short || '',
          flag: '',
          score: scores.team1 || '',
          overs: overs.team1 || ''
        },
        team2: {
          name: teams.team2 || '',
          short: teams.team2Short || '',
          flag: '',
          score: scores.team2 || '',
          overs: overs.team2 || ''
        },
        result: '',
        winningTeam: '',
        startTime: '',
        startsIn: '',
        tabs: []
      };
    } catch (error) {
      logger.warn('Extract match data failed:', error);
      return null;
    }
  }

  extractTeams($, $card, selectors) {
    try {
      const result = {
        team1: '',
        team1Short: '',
        team2: '',
        team2Short: ''
      };

      const text = $card.text();

      if (selectors.team1 && selectors.team2) {
        const team1El = $card.find(selectors.team1).first();
        const team2El = $card.find(selectors.team2).first();
        if (team1El.length && team2El.length) {
          result.team1 = team1El.text().trim();
          result.team2 = team2El.text().trim();
          result.team1Short = result.team1.substring(0, 3).toUpperCase();
          result.team2Short = result.team2.substring(0, 3).toUpperCase();
          return result;
        }
      }

      const vsMatch = text.match(/([A-Za-z\s]+?)\s+(?:vs|v)\s+([A-Za-z\s]+?)(?=\s+(?:UPCOMING|RESULT|LIVE|\d|\(|$))/i);
      if (vsMatch) {
        result.team1 = vsMatch[1].trim();
        result.team2 = vsMatch[2].trim();
        result.team1Short = result.team1.substring(0, 3).toUpperCase();
        result.team2Short = result.team2.substring(0, 3).toUpperCase();
        return result;
      }

      return result;
    } catch (error) {
      logger.warn('Extract teams failed:', error);
      return { team1: '', team1Short: '', team2: '', team2Short: '' };
    }
  }

  extractScores(text) {
    try {
      const result = { team1: '', team2: '' };
      
      const allScores = text.match(/\b(\d{1,3}(?:\/\d{1,2})?)\b/g);
      if (!allScores) return result;
      
      const validScores = [];
      for (let i = 0; i < allScores.length; i++) {
        const score = allScores[i];
        const num = parseInt(score);
        if (num > 0 && num < 500 && score.length <= 5) {
          if (!score.match(/^(19|20)\d{2}$/)) {
            validScores.push(score);
          }
        }
      }
      
      const uniqueScores = [...new Set(validScores)];
      
      if (uniqueScores.length >= 2) {
        result.team1 = uniqueScores[0];
        result.team2 = uniqueScores[1];
      } else if (uniqueScores.length === 1) {
        result.team1 = uniqueScores[0];
      }
      
      return result;
    } catch (error) {
      return { team1: '', team2: '' };
    }
  }

  extractOvers(text) {
    try {
      const result = { team1: '', team2: '' };
      
      const overs = text.match(/\((\d+\.?\d*)\s*(?:ov|overs?)\)/g);
      if (!overs) return result;
      
      const ovs = [];
      for (let i = 0; i < overs.length; i++) {
        const match = overs[i].match(/(\d+\.?\d*)/);
        if (match) {
          ovs.push(match[1]);
        }
      }
      
      const uniqueOvs = [...new Set(ovs)];
      
      if (uniqueOvs.length >= 2) {
        result.team1 = uniqueOvs[0];
        result.team2 = uniqueOvs[1];
      } else if (uniqueOvs.length === 1) {
        result.team1 = uniqueOvs[0];
      }
      
      return result;
    } catch (error) {
      return { team1: '', team2: '' };
    }
  }

  extractMatchId(url) {
    if (!url) return '';
    const match = url.match(/\/match\/([a-f0-9-]+)/i) ||
                  url.match(/\/cricket-match\/([a-f0-9-]+)/i) ||
                  url.match(/\/([a-f0-9-]{8,})(?:\/|$)/i);
    return match ? match[1] : '';
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getNextSource() {
    // Get enabled sources that haven't failed
    const available = this.sourceKeys.filter(key => !this.failedSources.has(key));
    
    if (available.length === 0) {
      // Reset failed sources and try again
      this.failedSources.clear();
      return this.sourceKeys[0];
    }
    
    // Rotate through available sources
    const sourceKey = available[this.currentSourceIndex % available.length];
    this.currentSourceIndex++;
    return sourceKey;
  }

  resetFailedSources() {
    this.failedSources.clear();
    this.currentSourceIndex = 0;
  }
}

module.exports = UniversalScraper;