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
  console.log(
    util.inspect(data, {
      depth: null,
      colors: true,
      compact: false,
      maxArrayLength: null,
      maxStringLength: null,
      showHidden: false,
    })
  );
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
      weatherFailed: 0,
    };

    // Agent configuration
    this.numberOfAgents = 4;
    this.agentStaggerDelay = 3000;
    this.matchDelay = 2000;

    // Real-time update interval
    this.updateInterval = 5000;
    this.isPolling = false;
    this.pollingInterval = null;
    this.activeMatches = new Map();

    // Rate limiting
    this.maxRetries = 3;
    this.browser = null;
    this.page = null;
    this.context = null;
    this.requestCount = 0;
    this.lastRequestTime = 0;
    this.isBrowserInitialized = false;

    // Lock management
    this.isScraping = false;
    this.scrapeLockTimeout = 60000;
    this.scrapeStartTime = null;

    // Browser manager
    this.browserManager = browserManager;
    this.useBrowserManager = true;

    // Weather caches
    this.geoCache = new Map();
    this.weatherCache = new Map();

    // Track processed URLs
    this.processedUrls = new Set();
    this.agentResults = [];
    this.agentStats = {};

    // Cache buster for real-time data
    this.cacheBuster = Date.now();

    // Callbacks for real-time updates
    this.onMatchUpdate = null;
    this.onMatchComplete = null;
    this.onNewMatch = null;

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
      99: { condition: 'Thunderstorm', icon: '11d' },
    };

    // Country mapping
    this.countryMap = {
      India: 'India',
      England: 'England',
      Australia: 'Australia',
      Pakistan: 'Pakistan',
      'New Zealand': 'New Zealand',
      'South Africa': 'South Africa',
      'West Indies': 'West Indies',
      'Sri Lanka': 'Sri Lanka',
      Bangladesh: 'Bangladesh',
      Afghanistan: 'Afghanistan',
      Zimbabwe: 'Zimbabwe',
      Ireland: 'Ireland',
      Nepal: 'Nepal',
      Namibia: 'Namibia',
      Guyana: 'Guyana',
    };

    // City to country mapping
    this.cityCountryMap = {
      London: 'England',
      Birmingham: 'England',
      Manchester: 'England',
      Leeds: 'England',
      Nottingham: 'England',
      Southampton: 'England',
      Taunton: 'England',
      Cardiff: 'Wales',
      Edinburgh: 'Scotland',
      Dublin: 'Ireland',
      Melbourne: 'Australia',
      Sydney: 'Australia',
      Brisbane: 'Australia',
      Perth: 'Australia',
      Adelaide: 'Australia',
      Auckland: 'New Zealand',
      Wellington: 'New Zealand',
      Christchurch: 'New Zealand',
      Mumbai: 'India',
      Delhi: 'India',
      Bangalore: 'India',
      Chennai: 'India',
      Kolkata: 'India',
      Hyderabad: 'India',
      Ahmedabad: 'India',
      Pune: 'India',
      Lahore: 'Pakistan',
      Karachi: 'Pakistan',
      Rawalpindi: 'Pakistan',
      Multan: 'Pakistan',
      Dhaka: 'Bangladesh',
      Colombo: 'Sri Lanka',
      Kandy: 'Sri Lanka',
      Galle: 'Sri Lanka',
      Dambulla: 'Sri Lanka',
      Kathmandu: 'Nepal',
      Dubai: 'UAE',
      'Abu Dhabi': 'UAE',
      Sharjah: 'UAE',
      Johannesburg: 'South Africa',
      'Cape Town': 'South Africa',
      Durban: 'South Africa',
      Centurion: 'South Africa',
      Harare: 'Zimbabwe',
      Bulawayo: 'Zimbabwe',
      Windhoek: 'Namibia',
      'Port of Spain': 'Trinidad and Tobago',
      Bridgetown: 'Barbados',
      Georgetown: 'Guyana',
      Providence: 'Guyana',
    };

    // Tournament to location mapping
    this.tournamentLocationMap = {
      'The Hundred': 'England',
      'The Hundred W': 'England',
      'England One Day Cup': 'England',
      'County Championship': 'England',
      IPL: 'India',
      'Indian Premier League': 'India',
      BBL: 'Australia',
      'Big Bash': 'Australia',
      CPL: 'West Indies',
      'Caribbean Premier League': 'West Indies',
      PSL: 'Pakistan',
      'Pakistan Super League': 'Pakistan',
      LPL: 'Sri Lanka',
      'Lanka Premier League': 'Sri Lanka',
      DPL: 'India',
      'Delhi Premier League': 'India',
      'Nepal Premier League': 'Nepal',
      'Namibia T20': 'Namibia',
      'CWC League': 'Namibia',
      'ECS England': 'England',
      'England-Hornchurch T10': 'England',
    };

    // Team ID mapping
    this.teamIdMap = {
      India: 'team_ind',
      England: 'team_eng',
      Australia: 'team_aus',
      Pakistan: 'team_pak',
      'New Zealand': 'team_nz',
      'South Africa': 'team_sa',
      'West Indies': 'team_wi',
      'Sri Lanka': 'team_sl',
      Bangladesh: 'team_ban',
      Afghanistan: 'team_afg',
      Zimbabwe: 'team_zim',
      Ireland: 'team_ire',
      Nepal: 'team_nep',
      Namibia: 'team_nam',
      Maharani: 'team_maharani',
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
      Worcestershire: 'team_worcs',
      Derbyshire: 'team_derby',
      'Lahore Qalandars': 'team_lahore',
      'Perth Scorchers': 'team_perth',
      'Guyana Amazon Warriors': 'team_guyana',
      'San Francisco Unicorns': 'team_san_francisco',
      'BP-W': 'team_bp_w',
      'TR-W': 'team_tr_w',
      GLCS: 'team_glcs',
      SOM: 'team_som',
    };
  }

  // ============================================================
  // GET COUNTRY FROM TEAM NAME
  // ============================================================
  getCountryFromTeamName(teamName) {
    if (!teamName) return null;

    for (const [key, country] of Object.entries(this.countryMap)) {
      if (teamName.includes(key) || key.includes(teamName)) {
        return country;
      }
    }

    for (const [city, country] of Object.entries(this.cityCountryMap)) {
      if (teamName.includes(city) || city.includes(teamName)) {
        return country;
      }
    }

    return null;
  }

  // ============================================================
  // GET LOCATION FROM SERIES NAME
  // ============================================================
  getLocationFromSeries(seriesName) {
    if (!seriesName) return null;

    for (const [tournament, location] of Object.entries(this.tournamentLocationMap)) {
      if (seriesName.includes(tournament) || tournament.includes(seriesName)) {
        return location;
      }
    }

    for (const [country] of Object.entries(this.countryMap)) {
      if (seriesName.includes(country)) {
        return country;
      }
    }

    for (const [city, country] of Object.entries(this.cityCountryMap)) {
      if (seriesName.includes(city)) {
        return country;
      }
    }

    if (seriesName.includes('W ') || seriesName.includes('Women')) {
      return 'England';
    }

    if (seriesName.includes('100B') || seriesName.includes('The Hundred')) {
      return 'England';
    }

    return null;
  }

  // ============================================================
  // GET LOCATION FROM URL
  // ============================================================
  getLocationFromUrl(url) {
    if (!url) return null;

    const urlParts = url.split('/');
    for (const part of urlParts) {
      const decoded = decodeURIComponent(part).replace(/-/g, ' ');

      for (const [tournament, location] of Object.entries(this.tournamentLocationMap)) {
        if (decoded.includes(tournament.toLowerCase()) || decoded.includes(tournament)) {
          return location;
        }
      }

      for (const [country] of Object.entries(this.countryMap)) {
        if (decoded.includes(country.toLowerCase()) || decoded.includes(country)) {
          return country;
        }
      }

      for (const [city, country] of Object.entries(this.cityCountryMap)) {
        if (decoded.includes(city.toLowerCase()) || decoded.includes(city)) {
          return country;
        }
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
        .replace(
          /Cricket Ground|Ground|Stadium|International Stadium|Sports Complex|Oval|Arena|Park|Gardens|Cricket Club|CC/gi,
          ''
        )
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanedVenue !== venue && cleanedVenue.length > 2) {
        candidates.add(cleanedVenue);
      }
      if (venue.includes(',')) {
        const parts = venue.split(',').map((p) => p.trim());
        parts.forEach((part) => {
          if (part.length > 2) candidates.add(part);
        });
      }
      const cityMatch = venue.match(/,?\s*([A-Za-z\s]+)$/);
      if (cityMatch && cityMatch[1] && cityMatch[1].length > 2) {
        candidates.add(cityMatch[1].trim());
      }
    }

    if (series) {
      const seriesLocation = this.getLocationFromSeries(series);
      if (seriesLocation) {
        candidates.add(seriesLocation);
        for (const [city, country] of Object.entries(this.cityCountryMap)) {
          if (seriesLocation.includes(city) || city.includes(seriesLocation)) {
            candidates.add(country);
          }
        }
      }
    }

    if (matchTitle) {
      for (const [country] of Object.entries(this.countryMap)) {
        if (matchTitle.includes(country)) {
          candidates.add(country);
        }
      }
      for (const [city, country] of Object.entries(this.cityCountryMap)) {
        if (matchTitle.includes(city)) {
          candidates.add(city);
          candidates.add(country);
        }
      }
      for (const [tournament, location] of Object.entries(this.tournamentLocationMap)) {
        if (matchTitle.includes(tournament)) {
          candidates.add(location);
        }
      }
    }

    if (team1Name) {
      const country = this.getCountryFromTeamName(team1Name);
      if (country) candidates.add(country);
    }
    if (team2Name) {
      const country = this.getCountryFromTeamName(team2Name);
      if (country) candidates.add(country);
    }

    const urlLocation = this.getLocationFromUrl(matchUrl);
    if (urlLocation) {
      candidates.add(urlLocation);
    }

    candidates.add('England');

    const validCandidates = new Set();
    for (const candidate of candidates) {
      const trimmed = candidate.trim();
      if (trimmed && trimmed !== 'TBD' && trimmed !== 'tbd' && trimmed.length > 2) {
        validCandidates.add(trimmed);
      }
    }

    const prioritized = [];
    const englandCandidates = [];
    const countryCandidates = [];
    const cityCandidates = [];
    const otherCandidates = [];

    for (const candidate of validCandidates) {
      if (
        candidate.toLowerCase() === 'england' ||
        candidate.toLowerCase() === 'uk' ||
        candidate.toLowerCase() === 'united kingdom'
      ) {
        englandCandidates.push(candidate);
      } else if (
        Object.values(this.countryMap).some(
          (c) => candidate.toLowerCase() === c.toLowerCase() || candidate.includes(c)
        )
      ) {
        countryCandidates.push(candidate);
      } else if (
        Object.keys(this.cityCountryMap).some(
          (c) => candidate.toLowerCase() === c.toLowerCase() || candidate.includes(c)
        )
      ) {
        cityCandidates.push(candidate);
      } else {
        otherCandidates.push(candidate);
      }
    }

    prioritized.push(...englandCandidates);
    prioritized.push(...countryCandidates);
    prioritized.push(...cityCandidates);
    prioritized.push(...otherCandidates);

    const seen = new Set();
    const uniqueCandidates = [];
    for (const candidate of prioritized) {
      const lower = candidate.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        uniqueCandidates.push(candidate);
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
      return this.geoCache.get(cacheKey);
    }

    try {
      const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;

      const response = await axios.get(geocodeUrl, {
        timeout: 8000,
      });

      if (response.data.results && response.data.results.length > 0) {
        const result = response.data.results[0];
        const coords = {
          lat: result.latitude,
          lon: result.longitude,
          name: result.name,
          country: result.country,
        };
        this.geoCache.set(cacheKey, coords);
        return coords;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  // ============================================================
  // GET WEATHER FOR VENUE
  // ============================================================
  async getWeatherForVenue(venue, series, matchTitle, team1Name, team2Name, matchUrl) {
    const candidates = this.buildLocationCandidates(
      venue,
      series,
      matchTitle,
      team1Name,
      team2Name,
      matchUrl
    );

    if (candidates.length === 0) {
      return null;
    }

    for (let i = 0; i < Math.min(candidates.length, 5); i++) {
      const location = candidates[i];

      try {
        const coords = await this.getCoordinates(location);
        if (!coords) continue;

        const { lat: latitude, lon: longitude } = coords;
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=precipitation_probability_max&timezone=auto`;

        const weatherResponse = await axios.get(weatherUrl, { timeout: 8000 });
        const data = weatherResponse.data;

        if (!data.current) continue;

        const current = data.current;
        const weatherCode = current.weather_code;
        const weatherInfo = this.weatherCodeMap[weatherCode] || {
          condition: 'Unknown',
          icon: '01d',
        };

        let rainProbability = null;
        if (
          data.daily &&
          data.daily.precipitation_probability_max &&
          data.daily.precipitation_probability_max.length > 0
        ) {
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
          last_updated: new Date().toISOString(),
        };

        this.stats.weatherSuccess++;
        return weather;
      } catch (error) {
        continue;
      }
    }

    this.stats.weatherFailed++;
    return null;
  }

  // ============================================================
  // SLEEP
  // ============================================================
  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================================
  // GET RANDOM USER AGENT
  // ============================================================
  getRandomUserAgent() {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  // ============================================================
  // INITIALIZE BROWSER
  // ============================================================
  async initializeBrowser() {
    try {
      if (this.isBrowserInitialized && this.browser && this.browser.isConnected()) {
        return true;
      }

      if (this.browserManager.browser && this.browserManager.browser.isConnected()) {
        this.browser = this.browserManager.browser;
        this.context = this.browserManager.context;
        
        if (this.context) {
          this.page = await this.context.newPage();
          this.page.setDefaultTimeout(60000);
          this.page.setDefaultNavigationTimeout(60000);
          
          const userAgent = this.getRandomUserAgent();
          await this.page.setExtraHTTPHeaders({
            'User-Agent': userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            'Referer': 'https://crex.com/'
          });
        }
        
        this.isBrowserInitialized = true;
        logger.info('✅ Browser initialized (using existing)');
        return true;
      }

      await this.browserManager.launch();
      this.browser = this.browserManager.browser;
      this.context = this.browserManager.context;

      if (this.context) {
        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(60000);
        this.page.setDefaultNavigationTimeout(60000);
        
        const userAgent = this.getRandomUserAgent();
        await this.page.setExtraHTTPHeaders({
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
          'Referer': 'https://crex.com/'
        });
      }

      this.isBrowserInitialized = true;
      logger.info('✅ Browser initialized (new)');
      return true;
    } catch (error) {
      logger.error(`Failed to initialize browser: ${error.message}`);
      this.isBrowserInitialized = false;
      return false;
    }
  }

  // ============================================================
  // CLOSE BROWSER
  // ============================================================
  async closeBrowser() {
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
        this.page = null;
      }
      this.isBrowserInitialized = false;
      return true;
    } catch (error) {
      this.page = null;
      this.isBrowserInitialized = false;
      return false;
    }
  }

  // ============================================================
  // NAVIGATE WITH RETRY
  // ============================================================
  async navigateWithRetry(url, options = {}) {
    const maxRetries = options.maxRetries || this.maxRetries;

    if (!this.isBrowserInitialized || !this.page) {
      const initialized = await this.initializeBrowser();
      if (!initialized) {
        throw new Error('Failed to initialize browser');
      }
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < 2000) {
          await this.sleep(2000 - timeSinceLastRequest + Math.random() * 1000);
        }

        this.lastRequestTime = Date.now();
        this.requestCount++;

        logger.info(`🔄 Navigation attempt ${attempt}/${maxRetries}: ${url}`);

        const userAgent = this.getRandomUserAgent();
        await this.page.setExtraHTTPHeaders({
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
          'Referer': 'https://crex.com/'
        });

        const response = await this.page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        if (response && response.status() === 403) {
          logger.warn(`⚠️ 403 Forbidden on attempt ${attempt}`);
          if (attempt === maxRetries) {
            throw new Error('403 Forbidden');
          }
          await this.sleep(5000 * attempt);
          continue;
        }

        if (response && response.status() >= 400) {
          logger.warn(`⚠️ Status ${response.status()} on attempt ${attempt}`);
          if (attempt === maxRetries) {
            throw new Error(`Status ${response.status()}`);
          }
          await this.sleep(3000 * attempt);
          continue;
        }

        await this.page.waitForLoadState('domcontentloaded');
        await this.sleep(2000 + Math.random() * 2000);
        
        logger.info(`✅ Navigation successful on attempt ${attempt}`);
        return response;
      } catch (error) {
        logger.warn(`❌ Navigation attempt ${attempt} failed: ${error.message}`);
        if (attempt === maxRetries) {
          throw error;
        }
        if (attempt === 2) {
          logger.info('🔄 Reinitializing browser...');
          await this.closeBrowser();
          await this.initializeBrowser();
        }
        await this.sleep(3000 * attempt);
      }
    }

    throw new Error(`Failed to navigate after ${maxRetries} attempts`);
  }

  // ============================================================
  // START REAL-TIME POLLING
  // ============================================================
  async startRealTimeUpdates(options = {}) {
    const {
      onUpdate,
      onComplete,
      onNewMatch,
      interval = 5000,
    } = options;

    if (this.isPolling) {
      logger.warn('⚠️ Real-time polling already running');
      return false;
    }

    logger.info(`🔄 Starting real-time updates every ${interval}ms`);

    this.onMatchUpdate = onUpdate || null;
    this.onMatchComplete = onComplete || null;
    this.onNewMatch = onNewMatch || null;
    this.updateInterval = interval;
    this.isPolling = true;

    const initialResult = await this.scrapeLive(true);
    if (initialResult.success && initialResult.data.length > 0) {
      initialResult.data.forEach(match => {
        const matchId = match.match_id;
        this.activeMatches.set(matchId, {
          data: match,
          lastUpdate: Date.now(),
          isComplete: false
        });
      });

      if (this.onNewMatch) {
        initialResult.data.forEach(match => {
          this.onNewMatch(match);
        });
      }
    }

    this.pollingInterval = setInterval(async () => {
      try {
        await this.pollLiveMatches();
      } catch (error) {
        logger.error(`❌ Polling error: ${error.message}`);
      }
    }, this.updateInterval);

    logger.info(`✅ Real-time updates started`);
    return true;
  }

  // ============================================================
  // STOP REAL-TIME POLLING
  // ============================================================
  stopRealTimeUpdates() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.isPolling = false;
    logger.info('⏹️ Real-time updates stopped');
    return true;
  }

  // ============================================================
  // POLL LIVE MATCHES
  // ============================================================
  async pollLiveMatches() {
    logger.debug('🔄 Polling live matches for updates...');

    try {
      const result = await this.scrapeLive(true);
      
      if (!result.success || result.data.length === 0) {
        for (const [matchId, matchData] of this.activeMatches) {
          if (!matchData.isComplete) {
            matchData.isComplete = true;
            if (this.onMatchComplete) {
              this.onMatchComplete(matchData.data);
            }
          }
        }
        return;
      }

      const currentMatchIds = new Set();
      
      for (const match of result.data) {
        const matchId = match.match_id;
        currentMatchIds.add(matchId);

        if (this.activeMatches.has(matchId)) {
          const existing = this.activeMatches.get(matchId);
          
          const oldScore = existing.data.scoreboard?.batting_team?.score || '';
          const newScore = match.scoreboard?.batting_team?.score || '';
          const oldWickets = existing.data.scoreboard?.batting_team?.wickets || '';
          const newWickets = match.scoreboard?.batting_team?.wickets || '';

          const isComplete = match.match?.status?.toLowerCase().includes('complete') || 
                             match.match?.status?.toLowerCase().includes('finished');

          if (isComplete && !existing.isComplete) {
            existing.isComplete = true;
            if (this.onMatchComplete) {
              this.onMatchComplete(match);
            }
          }

          if (oldScore !== newScore || oldWickets !== newWickets) {
            logger.info(`📊 Match ${matchId} updated: ${newScore}/${newWickets}`);
            
            existing.data = match;
            existing.lastUpdate = Date.now();
            
            if (this.onMatchUpdate) {
              this.onMatchUpdate(match, {
                previousScore: oldScore,
                newScore: newScore,
                previousWickets: oldWickets,
                newWickets: newWickets
              });
            }
          }
        } else {
          logger.info(`🆕 New match detected: ${match.teams.home.name} vs ${match.teams.away.name}`);
          
          this.activeMatches.set(matchId, {
            data: match,
            lastUpdate: Date.now(),
            isComplete: false
          });
          
          if (this.onNewMatch) {
            this.onNewMatch(match);
          }
        }
      }

      for (const [matchId, matchData] of this.activeMatches) {
        if (!currentMatchIds.has(matchId) && !matchData.isComplete) {
          matchData.isComplete = true;
          if (this.onMatchComplete) {
            this.onMatchComplete(matchData.data);
          }
        }
      }

    } catch (error) {
      logger.error(`❌ Polling error: ${error.message}`);
    }
  }

  // ============================================================
  // MAIN SCRAPE METHOD
  // ============================================================
  async scrapeLive(forceRefresh = true) {
    // Check for stale lock
    if (this.isScraping && this.scrapeStartTime) {
      const elapsed = Date.now() - this.scrapeStartTime;
      if (elapsed > this.scrapeLockTimeout) {
        logger.warn(`⚠️ Stale scrape lock detected (${elapsed}ms), releasing...`);
        this.isScraping = false;
        this.scrapeStartTime = null;
      }
    }

    if (this.isScraping) {
      logger.warn('⚠️ Scrape already in progress');
      return {
        success: false,
        timestamp: new Date().toISOString(),
        data: [],
        total: 0,
        message: 'Scrape already in progress',
      };
    }

    // Acquire lock
    this.isScraping = true;
    this.scrapeStartTime = Date.now();
    this.processedUrls.clear();
    this.agentResults = [];
    this.agentStats = {};

    if (forceRefresh) {
      this.cacheBuster = Date.now();
      logger.info('🔄 Force refresh enabled - bypassing cache');
    }

    logger.info('🚀 Starting live matches scraper with Agent-based architecture');
    logger.info(`📋 Agents: ${this.numberOfAgents}, Stagger Delay: ${this.agentStaggerDelay}ms`);

    try {
      await this.initializeBrowser();

      const discoveredMatches = await this.discoverLiveMatches(forceRefresh);
      this.stats.discovered = discoveredMatches.length;

      if (discoveredMatches.length === 0) {
        logger.info('📢 No live matches currently in progress');
        await this.closeBrowser();
        this.isScraping = false;
        this.scrapeStartTime = null;
        return {
          success: true,
          timestamp: new Date().toISOString(),
          data: [],
          total: 0,
          message: 'No live matches currently in progress',
        };
      }

      logger.info(`📋 Phase 1 complete: Discovered ${discoveredMatches.length} live matches`);

      const fullMatches = await this.processWithAgents(discoveredMatches);
      this.stats.detailed = fullMatches.length;

      logger.info(`📋 Phase 2 complete: Extracted details for ${fullMatches.length} live matches`);

      await this.closeBrowser();
      this.logStatistics();

      const result = {
        success: true,
        timestamp: new Date().toISOString(),
        data: fullMatches,
        total: fullMatches.length,
        cacheBuster: this.cacheBuster,
        duration: Date.now() - this.scrapeStartTime,
      };

      if (fullMatches.length > 0) {
        deepLog('📋 SAMPLE LIVE MATCH - Real-time data', fullMatches[0]);
      }

      this.isScraping = false;
      this.scrapeStartTime = null;
      return result;
    } catch (error) {
      logger.error(`❌ LiveScraper error: ${error.message}`);
      logger.error(error.stack);
      await this.closeBrowser();
      this.isScraping = false;
      this.scrapeStartTime = null;
      return {
        success: false,
        timestamp: new Date().toISOString(),
        data: [],
        total: 0,
        error: error.message,
      };
    }
  }

  // ============================================================
  // DISCOVER LIVE MATCHES
  // ============================================================
  async discoverLiveMatches(forceRefresh = true) {
    logger.info('🔍 Phase 1: Discovering live matches...');

    const url = forceRefresh 
      ? `https://crex.com/cricket-live-score?_=${this.cacheBuster}`
      : 'https://crex.com/cricket-live-score';

    logger.info(`📡 Fetching fresh data from: ${url}`);

    try {
      await this.navigateWithRetry(url, {
        maxRetries: this.maxRetries,
      });

      if (!this.page) {
        logger.warn('⚠️ Page is null, reinitializing...');
        await this.initializeBrowser();
        await this.navigateWithRetry(url, {
          maxRetries: this.maxRetries,
        });
      }

      try {
        await this.page.waitForSelector('.team-innig, .live-score-card, .match-card', { timeout: 10000 });
        logger.info('✅ Found live match indicators on page');
      } catch (e) {
        logger.warn('⚠️ No live match indicators found, waiting for page to settle...');
        await this.sleep(3000);
      }

      const matches = await this.extractLiveMatchesFromPage();

      logger.info(`✅ Discovered ${matches.length} live matches`);
      
      if (matches.length > 0) {
        matches.forEach((match, index) => {
          logger.info(`  ${index + 1}. ${match.team1.name} vs ${match.team2.name} - ${match.team1.score}/${match.team1.wickets} vs ${match.team2.score}/${match.team2.wickets}`);
        });
      }

      return matches;

    } catch (error) {
      logger.error(`❌ Failed to discover live matches: ${error.message}`);
      return [];
    }
  }

  // ============================================================
  // EXTRACT LIVE MATCHES FROM PAGE
  // ============================================================
  async extractLiveMatchesFromPage() {
    if (!this.page) {
      logger.warn('⚠️ Page is null in extractLiveMatchesFromPage');
      return [];
    }

    const matches = await this.page.evaluate(() => {
      const results = [];
      const seenUrls = new Set();

      const cleanText = (text) => {
        if (!text) return '';
        return text.replace(/\s+/g, ' ').trim();
      };

      const getText = (el) => {
        if (!el) return '';
        return el.textContent ? cleanText(el.textContent) : '';
      };

      const containers = document.querySelectorAll('.team-innig, .live-score-card, .match-card, .score-card');
      
      containers.forEach(container => {
        try {
          const link = container.querySelector('a[href*="cricket-live-score"]');
          if (!link) return;
          
          const href = link.getAttribute('href');
          if (!href) return;
          
          const url = href.startsWith('http') ? href : `https://crex.com${href}`;
          if (seenUrls.has(url)) return;
          seenUrls.add(url);

          const urlMatch = url.match(/\/([A-Za-z0-9]+)-vs-([A-Za-z0-9]+)/i);
          let team1Name = 'Team 1';
          let team2Name = 'Team 2';
          
          if (urlMatch) {
            team1Name = urlMatch[1].toUpperCase();
            team2Name = urlMatch[2].toUpperCase();
          }

          const teamElements = container.querySelectorAll('.team-name, .name, .team');
          let teamNames = [];
          teamElements.forEach(el => {
            const name = cleanText(getText(el));
            if (name && name.length > 1 && name.length < 30) {
              teamNames.push(name);
            }
          });
          
          if (teamNames.length >= 2) {
            team1Name = teamNames[0];
            team2Name = teamNames[1];
          }

          const scoreElements = container.querySelectorAll('.score, .runs, .team-score');
          let scores = [];
          scoreElements.forEach(el => {
            const scoreText = cleanText(getText(el));
            if (scoreText && scoreText.length > 0) {
              scores.push(scoreText);
            }
          });

          let series = '';
          const seriesEl = container.querySelector('.series-name, .snameTag, .match-series');
          if (seriesEl) {
            series = cleanText(getText(seriesEl));
          }

          let team1Score = '';
          let team1Wickets = '';
          let team1Overs = '';
          let team2Score = '';
          let team2Wickets = '';
          let team2Overs = '';

          if (scores.length >= 2) {
            const score1 = scores[0] || '';
            const score1Match = score1.match(/(\d+)-(\d+)\s*(\d+)b?/);
            if (!score1Match) {
              const score1MatchAlt = score1.match(/(\d+)[-/](\d+)\s*(?:\(([\d.]+)\))?/);
              if (score1MatchAlt) {
                team1Score = score1MatchAlt[1];
                team1Wickets = score1MatchAlt[2];
                team1Overs = score1MatchAlt[3] || '';
              }
            } else {
              team1Score = score1Match[1];
              team1Wickets = score1Match[2];
              team1Overs = score1Match[3] + 'b';
            }

            const score2 = scores[1] || '';
            const score2Match = score2.match(/(\d+)-(\d+)\s*(\d+)b?/);
            if (!score2Match) {
              const score2MatchAlt = score2.match(/(\d+)[-/](\d+)\s*(?:\(([\d.]+)\))?/);
              if (score2MatchAlt) {
                team2Score = score2MatchAlt[1];
                team2Wickets = score2MatchAlt[2];
                team2Overs = score2MatchAlt[3] || '';
              }
            } else {
              team2Score = score2Match[1];
              team2Wickets = score2Match[2];
              team2Overs = score2Match[3] + 'b';
            }
          }

          let status = 'Live';
          const statusEl = container.querySelector('.status, .match-status, .live-status');
          if (statusEl) {
            const statusText = cleanText(getText(statusEl));
            if (statusText) status = statusText;
          }

          results.push({
            url: url,
            status: status,
            team1: {
              name: team1Name,
              short: team1Name.substring(0, 3).toUpperCase(),
              flag: '',
              score: team1Score,
              wickets: team1Wickets,
              overs: team1Overs,
            },
            team2: {
              name: team2Name,
              short: team2Name.substring(0, 3).toUpperCase(),
              flag: '',
              score: team2Score,
              wickets: team2Wickets,
              overs: team2Overs,
            },
            series: series || 'Unknown Series'
          });

        } catch (e) {
          // Skip this container
        }
      });

      if (results.length === 0) {
        const links = document.querySelectorAll('a[href*="cricket-live-score"]');
        links.forEach(link => {
          try {
            const href = link.getAttribute('href');
            if (!href) return;
            
            const url = href.startsWith('http') ? href : `https://crex.com${href}`;
            if (seenUrls.has(url)) return;
            seenUrls.add(url);

            const urlMatch = url.match(/\/([A-Za-z0-9]+)-vs-([A-Za-z0-9]+)/i);
            if (urlMatch) {
              const team1Name = urlMatch[1].toUpperCase();
              const team2Name = urlMatch[2].toUpperCase();
              
              const parent = link.closest('div, li, article');
              const text = parent ? getText(parent) : '';
              
              let team1Score = '';
              let team2Score = '';
              const scoreMatch = text.match(/(\d+)[-/](\d+)/g);
              if (scoreMatch && scoreMatch.length >= 2) {
                team1Score = scoreMatch[0] || '';
                team2Score = scoreMatch[1] || '';
              }

              results.push({
                url: url,
                status: 'Live',
                team1: {
                  name: team1Name,
                  short: team1Name.substring(0, 3).toUpperCase(),
                  flag: '',
                  score: team1Score,
                  wickets: '',
                  overs: '',
                },
                team2: {
                  name: team2Name,
                  short: team2Name.substring(0, 3).toUpperCase(),
                  flag: '',
                  score: team2Score,
                  wickets: '',
                  overs: '',
                },
                series: 'Unknown Series'
              });
            }
          } catch (e) {
            // Skip this link
          }
        });
      }

      return results;
    });

    return matches;
  }

  // ============================================================
  // PROCESS WITH AGENTS
  // ============================================================
  async processWithAgents(discoveredMatches) {
    logger.info('🤖 Starting Agent-based processing for real-time data...');
    
    const batches = this.splitIntoBatches(discoveredMatches);
    const agentPromises = [];

    for (let i = 0; i < batches.length; i++) {
      const agentNum = i + 1;
      const batch = batches[i];

      if (batch.length === 0) continue;

      const startDelay = i * this.agentStaggerDelay;
      logger.info(`⏳ Agent ${agentNum} starting in ${startDelay}ms...`);

      const agentPromise = new Promise((resolve) => {
        setTimeout(async () => {
          logger.info(`🤖 Agent ${agentNum} started with ${batch.length} matches`);
          const result = await this.runAgent(agentNum, batch);
          resolve(result);
        }, startDelay);
      });

      agentPromises.push(agentPromise);
    }

    const results = await Promise.all(agentPromises);

    const allMatches = [];
    results.forEach((result) => {
      if (result && result.matches) {
        allMatches.push(...result.matches);
      }
    });

    logger.info(`✅ All agents completed. Total matches: ${allMatches.length}`);
    return allMatches;
  }

  // ============================================================
  // SPLIT INTO BATCHES
  // ============================================================
  splitIntoBatches(matches) {
    const batches = [];
    const total = matches.length;
    const batchSize = Math.ceil(total / this.numberOfAgents);

    for (let i = 0; i < this.numberOfAgents; i++) {
      const start = i * batchSize;
      const end = Math.min(start + batchSize, total);

      if (start < total) {
        batches.push(matches.slice(start, end));
      } else {
        batches.push([]);
      }
    }

    return batches;
  }

  // ============================================================
  // RUN AGENT
  // ============================================================
  async runAgent(agentNum, batch) {
    const agentId = `Agent ${agentNum}`;
    const stats = {
      total: batch.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      startTime: Date.now(),
    };

    this.agentStats[agentId] = stats;
    const results = [];

    const page = await this.context.newPage();
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    try {
      for (let i = 0; i < batch.length; i++) {
        const match = batch[i];

        const urlKey = match.url.split('?')[0];
        if (this.processedUrls.has(urlKey)) {
          logger.info(`   ⏭️ ${agentId} skipping duplicate: ${match.url}`);
          continue;
        }
        this.processedUrls.add(urlKey);

        stats.processed++;
        logger.info(`   ${agentId} getting real-time data for: ${match.team1.name} vs ${match.team2.name}`);

        try {
          const matchData = await this.getRealTimeMatchData(page, match, agentId);

          if (matchData) {
            results.push(matchData);
            stats.succeeded++;
            logger.info(`   ✅ ${agentId} got real-time data for ${match.team1.name} vs ${match.team2.name}`);
          } else {
            stats.failed++;
            const fallbackMatch = this.createFallbackMatch(match);
            results.push(fallbackMatch);
          }
        } catch (error) {
          stats.failed++;
          logger.error(`   ❌ ${agentId} error on ${match.team1.name} vs ${match.team2.name}: ${error.message}`);
          const fallbackMatch = this.createFallbackMatch(match);
          results.push(fallbackMatch);
        }

        if (i < batch.length - 1) {
          await this.sleep(this.matchDelay);
        }
      }
    } catch (error) {
      logger.error(`❌ ${agentId} crashed: ${error.message}`);
    } finally {
      await page.close();

      const duration = (Date.now() - stats.startTime) / 1000;
      logger.info(
        `🏁 ${agentId} finished: ${stats.succeeded}/${stats.total} succeeded, ${stats.failed} failed, ${duration}s`
      );
    }

    return {
      agentId,
      matches: results,
      stats,
    };
  }

  // ============================================================
  // GET REAL-TIME MATCH DATA
  // ============================================================
  async getRealTimeMatchData(page, match, agentId) {
    try {
      const url = match.url.includes('?') 
        ? `${match.url}&_=${this.cacheBuster}`
        : `${match.url}?_=${this.cacheBuster}`;

      logger.info(`   📡 ${agentId} fetching: ${url}`);

      const userAgent = this.getRandomUserAgent();
      
      await page.setExtraHTTPHeaders({
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Referer': 'https://crex.com/'
      });

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      try {
        await page.waitForSelector('.team-1, .team-2, .runs.f-runs, .live-score-card', { timeout: 10000 });
      } catch (e) {
        logger.warn(`   ⚠️ ${agentId} timeout waiting for content, continuing...`);
      }

      await this.sleep(2000 + Math.random() * 2000);

      const matchData = await this.extractRealTimeMatchData(page, match);

      return matchData;

    } catch (error) {
      logger.error(`   ❌ ${agentId} error getting real-time data: ${error.message}`);
      return null;
    }
  }

  // ============================================================
  // EXTRACT REAL-TIME MATCH DATA - FIXED FOR ACTUAL HTML STRUCTURE
  // ============================================================
  async extractRealTimeMatchData(page, match) {
    const data = await page.evaluate((match) => {
      const cleanText = (text) => {
        if (!text) return '';
        return text.replace(/\s+/g, ' ').trim();
      };

      const getText = (el) => {
        if (!el) return '';
        return el.textContent ? cleanText(el.textContent) : '';
      };

      // ============================================================
      // 1. Get match title and basic info
      // ============================================================
      const titleEl = document.querySelector('.match-title, h1, .title');
      const title = titleEl ? getText(titleEl) : '';

      let series = '';
      const seriesEl = document.querySelector('.series-name, .snameTag, .match-series, .tournament');
      if (seriesEl) {
        series = getText(seriesEl);
      }

      let venue = 'TBD';
      const venueEl = document.querySelector('.venue, .match-venue, .venue-name, .location, .stadium');
      if (venueEl) {
        venue = getText(venueEl);
      }

      let status = 'Live';
      const statusEl = document.querySelector('.status, .match-status, .live-status, .match-state');
      if (statusEl) {
        status = getText(statusEl);
      }

      let format = 'T20';
      if (title) {
        if (title.includes('100B') || title.includes('The Hundred')) format = 'The Hundred';
        else if (title.includes('ODI')) format = 'ODI';
        else if (title.includes('Test')) format = 'Test';
      }

      // ============================================================
      // 2. Get scoreboard data - FIXED for actual HTML structure
      // ============================================================
      
      let battingTeam = { name: '', score: '', runs: null, wickets: null, overs: '' };
      let bowlingTeam = { name: '' };
      let crr = null;
      let rrr = null;
      let requiredRuns = null;
      let requiredBalls = null;
      let target = null;

      // Get batting team from .team-1
      const team1El = document.querySelector('.team-1');
      if (team1El) {
        battingTeam.name = getText(team1El);
      }

      // Get score from .runs.f-runs span
      const scoreEl = document.querySelector('.runs.f-runs');
      if (scoreEl) {
        const spans = scoreEl.querySelectorAll('span');
        if (spans.length >= 1) {
          const scoreText = getText(spans[0]);
          const scoreMatch = scoreText.match(/(\d+)-(\d+)/);
          if (scoreMatch) {
            battingTeam.score = scoreText;
            battingTeam.runs = parseInt(scoreMatch[1]);
            battingTeam.wickets = parseInt(scoreMatch[2]);
          }
        }
        if (spans.length >= 2) {
          battingTeam.overs = getText(spans[1]); // "65b"
        }
      }

      // Get bowling team from .team-2
      const team2El = document.querySelector('.team-2');
      if (team2El) {
        bowlingTeam.name = getText(team2El);
      }

      // Get CRR and RRR from .team-run-rate .title .data
      const runRateEls = document.querySelectorAll('.team-run-rate .title .data');
      if (runRateEls.length >= 1) {
        crr = getText(runRateEls[0]);
      }
      if (runRateEls.length >= 2) {
        rrr = getText(runRateEls[1]);
      }

      // Get required runs and balls from .final-result
      const finalResultEl = document.querySelector('.final-result');
      if (finalResultEl) {
        const text = getText(finalResultEl);
        const runsMatch = text.match(/(\d+)\s+runs?/);
        const ballsMatch = text.match(/(\d+)\s+balls?/);
        if (runsMatch) requiredRuns = runsMatch[1] + ' runs';
        if (ballsMatch) requiredBalls = ballsMatch[1] + ' balls';
      }

      // If bowling team not found, use match.team2
      if (!bowlingTeam.name) {
        bowlingTeam.name = match.team2.name;
      }

      // If batting team not found, use match.team1
      if (!battingTeam.name) {
        battingTeam.name = match.team1.name;
        battingTeam.score = match.team1.score || '';
        battingTeam.wickets = match.team1.wickets || '';
        battingTeam.overs = match.team1.overs || '';
      }

      // ============================================================
      // 3. Get current batsmen
      // ============================================================
      const batsmen = [];
      const batsmanElements = document.querySelectorAll('.player-card, .batsman, .batter, .batsman-item');
      batsmanElements.forEach(el => {
        const nameEl = el.querySelector('.player-name, .name, .batsmen-name, .batter-name');
        const name = nameEl ? getText(nameEl) : '';
        if (name) {
          const fullText = getText(el);
          const match = fullText.match(/(\d+)\s*\((\d+)\)/);
          if (match) {
            const isStriker = el.querySelector('.striker, .on-strike, .strike-icon') !== null;
            batsmen.push({
              name: name,
              runs: match[1],
              balls: match[2],
              is_striker: isStriker || batsmen.length === 0
            });
          }
        }
      });

      // ============================================================
      // 4. Get current bowler
      // ============================================================
      let bowler = { name: '', overs: '', runs: null, wickets: null };
      const bowlerEl = document.querySelector('.bowler, .current-bowler, .bowler-item');
      if (bowlerEl) {
        const nameEl = bowlerEl.querySelector('.player-name, .name, .bowler-name');
        if (nameEl) {
          bowler.name = getText(nameEl);
        }
        const fullText = getText(bowlerEl);
        const match = fullText.match(/(\d+)-(\d+)\s*\(([\d.]+)\s*b?\)/);
        if (match) {
          bowler.wickets = parseInt(match[1]);
          bowler.runs = parseInt(match[2]);
          bowler.overs = match[3];
        }
      }

      // ============================================================
      // 5. Get overs/ball-by-ball data
      // ============================================================
      const overs = [];
      const overElements = document.querySelectorAll('.over, .overs-slide, .over-item, .over-container');
      overElements.forEach(el => {
        const balls = [];
        const ballElements = el.querySelectorAll('.ball, .delivery, .ball-item');
        ballElements.forEach(b => {
          const text = getText(b);
          if (text) balls.push(text);
        });
        if (balls.length > 0) {
          const totalEl = el.querySelector('.total, .over-total, .over-score');
          const total = totalEl ? getText(totalEl) : '';
          const overNumEl = el.querySelector('.over-number, .over-title');
          const overNum = overNumEl ? getText(overNumEl) : '';
          overs.push({ over: overNum, balls, total });
        }
      });

      // ============================================================
      // 6. Get commentary
      // ============================================================
      const commentary = [];
      const commentaryElements = document.querySelectorAll('.commentary-item, .comment, .ball-commentary, .commentary-entry');
      commentaryElements.forEach(el => {
        const ballEl = el.querySelector('.ball-number, .ball, .over-ball');
        const textEl = el.querySelector('.comment-text, .description, .comment, .text');
        const ball = ballEl ? getText(ballEl) : '';
        const text = textEl ? getText(textEl) : '';
        if (ball || text) {
          commentary.push({ ball, text });
        }
      });

      // ============================================================
      // 7. Get toss info
      // ============================================================
      let toss = { status: 'Not Started' };
      const tossEl = document.querySelector('.toss, .toss-info, .match-toss');
      if (tossEl) {
        const tossText = getText(tossEl);
        if (tossText) {
          toss.status = tossText;
          const winnerMatch = tossText.match(/([A-Za-z\s]+)\s+won the toss/i);
          if (winnerMatch) {
            toss.winner = winnerMatch[1].trim();
            if (tossText.includes('bat')) toss.decision = 'bat';
            else if (tossText.includes('bowl')) toss.decision = 'bowl';
          }
        }
      }

      // ============================================================
      // 8. Get match ID from URL
      // ============================================================
      const urlMatch = match.url.match(/\/cricket-live-score\/([A-Za-z0-9-]+)/i);
      const matchIdFromUrl = urlMatch ? urlMatch[1] : `live_${Date.now()}`;

      // ============================================================
      // 9. BUILD FINAL DATA OBJECT
      // ============================================================
      return {
        match_id: matchIdFromUrl,
        match_url: match.url,
        series: {
          id: `series_${Date.now()}`,
          name: series || match.series || 'Unknown Series',
          short_name: series ? series.substring(0, 20) : '',
          season: new Date().getFullYear().toString(),
        },
        match: {
          number: title.match(/(\d+(?:st|nd|rd|th)\s+(?:Match|T20|ODI|Test|100B|The Hundred))/i)?.[0] || '',
          format: format,
          status: status,
          start_time: '',
          current_innings: '',
          current_ball: '',
          live_current_score: battingTeam.score || '',
        },
        venue: {
          id: `venue_${Date.now()}`,
          name: venue,
        },
        teams: {
          home: {
            id: `team_${battingTeam.name || match.team1.name}`,
            name: battingTeam.name || match.team1.name,
            short_name: (battingTeam.name || match.team1.name).substring(0, 3).toUpperCase(),
            logo: match.team1.flag || '',
          },
          away: {
            id: `team_${bowlingTeam.name || match.team2.name}`,
            name: bowlingTeam.name || match.team2.name,
            short_name: (bowlingTeam.name || match.team2.name).substring(0, 3).toUpperCase(),
            logo: match.team2.flag || '',
          },
        },
        scoreboard: {
          batting_team: battingTeam,
          bowling_team: bowlingTeam,
          target: target,
          required_runs: requiredRuns,
          required_balls: requiredBalls,
          crr: crr,
          rrr: rrr,
          current_ball: '',
        },
        current_batsmen: batsmen,
        current_bowler: bowler,
        overs: overs,
        commentary: commentary,
        prediction: {
          home_probability: null,
          away_probability: null,
          projected_scores: []
        },
        toss: toss,
        weather: null,
        countdown: null,
        _lastUpdated: new Date().toISOString(),
        _updateCount: 0
      };
    }, match);

    // Increment update count
    data._updateCount = (data._updateCount || 0) + 1;
    data._lastUpdated = new Date().toISOString();

    return data;
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
        season: new Date().getFullYear().toString(),
      },
      match: {
        number: 'Match',
        format: 'T20',
        status: 'Live',
        start_time: '',
        current_innings: '',
        current_ball: '',
        live_current_score: '',
      },
      venue: {
        id: `venue_${Date.now()}`,
        name: 'TBD',
      },
      teams: {
        home: {
          id: this.getTeamId(discovered.team1.name),
          name: discovered.team1.name || 'Team 1',
          short_name: discovered.team1.short || 'T1',
          logo: discovered.team1.flag || '',
        },
        away: {
          id: this.getTeamId(discovered.team2.name),
          name: discovered.team2.name || 'Team 2',
          short_name: discovered.team2.short || 'T2',
          logo: discovered.team2.flag || '',
        },
      },
      scoreboard: {
        batting_team: {
          name: discovered.team1.name,
          score: discovered.team1.score || '',
          runs: null,
          wickets: null,
          overs: discovered.team1.overs || '',
        },
        bowling_team: { name: discovered.team2.name },
        target: null,
        required_runs: null,
        required_balls: null,
        crr: null,
        rrr: null,
        current_ball: '',
      },
      current_batsmen: [],
      current_bowler: { name: '', overs: '', runs: null, wickets: null },
      overs: [],
      commentary: [],
      prediction: { home_probability: null, away_probability: null, projected_scores: [] },
      toss: { status: 'Not Started', winner: '', decision: '' },
      weather: null,
      countdown: null,
      _lastUpdated: new Date().toISOString(),
      _updateCount: 0
    };
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
    logger.info(
      `   Success rate: ${this.stats.discovered > 0 ? Math.round((this.stats.detailed / this.stats.discovered) * 100) : 0}%`
    );

    logger.info(`🤖 Agent Statistics:`);
    for (const [agentId, stats] of Object.entries(this.agentStats)) {
      const duration = (Date.now() - stats.startTime) / 1000;
      logger.info(
        `   ${agentId}: ${stats.succeeded}/${stats.total} succeeded, ${stats.failed} failed, ${duration}s`
      );
    }

    logger.info(`📊 Active Matches: ${this.activeMatches.size}`);
    for (const [matchId, matchData] of this.activeMatches) {
      const match = matchData.data;
      const lastUpdate = matchData.lastUpdate;
      const age = (Date.now() - lastUpdate) / 1000;
      logger.info(`   ${match.teams.home.name} vs ${match.teams.away.name} - ${age.toFixed(1)}s ago`);
    }
  }
}

module.exports = LiveScraper;