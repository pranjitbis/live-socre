// src/scraper/crex/LiveScraper.js
const BaseCrexScraper = require('./BaseCrexScraper');
const LIVE_SELECTORS = require('./selectors/liveSelectors');
const logger = require('../../logger');
const util = require('util');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const browserManager = require('../browser');

// Deep logging function
const deepLog = (label, data) => {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`📊 ${label}`);
  console.log(`${'═'.repeat(80)}`);
  console.log(util.inspect(data, {
    depth: null,
    colors: true,
    compact: false,
    maxArrayLength: null,
    maxStringLength: null,
    showHidden: false
  }));
  console.log(`${'═'.repeat(80)}\n`);
};

class LiveScraper extends BaseCrexScraper {
  constructor() {
    super();
    this.selectors = LIVE_SELECTORS;
    this.stats = {
      discovered: 0,
      detailed: 0,
      merged: 0,
      errors: 0,
      weatherSuccess: 0,
      weatherFailed: 0
    };
    
    // Rate limiting
    this.requestDelay = 3000;
    this.maxRetries = 3;
    this.browser = null;
    this.page = null;
    this.context = null;
    this.requestCount = 0;
    this.lastRequestTime = 0;
    this.isBrowserInitialized = false;
    
    // Browser manager
    this.browserManager = browserManager;
    this.useBrowserManager = true;
    
    // Weather caches
    this.geoCache = new Map();
    this.weatherCache = new Map();
    
    // Weather code mapping
    this.weatherCodeMap = {
      0: { condition: 'Clear Sky', icon: '01d' },
      1: { condition: 'Mainly Clear', icon: '02d' },
      2: { condition: 'Partly Cloudy', icon: '03d' },
      3: { condition: 'Cloudy', icon: '04d' },
      45: { condition: 'Fog', icon: '50d' },
      48: { condition: 'Depositing Fog', icon: '50d' },
      51: { condition: 'Light Drizzle', icon: '09d' },
      53: { condition: 'Moderate Drizzle', icon: '09d' },
      55: { condition: 'Heavy Drizzle', icon: '09d' },
      61: { condition: 'Light Rain', icon: '10d' },
      63: { condition: 'Rain', icon: '10d' },
      65: { condition: 'Heavy Rain', icon: '10d' },
      71: { condition: 'Snow', icon: '13d' },
      73: { condition: 'Snow', icon: '13d' },
      75: { condition: 'Heavy Snow', icon: '13d' },
      80: { condition: 'Rain Showers', icon: '09d' },
      81: { condition: 'Rain Showers', icon: '09d' },
      82: { condition: 'Heavy Rain Showers', icon: '09d' },
      95: { condition: 'Thunderstorm', icon: '11d' },
      96: { condition: 'Thunderstorm', icon: '11d' },
      99: { condition: 'Thunderstorm', icon: '11d' }
    };
    
    // Country mapping for team names
    this.countryMap = {
      'India': 'India',
      'England': 'England',
      'Australia': 'Australia',
      'Pakistan': 'Pakistan',
      'New Zealand': 'New Zealand',
      'South Africa': 'South Africa',
      'West Indies': 'West Indies',
      'Sri Lanka': 'Sri Lanka',
      'Bangladesh': 'Bangladesh',
      'Afghanistan': 'Afghanistan',
      'Zimbabwe': 'Zimbabwe',
      'Ireland': 'Ireland',
      'Nepal': 'Nepal',
      'Namibia': 'Namibia',
      'Guyana': 'Guyana'
    };
    
    // Team abbreviation to country mapping
    this.teamCountryMap = {
      'PAK': 'Pakistan',
      'WI': 'West Indies',
      'IND': 'India',
      'ENG': 'England',
      'AUS': 'Australia',
      'NZ': 'New Zealand',
      'SA': 'South Africa',
      'SL': 'Sri Lanka',
      'BAN': 'Bangladesh',
      'AFG': 'Afghanistan',
      'ZIM': 'Zimbabwe',
      'IRE': 'Ireland',
      'NEP': 'Nepal',
      'NAM': 'Namibia',
      'GUY': 'Guyana',
      'LANCS': 'England',
      'LEIC': 'England',
      'WOR': 'England',
      'HAM': 'England',
      'MDX': 'England',
      'KT': 'England',
      'LS': 'England',
      'TR': 'England',
      'DS': 'Sri Lanka',
      'GG': 'Sri Lanka',
      'Live PAK': 'Pakistan'
    };
    
    // Team ID mapping
    this.teamIdMap = {
      'India': 'team_ind',
      'England': 'team_eng',
      'Australia': 'team_aus',
      'Pakistan': 'team_pak',
      'New Zealand': 'team_nz',
      'South Africa': 'team_sa',
      'West Indies': 'team_wi',
      'Sri Lanka': 'team_sl',
      'Bangladesh': 'team_ban',
      'Afghanistan': 'team_afg',
      'Zimbabwe': 'team_zim',
      'Ireland': 'team_ire',
      'Nepal': 'team_nep',
      'Namibia': 'team_nam',
      'Maharani': 'team_maharani',
      'Galle Gallants': 'team_galle',
      'Dambulla Sixers': 'team_dambulla',
      'Kandy Falcons': 'team_kandy',
      'Jaffna Kings': 'team_jaffna',
      'Colombo Kaps': 'team_colombo',
      'Kandy Royals': 'team_kandy_royals',
      'London Spirit': 'team_london_spirit',
      'Manchester Super Giants': 'team_manchester',
      'Southern Brave': 'team_southern_brave',
      'Welsh Fire': 'team_welsh_fire',
      'Birmingham Phoenix': 'team_birmingham',
      'Trent Rockets': 'team_trent_rockets',
      'Oval Invincibles': 'team_oval',
      'Northern Superchargers': 'team_northern',
      'Worcestershire': 'team_worcs',
      'Derbyshire': 'team_derby',
      'Lahore Qalandars': 'team_lahore',
      'Perth Scorchers': 'team_perth',
      'Guyana Amazon Warriors': 'team_guyana',
      'San Francisco Unicorns': 'team_san_francisco',
      'BP-W': 'team_bp_w',
      'TR-W': 'team_tr_w',
      'GLCS': 'team_glcs',
      'SOM': 'team_som'
    };
  }

  // ============================================================
  // GET COUNTRY FROM TEAM NAME
  // ============================================================
  getCountryFromTeamName(teamName) {
    if (!teamName) return null;
    
    if (this.teamCountryMap[teamName]) return this.teamCountryMap[teamName];
    
    for (const [key, value] of Object.entries(this.teamCountryMap)) {
      if (teamName.includes(key) || key.includes(teamName)) {
        return value;
      }
    }
    
    for (const [key, country] of Object.entries(this.countryMap)) {
      if (teamName.includes(key) || key.includes(teamName)) {
        return country;
      }
    }
    
    return null;
  }

  // ============================================================
  // BUILD LOCATION CANDIDATES
  // ============================================================
  buildLocationCandidates(venue, series, matchTitle, team1Name, team2Name, matchUrl) {
    const candidates = new Set();
    
    if (venue && venue !== 'TBD' && venue.length > 2) {
      candidates.add(venue);
      
      const cleanedVenue = venue
        .replace(/Cricket Ground|Ground|Stadium|International Stadium|Sports Complex|Oval|Arena|Park|Gardens|Cricket Club|CC/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanedVenue !== venue && cleanedVenue.length > 2) {
        candidates.add(cleanedVenue);
      }
      
      if (venue.includes(',')) {
        const parts = venue.split(',').map(p => p.trim());
        parts.forEach(part => {
          if (part.length > 2) {
            candidates.add(part);
          }
        });
      }
      
      const cityMatch = venue.match(/,?\s*([A-Za-z\s]+)$/);
      if (cityMatch && cityMatch[1] && cityMatch[1].length > 2) {
        candidates.add(cityMatch[1].trim());
      }
    }
    
    if (matchUrl) {
      const urlParts = matchUrl.split('/');
      for (const part of urlParts) {
        const decoded = decodeURIComponent(part).replace(/-/g, ' ');
        for (const [country] of Object.entries(this.countryMap)) {
          if (decoded.includes(country.toLowerCase()) || decoded.includes(country)) {
            candidates.add(country);
          }
        }
        const locationMatch = decoded.match(/(england|australia|india|pakistan|sri lanka|west indies|new zealand|south africa|bangladesh|afghanistan|zimbabwe|ireland|nepal|namibia|guyana)/i);
        if (locationMatch) {
          candidates.add(locationMatch[1]);
        }
      }
    }
    
    if (series) {
      for (const [country] of Object.entries(this.countryMap)) {
        if (series.includes(country)) {
          candidates.add(country);
        }
      }
      
      const countryPatterns = [
        /(?:India|England|Australia|Pakistan|New Zealand|South Africa|West Indies|Sri Lanka|Bangladesh|Afghanistan|Zimbabwe|Ireland|Nepal|Namibia|Guyana)\s+(?:Tour|vs|in)/i,
        /(?:Tour|vs|in)\s+(?:India|England|Australia|Pakistan|New Zealand|South Africa|West Indies|Sri Lanka|Bangladesh|Afghanistan|Zimbabwe|Ireland|Nepal|Namibia|Guyana)/i
      ];
      
      for (const pattern of countryPatterns) {
        const match = series.match(pattern);
        if (match) {
          const country = match[0].replace(/Tour|vs|in/gi, '').trim();
          if (country && country.length > 2) {
            candidates.add(country);
          }
        }
      }
      
      const vsMatch = series.match(/([A-Za-z\s]+)\s+vs\s+([A-Za-z\s]+)/i);
      if (vsMatch) {
        const country1 = vsMatch[1].trim();
        const country2 = vsMatch[2].trim();
        if (country1 && country1.length > 2) candidates.add(country1);
        if (country2 && country2.length > 2) candidates.add(country2);
      }
    }
    
    if (matchTitle) {
      for (const [country] of Object.entries(this.countryMap)) {
        if (matchTitle.includes(country)) {
          candidates.add(country);
        }
      }
    }
    
    if (team1Name) {
      for (const [key, country] of Object.entries(this.countryMap)) {
        if (team1Name.includes(key) || key.includes(team1Name)) {
          candidates.add(country);
        }
      }
      const teamCountry = this.getCountryFromTeamName(team1Name);
      if (teamCountry) candidates.add(teamCountry);
    }
    
    if (team2Name) {
      for (const [key, country] of Object.entries(this.countryMap)) {
        if (team2Name.includes(key) || key.includes(team2Name)) {
          candidates.add(country);
        }
      }
      const teamCountry = this.getCountryFromTeamName(team2Name);
      if (teamCountry) candidates.add(teamCountry);
    }
    
    if (team1Name && team1Name.length <= 3) {
      const country = this.teamCountryMap[team1Name.toUpperCase()];
      if (country) candidates.add(country);
    }
    
    if (team2Name && team2Name.length <= 3) {
      const country = this.teamCountryMap[team2Name.toUpperCase()];
      if (country) candidates.add(country);
    }
    
    const validCandidates = new Set();
    for (const candidate of candidates) {
      const trimmed = candidate.trim();
      if (trimmed && trimmed !== 'TBD' && trimmed !== 'tbd' && trimmed.length > 2) {
        validCandidates.add(trimmed);
      }
    }
    
    const prioritized = [];
    const venueCandidates = [];
    const cityCandidates = [];
    const seriesCandidates = [];
    const countryCandidates = [];
    
    for (const candidate of validCandidates) {
      const isCountry = Object.values(this.countryMap).some(c => 
        candidate.toLowerCase() === c.toLowerCase() || 
        candidate.includes(c)
      );
      
      if (isCountry && candidate.length <= 20) {
        countryCandidates.push(candidate);
      } else if (candidate.includes(',')) {
        venueCandidates.push(candidate);
      } else if (candidate.match(/[A-Z][a-z]+\s+[A-Z][a-z]+/)) {
        venueCandidates.push(candidate);
      } else if (candidate.match(/[A-Z][a-z]+/)) {
        cityCandidates.push(candidate);
      } else {
        seriesCandidates.push(candidate);
      }
    }
    
    const allCandidates = [
      ...venueCandidates,
      ...cityCandidates,
      ...seriesCandidates,
      ...countryCandidates
    ];
    
    const seen = new Set();
    const uniqueCandidates = [];
    for (const candidate of allCandidates) {
      const lower = candidate.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        uniqueCandidates.push(candidate);
      }
    }
    
    if (uniqueCandidates.length === 0) {
      if (team1Name) {
        const country = this.getCountryFromTeamName(team1Name);
        if (country && !uniqueCandidates.includes(country)) uniqueCandidates.push(country);
      }
      if (team2Name) {
        const country = this.getCountryFromTeamName(team2Name);
        if (country && !uniqueCandidates.includes(country)) uniqueCandidates.push(country);
      }
    }
    
    return uniqueCandidates;
  }

  // ============================================================
  // GET COORDINATES WITH CACHING
  // ============================================================
  async getCoordinates(location) {
    const cacheKey = location.toLowerCase().trim();
    
    if (this.geoCache.has(cacheKey)) {
      logger.debug(`    ✅ Coordinates from cache for: ${location}`);
      return this.geoCache.get(cacheKey);
    }

    try {
      const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
      
      const response = await axios.get(geocodeUrl, {
        timeout: 10000
      });
      
      if (response.data.results && response.data.results.length > 0) {
        const result = response.data.results[0];
        const coords = {
          lat: result.latitude,
          lon: result.longitude,
          name: result.name,
          country: result.country
        };
        this.geoCache.set(cacheKey, coords);
        logger.debug(`    ✅ Geocoded "${location}" → ${result.name}, ${result.country}`);
        return coords;
      } else {
        logger.debug(`    ⚠️ No results for location: "${location}"`);
        return null;
      }
    } catch (error) {
      logger.debug(`    ⚠️ Geocoding failed for "${location}": ${error.message}`);
      return null;
    }
  }

  // ============================================================
  // GET WEATHER FOR VENUE
  // ============================================================
  async getWeatherForVenue(venue, series, matchTitle, team1Name, team2Name, matchUrl) {
    const candidates = this.buildLocationCandidates(venue, series, matchTitle, team1Name, team2Name, matchUrl);
    
    if (candidates.length === 0) {
      logger.warn(`    ❌ No location candidates found for weather`);
      return null;
    }

    logger.info(`    🌤️ Weather requested with ${candidates.length} location candidates:`);
    candidates.slice(0, 10).forEach((c, i) => {
      logger.info(`       ${i + 1}. "${c}"`);
    });
    if (candidates.length > 10) {
      logger.info(`       ... and ${candidates.length - 10} more`);
    }

    for (let i = 0; i < candidates.length; i++) {
      const location = candidates[i];
      logger.debug(`    🔍 Trying location ${i + 1}/${candidates.length}: "${location}"`);
      
      try {
        const coords = await this.getCoordinates(location);
        
        if (!coords) {
          logger.debug(`    ⚠️ No coordinates for "${location}", trying next`);
          continue;
        }

        const { lat: latitude, lon: longitude } = coords;

        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=precipitation_probability_max&timezone=auto`;
        
        const weatherResponse = await axios.get(weatherUrl, {
          timeout: 10000
        });

        const data = weatherResponse.data;
        
        if (!data.current) {
          logger.debug(`    ⚠️ No weather data for "${location}", trying next`);
          continue;
        }

        const current = data.current;
        const weatherCode = current.weather_code;
        const weatherInfo = this.weatherCodeMap[weatherCode] || { condition: 'Unknown', icon: '01d' };
        
        let rainProbability = null;
        if (data.daily && data.daily.precipitation_probability_max && data.daily.precipitation_probability_max.length > 0) {
          rainProbability = data.daily.precipitation_probability_max[0];
        }

        const weather = {
          temperature: current.temperature_2m || null,
          feels_like: current.apparent_temperature || null,
          humidity: current.relative_humidity_2m || null,
          wind_speed: current.wind_speed_10m || null,
          condition: weatherInfo.condition,
          rain_probability: rainProbability,
          weather_icon: weatherInfo.icon,
          last_updated: new Date().toISOString()
        };

        this.stats.weatherSuccess++;
        
        logger.info(`    ✅ Weather fetched for "${location}": ${weather.temperature}°C, ${weather.condition}, ${weather.humidity}% humidity`);
        logger.info(`       (Original venue: "${venue || 'N/A'}", Teams: ${team1Name || 'N/A'} vs ${team2Name || 'N/A'})`);
        return weather;

      } catch (error) {
        logger.debug(`    ❌ Weather API error for "${location}": ${error.message}`);
        continue;
      }
    }

    this.stats.weatherFailed++;
    logger.warn(`    ❌ No valid weather location found after all ${candidates.length} retries.`);
    logger.warn(`       Venue: "${venue || 'N/A'}"`);
    logger.warn(`       Series: "${series || 'N/A'}"`);
    logger.warn(`       Teams: ${team1Name || 'N/A'} vs ${team2Name || 'N/A'}`);
    return null;
  }

  // ============================================================
  // SLEEP WITH RATE LIMITING
  // ============================================================
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================
  // OVERRIDE: INITIALIZE BROWSER WITH MANAGER
  // ============================================================
  async initializeBrowser() {
    try {
      if (this.isBrowserInitialized && this.browser && this.browser.isConnected()) {
        logger.debug('Browser already initialized, reusing...');
        return true;
      }

      // Use the shared browser manager
      logger.info('🔄 Using shared browser manager...');
      await this.browserManager.launch();
      
      // Get the browser and context from the manager
      this.browser = this.browserManager.browser;
      this.context = this.browserManager.context;
      
      // Create a new page for this scraper instance
      if (this.context) {
        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(45000);
        this.page.setDefaultNavigationTimeout(45000);
      }
      
      this.isBrowserInitialized = true;
      logger.info('✅ Browser initialized via shared manager');
      return true;
      
    } catch (error) {
      logger.error(`Failed to initialize browser: ${error.message}`);
      // Fallback to creating our own browser
      logger.info('⚠️ Falling back to standalone browser...');
      return await super.initializeBrowser();
    }
  }

  // ============================================================
  // OVERRIDE: CLOSE BROWSER
  // ============================================================
  async closeBrowser() {
    try {
      // Only close our page, not the shared browser
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
        this.page = null;
      }
      this.isBrowserInitialized = false;
      logger.info('✅ LiveScraper page closed');
      return true;
    } catch (error) {
      logger.error(`Error closing page: ${error.message}`);
      this.page = null;
      this.isBrowserInitialized = false;
      return false;
    }
  }

  // ============================================================
  // OVERRIDE: NAVIGATE WITH RETRY AND RATE LIMITING
  // ============================================================
  async navigateWithRetry(url, options = {}) {
    const maxRetries = options.maxRetries || this.maxRetries;
    const delay = options.delay || this.requestDelay;
    
    // Ensure browser is initialized
    if (!this.isBrowserInitialized || !this.page) {
      await this.initializeBrowser();
    }
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Rate limiting
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < 2000) {
          const waitTime = 2000 - timeSinceLastRequest + Math.random() * 1000;
          logger.debug(`Rate limiting: waiting ${waitTime}ms`);
          await this.sleep(waitTime);
        }
        
        this.lastRequestTime = Date.now();
        this.requestCount++;
        
        if (attempt > 1) {
          logger.info(`   ⏳ Rate limiting: waiting ${delay * attempt}ms before retry ${attempt}/${maxRetries}`);
          await this.sleep(delay * attempt);
        }
        
        // Random referrer
        const referrers = [
          'https://www.google.com/',
          'https://www.bing.com/',
          'https://www.yahoo.com/',
          'https://duckduckgo.com/'
        ];
        
        await this.page.setExtraHTTPHeaders({
          'Referer': referrers[Math.floor(Math.random() * referrers.length)]
        });
        
        // Rotate user agent if using browser manager
        if (this.useBrowserManager && this.browserManager) {
          const newUA = this.browserManager.getRandomUserAgent();
          await this.context.setExtraHTTPHeaders({
            'User-Agent': newUA
          });
        }
        
        const response = await this.page.goto(url, {
          waitUntil: options.waitUntil || 'domcontentloaded',
          timeout: options.timeout || 30000
        });
        
        if (response && response.status() === 403) {
          logger.warn(`   ⚠️ Received 403 Forbidden, attempt ${attempt}/${maxRetries}`);
          
          // Rotate user agent on 403
          if (this.useBrowserManager && this.browserManager) {
            const newUA = this.browserManager.getRandomUserAgent();
            await this.context.setExtraHTTPHeaders({
              'User-Agent': newUA
            });
            logger.info(`   🔄 Rotated User-Agent: ${newUA}`);
          }
          
          // Try rotating proxy if available
          if (this.browserManager && this.browserManager.getNextProxy) {
            const proxy = this.browserManager.getNextProxy();
            if (proxy) {
              logger.info(`   🔄 Rotating to proxy: ${proxy}`);
              await this.closeBrowser();
              await this.initializeBrowser();
            }
          }
          
          // Wait longer before retry on 403
          const waitTime = (delay * attempt * 2) + Math.random() * 2000;
          logger.info(`   ⏳ Waiting ${waitTime}ms before retry...`);
          await this.sleep(waitTime);
          
          if (attempt === maxRetries) {
            throw new Error(`Failed after ${maxRetries} attempts: 403 Forbidden`);
          }
          continue;
        }
        
        if (response && response.status() >= 400) {
          logger.warn(`   ⚠️ Received status ${response.status()}, attempt ${attempt}/${maxRetries}`);
          if (attempt === maxRetries) {
            throw new Error(`Failed after ${maxRetries} attempts: status ${response.status()}`);
          }
          await this.sleep(delay * attempt);
          continue;
        }
        
        // Wait for page to be interactive
        await this.page.waitForLoadState('domcontentloaded');
        await this.sleep(1000);
        
        // Check for consent
        try {
          const bodyText = await this.page.textContent('body');
          if (bodyText && (bodyText.includes('cookie') || bodyText.includes('Consent') || bodyText.includes('GDPR'))) {
            await this.acceptConsent();
          }
        } catch (e) {
          // Ignore consent errors
        }
        
        return response;
        
      } catch (error) {
        logger.warn(`   ⚠️ Navigation attempt ${attempt}/${maxRetries} failed: ${error.message}`);
        
        // If browser issue, restart
        if (error.message.includes('browser') || 
            error.message.includes('disconnected') ||
            error.message.includes('closed')) {
          await this.closeBrowser();
          await this.initializeBrowser();
        }
        
        if (attempt === maxRetries) {
          throw error;
        }
        await this.sleep(delay * attempt + Math.random() * 2000);
      }
    }
    
    throw new Error(`Failed to navigate after ${maxRetries} attempts`);
  }

  // ============================================================
  // ACCEPT CONSENT
  // ============================================================
  async acceptConsent() {
    try {
      const selectors = [
        '#onetrust-accept-btn-handler',
        '#onetrust-close-btn-container button',
        '.onetrust-close-btn-handler',
        '#accept-recommended-btn-handler',
        '.btn-primary',
        '.cookie-accept',
        '.accept-cookies',
        'button:contains("Accept")',
        'button:contains("Accept All")',
      ];
      
      for (const selector of selectors) {
        try {
          const element = await this.page.$(selector);
          if (element && await element.isVisible()) {
            await element.click();
            logger.info('✅ Accepted consent');
            await this.sleep(1000);
            return true;
          }
        } catch (e) {
          // Continue
        }
      }
      
      // Try JavaScript click
      await this.page.evaluate(() => {
        const buttons = document.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
          const text = (btn.textContent || '').toLowerCase();
          if (text.includes('accept') || text.includes('allow') || text.includes('agree')) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      
      return false;
    } catch (error) {
      logger.warn('Consent acceptance failed:', error.message);
      return false;
    }
  }

  // ============================================================
  // CLEANUP
  // ============================================================
  async cleanup() {
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
      }
      this.page = null;
      this.isBrowserInitialized = false;
      logger.info('✅ LiveScraper cleaned up');
      return true;
    } catch (error) {
      logger.warn('Error cleaning up LiveScraper:', error.message);
      return false;
    }
  }

  // ============================================================
  // MAIN SCRAPE METHOD
  // ============================================================
  async scrapeLive() {
    logger.info('🚀 Starting live matches scraper');

    try {
      // Initialize browser once
      await this.initializeBrowser();
      
      // Phase 1: Discover matches
      const discoveredMatches = await this.discoverLiveMatches();
      this.stats.discovered = discoveredMatches.length;
      
      if (discoveredMatches.length === 0) {
        logger.info('📢 No live matches currently in progress');
        await this.closeBrowser();
        const result = {
          success: false,
          timestamp: new Date().toISOString(),
          data: []
        };
        deepLog('SCRAPER RESULT - No live matches found', result);
        return result;
      }

      logger.info(`📋 Phase 1 complete: Discovered ${discoveredMatches.length} live matches`);
      deepLog(`PHASE 1 - Discovered ${discoveredMatches.length} live matches`, discoveredMatches);

      // Phase 2: Extract details with rate limiting
      const fullMatches = [];
      for (let i = 0; i < discoveredMatches.length; i++) {
        const match = discoveredMatches[i];
        
        // Rate limiting between matches
        if (i > 0) {
          logger.info(`   ⏳ Waiting ${this.requestDelay}ms before next match...`);
          await this.sleep(this.requestDelay);
        }
        
        try {
          logger.info(`  📄 Processing match ${i + 1}/${discoveredMatches.length}: ${match.url}`);
          
          // Navigate with retry
          await this.navigateWithRetry(match.url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
            maxRetries: this.maxRetries,
            delay: this.requestDelay
          });
          
          await this.sleep(2000);
          
          // Extract data
          const matchData = await this.extractMatchDetails(match);
          if (matchData) {
            fullMatches.push(matchData);
            this.stats.detailed++;
            
            logger.info(`    ✅ Extracted: ${matchData.teams.home.name} vs ${matchData.teams.away.name}`);
            logger.info(`       Score: ${matchData.scoreboard.batting_team.score || 'N/A'}`);
            logger.info(`       Overs: ${matchData.scoreboard.batting_team.overs || 'N/A'}`);
          }
        } catch (error) {
          logger.error(`    ❌ Error processing match ${i + 1}: ${error.message}`);
          this.stats.errors++;
          
          // Create fallback match
          const fallbackMatch = this.createFallbackMatch(match);
          fullMatches.push(fallbackMatch);
          deepLog(`PHASE 2 - Match ${i + 1} FALLBACK Data`, fallbackMatch);
        }
      }

      logger.info(`📋 Phase 2 complete: Extracted details for ${fullMatches.length} live matches`);

      // Close browser after all extraction is done
      await this.closeBrowser();
      this.logStatistics();

      const result = {
        success: true,
        timestamp: new Date().toISOString(),
        data: fullMatches
      };

      deepLog('✅ FINAL SCRAPER RESULT - Complete JSON', result);
      
      if (fullMatches.length > 0) {
        deepLog('📋 SAMPLE LIVE MATCH - First match in detail', fullMatches[0]);
      }

      return result;

    } catch (error) {
      logger.error(`❌ LiveScraper error: ${error.message}`);
      await this.closeBrowser();
      const result = {
        success: false,
        timestamp: new Date().toISOString(),
        data: []
      };
      deepLog('❌ SCRAPER ERROR RESULT', result);
      return result;
    }
  }

  // ============================================================
  // DISCOVER LIVE MATCHES
  // ============================================================
  async discoverLiveMatches() {
    logger.info('🔍 Phase 1: Discovering live matches...');

    const url = this.selectors.PAGE_URL || 'https://crex.com/cricket-live-score';
    
    try {
      await this.navigateWithRetry(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      try {
        await this.page.waitForSelector('.live-card, .live-score-card, .match-card, .team-innig', { 
          timeout: 10000 
        });
        logger.info('✅ Found live match indicators on page');
      } catch (e) {
        logger.warn('⚠️ No live match indicators found, waiting for page to settle...');
        await this.sleep(3000);
      }

      await this.sleep(3000);
      
      const debugDir = path.join(process.cwd(), 'debug');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      
      try {
        await this.page.screenshot({ path: path.join(debugDir, 'live-page-screenshot.png'), fullPage: true });
        logger.info(`💾 Saved screenshot to debug/live-page-screenshot.png`);
      } catch (e) {
        logger.warn(`Could not save screenshot: ${e.message}`);
      }

    } catch (error) {
      logger.error(`❌ Failed to load live matches page: ${error.message}`);
      return [];
    }

    try {
      const pageHtml = await this.page.content();
      const debugDir = path.join(process.cwd(), 'debug');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      fs.writeFileSync(path.join(debugDir, 'live-page.html'), pageHtml);
      logger.info(`💾 Saved page HTML to debug/live-page.html for inspection`);
    } catch (e) {
      logger.warn(`Could not save HTML: ${e.message}`);
    }

    const selectors = [
      '.live-card',
      '.live-score-card',
      '.match-card',
      '.match-container',
      '.team-result',
      '.team-content',
      '.teamProfile',
      '.team-innig',
      '.score-card',
      '.match-item',
      '.live-match-item',
      '.match-row',
      '.cricket-match-card',
      '.match-card-container'
    ];

    let foundCards = [];

    for (const selector of selectors) {
      try {
        const count = await this.page.locator(selector).count();
        logger.info(`  🔍 Checking selector "${selector}": ${count} elements found`);
        
        if (count > 0) {
          foundCards = await this.page.$$(selector);
          logger.info(`✅ Found ${count} elements with selector: ${selector}`);
          
          if (foundCards.length > 0) {
            try {
              const firstCardHtml = await this.page.evaluate((el) => el.outerHTML, foundCards[0]);
              const snippet = firstCardHtml.substring(0, 500) + '...';
              logger.info(`📄 First card HTML snippet: ${snippet}`);
              
              const debugDir = path.join(process.cwd(), 'debug');
              if (!fs.existsSync(debugDir)) {
                fs.mkdirSync(debugDir, { recursive: true });
              }
              fs.writeFileSync(path.join(debugDir, 'first-card.html'), firstCardHtml);
              logger.info(`💾 Saved first card HTML to debug/first-card.html`);
            } catch (e) {
              logger.warn(`Could not save first card HTML: ${e.message}`);
            }
          }
          break;
        }
      } catch (error) {
        logger.debug(`  ⚠️ Error with selector "${selector}": ${error.message}`);
      }
    }

    if (foundCards.length === 0) {
      logger.warn('❌ No live match cards found with any selector');
      return [];
    }

    const discoveredMatches = await this.page.evaluate((cards) => {
      const matches = [];
      
      const getText = (el) => {
        if (!el) return '';
        return el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
      };

      const cleanText = (text) => {
        if (!text) return '';
        return text.replace(/\s+/g, ' ').trim();
      };

      const getTeamShortName = (name) => {
        const map = {
          'India': 'IND',
          'England': 'ENG',
          'Australia': 'AUS',
          'Pakistan': 'PAK',
          'New Zealand': 'NZ',
          'South Africa': 'SA',
          'West Indies': 'WI',
          'Sri Lanka': 'SL',
          'Bangladesh': 'BAN',
          'Afghanistan': 'AFG',
          'Zimbabwe': 'ZIM',
          'Ireland': 'IRE',
          'Nepal': 'NEP',
          'Namibia': 'NAM',
          'Galle Gallants': 'GAG',
          'Dambulla Sixers': 'DAS',
          'Kandy Falcons': 'KFS',
          'Jaffna Kings': 'JKS',
          'Colombo Kaps': 'CLK',
          'Kandy Royals': 'KRL',
          'London Spirit': 'LDN',
          'Manchester Super Giants': 'MSG',
          'Southern Brave': 'SOU',
          'Welsh Fire': 'WEF',
          'Birmingham Phoenix': 'BIR',
          'Trent Rockets': 'TRE',
          'Oval Invincibles': 'OVAL',
          'Northern Superchargers': 'NOR',
          'Worcestershire': 'WORCS',
          'Derbyshire': 'DERBY',
          'Lahore Qalandars': 'LQ',
          'Perth Scorchers': 'PS',
          'Guyana Amazon Warriors': 'GAW',
          'San Francisco Unicorns': 'SFU',
          'BP-W': 'BPW',
          'TR-W': 'TRW',
          'GLCS': 'GLC',
          'SOM': 'SOM'
        };
        return map[name] || name.substring(0, 3).toUpperCase();
      };

      const getMatchUrl = (card) => {
        const links = card.querySelectorAll('a[href*="cricket-live-score"]');
        for (const link of links) {
          const href = link.getAttribute('href');
          if (href && href.includes('cricket-live-score')) {
            if (href.startsWith('https://')) {
              return href;
            } else if (href.startsWith('/')) {
              return `https://crex.com${href}`;
            } else {
              return `https://crex.com/${href}`;
            }
          }
        }
        return '';
      };

      cards.forEach((card) => {
        const cardText = getText(card);
        
        if (cardText.includes('Advertisement') || 
            cardText.includes('News') || 
            cardText.includes('Video') || 
            cardText.includes('Photo') ||
            cardText.includes('Podcast')) {
          return;
        }

        const matchUrl = getMatchUrl(card);
        if (!matchUrl) return;

        let team1Name = '';
        let team2Name = '';

        const vsMatch = cardText.match(/([A-Za-z\s]+)\s+vs\s+([A-Za-z\s]+)/i);
        if (vsMatch) {
          team1Name = cleanText(vsMatch[1]);
          team2Name = cleanText(vsMatch[2]);
        }

        if (!team1Name || !team2Name) {
          const teamSelectors = ['.team-name', '.teamName', '.name', '.team', '.cb-team-name'];
          const teamNames = [];
          
          for (const selector of teamSelectors) {
            const elements = card.querySelectorAll(selector);
            elements.forEach(el => {
              const text = cleanText(getText(el));
              if (text && text.length > 1 && text.length < 30 && !text.includes('vs')) {
                teamNames.push(text);
              }
            });
            if (teamNames.length >= 2) break;
          }

          if (teamNames.length >= 2) {
            team1Name = teamNames[0];
            team2Name = teamNames[1];
          }
        }

        const flags = [];
        const flagImages = card.querySelectorAll('img[src*="Teams"], img[src*="cricketvectors"], .team-flag img, .flag img');
        flagImages.forEach(img => {
          const src = img.getAttribute('src') || '';
          if (src && (src.includes('Teams') || src.includes('cricketvectors'))) {
            flags.push(src);
          }
        });

        let team1Score = '';
        let team1Wickets = '';
        let team1Overs = '';
        let team2Score = '';
        let team2Wickets = '';
        let team2Overs = '';

        const scoreElements = card.querySelectorAll('.score, .team-score, .runs, .score-text, .match-score');
        const oversElements = card.querySelectorAll('.overs, .over, .overs-text, .match-overs');
        
        if (scoreElements.length >= 2) {
          const score1Text = cleanText(getText(scoreElements[0]));
          const score2Text = cleanText(getText(scoreElements[1]));
          
          const score1Match = score1Text.match(/(\d+)[-/](\d+)/);
          if (score1Match) {
            team1Score = score1Match[1];
            team1Wickets = score1Match[2];
          }
          
          const score2Match = score2Text.match(/(\d+)[-/](\d+)/);
          if (score2Match) {
            team2Score = score2Match[1];
            team2Wickets = score2Match[2];
          }
        }

        if (oversElements.length >= 2) {
          team1Overs = cleanText(getText(oversElements[0])).replace(/[()]/g, '');
          team2Overs = cleanText(getText(oversElements[1])).replace(/[()]/g, '');
        }

        let series = '';
        const seriesSelectors = ['.series-name', '.snameTag', '.match-series', '.series-title', '.tournament', '.series'];
        for (const selector of seriesSelectors) {
          const el = card.querySelector(selector);
          if (el) {
            series = cleanText(getText(el));
            break;
          }
        }

        if (team1Name && team2Name) {
          matches.push({
            url: matchUrl,
            status: 'LIVE',
            team1: {
              name: team1Name,
              short: getTeamShortName(team1Name),
              flag: flags[0] || '',
              score: team1Score,
              wickets: team1Wickets,
              overs: team1Overs
            },
            team2: {
              name: team2Name,
              short: getTeamShortName(team2Name),
              flag: flags[1] || '',
              score: team2Score,
              wickets: team2Wickets,
              overs: team2Overs
            },
            series: series
          });
        }
      });

      return matches;
    }, foundCards);

    logger.info(`✅ Discovered ${discoveredMatches.length} live matches`);
    
    if (discoveredMatches.length > 0) {
      discoveredMatches.forEach((match, index) => {
        logger.info(`  ${index + 1}. ${match.team1.name} (${match.team1.score}/${match.team1.wickets}) vs ${match.team2.name} (${match.team2.score}/${match.team2.wickets}) - ${match.url}`);
      });
    }

    deepLog(`PHASE 1 - Discovered ${discoveredMatches.length} live matches`, discoveredMatches);
    return discoveredMatches;
  }

  // ============================================================
  // CREATE FALLBACK MATCH
  // ============================================================
  createFallbackMatch(discovered) {
    return {
      match_id: `live_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      match_url: discovered.url,
      series: {
        id: `series_${Date.now()}`,
        name: discovered.series || 'Unknown Series',
        short_name: '',
        season: new Date().getFullYear().toString()
      },
      match: {
        number: 'Match',
        format: 'T20',
        status: 'Live',
        start_time: '',
        current_innings: '',
        current_ball: ''
      },
      venue: {
        id: `venue_${Date.now()}`,
        name: 'TBD'
      },
      teams: {
        home: {
          id: this.getTeamId(discovered.team1.name),
          name: discovered.team1.name || 'Team 1',
          short_name: discovered.team1.short || 'T1',
          logo: discovered.team1.flag || ''
        },
        away: {
          id: this.getTeamId(discovered.team2.name),
          name: discovered.team2.name || 'Team 2',
          short_name: discovered.team2.short || 'T2',
          logo: discovered.team2.flag || ''
        }
      },
      scoreboard: {
        batting_team: { name: discovered.team1.name, score: discovered.team1.score || '', runs: null, wickets: null, overs: discovered.team1.overs || '' },
        bowling_team: { name: discovered.team2.name },
        target: null,
        required_runs: null,
        required_balls: null,
        crr: null,
        rrr: null,
        current_ball: ''
      },
      current_batsmen: [],
      current_bowler: { name: '', overs: '', runs: null, wickets: null },
      overs: [],
      commentary: [],
      prediction: { home_probability: null, away_probability: null, projected_scores: [] },
      toss: { status: 'Not Started', winner: '', decision: '' },
      weather: null,
      countdown: null
    };
  }

  // ============================================================
  // EXTRACT MATCH DETAILS
  // ============================================================
  async extractMatchDetails(discovered) {
    const series = await this.extractSeries(this.page);
    const venue = await this.extractVenue(this.page);
    const scoreboard = await this.extractScoreboard(this.page);
    const currentBatsmen = await this.extractCurrentBatsmen(this.page);
    const currentBowler = await this.extractCurrentBowler(this.page);
    const overs = await this.extractOversTimeline(this.page);
    const commentary = await this.extractCommentary(this.page);
    const prediction = await this.extractPrediction(this.page);
    const toss = await this.extractToss(this.page);
    
    // Get weather
    let weather = null;
    if (venue || series || discovered.team1.name || discovered.team2.name) {
      weather = await this.getWeatherForVenue(
        venue,
        series,
        '',
        discovered.team1.name,
        discovered.team2.name,
        discovered.url
      );
    }

    let format = 'T20';
    const titleText = await this.extractTextFromSelectors(this.page, this.page, [
      'h1', '.match-title', '.title'
    ]);
    if (titleText) {
      if (titleText.includes('ODI')) format = 'ODI';
      else if (titleText.includes('Test')) format = 'Test';
      else if (titleText.includes('100B')) format = 'The Hundred';
    }

    return {
      match_id: `live_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      match_url: discovered.url,
      series: {
        id: `series_${Date.now()}`,
        name: series || discovered.series || 'Unknown Series',
        short_name: series ? series.substring(0, 20) : '',
        season: new Date().getFullYear().toString()
      },
      match: {
        number: titleText ? (titleText.match(/(\d+(?:st|nd|rd|th)\s+(?:Match|T20|ODI|Test|100B))/i)?.[0] || 'Match') : 'Match',
        format: format,
        status: 'Live',
        start_time: '',
        current_innings: '',
        current_ball: scoreboard.current_ball || ''
      },
      venue: {
        id: `venue_${Date.now()}`,
        name: venue || 'TBD'
      },
      teams: {
        home: {
          id: this.getTeamId(scoreboard.batting_team.name || discovered.team1.name),
          name: scoreboard.batting_team.name || discovered.team1.name,
          short_name: discovered.team1.short || '',
          logo: discovered.team1.flag || ''
        },
        away: {
          id: this.getTeamId(scoreboard.bowling_team.name || discovered.team2.name),
          name: scoreboard.bowling_team.name || discovered.team2.name,
          short_name: discovered.team2.short || '',
          logo: discovered.team2.flag || ''
        }
      },
      scoreboard: {
        batting_team: {
          name: scoreboard.batting_team.name || discovered.team1.name,
          score: scoreboard.batting_team.score || discovered.team1.score || '',
          runs: scoreboard.batting_team.runs,
          wickets: scoreboard.batting_team.wickets,
          overs: scoreboard.batting_team.overs || discovered.team1.overs || ''
        },
        bowling_team: {
          name: scoreboard.bowling_team.name || discovered.team2.name
        },
        target: scoreboard.target,
        required_runs: scoreboard.required_runs,
        required_balls: scoreboard.required_balls,
        crr: scoreboard.crr,
        rrr: scoreboard.rrr,
        current_ball: scoreboard.current_ball || ''
      },
      current_batsmen: currentBatsmen,
      current_bowler: currentBowler,
      overs: overs,
      commentary: commentary,
      prediction: prediction,
      toss: toss,
      weather: weather || null,
      countdown: null
    };
  }

  // ============================================================
  // EXTRACT CURRENT BATSMEN
  // ============================================================
  async extractCurrentBatsmen(page) {
    const batsmen = [];
    
    try {
      await page.waitForSelector('.player-card-wrapper, .playing-batsmen-wrapper, .player-profile, .player-card', {
        timeout: 10000
      });
    } catch (e) {}

    const battingContainerSelectors = [
      '.player-active', '.player-card-wrapper', '.player-card', '.player-profile',
      '.playing-batsmen-wrapper', '.batsmen-partnership', '.batsmen-info-wrapper',
      '.live-data', '.player-section', '.batting-card', '.innings-batting',
      '[class*="batsmen"]', '[class*="player-card"]', '[class*="player-profile"]',
      '.team-innig .player-info', '.score-card .player-info'
    ];
    
    let container = null;
    for (const selector of battingContainerSelectors) {
      try {
        const found = await page.$(selector);
        if (found) {
          container = found;
          break;
        }
      } catch (e) { continue; }
    }
    if (!container) return batsmen;

    const cardSelectors = [
      '.player-card-wrapper', '.player-card', '.player-profile', '.batsman-item',
      '.batsman', '[class*="player-card"]', '[class*="player-profile"]',
      '[class*="batsman"]', '.player-info'
    ];
    
    let cards = [];
    for (const selector of cardSelectors) {
      try {
        const found = await container.$$(selector);
        if (found && found.length > 0) {
          cards = found;
          break;
        }
      } catch (e) { continue; }
    }
    if (cards.length === 0) return batsmen;

    for (let i = 0; i < cards.length && batsmen.length < 2; i++) {
      const card = cards[i];
      try {
        let name = '';
        const nameSelectors = [
          '.batsmen-name', '.player-name', '.playerName', '.name',
          '.p-name', 'a[href*="/player/"] p', 'a[href*="/player/"]'
        ];
        for (const nameSel of nameSelectors) {
          try {
            const nameEl = await card.$(nameSel);
            if (nameEl) {
              const text = await page.evaluate(el => el.textContent.trim(), nameEl);
              if (text && text.length > 0 && text.length < 50) {
                name = text;
                break;
              }
            }
          } catch (e) {}
        }
        if (!name) continue;

        let runs = '', balls = '';
        const scoreSelectors = ['.batsmen-score', '.runs', '.score'];
        for (const scoreSel of scoreSelectors) {
          try {
            const scoreEl = await card.$(scoreSel);
            if (scoreEl) {
              const scoreText = await page.evaluate(el => el.textContent.trim(), scoreEl);
              if (scoreText) {
                const scoreMatch = scoreText.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
                if (scoreMatch) {
                  runs = scoreMatch[1];
                  balls = scoreMatch[2];
                  break;
                }
                const numMatch = scoreText.match(/(\d+)/);
                if (numMatch) { runs = numMatch[1]; break; }
              }
            }
          } catch (e) {}
        }

        let image = null;
        const imageSelectors = ['.batsmen-image img', '.player-image img', 'img[src*="player"]'];
        for (const imgSel of imageSelectors) {
          try {
            const imgEl = await card.$(imgSel);
            if (imgEl) {
              let src = await page.evaluate(el => el.getAttribute('src'), imgEl);
              if (src && !src.includes('placeholder')) {
                image = src.startsWith('/') ? `https://crex.com${src}` : src;
                break;
              }
            }
          } catch (e) {}
        }

        let profileUrl = null;
        const profileSelectors = ['a[href*="/player/"]', 'a[href*="player-profile"]'];
        for (const profSel of profileSelectors) {
          try {
            const profEl = await card.$(profSel);
            if (profEl) {
              const href = await page.evaluate(el => el.getAttribute('href'), profEl);
              if (href) {
                profileUrl = href.startsWith('/') ? `https://crex.com${href}` : href;
                break;
              }
            }
          } catch (e) {}
        }

        let is_striker = false;
        try {
          const strikeIcon = await card.$('.circle-strike-icon');
          if (strikeIcon) is_striker = true;
        } catch (e) {}
        if (!is_striker) {
          try {
            const svgs = await card.$$('svg');
            for (const svg of svgs) {
              const svgHtml = await page.evaluate(el => el.outerHTML, svg);
              if (svgHtml && (svgHtml.includes('ce_highlight_ac2') || svgHtml.includes('highlight_ac2'))) {
                is_striker = true;
                break;
              }
            }
          } catch (e) {}
        }

        batsmen.push({
          name: name,
          runs: runs || null,
          balls: balls || null,
          image: image,
          profile_url: profileUrl,
          is_striker: is_striker
        });

      } catch (error) {
        continue;
      }
    }

    if (batsmen.length > 0) {
      const strikers = batsmen.filter(b => b.is_striker === true);
      if (strikers.length === 0) {
        batsmen[0].is_striker = true;
      } else if (strikers.length > 1) {
        let foundFirst = false;
        for (const batsman of batsmen) {
          if (batsman.is_striker) {
            if (!foundFirst) { foundFirst = true; }
            else { batsman.is_striker = false; }
          }
        }
      }
    }
    return batsmen;
  }

  // ============================================================
  // EXTRACT CURRENT BOWLER
  // ============================================================
  async extractCurrentBowler(page) {
    const bowler = { name: '', overs: '', runs: null, wickets: null };
    try {
      const bowlingContainerSelectors = [
        '.player-card-wrapper', '.player-card.border', '.player-profile',
        '.bowling-card', '.bowler-info', '.current-bowler', '.bowler-container',
        '.player-info', '[class*="bowler"]', '[class*="bowling"]'
      ];
      
      let container = null;
      for (const selector of bowlingContainerSelectors) {
        try {
          const found = await page.$(selector);
          if (found) {
            container = found;
            break;
          }
        } catch (e) { continue; }
      }

      if (!container) {
        const teamInnings = await page.$$('.team-innig, .live-data, .team-result');
        if (teamInnings.length >= 2) {
          const bowlingTeam = teamInnings[1];
          const playerCards = await bowlingTeam.$$('.player-card, .player-card-wrapper, .player-profile');
          if (playerCards.length > 0) {
            container = playerCards[0];
          }
        }
      }

      if (!container) return bowler;

      const nameSelectors = [
        '.batsmen-name', '.player-name', '.name', '.bowler-name',
        'a[href*="/player/"] p', 'a[href*="/player/"]', '.p-name'
      ];
      for (const nameSel of nameSelectors) {
        try {
          const nameEl = await container.$(nameSel);
          if (nameEl) {
            const text = await page.evaluate(el => el.textContent.trim(), nameEl);
            if (text && text.length > 0 && text.length < 50) {
              bowler.name = text;
              break;
            }
          }
        } catch (e) {}
      }

      const figuresSelectors = [
        '.bowling-figures', '.figures', '.stats', '.score',
        '.bowling-stats', '.bowler-stats'
      ];
      for (const figSel of figuresSelectors) {
        try {
          const figEl = await container.$(figSel);
          if (figEl) {
            const text = await page.evaluate(el => el.textContent.trim(), figEl);
            if (text) {
              const figuresMatch = text.match(/(\d+)-(\d+)\s*\(([\d.]+)\)/);
              if (figuresMatch) {
                bowler.wickets = parseInt(figuresMatch[1]);
                bowler.runs = parseInt(figuresMatch[2]);
                bowler.overs = figuresMatch[3];
                break;
              }
            }
          }
        } catch (e) {}
      }

      if (!bowler.overs && !bowler.runs && !bowler.wickets) {
        try {
          const text = await page.evaluate(el => el.textContent.trim(), container);
          if (text) {
            const figuresMatch = text.match(/(\d+)-(\d+)\s*\(([\d.]+)\)/);
            if (figuresMatch) {
              bowler.wickets = parseInt(figuresMatch[1]);
              bowler.runs = parseInt(figuresMatch[2]);
              bowler.overs = figuresMatch[3];
            }
          }
        } catch (e) {}
      }
    } catch (error) {}
    return bowler;
  }

  // ============================================================
  // EXTRACT TOSS
  // ============================================================
  async extractToss(page) {
    const toss = { status: 'Not Started' };
    let foundToss = false;
    let tossMessage = '';

    const tossSelectors = [
      '.toss-wrap p', '.toss-wrap', '[class*="toss"] p', '[class*="toss"]',
      '.match-info .toss', '.toss-info', '.toss-detail', '.match-toss'
    ];

    for (const selector of tossSelectors) {
      try {
        const elements = await page.$$(selector);
        for (const el of elements) {
          try {
            let text = await page.evaluate(el => el.textContent.trim(), el);
            if (text && text.length > 0) {
              text = text.replace(/\s+/g, ' ').trim();
              if (text.includes('won the toss')) {
                tossMessage = text;
                foundToss = true;
                toss.status = tossMessage;
                return toss;
              }
            }
          } catch (e) { continue; }
        }
        if (foundToss) break;
      } catch (error) { continue; }
    }

    if (!foundToss) {
      try {
        const bodyText = await page.evaluate(() => document.body.textContent);
        const lines = bodyText.split('\n');
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.includes('won the toss')) {
            tossMessage = trimmedLine.replace(/\s+/g, ' ').trim();
            foundToss = true;
            toss.status = tossMessage;
            return toss;
          }
        }
      } catch (e) {}
    }

    return toss;
  }

  // ============================================================
  // EXTRACT SERIES
  // ============================================================
  async extractSeries(page) {
    const selectors = [
      '.series-name', '.snameTag', '.match-series', '.series-title',
      '.tournament', '.series', '.match-tournament', 'h1',
      '.match-header .series', '.match-info .series'
    ];
    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const text = await page.evaluate(el => el.textContent.trim(), el);
          if (text && text.length > 0) {
            return text;
          }
        }
      } catch (e) {}
    }
    try {
      const title = await page.title();
      if (title && !title.includes('Cricket') && title.length > 3) {
        return title;
      }
    } catch (e) {}
    return '';
  }

  // ============================================================
  // EXTRACT VENUE
  // ============================================================
  async extractVenue(page) {
    const selectors = [
      '.venue', '.match-venue', '.venue-name', '.location', '.stadium',
      '.match-location', '.match-info .venue', '.match-details .venue',
      '.matchInfo', '.info-row', '.venue-info', '.meta-info',
      '.scorecard-header', '[data-testid*="venue"]', '[class*="venue"]',
      '[class*="location"]'
    ];
    
    for (const selector of selectors) {
      try {
        const elements = await page.$$(selector);
        for (const el of elements) {
          const text = await page.evaluate(el => el.textContent.trim(), el);
          if (text && text.length > 3 && !text.includes('Over') && !text.includes('wd')) {
            return text;
          }
        }
      } catch (e) {}
    }
    
    try {
      const bodyText = await page.evaluate(() => document.body.textContent);
      const patterns = [
        /Venue:\s*([^,\n]+(?:,[^,\n]+)?)/i,
        /at\s+([A-Za-z\s,]+(?:Stadium|Ground|Park|Gardens|Oval))/i,
        /Stadium:\s*([^,\n]+)/i,
        /Ground:\s*([^,\n]+)/i,
        /Location:\s*([^,\n]+)/i
      ];
      for (const pattern of patterns) {
        const match = bodyText.match(pattern);
        if (match && match[1]) {
          const venue = match[1].trim();
          if (venue && venue.length > 3) {
            return venue;
          }
        }
      }
    } catch (e) {}
    
    return '';
  }

  // ============================================================
  // EXTRACT SCOREBOARD - Supports The Hundred (35b) format
  // ============================================================
  async extractScoreboard(page) {
    const scoreboard = {
      batting_team: { name: '', score: '', runs: null, wickets: null, overs: '' },
      bowling_team: { name: '' },
      target: null,
      required_runs: null,
      required_balls: null,
      crr: null,
      rrr: null,
      current_ball: ''
    };

    const teamInningsSelectors = ['.team-innig', '.live-data', '.team-result', '.result-box'];
    let battingEl = null;
    let bowlingEl = null;
    
    for (const selector of teamInningsSelectors) {
      try {
        const elements = await page.$$(selector);
        if (elements.length >= 2) {
          battingEl = elements[0];
          bowlingEl = elements[1];
          break;
        }
      } catch (e) {}
    }

    if (battingEl && bowlingEl) {
      const nameSelectors = ['.team-name', '.name', '.team-title', '.team-label'];
      for (const sel of nameSelectors) {
        try {
          const el = await battingEl.$(sel);
          if (el) {
            const text = await page.evaluate(el => el.textContent.trim(), el);
            if (text) {
              scoreboard.batting_team.name = text;
              break;
            }
          }
        } catch (e) {}
      }

      const runsContainer = await battingEl.$('.runs, .score, .team-score');
      
      if (runsContainer) {
        const spans = await runsContainer.$$('span');
        const spanTexts = [];
        for (const span of spans) {
          const text = await page.evaluate(el => el.textContent.trim(), span);
          if (text) spanTexts.push(text);
        }
        
        if (spanTexts.length > 0) {
          const scoreText = spanTexts[0];
          const scoreMatch = scoreText.match(/(\d+)\s*[-/]\s*(\d+)/);
          if (scoreMatch) {
            scoreboard.batting_team.score = scoreText;
            scoreboard.batting_team.runs = parseInt(scoreMatch[1]);
            scoreboard.batting_team.wickets = parseInt(scoreMatch[2]);
          } else {
            const numMatch = scoreText.match(/(\d+)/);
            if (numMatch) {
              scoreboard.batting_team.score = scoreText;
              scoreboard.batting_team.runs = parseInt(numMatch[1]);
            }
          }
        }
        
        if (spanTexts.length > 1) {
          const oversValue = spanTexts[1];
          const overRegex = /^(\d+\.\d+|\d+b)$/i;
          if (oversValue && overRegex.test(oversValue)) {
            scoreboard.batting_team.overs = oversValue;
            scoreboard.current_ball = oversValue.replace(/[()]/g, '');
          } else {
            const allText = await page.evaluate(el => el.textContent.trim(), runsContainer);
            const overMatch = allText.match(/(\d+\.\d+|\d+b)/);
            if (overMatch) {
              scoreboard.batting_team.overs = overMatch[1];
              scoreboard.current_ball = overMatch[1].replace(/[()]/g, '');
            }
          }
        } else {
          const battingText = await page.evaluate(el => el.textContent.trim(), battingEl);
          const overMatch = battingText.match(/(\d+\.\d+|\d+b)/);
          if (overMatch) {
            scoreboard.batting_team.overs = overMatch[1];
            scoreboard.current_ball = overMatch[1].replace(/[()]/g, '');
          }
        }
      }

      for (const sel of nameSelectors) {
        try {
          const el = await bowlingEl.$(sel);
          if (el) {
            const text = await page.evaluate(el => el.textContent.trim(), el);
            if (text) {
              scoreboard.bowling_team.name = text;
              break;
            }
          }
        } catch (e) {}
      }
    }

    const crrSelectors = ['.crr', '.current-run-rate', '.run-rate'];
    for (const sel of crrSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          const text = await page.evaluate(el => el.textContent.trim(), el);
          if (text) {
            const numMatch = text.match(/(\d+\.\d+)/);
            if (numMatch) { scoreboard.crr = parseFloat(numMatch[1]); break; }
          }
        }
      } catch (e) {}
    }

    const rrrSelectors = ['.rrr', '.required-run-rate', '.req-run-rate'];
    for (const sel of rrrSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          const text = await page.evaluate(el => el.textContent.trim(), el);
          if (text) {
            const numMatch = text.match(/(\d+\.\d+)/);
            if (numMatch) { scoreboard.rrr = parseFloat(numMatch[1]); break; }
          }
        }
      } catch (e) {}
    }

    return scoreboard;
  }

  // ============================================================
  // EXTRACT OVERS TIMELINE
  // ============================================================
  async extractOversTimeline(page) {
    const overs = [];
    const containerSelectors = [
      '.overs-timeline', '.overs-slide-container', '.overs-container'
    ];
    for (const containerSel of containerSelectors) {
      try {
        const container = await page.$(containerSel);
        if (container) {
          const slideSelectors = ['.overs-slide', '.content', '.over-item'];
          for (const slideSel of slideSelectors) {
            const slides = await container.$$(slideSel);
            for (const slide of slides) {
              let overNumber = '';
              const overSelectors = [
                '.over-title', '.over-number', '.title', '.header', 'h4'
              ];
              for (const sel of overSelectors) {
                try {
                  const el = await slide.$(sel);
                  if (el) {
                    const text = await page.evaluate(el => el.textContent.trim(), el);
                    if (text) {
                      let match = text.match(/Over\s*(\d+)/i);
                      if (match) { overNumber = match[1]; break; }
                      match = text.match(/(\d+)(?:st|nd|rd|th)\s+Five/i);
                      if (match) { overNumber = `${match[1]}th Five`; break; }
                      if (text.match(/^\d+$/)) { overNumber = text; break; }
                    }
                  }
                } catch (e) {}
              }
              if (!overNumber) {
                try {
                  const text = await page.evaluate(el => el.textContent.trim(), slide);
                  let match = text.match(/Over\s*(\d+)/i);
                  if (match) { overNumber = match[1]; }
                  else {
                    match = text.match(/(\d+)(?:st|nd|rd|th)\s+Five/i);
                    if (match) { overNumber = `${match[1]}th Five`; }
                  }
                } catch (e) {}
              }
              const balls = [];
              const ballElements = await slide.$$('.over-ball, .ball');
              for (const ballEl of ballElements) {
                const result = await page.evaluate(el => el.textContent.trim(), ballEl);
                if (result) balls.push(result);
              }
              let total = '';
              const totalSelectors = ['.total', '.over-total'];
              for (const sel of totalSelectors) {
                try {
                  const el = await slide.$(sel);
                  if (el) {
                    const text = await page.evaluate(el => el.textContent.trim(), el);
                    if (text) { total = text.replace(/^=\s*/, '').trim(); break; }
                  }
                } catch (e) {}
              }
              if (!total) {
                try {
                  const text = await page.evaluate(el => el.textContent.trim(), slide);
                  const match = text.match(/=\s*(\d+)/);
                  if (match) { total = match[1]; }
                } catch (e) {}
              }
              if (overNumber || balls.length > 0) {
                overs.push({ over: overNumber || '', balls: balls, total: total || '' });
              }
            }
            if (overs.length > 0) break;
          }
        }
        if (overs.length > 0) break;
      } catch (e) {}
    }
    return overs;
  }

  // ============================================================
  // EXTRACT COMMENTARY
  // ============================================================
  async extractCommentary(page) {
    const commentary = [];
    const containerSelectors = [
      '.commentary-container', '.commentary-section', '.commentary-list', '.live-commentary'
    ];
    for (const containerSel of containerSelectors) {
      try {
        const container = await page.$(containerSel);
        if (container) {
          const itemSelectors = ['.commentary-item', '.comment', '.ball-commentary'];
          for (const itemSel of itemSelectors) {
            const items = await container.$$(itemSel);
            for (const item of items) {
              const ball = await this.extractTextFromSelectors(page, item, [
                '.ball-number', '.over-ball', '.ball'
              ]);
              const result = await this.extractTextFromSelectors(page, item, [
                '.result', '.event', '.ball-result'
              ]);
              const text = await this.extractTextFromSelectors(page, item, [
                '.comment-text', '.description', '.comment'
              ]);
              if (ball || text || result) {
                commentary.push({ ball: ball || '', result: result || '', text: text || '' });
              }
            }
            if (commentary.length > 0) break;
          }
        }
        if (commentary.length > 0) break;
      } catch (e) {}
    }
    return commentary;
  }

  // ============================================================
  // EXTRACT PREDICTION
  // ============================================================
  async extractPrediction(page) {
    const prediction = { home_probability: null, away_probability: null, projected_scores: [] };
    try {
      const displayFlex = await page.$('.displayFlex');
      if (displayFlex) {
        const percentageElements = await displayFlex.$$('.percentageScreenText');
        const percentages = [];
        for (const el of percentageElements) {
          const text = await page.evaluate(el => el.textContent.trim(), el);
          if (text) {
            const num = parseInt(text.replace('%', ''));
            if (!isNaN(num)) percentages.push(num);
          }
        }
        if (percentages.length >= 2) {
          prediction.home_probability = percentages[0];
          prediction.away_probability = percentages[1];
        }
      }
    } catch (error) {}
    return prediction;
  }

  // ============================================================
  // HELPER: EXTRACT TEXT FROM SELECTORS
  // ============================================================
  async extractTextFromSelectors(page, element, selectors) {
    for (const selector of selectors) {
      try {
        const el = await element.$(selector);
        if (el) {
          const text = await page.evaluate(el => el.textContent.trim(), el);
          if (text) return text;
        }
      } catch (e) {}
    }
    return '';
  }

  // ============================================================
  // GET TEAM ID FROM NAME
  // ============================================================
  getTeamId(teamName) {
    if (!teamName) return `team_${Date.now()}`;
    for (const [name, id] of Object.entries(this.teamIdMap)) {
      if (teamName.includes(name) || name.includes(teamName)) {
        return id;
      }
    }
    const cleanName = teamName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `team_${cleanName}`;
  }

  // ============================================================
  // LOG STATISTICS
  // ============================================================
  logStatistics() {
    logger.info(`📊 Live Scraper Statistics:`);
    logger.info(`   Discovered: ${this.stats.discovered}`);
    logger.info(`   Detailed extracted: ${this.stats.detailed}`);
    logger.info(`   Weather Success: ${this.stats.weatherSuccess}`);
    logger.info(`   Weather Failed: ${this.stats.weatherFailed}`);
    logger.info(`   Errors: ${this.stats.errors}`);
    logger.info(`   Total Requests: ${this.requestCount}`);
    logger.info(`   Success rate: ${this.stats.discovered > 0 ? Math.round((this.stats.detailed / this.stats.discovered) * 100) : 0}%`);
  }
}

module.exports = LiveScraper;