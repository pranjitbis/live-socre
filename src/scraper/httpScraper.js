// src/scraper/httpScraper.js
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const logger = require('../logger');

class HttpScraper {
  constructor() {
    this.timeout = 15000;
    this.maxRetries = 3;
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    ];
    this.cookies = [];
    this.invalidTeamNames = ['URL', 'ODI', 'T20', 'TEST', 'IPL', 'MLC', 'LPL', 'BAN', 'ZIM', 'ENG', 'IND', 'NZ', 'WI', 'USA', 'SA', 'PAK', 'SL', 'AUS', 'AFG', 'IRE', 'NED', 'OMA', 'PNG', 'SCOT', 'UAE', 'RESULT', 'LIVE', 'UPCOMING', 'STUMPS', 'TEA', 'LUNCH', 'See all', 'PRE', 'POST', 'ICC', 'RUN', 'WIDE', 'CMS', 'FILM', 'AFP', 'DARK', 'GTM'];
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  getHeaders() {
    return {
      'User-Agent': this.getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Pragma': 'no-cache',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Cookie': this.cookies.join('; '),
    };
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  hashUrl(url) {
    return crypto.createHash('md5').update(url).digest('hex').substring(0, 16);
  }

  async fetchUrl(url, retryCount = 0) {
    try {
      logger.debug(`Fetching: ${url}`);
      
      // Set initial cookies
      if (this.cookies.length === 0) {
        this.cookies = [
          'geoCountry=US',
          'geoRegion=US-CA',
          'ak_bmsc=test',
          'cookieconsent_status=allow',
        ];
      }
      
      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: this.getHeaders(),
        maxRedirects: 3,
        decompress: true,
        withCredentials: true,
      });
      
      // Extract cookies from response
      if (response.headers['set-cookie']) {
        const setCookies = response.headers['set-cookie'];
        for (const cookie of setCookies) {
          const parts = cookie.split(';')[0].split('=');
          if (parts.length === 2) {
            const existing = this.cookies.findIndex(c => c.startsWith(parts[0] + '='));
            if (existing !== -1) {
              this.cookies[existing] = cookie.split(';')[0];
            } else {
              this.cookies.push(cookie.split(';')[0]);
            }
          }
        }
      }
      
      return response;
    } catch (error) {
      if (retryCount < this.maxRetries) {
        const backoffDelay = Math.min(3000 * Math.pow(2, retryCount), 10000);
        logger.warn(`Retry ${retryCount + 1}/${this.maxRetries} for ${url} in ${backoffDelay}ms`);
        await this.delay(backoffDelay);
        return this.fetchUrl(url, retryCount + 1);
      }
      throw error;
    }
  }

  async scrapeLive() {
    return this.scrapeUrl('https://www.espncricinfo.com/live-cricket-score', 'live');
  }

  async scrapeResults() {
    return this.scrapeUrl('https://www.espncricinfo.com/results', 'results');
  }

  async scrapeFixtures() {
    const urls = [
      'https://www.espncricinfo.com/ci/engine/match/index.html',
      'https://www.espncricinfo.com/live-cricket-score',
    ];
    
    for (const url of urls) {
      try {
        const result = await this.scrapeUrl(url, 'fixtures');
        if (result.matches && result.matches.length > 0) {
          return result;
        }
      } catch (error) {
        logger.warn(`Fixtures URL failed: ${url}`, error.message);
      }
    }
    
    return {
      source: 'espncricinfo',
      type: 'fixtures',
      matches: [],
      total: 0,
      timestamp: new Date().toISOString(),
      error: 'No fixtures found',
    };
  }

  async scrapeUrl(url, type) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.info(`Scraping ${type} (attempt ${attempt}/${this.maxRetries}): ${url}`);

        const response = await this.fetchUrl(url);
        
        if (response.status === 200) {
          const html = response.data;
          
          // Check for consent page
          if (html.includes('Privacy Preference Center') || html.includes('cookie')) {
            logger.warn('Consent page detected, skipping...');
            return {
              source: 'espncricinfo',
              type: type,
              matches: [],
              total: 0,
              timestamp: new Date().toISOString(),
              error: 'Consent page detected',
            };
          }
          
          if (html.includes('page does not exist') || html.includes('something went wrong')) {
            logger.warn(`Page ${url} does not exist`);
            return {
              source: 'espncricinfo',
              type: type,
              matches: [],
              total: 0,
              timestamp: new Date().toISOString(),
              error: 'Page not found',
            };
          }

          const $ = cheerio.load(html);
          const matches = this.extractMatches($, type);
          
          // Remove duplicates and validate
          const validatedMatches = this.validateAndCleanMatches(matches);
          
          return {
            source: 'espncricinfo',
            type: type,
            matches: validatedMatches,
            total: validatedMatches.length,
            timestamp: new Date().toISOString(),
          };
        }
        
        logger.warn(`${type} returned status ${response.status} (attempt ${attempt})`);
        lastError = `HTTP ${response.status}`;
        
        if (attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          logger.info(`Waiting ${delay}ms before retry...`);
          await this.delay(delay);
        }
        
      } catch (error) {
        lastError = error.message;
        logger.warn(`Scraping attempt ${attempt} for ${type} failed:`, error.message);
        
        if (attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt) * 2000;
          logger.info(`Waiting ${delay}ms before retry...`);
          await this.delay(delay);
        }
      }
    }

    logger.error(`All scraping attempts for ${type} failed:`, lastError);
    return {
      source: 'espncricinfo',
      type: type,
      matches: [],
      total: 0,
      timestamp: new Date().toISOString(),
      error: lastError || 'All retry attempts failed',
    };
  }

  extractMatches($, type) {
    try {
      const matches = [];
      const processedCards = new Set();
      
      // Get all divs that might contain match data
      const allDivs = $('div');
      
      for (let i = 0; i < allDivs.length; i++) {
        const el = allDivs[i];
        const $el = $(el);
        const html = $el.html();
        if (!html || processedCards.has(html)) continue;
        
        const text = $el.text();
        if (!text || text.length < 20 || text.length > 3000) continue;
        
        // Check if this is a match card
        const hasStatus = /LIVE|UPCOMING|RESULT|Stumps|Innings Break/i.test(text);
        const hasTeams = /[A-Z]{2,4}\s+(?:vs|v)\s+[A-Z]{2,4}/i.test(text);
        const hasScore = /\d{1,3}\/\d{1,2}/.test(text);
        const hasOvers = /\((\d+\.?\d*)\s*(?:ov|overs?)\)/.test(text);
        const hasDate = /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(text);
        const hasTime = /\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)/.test(text);
        
        let indicators = 0;
        if (hasStatus) indicators++;
        if (hasTeams) indicators++;
        if (hasScore) indicators++;
        if (hasOvers) indicators++;
        if (hasDate) indicators++;
        if (hasTime) indicators++;
        
        const isNav = $el.closest('nav').length > 0 || 
                     $el.closest('header').length > 0 ||
                     $el.closest('footer').length > 0 ||
                     $el.closest('aside').length > 0 ||
                     $el.closest('.advertisement').length > 0;
        
        let minIndicators = 2;
        if (type === 'fixtures') minIndicators = 1;
        
        if (indicators >= minIndicators && !isNav) {
          processedCards.add(html);
          const matchData = this.extractMatchData($el, type);
          if (matchData && this.isValidMatchData(matchData)) {
            matches.push(matchData);
          }
        }
      }
      
      return matches;
      
    } catch (error) {
      logger.error('Extract matches failed:', error.message);
      return [];
    }
  }

  extractMatchData($card, type) {
    try {
      const text = $card.text();
      if (!text || text.length < 10) return null;
      
      // Extract status
      const status = this.extractStatus(text, type);
      
      // Extract URL
      const url = this.extractMatchUrl($card);
      
      // Extract match ID
      const matchId = url ? this.hashUrl(url) : null;
      
      // Extract series
      const series = this.extractSeries($card, text);
      
      // Extract teams
      const teams = this.extractTeams($card, text);
      
      if (!teams.team1 || !teams.team2) {
        const teamMatch = text.match(/([A-Za-z\s]+)\s+vs\s+([A-Za-z\s]+)/i);
        if (teamMatch) {
          teams.team1 = teamMatch[1].trim();
          teams.team2 = teamMatch[2].trim();
          teams.team1Short = this.getTeamShortName(teams.team1);
          teams.team2Short = this.getTeamShortName(teams.team2);
        }
      }
      
      if (!teams.team1 || !teams.team2) return null;
      
      // Validate team names
      if (this.invalidTeamNames.includes(teams.team1.toUpperCase()) || 
          this.invalidTeamNames.includes(teams.team2.toUpperCase())) {
        return null;
      }
      
      // Extract scores
      const scores = this.extractScores(text);
      
      // Extract overs
      const overs = this.extractOvers(text);
      
      // Extract venue
      const venue = this.extractVenue(text);
      
      // Extract result
      const result = this.extractResult(text);
      
      // Extract winning team
      const winningTeam = this.extractWinningTeam(text);
      
      // Extract start time
      const startTime = this.extractStartTime(text);
      
      // Extract starts in
      const startsIn = this.extractStartsIn(text);
      
      // Extract format
      const format = this.extractFormat(text);
      
      // Extract tabs
      const tabs = this.extractTabs($card, text);
      
      // Extract flags
      const flags = this.extractFlags($card);
      
      return {
        matchId: matchId || '',
        url: url || '',
        series: series || '',
        status: status,
        format: format || '',
        venue: venue || '',
        team1: {
          name: teams.team1 || '',
          short: teams.team1Short || this.getTeamShortName(teams.team1),
          flag: flags.team1 || '',
          score: scores.team1 || '',
          overs: overs.team1 || '',
        },
        team2: {
          name: teams.team2 || '',
          short: teams.team2Short || this.getTeamShortName(teams.team2),
          flag: flags.team2 || '',
          score: scores.team2 || '',
          overs: overs.team2 || '',
        },
        result: result || '',
        winningTeam: winningTeam || '',
        startTime: startTime || '',
        startsIn: startsIn || '',
        tabs: tabs || [],
      };
      
    } catch (error) {
      return null;
    }
  }

  extractStatus(text, type) {
    if (type === 'results') return 'RESULT';
    if (type === 'fixtures') {
      if (/LIVE/i.test(text)) return 'LIVE';
      if (/RESULT/i.test(text)) return 'RESULT';
      return 'UPCOMING';
    }
    
    if (/LIVE/i.test(text) && !/RESULT/i.test(text)) return 'LIVE';
    if (/UPCOMING/i.test(text)) return 'UPCOMING';
    if (/RESULT/i.test(text) || /won by/i.test(text)) return 'RESULT';
    if (/Stumps/i.test(text)) return 'STUMPS';
    if (/TEA/i.test(text) && !/STEA/i.test(text)) return 'TEA';
    if (/LUNCH/i.test(text)) return 'LUNCH';
    if (/ABANDONED/i.test(text)) return 'ABANDONED';
    if (/Rain\s+Delay/i.test(text)) return 'RAIN DELAY';
    if (/No\s+Result/i.test(text)) return 'NO RESULT';
    return 'UNKNOWN';
  }

  extractMatchUrl($card) {
    const selectors = [
      'a[href*="/match/"]',
      'a[href*="/cricket-match/"]',
      'a[href*="/live-cricket-score/"]',
    ];
    
    for (const selector of selectors) {
      try {
        const link = $card.find(selector).first();
        if (link && link.length) {
          const href = link.attr('href');
          if (href) {
            if (href.startsWith('/')) {
              return `https://www.espncricinfo.com${href}`;
            }
            return href;
          }
        }
      } catch (e) {}
    }
    
    return '';
  }

  extractSeries($card, text) {
    try {
      const seriesLink = $card.find('a[href*="/cricket-series/"], a[href*="/series/"]').first();
      if (seriesLink && seriesLink.length) {
        let seriesText = seriesLink.text().trim();
        if (seriesText) {
          seriesText = this.cleanSeriesName(seriesText);
          if (seriesText && seriesText.length > 3) {
            return seriesText;
          }
        }
      }
    } catch (e) {}
    
    const statusMatch = text.match(/(UPCOMING|RESULT|LIVE|Stumps|Innings Break)/i);
    if (statusMatch) {
      const before = text.substring(0, statusMatch.index).trim();
      let clean = before
        .replace(/^\d+\.\s*/, '')
        .replace(/^[•●]\s*/, '')
        .replace(/See all$/i, '')
        .replace(/Live$/i, '')
        .replace(/Result$/i, '')
        .trim();
      
      if (clean && clean.length > 3 && clean.length < 100) {
        return this.cleanSeriesName(clean);
      }
    }
    
    return '';
  }

  cleanSeriesName(series) {
    if (!series) return '';
    return series
      .replace(/See all$/i, '')
      .replace(/Live$/i, '')
      .replace(/Result$/i, '')
      .replace(/•/g, '')
      .replace(/●/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  extractTeams($card, text) {
    const result = {
      team1: '',
      team1Short: '',
      team1Flag: '',
      team2: '',
      team2Short: '',
      team2Flag: ''
    };

    // Try flags
    const flags = $card.find('img[alt*="Flag"], img[alt]');
    const flagData = [];
    
    for (let i = 0; i < flags.length; i++) {
      const flagEl = flags[i];
      const $flag = $(flagEl);
      const alt = $flag.attr('alt') || '';
      const src = $flag.attr('src') || '';
      if (alt && (alt.includes('Flag') || alt.length > 3)) {
        const name = alt.replace(/\s*Flag/i, '').trim();
        if (name && name.length > 1) {
          flagData.push({ name, src });
        }
      }
    }
    
    if (flagData.length >= 2) {
      result.team1 = flagData[0].name;
      result.team2 = flagData[1].name;
      result.team1Flag = flagData[0].src || '';
      result.team2Flag = flagData[1].src || '';
      result.team1Short = result.team1.substring(0, 3).toUpperCase();
      result.team2Short = result.team2.substring(0, 3).toUpperCase();
      return result;
    }

    // Try "vs" pattern
    const vsMatch = text.match(/([A-Za-z\s&]+?)\s+(?:vs|v)\s+([A-Za-z\s&]+?)(?=\s+(?:UPCOMING|RESULT|LIVE|Stumps|\d|\(|$))/i);
    if (vsMatch) {
      let team1 = vsMatch[1].trim().replace(/\s+\(.*?\)/g, '').trim();
      let team2 = vsMatch[2].trim().replace(/\s+\(.*?\)/g, '').trim();
      
      if (this.isValidTeamName(team1) && this.isValidTeamName(team2)) {
        result.team1 = this.getFullTeamName(team1);
        result.team2 = this.getFullTeamName(team2);
        result.team1Short = result.team1.substring(0, 3).toUpperCase();
        result.team2Short = result.team2.substring(0, 3).toUpperCase();
        return result;
      }
    }

    // Try abbreviations
    const abbrs = text.match(/\b([A-Z]{2,4})\b/g);
    if (abbrs && abbrs.length >= 2) {
      const valid = abbrs.filter(a => this.isValidTeamName(a) && !this.invalidTeamNames.includes(a.toUpperCase()));
      if (valid.length >= 2) {
        result.team1Short = valid[0];
        result.team2Short = valid[1];
        result.team1 = this.getFullTeamName(valid[0]);
        result.team2 = this.getFullTeamName(valid[1]);
        return result;
      }
    }

    return result;
  }

  isValidTeamName(name) {
    if (!name) return false;
    const upper = name.toUpperCase();
    return !this.invalidTeamNames.includes(upper) && name.length > 1;
  }

  getFullTeamName(abbr) {
    const teamMap = {
      'ENG': 'England', 'IND': 'India', 'AUS': 'Australia', 'NZ': 'New Zealand',
      'WI': 'West Indies', 'PAK': 'Pakistan', 'SL': 'Sri Lanka', 'SA': 'South Africa',
      'BAN': 'Bangladesh', 'ZIM': 'Zimbabwe', 'AFG': 'Afghanistan', 'IRE': 'Ireland',
      'NED': 'Netherlands', 'OMA': 'Oman', 'PNG': 'Papua New Guinea', 'SCOT': 'Scotland',
      'UAE': 'UAE', 'USA': 'USA',
    };
    return teamMap[abbr.toUpperCase()] || abbr;
  }

  getTeamShortName(name) {
    const reverseMap = {
      'England': 'ENG', 'India': 'IND', 'Australia': 'AUS', 'New Zealand': 'NZ',
      'West Indies': 'WI', 'Pakistan': 'PAK', 'Sri Lanka': 'SL', 'South Africa': 'SA',
      'Bangladesh': 'BAN', 'Zimbabwe': 'ZIM', 'Afghanistan': 'AFG', 'Ireland': 'IRE',
      'Netherlands': 'NED', 'Oman': 'OMA', 'Papua New Guinea': 'PNG', 'Scotland': 'SCOT',
      'UAE': 'UAE', 'USA': 'USA',
    };
    return reverseMap[name] || name.substring(0, 3).toUpperCase();
  }

  extractScores(text) {
    const result = { team1: '', team2: '' };
    
    const scores = text.match(/\b(\d{1,3}\/\d{1,2})\b/g);
    if (scores) {
      const unique = [...new Set(scores)];
      if (unique.length >= 2) {
        result.team1 = unique[0];
        result.team2 = unique[1];
        return result;
      } else if (unique.length === 1) {
        result.team1 = unique[0];
        return result;
      }
    }
    
    return result;
  }

  extractOvers(text) {
    const result = { team1: '', team2: '' };
    
    const overs = text.match(/\((\d+\.?\d*)\s*(?:ov|overs?)\)/g);
    if (overs) {
      const ovs = overs.map(o => {
        const match = o.match(/(\d+\.?\d*)/);
        return match ? match[1] : '';
      }).filter(o => o);
      const unique = [...new Set(ovs)];
      if (unique.length >= 2) {
        result.team1 = unique[0];
        result.team2 = unique[1];
        return result;
      } else if (unique.length === 1) {
        result.team1 = unique[0];
        return result;
      }
    }
    
    return result;
  }

  extractVenue(text) {
    const patterns = [
      /([A-Za-z\s]+(?:Stadium|Ground|Park|Centre|Venue))/i,
      /at\s+([A-Za-z\s]+)(?:,|\.|\s|$)/i,
      /Venue:\s*([A-Za-z\s]+)/i,
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const venue = match[1].trim();
        if (venue && !venue.includes('Score') && !venue.includes('Live') && 
            !venue.includes('Cricket') && venue.length > 3) {
          return venue;
        }
      }
    }
    
    return '';
  }

  extractResult(text) {
    const match = text.match(/([A-Za-z\s]+)\s+won by\s+(\d+)\s+(wickets|runs)/i);
    if (match) return match[0];
    if (/Match\s+Tied/i.test(text)) return 'Match Tied';
    if (/No\s+Result/i.test(text)) return 'No Result';
    if (/Abandoned/i.test(text)) return 'Abandoned';
    if (/Drawn/i.test(text)) return 'Match Drawn';
    return '';
  }

  extractWinningTeam(text) {
    const match = text.match(/([A-Za-z\s]+)\s+won by/i);
    if (match) {
      let team = match[1].trim();
      team = team.replace(/^[•●]\s*/, '').trim();
      if (this.isValidTeamName(team)) {
        return this.getFullTeamName(team);
      }
    }
    return '';
  }

  extractStartTime(text) {
    const timeMatch = text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/);
    if (timeMatch) return timeMatch[1];
    
    const dateMatch = text.match(/(Today|Tomorrow|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/i);
    if (dateMatch) return dateMatch[1];
    
    return '';
  }

  extractStartsIn(text) {
    const match = text.match(/Match starts in\s+([\d\s]+(?:hrs|mins|hours|minutes))/i);
    if (match) return match[1].trim();
    return '';
  }

  extractFormat(text) {
    const formats = ['T20', 'ODI', 'Test', 'IPL', 'MLC', 'LPL', 'World Cup', 'Champions Trophy'];
    for (const format of formats) {
      if (text.includes(format)) {
        return format;
      }
    }
    return '';
  }

  extractTabs($card, text) {
    const tabs = [];
    const tabPatterns = ['Scorecard', 'Commentary', 'Squads', 'Preview', 'News', 'Videos', 'Schedule', 'Table'];
    
    for (const tab of tabPatterns) {
      if (text.includes(tab)) {
        tabs.push(tab);
      }
    }
    
    try {
      const links = $card.find('a[href]');
      for (let i = 0; i < links.length; i++) {
        const linkEl = links[i];
        const $link = $(linkEl);
        const linkText = $link.text().trim().toLowerCase();
        const href = $link.attr('href') || '';
        
        for (const tab of tabPatterns) {
          if ((linkText.includes(tab.toLowerCase()) || href.includes(tab.toLowerCase())) && !tabs.includes(tab)) {
            tabs.push(tab);
          }
        }
      }
    } catch (e) {}
    
    return tabs;
  }

  extractFlags($card) {
    const result = { team1: '', team2: '' };
    
    try {
      const flags = $card.find('img[alt*="Flag"], img[alt]');
      const flagData = [];
      
      for (let i = 0; i < flags.length; i++) {
        const flagEl = flags[i];
        const $flag = $(flagEl);
        const alt = $flag.attr('alt') || '';
        const src = $flag.attr('src') || $flag.attr('data-src') || '';
        
        if (alt && (alt.includes('Flag') || alt.length > 3)) {
          let name = alt.replace(/\s*Flag/i, '').trim();
          if (name && name.length > 1) {
            let imageUrl = src;
            if (src && !src.startsWith('http')) {
              imageUrl = `https://www.espncricinfo.com${src}`;
            }
            flagData.push({ name, src: imageUrl });
          }
        }
      }
      
      if (flagData.length >= 2) {
        result.team1 = flagData[0].src;
        result.team2 = flagData[1].src;
      }
    } catch (e) {}
    
    return result;
  }

  isValidMatchData(matchData) {
    if (!matchData) return false;
    if (!matchData.team1?.name && !matchData.team2?.name) return false;
    
    const team1Name = matchData.team1?.name || '';
    const team2Name = matchData.team2?.name || '';
    
    if (this.invalidTeamNames.includes(team1Name.toUpperCase()) || 
        this.invalidTeamNames.includes(team2Name.toUpperCase())) {
      return false;
    }
    
    if (team1Name.length < 2 || team2Name.length < 2) return false;
    if (matchData.status === 'UNKNOWN') return false;
    
    return true;
  }

  validateAndCleanMatches(matches) {
    const validated = [];
    const seen = new Map();
    
    for (const match of matches) {
      if (!this.isValidMatchData(match)) continue;
      
      if (match.series) {
        match.series = this.cleanSeriesName(match.series);
      }
      
      if (!match.matchId) {
        match.matchId = match.url ? this.hashUrl(match.url) : null;
        if (!match.matchId) continue;
      }
      
      if (match.team1?.name) {
        const fullName = this.getFullTeamName(match.team1.name);
        if (fullName && !this.invalidTeamNames.includes(fullName.toUpperCase())) {
          match.team1.name = fullName;
          match.team1.short = this.getTeamShortName(fullName);
        }
      }
      if (match.team2?.name) {
        const fullName = this.getFullTeamName(match.team2.name);
        if (fullName && !this.invalidTeamNames.includes(fullName.toUpperCase())) {
          match.team2.name = fullName;
          match.team2.short = this.getTeamShortName(fullName);
        }
      }
      
      if (!match.team1?.name || !match.team2?.name) continue;
      if (this.invalidTeamNames.includes(match.team1.name.toUpperCase()) || 
          this.invalidTeamNames.includes(match.team2.name.toUpperCase())) {
        continue;
      }
      
      const key = `${match.team1.name}|${match.team2.name}|${match.status}|${match.series || ''}`;
      
      if (!seen.has(key)) {
        seen.set(key, match);
        validated.push(match);
      }
    }
    
    if (matches.length > validated.length) {
      logger.info(`Validation: ${matches.length} -> ${validated.length} matches`);
    }
    
    return validated;
  }

  isValidMatch(matchData) {
    return this.isValidMatchData(matchData);
  }

  removeDuplicates(matches) {
    const seen = new Set();
    const unique = [];
    
    for (const match of matches) {
      const key = `${match.team1?.name || ''}|${match.team2?.name || ''}|${match.status || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(match);
      }
    }
    
    return unique;
  }
}

module.exports = HttpScraper;