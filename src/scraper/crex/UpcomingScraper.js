// src/scraper/crex/UpcomingScraper.js
const BaseCrexScraper = require('./BaseCrexScraper');
const UPCOMING_SELECTORS = require('./selectors/upcomingSelectors');
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

class UpcomingScraper extends BaseCrexScraper {
  constructor() {
    super();
    this.selectors = UPCOMING_SELECTORS;

    // ✅ 4-AGENT CONFIGURATION (Worker Pool)
    this.maxWorkers = 4;
    this.workerTimeout = 30000;
    this.agentStaggerDelay = 2000;
    this.matchDelay = 1500;

    // Statistics
    this.stats = {
      discovered: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      retried: 0,
      duplicateRemoved: 0,
      totalMatches: 0,
      weatherSuccess: 0,
      weatherFailed: 0,
      workerStats: {},
      startTime: null,
    };

    // Processing queues
    this.processingQueue = [];
    this.processedUrls = new Set();
    this.failedUrls = new Set();
    this.retryQueue = [];
    this.results = [];
    this.failedMatches = [];

    // Worker management
    this.workers = [];
    this.isRunning = false;
    this.browser = null;
    this.context = null;
    this.activeAgents = 0;

    // ✅ FIX: Use browserManager from the module
    this.browserManager = browserManager;

    // Weather caches
    this.geoCache = new Map();
    this.weatherCache = new Map();
    this.playerCache = new Map();

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

    // Timezone mapping
    this.timezoneMap = {
      London: 'Europe/London',
      Birmingham: 'Europe/London',
      Manchester: 'Europe/London',
      Leeds: 'Europe/London',
      Nottingham: 'Europe/London',
      Southampton: 'Europe/London',
      Taunton: 'Europe/London',
      Cardiff: 'Europe/London',
      Edinburgh: 'Europe/London',
      Dublin: 'Europe/Dublin',
      Windhoek: 'Africa/Windhoek',
      Bengaluru: 'Asia/Kolkata',
      Bangalore: 'Asia/Kolkata',
      Mumbai: 'Asia/Kolkata',
      Delhi: 'Asia/Kolkata',
      Chennai: 'Asia/Kolkata',
      Kolkata: 'Asia/Kolkata',
      Hyderabad: 'Asia/Kolkata',
      Ahmedabad: 'Asia/Kolkata',
      Pune: 'Asia/Kolkata',
      Dharamsala: 'Asia/Kolkata',
      Mohali: 'Asia/Kolkata',
      Nagpur: 'Asia/Kolkata',
      Indore: 'Asia/Kolkata',
      Rajkot: 'Asia/Kolkata',
      Lahore: 'Asia/Karachi',
      Karachi: 'Asia/Karachi',
      Rawalpindi: 'Asia/Karachi',
      Multan: 'Asia/Karachi',
      Dhaka: 'Asia/Dhaka',
      Colombo: 'Asia/Colombo',
      Kandy: 'Asia/Colombo',
      Galle: 'Asia/Colombo',
      Dambulla: 'Asia/Colombo',
      Kathmandu: 'Asia/Kathmandu',
      Dubai: 'Asia/Dubai',
      'Abu Dhabi': 'Asia/Dubai',
      Sharjah: 'Asia/Dubai',
      Melbourne: 'Australia/Melbourne',
      Sydney: 'Australia/Sydney',
      Brisbane: 'Australia/Brisbane',
      Perth: 'Australia/Perth',
      Adelaide: 'Australia/Adelaide',
      Auckland: 'Pacific/Auckland',
      Wellington: 'Pacific/Auckland',
      Christchurch: 'Pacific/Auckland',
      'Port of Spain': 'America/Port_of_Spain',
      Bridgetown: 'America/Barbados',
      Georgetown: 'America/Guyana',
      Guyana: 'America/Guyana',
      Providence: 'America/Guyana',
      'Providence Stadium': 'America/Guyana',
      Johannesburg: 'Africa/Johannesburg',
      'Cape Town': 'Africa/Johannesburg',
      Durban: 'Africa/Johannesburg',
      Centurion: 'Africa/Johannesburg',
      Harare: 'Africa/Harare',
      Bulawayo: 'Africa/Harare',
      Kabul: 'Asia/Kabul',
      Islamabad: 'Asia/Karachi',
      Utrecht: 'Europe/Amsterdam',
      Amsterdam: 'Europe/Amsterdam',
      'The Rose Bowl': 'Europe/London',
      Edgbaston: 'Europe/London',
      'Old Trafford': 'Europe/London',
      Headingley: 'Europe/London',
      'Trent Bridge': 'Europe/London',
      "Lord's": 'Europe/London',
      'The Oval': 'Europe/London',
      'Sophia Gardens': 'Europe/London',
      'Riverside Ground': 'Europe/London',
    };
  }

  // ============================================================
  // HELPER METHODS
  // ============================================================

  getTimezoneFromVenue(venue) {
    if (!venue) return 'Europe/London';

    for (const [city, timezone] of Object.entries(this.timezoneMap)) {
      if (venue.includes(city) || city.includes(venue)) {
        return timezone;
      }
    }

    const cityMatch = venue.match(/,?\s*([A-Za-z\s]+)$/);
    if (cityMatch) {
      const city = cityMatch[1].trim();
      for (const [knownCity, timezone] of Object.entries(this.timezoneMap)) {
        if (city.includes(knownCity) || knownCity.includes(city)) {
          return timezone;
        }
      }
    }

    return 'Europe/London';
  }

  generateTeamId(teamName) {
    if (!teamName) return `team_${Date.now()}`;
    let id = teamName
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return `team_${id}`;
  }

  cleanPlayerName(name) {
    if (!name) return '';
    let cleaned = name.replace(/\s+/g, ' ').trim();
    cleaned = cleaned.replace(/✈️/g, ' ✈️').replace(/\s+/g, ' ').trim();
    cleaned = cleaned.replace(/\(C\)/g, ' (C) ').replace(/\s+/g, ' ').trim();
    cleaned = cleaned
      .replace(/\(WK\)/g, ' (WK) ')
      .replace(/\s+/g, ' ')
      .trim();
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    cleaned = cleaned
      .replace(/\)\s*\(/g, ') (')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned;
  }

  buildLocationCandidates(venue, series, matchTitle, team1Name, team2Name) {
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
      for (const [country] of Object.entries(this.countryMap)) {
        if (series.includes(country)) candidates.add(country);
      }
    }

    if (matchTitle) {
      for (const [country] of Object.entries(this.countryMap)) {
        if (matchTitle.includes(country)) candidates.add(country);
      }
    }

    if (team1Name) {
      for (const [key, country] of Object.entries(this.countryMap)) {
        if (team1Name.includes(key)) candidates.add(country);
      }
    }

    if (team2Name) {
      for (const [key, country] of Object.entries(this.countryMap)) {
        if (team2Name.includes(key)) candidates.add(country);
      }
    }

    const validCandidates = new Set();
    for (const candidate of candidates) {
      const trimmed = candidate.trim();
      if (trimmed && trimmed !== 'TBD' && trimmed !== 'tbd' && trimmed.length > 2) {
        validCandidates.add(trimmed);
      }
    }

    const allCandidates = Array.from(validCandidates);
    const seen = new Set();
    const uniqueCandidates = [];
    for (const candidate of allCandidates) {
      const lower = candidate.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        uniqueCandidates.push(candidate);
      }
    }

    return uniqueCandidates;
  }

  async getCoordinates(location) {
    const cacheKey = location.toLowerCase().trim();

    if (this.geoCache.has(cacheKey)) {
      return this.geoCache.get(cacheKey);
    }

    try {
      const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
      const response = await axios.get(geocodeUrl, { timeout: 10000 });

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

  async getWeather(venue, series, matchTitle, team1Name, team2Name) {
    const candidates = this.buildLocationCandidates(
      venue,
      series,
      matchTitle,
      team1Name,
      team2Name
    );

    if (candidates.length === 0) {
      return null;
    }

    for (let i = 0; i < candidates.length; i++) {
      const location = candidates[i];

      try {
        const coords = await this.getCoordinates(location);
        if (!coords) continue;

        const { lat: latitude, lon: longitude } = coords;
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=precipitation_probability_max&timezone=auto`;

        const weatherResponse = await axios.get(weatherUrl, { timeout: 10000 });
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
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  // ============================================================
  // ✅ FIXED: INITIALIZE SHARED BROWSER
  // ============================================================

  async initializeSharedBrowser() {
    logger.info('🔧 Initializing shared browser for worker pool...');

    try {
      // ✅ FIX: Use browserManager to launch browser
      await this.browserManager.launch();
      
      // ✅ Get browser and context from the manager
      this.browser = this.browserManager.browser;
      this.context = this.browserManager.context;

      if (!this.browser || !this.context) {
        throw new Error('Failed to get browser or context from browserManager');
      }

      logger.info('✅ Shared browser initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize shared browser:', error);
      throw error;
    }
  }

  // ============================================================
  // MAIN SCRAPE METHOD
  // ============================================================

  async scrapeUpcoming(forceRefresh = true) {
    this.stats.startTime = Date.now();
    logger.info(`🚀 Starting upcoming matches scraper (forceRefresh: ${forceRefresh})`);
    logger.info(`📋 Max Workers: ${this.maxWorkers}`);

    // ✅ If forceRefresh is true, clear processed URLs for fresh scrape
    if (forceRefresh) {
      this.processedUrls.clear();
      this.agentResults = [];
      this.agentStats = {};
      this.activeAgents = 0;
      this.results = [];
      this.failedUrls.clear();
      this.retryQueue = [];
      this.processingQueue = [];
    }

    try {
      // Step 1: Initialize shared browser
      await this.initializeSharedBrowser();

      // Step 2: Discover all upcoming match URLs
      const discoveredMatches = await this.discoverMatches();
      this.stats.discovered = discoveredMatches.length;

      if (discoveredMatches.length === 0) {
        logger.warn('⚠️ No upcoming matches discovered');
        await this.closeBrowser();
        return {
          success: true,
          source: 'crex',
          type: 'upcoming',
          timestamp: new Date().toISOString(),
          data: [],
          total: 0,
          duration: Date.now() - this.stats.startTime,
          message: 'No upcoming matches found',
        };
      }

      logger.info(`📋 Discovered ${discoveredMatches.length} upcoming matches`);

      // Step 3: Remove duplicate URLs
      const uniqueMatches = this.removeDuplicates(discoveredMatches);
      this.stats.duplicateRemoved = discoveredMatches.length - uniqueMatches.length;

      logger.info(`🗑️ Removed ${this.stats.duplicateRemoved} duplicate URLs`);
      logger.info(`📋 Unique matches: ${uniqueMatches.length}`);

      // Step 4: Create shared queue
      this.processingQueue = [...uniqueMatches];
      this.stats.totalMatches = this.processingQueue.length;

      // Step 5-7: Process with worker pool
      const results = await this.processWithWorkerPool();

      // Merge results
      const finalData = this.mergeResults(results);

      // Close browser
      await this.closeBrowser();
      this.logStatistics();

      logger.info(`✅ Completed processing ${finalData.length} upcoming matches`);

      return {
        success: true,
        source: 'crex',
        type: 'upcoming',
        timestamp: new Date().toISOString(),
        data: finalData,
        total: finalData.length,
        duration: Date.now() - this.stats.startTime,
        cacheBuster: Date.now(),
      };
    } catch (error) {
      logger.error(`❌ UpcomingScraper error: ${error.message}`);
      logger.error(error.stack);
      await this.closeBrowser();
      return {
        success: false,
        source: 'crex',
        type: 'upcoming',
        timestamp: new Date().toISOString(),
        data: [],
        total: 0,
        error: error.message,
        duration: Date.now() - this.stats.startTime,
      };
    }
  }

  // ============================================================
  // STEP 2: DISCOVER MATCHES
  // ============================================================

  async discoverMatches() {
    logger.info('🔍 Discovering upcoming matches...');

    const page = await this.context.newPage();

    try {
      // Try both URLs
      const urls = [
        'https://crex.com/cricket-schedule',
        'https://crex.com/upcoming-matches',
        'https://crex.com',
      ];

      let success = false;
      let html = '';

      for (const url of urls) {
        try {
          logger.info(`  Trying: ${url}`);
          await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15000,
          });

          // Wait for content
          await this.sleep(2000);

          html = await page.content();

          // Check if we have any match cards
          const hasCards = await page.evaluate(() => {
            const cards = document.querySelectorAll(
              '.live-card, .score-card, .match-card, .match-container, .team-innig'
            );
            return cards.length > 0;
          });

          if (hasCards) {
            success = true;
            logger.info(`  ✅ Found matches on: ${url}`);
            break;
          }
        } catch (error) {
          logger.warn(`  ⚠️ Failed to load ${url}: ${error.message}`);
        }
      }

      if (!success) {
        logger.error('❌ Could not find any match cards on any URL');
        await page.close();
        return [];
      }

      // Save debug HTML
      try {
        const debugDir = path.join(process.cwd(), 'debug');
        if (!fs.existsSync(debugDir)) {
          fs.mkdirSync(debugDir, { recursive: true });
        }
        fs.writeFileSync(path.join(debugDir, 'upcoming-page.html'), html);
        logger.info(`💾 Saved page HTML to debug/upcoming-page.html`);
      } catch (e) {}

      const result = await page.evaluate(() => {
        const matches = [];
        const cards = document.querySelectorAll(
          '.live-card, .score-card, .match-card, .match-container, .team-innig'
        );

        const getText = (el) => {
          if (!el) return '';
          return el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
        };

        const cleanText = (text) => {
          if (!text) return '';
          return text.replace(/\s+/g, ' ').trim();
        };

        const getMatchUrl = (card) => {
          const links = card.querySelectorAll('a[href*="cricket-live-score"]');
          for (const link of links) {
            const href = link.getAttribute('href');
            if (href && href.includes('cricket-live-score')) {
              if (href.startsWith('https://')) return href;
              if (href.startsWith('/')) return `https://crex.com${href}`;
              return `https://crex.com/${href}`;
            }
          }
          return '';
        };

        cards.forEach((card) => {
          const cardText = getText(card);
          const matchUrl = getMatchUrl(card);

          if (!matchUrl) return;

          if (
            cardText.includes('Advertisement') ||
            cardText.includes('News') ||
            cardText.includes('Video')
          ) {
            return;
          }

          let team1Name = '';
          let team2Name = '';

          // Try to extract team names from text
          const vsMatch = cardText.match(/([A-Za-z\s]+)\s+vs\s+([A-Za-z\s]+)/i);
          if (vsMatch) {
            team1Name = cleanText(vsMatch[1]);
            team2Name = cleanText(vsMatch[2]);
          }

          // If not found, try team selectors
          if (!team1Name || !team2Name) {
            const teamNames = [];
            const teamElements = card.querySelectorAll(
              '.team-name, .teamName, .name, .team, .cb-team-name'
            );
            teamElements.forEach((el) => {
              const text = cleanText(getText(el));
              if (text && text.length > 1 && text.length < 30 && !text.includes('vs')) {
                teamNames.push(text);
              }
            });
            if (teamNames.length >= 2) {
              team1Name = teamNames[0];
              team2Name = teamNames[1];
            }
          }

          // If still not found, try to parse from the card structure
          if (!team1Name || !team2Name) {
            const teams = card.querySelectorAll(
              '.team, .team-name, .cb-team-name, [class*="team"]'
            );
            const teamTexts = [];
            teams.forEach((el) => {
              const text = cleanText(getText(el));
              if (text && text.length > 1 && text.length < 30) {
                teamTexts.push(text);
              }
            });
            if (teamTexts.length >= 2) {
              team1Name = teamTexts[0];
              team2Name = teamTexts[1];
            }
          }

          let series = '';
          const seriesMatch = cardText.match(/([A-Za-z\s]+)\s+vs\s+([A-Za-z\s]+)\s+(\d{4})/i);
          if (seriesMatch) {
            series = `${cleanText(seriesMatch[1])} vs ${cleanText(seriesMatch[2])} ${seriesMatch[3]}`;
          }

          // If no series found, try series selectors
          if (!series) {
            const seriesEl = card.querySelector(
              '.series-name, .snameTag, .match-series, .series-title, .tournament'
            );
            if (seriesEl) {
              series = cleanText(getText(seriesEl));
            }
          }

          // Try to extract flags
          let flag1 = '';
          let flag2 = '';
          const flagImages = card.querySelectorAll(
            'img[src*="Teams"], img[src*="cricketvectors"], .team-flag img, .flag img'
          );
          if (flagImages.length >= 2) {
            flag1 = flagImages[0].getAttribute('src') || '';
            flag2 = flagImages[1].getAttribute('src') || '';
          }

          if (team1Name && team2Name) {
            matches.push({
              url: matchUrl,
              team1: {
                name: team1Name,
                flag: flag1,
              },
              team2: {
                name: team2Name,
                flag: flag2,
              },
              series: series,
            });
          }
        });

        return matches;
      });

      await page.close();

      logger.info(`✅ Discovered ${result.length} upcoming matches`);

      if (result.length > 0) {
        result.forEach((match, index) => {
          logger.info(`  ${index + 1}. ${match.team1.name} vs ${match.team2.name} - ${match.url}`);
        });
      }

      return result;
    } catch (error) {
      logger.error('Failed to discover matches:', error);
      await page.close();
      return [];
    }
  }

  // ============================================================
  // STEP 3: REMOVE DUPLICATES
  // ============================================================

  removeDuplicates(matches) {
    const seen = new Set();
    const unique = [];

    for (const match of matches) {
      if (!seen.has(match.url)) {
        seen.add(match.url);
        unique.push(match);
      }
    }

    return unique;
  }

  // ============================================================
  // STEPS 4-7: PROCESS WITH WORKER POOL
  // ============================================================

  async processWithWorkerPool() {
    logger.info(`👷 Starting ${this.maxWorkers} workers...`);

    const workerPromises = [];
    const startTime = Date.now();

    // Create workers
    for (let i = 1; i <= this.maxWorkers; i++) {
      workerPromises.push(this.createWorker(i));
    }

    // Wait for all workers to complete
    await Promise.all(workerPromises);

    const duration = Date.now() - startTime;
    logger.info(`✅ All workers completed in ${duration}ms`);
    logger.info(
      `📊 Processed: ${this.stats.processed}, Succeeded: ${this.stats.succeeded}, Failed: ${this.stats.failed}`
    );

    // Check if we have failed matches to retry
    if (this.failedUrls.size > 0 && this.retryQueue.length === 0) {
      logger.info(`🔄 Retrying ${this.failedUrls.size} failed matches...`);
      this.retryQueue = Array.from(this.failedUrls);
      this.failedUrls.clear();

      // Create retry workers
      const retryPromises = [];
      const retryWorkers = Math.min(2, this.retryQueue.length);

      for (let i = 1; i <= retryWorkers; i++) {
        retryPromises.push(this.createRetryWorker(i));
      }

      await Promise.all(retryPromises);
    }

    return this.results;
  }

  // ============================================================
  // CREATE WORKER
  // ============================================================

  async createWorker(workerId) {
    const workerName = `Worker ${workerId}`;
    logger.info(`👷 ${workerName} started`);

    this.stats.workerStats[workerId] = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      startTime: Date.now(),
    };

    // Each worker gets its own page from the shared context
    const page = await this.context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    // Set user agent
    const userAgent = this.getRandomUserAgent();
    await page.setExtraHTTPHeaders({
      'User-Agent': userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Referer: 'https://crex.com/',
    });

    let processedCount = 0;

    while (this.processingQueue.length > 0) {
      // Get next match from queue
      const match = this.processingQueue.shift();

      if (!match) break;
      if (this.processedUrls.has(match.url)) continue;

      this.processedUrls.add(match.url);
      processedCount++;
      this.stats.processed++;

      const queueRemaining = this.processingQueue.length;
      logger.info(
        `👷 ${workerName} processing Match ${processedCount} (Queue Remaining: ${queueRemaining})`
      );

      try {
        // Process the match
        const result = await this.processMatch(page, match, workerId);

        if (result) {
          this.results.push(result);
          this.stats.succeeded++;
          this.stats.workerStats[workerId].succeeded++;
          logger.info(
            `✅ ${workerName} completed Match ${processedCount} (Queue Remaining: ${queueRemaining})`
          );
        } else {
          this.failedUrls.add(match.url);
          this.stats.failed++;
          this.stats.workerStats[workerId].failed++;
          logger.warn(
            `❌ ${workerName} failed Match ${processedCount} (Queue Remaining: ${queueRemaining})`
          );
        }

        this.stats.workerStats[workerId].processed++;
      } catch (error) {
        this.failedUrls.add(match.url);
        this.stats.failed++;
        this.stats.workerStats[workerId].failed++;
        logger.error(`❌ ${workerName} error on Match ${processedCount}: ${error.message}`);
      }

      // Small delay between matches
      if (this.processingQueue.length > 0) {
        await this.sleep(500);
      }
    }

    await page.close();

    const duration = (Date.now() - this.stats.workerStats[workerId].startTime) / 1000;
    logger.info(
      `🏁 ${workerName} finished - Processed: ${processedCount}, Succeeded: ${this.stats.workerStats[workerId].succeeded}, Failed: ${this.stats.workerStats[workerId].failed}, Duration: ${duration}s`
    );

    return { workerId, processed: processedCount };
  }

  // ============================================================
  // CREATE RETRY WORKER
  // ============================================================

  async createRetryWorker(workerId) {
    const workerName = `Retry Worker ${workerId}`;
    logger.info(`🔄 ${workerName} started`);

    const page = await this.context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    let processedCount = 0;

    while (this.retryQueue.length > 0) {
      const url = this.retryQueue.shift();

      if (!url) break;

      processedCount++;
      logger.info(`🔄 ${workerName} retrying ${url}`);

      try {
        // Find the match data
        const match = { url };
        const result = await this.processMatch(page, match, `R${workerId}`);

        if (result) {
          this.results.push(result);
          this.stats.succeeded++;
          this.stats.retried++;
          logger.info(`✅ ${workerName} successfully retried match`);
        } else {
          this.stats.failed++;
          this.failedMatches.push({ url, reason: 'Retry failed' });
          logger.warn(`❌ ${workerName} retry failed`);
        }
      } catch (error) {
        this.stats.failed++;
        this.failedMatches.push({ url, reason: error.message });
        logger.error(`❌ ${workerName} retry error: ${error.message}`);
      }
    }

    await page.close();
    logger.info(`🏁 ${workerName} finished - Retried: ${processedCount}`);
  }

  // ============================================================
  // PROCESS SINGLE MATCH
  // ============================================================

  async processMatch(page, match, workerId) {
    try {
      // Navigate to match page
      await page.goto(match.url, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      // Wait for content to load
      await this.sleep(2000);

      // Extract detailed match data
      const detailData = await this.extractDetailedMatchData(page);

      // Extract players
      const playersData = await this.extractPlayersFromTabs(page);

      // Get weather
      let weather = null;
      if (
        detailData.venue ||
        detailData.series ||
        detailData.matchTitle ||
        detailData.team1.name ||
        detailData.team2.name
      ) {
        weather = await this.getWeather(
          detailData.venue,
          detailData.series,
          detailData.matchTitle,
          detailData.team1.name,
          detailData.team2.name
        );
      }

      // Format the match data
      const formattedMatch = await this.formatMatchData(match, detailData, playersData, weather);

      return formattedMatch;
    } catch (error) {
      logger.debug(`Worker ${workerId} error processing ${match.url}: ${error.message}`);
      return null;
    }
  }

  // ============================================================
  // EXTRACT DETAILED MATCH DATA
  // ============================================================

  async extractDetailedMatchData(page) {
    return await page.evaluate(() => {
      const getText = (el) => {
        if (!el) return '';
        return el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
      };

      const cleanText = (text) => {
        if (!text) return '';
        return text.replace(/\s+/g, ' ').trim();
      };

      const allText = document.body ? document.body.textContent.replace(/\s+/g, ' ').trim() : '';

      const data = {
        series: '',
        matchTitle: '',
        venue: '',
        rawMatchDate: '',
        date: '',
        startTime: '',
        countdownText: '',
        result: '',
        winningTeam: '',
        margin: '',
        team1: { name: '', flag: '', score: '' },
        team2: { name: '', flag: '', score: '' },
      };

      // Extract series
      const seriesSelectors = [
        '.series-name',
        '.snameTag',
        '.match-series',
        '.series-title',
        '.tournament',
        '.series',
      ];
      for (const selector of seriesSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          data.series = cleanText(getText(el));
          if (data.series) break;
        }
      }

      // Extract match title
      const titleSelectors = ['h1', '.match-title', '.match-header h1', '.title'];
      for (const selector of titleSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          data.matchTitle = cleanText(getText(el));
          if (data.matchTitle) break;
        }
      }

      // Extract venue
      const venueSelectors = ['.venue', '.match-venue', '.venue-name', '.location', '.stadium'];
      for (const selector of venueSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          const text = cleanText(getText(el));
          if (text && text.length > 3) {
            data.venue = text;
            break;
          }
        }
      }

      // Extract date/time
      const dateElement = document.querySelector('.match-date > div');
      if (dateElement) {
        const dateText = dateElement.textContent.trim();
        if (dateText && dateText.length > 0) {
          data.rawMatchDate = dateText;
          data.date = dateText;
          const timeMatch = dateText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)|\d{1,2}\s*(?:AM|PM))/i);
          if (timeMatch) {
            data.startTime = timeMatch[0];
          }
        }
      }

      // Extract teams
      const teamContainers = document.querySelectorAll(
        '.team-container, .team-info, .match-teams .team'
      );
      if (teamContainers.length >= 2) {
        const team1El = teamContainers[0];
        const team2El = teamContainers[1];

        const name1El = team1El.querySelector('.team-name, .name, .team-title');
        if (name1El) data.team1.name = cleanText(getText(name1El));

        const flag1El = team1El.querySelector('img');
        if (flag1El) data.team1.flag = flag1El.getAttribute('src') || '';

        const name2El = team2El.querySelector('.team-name, .name, .team-title');
        if (name2El) data.team2.name = cleanText(getText(name2El));

        const flag2El = team2El.querySelector('img');
        if (flag2El) data.team2.flag = flag2El.getAttribute('src') || '';
      }

      return data;
    });
  }

  // ============================================================
  // EXTRACT PLAYERS FROM TABS
  // ============================================================

  async extractPlayersFromTabs(page) {
    const playersData = {};

    try {
      // Wait for tabs
      await page
        .waitForSelector('.playingxi-button, .tab-item, .team-tab, [role="tab"]', {
          timeout: 5000,
        })
        .catch(() => {});

      const tabs = await page.$$('.playingxi-button, .tab-item, .team-tab, [role="tab"]');

      if (tabs.length < 2) {
        return playersData;
      }

      const tabCount = Math.min(tabs.length, 2);

      for (let i = 0; i < tabCount; i++) {
        try {
          const teamShortName = await page.evaluate((tab) => {
            return tab.textContent ? tab.textContent.replace(/\s+/g, ' ').trim() : '';
          }, tabs[i]);

          if (!teamShortName) continue;

          await tabs[i].click();
          await this.sleep(500);

          const players = await page.evaluate((teamShortName) => {
            const getText = (el) => {
              if (!el) return '';
              return el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
            };

            const cleanText = (text) => {
              if (!text) return '';
              return text.replace(/\s+/g, ' ').trim();
            };

            const cleanPlayerName = (name) => {
              if (!name) return '';
              let cleaned = name.replace(/\s+/g, ' ').trim();
              cleaned = cleaned.replace(/✈️/g, ' ✈️').replace(/\s+/g, ' ').trim();
              cleaned = cleaned.replace(/\(C\)/g, ' (C) ').replace(/\s+/g, ' ').trim();
              cleaned = cleaned
                .replace(/\(WK\)/g, ' (WK) ')
                .replace(/\s+/g, ' ')
                .trim();
              cleaned = cleaned.replace(/\s+/g, ' ').trim();
              cleaned = cleaned
                .replace(/\)\s*\(/g, ') (')
                .replace(/\s+/g, ' ')
                .trim();
              return cleaned;
            };

            const isPlaceholderImage = (src) => {
              if (!src) return true;
              const patterns = ['playerPlaceholder.svg', 'placeholder', 'default-player'];
              for (const pattern of patterns) {
                if (src.includes(pattern)) return true;
              }
              return false;
            };

            const getFullUrl = (path) => {
              if (!path) return '';
              if (path.startsWith('https://')) return path;
              if (path.startsWith('/')) return `https://crex.com${path}`;
              return `https://crex.com/${path}`;
            };

            const players = [];
            const playerCards = document.querySelectorAll(
              '.playingxi-card .player-card, .player-card'
            );

            for (const card of playerCards) {
              const nameEl = card.querySelector('.p-name, .player-name, .name');
              const rawName = nameEl ? cleanText(getText(nameEl)) : '';

              if (!rawName) continue;

              const cleanedName = cleanPlayerName(rawName);

              let role = 'Player';
              const roleEl = card.querySelector('.bat-ball-type, .bat-ball-typ, .role');
              if (roleEl) {
                const roleText = cleanText(getText(roleEl));
                if (roleText) {
                  const validRoles = ['Batter', 'Bowler', 'All Rounder', 'Wicket Keeper'];
                  for (const validRole of validRoles) {
                    if (roleText.includes(validRole) || validRole.includes(roleText)) {
                      role = validRole;
                      break;
                    }
                  }
                  if (role === 'Player') role = roleText;
                }
              }

              const player = { name: cleanedName, role: role };

              let image = '';
              const imgEl = card.querySelector('.img-card img, img');
              if (imgEl) {
                const dataSrc = imgEl.getAttribute('data-src');
                const src = imgEl.getAttribute('src');
                const imgSrc = dataSrc || src;
                if (imgSrc && !isPlaceholderImage(imgSrc)) {
                  image = imgSrc;
                }
              }
              if (image) player.image = image;

              let profileUrl = '';
              const profileEl = card.querySelector('a[href*="/player/"]');
              if (profileEl) {
                const href = profileEl.getAttribute('href');
                if (href) profileUrl = getFullUrl(href);
              }
              if (profileUrl) player.profile_url = profileUrl;

              players.push(player);
            }

            return players;
          }, teamShortName);

          if (players.length > 0) {
            playersData[teamShortName] = players;
          }
        } catch (error) {
          logger.warn(`Failed to process tab ${i + 1}: ${error.message}`);
        }
      }
    } catch (error) {
      logger.warn(`Error extracting players: ${error.message}`);
    }

    return playersData;
  }

  // ============================================================
  // FORMAT MATCH DATA
  // ============================================================

  async formatMatchData(discovered, detailData, playersData, weatherData) {
    const matchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const seriesId = `series_${Date.now()}`;
    const venueId = `venue_${Date.now()}`;

    const team1Id = this.generateTeamId(detailData.team1.name || discovered.team1.name);
    const team2Id = this.generateTeamId(detailData.team2.name || discovered.team2.name);

    let format = 'T20';
    const titleText =
      detailData.matchTitle || `${detailData.team1.name} vs ${detailData.team2.name}`;
    if (titleText.includes('ODI')) format = 'ODI';
    else if (titleText.includes('Test')) format = 'Test';
    else if (titleText.includes('100B')) format = 'The Hundred';
    else if (titleText.includes('T10')) format = 'T10';

    let matchNumber = 'Match';
    const numberMatch = titleText.match(/(\d+(?:st|nd|rd|th)\s+(?:Match|TEST|ODI|T20|T10|100B))/i);
    if (numberMatch) {
      matchNumber = numberMatch[0];
    }

    let status = 'Upcoming';
    if (detailData.result) {
      status = 'Completed';
    } else if (
      detailData.countdownText &&
      detailData.countdownText.toLowerCase().includes('live')
    ) {
      status = 'Live';
    }

    const startTime = detailData.rawMatchDate || '';

    const players = playersData || {};

    let seriesShortName = detailData.series || discovered.series || 'Unknown Series';
    seriesShortName = seriesShortName.replace(/^[\s,]+|[\s,]+$/g, '').trim();

    const homeShortName =
      Object.keys(players).find(
        (k) =>
          k.includes(discovered.team1.name?.substring(0, 3)) ||
          discovered.team1.name?.substring(0, 3).toUpperCase()
      ) ||
      discovered.team1.name?.substring(0, 3).toUpperCase() ||
      '';

    const awayShortName =
      Object.keys(players).find(
        (k) =>
          k.includes(discovered.team2.name?.substring(0, 3)) ||
          discovered.team2.name?.substring(0, 3).toUpperCase()
      ) ||
      discovered.team2.name?.substring(0, 3).toUpperCase() ||
      '';

    return {
      match_id: matchId,
      match_url: discovered.url,
      series: {
        id: seriesId,
        name: detailData.series || discovered.series || 'Unknown Series',
        short_name: seriesShortName,
        season: new Date().getFullYear().toString(),
      },
      match: {
        number: matchNumber,
        format: format,
        status: status,
        start_time: startTime,
      },
      venue: {
        id: venueId,
        name: detailData.venue || 'TBD',
      },
      teams: {
        home: {
          id: team1Id,
          name: detailData.team1.name || discovered.team1.name,
          short_name: homeShortName,
          logo: detailData.team1.flag || discovered.team1.flag || '',
        },
        away: {
          id: team2Id,
          name: detailData.team2.name || discovered.team2.name,
          short_name: awayShortName,
          logo: detailData.team2.flag || discovered.team2.flag || '',
        },
      },
      players: players,
      weather: weatherData || null,
    };
  }

  // ============================================================
  // MERGE RESULTS
  // ============================================================

  mergeResults(results) {
    const seen = new Set();
    const merged = [];

    for (const result of results) {
      if (!result || !result.match_url) continue;
      if (!seen.has(result.match_url)) {
        seen.add(result.match_url);
        merged.push(result);
      }
    }

    return merged;
  }

  // ============================================================
  // CLOSE BROWSER
  // ============================================================

  async closeBrowser() {
    try {
      // Only close our page, not the shared browser
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
        this.page = null;
      }
      this.isBrowserInitialized = false;
      this.browser = null;
      this.context = null;
      logger.info('✅ UpcomingScraper page closed');
    } catch (error) {
      logger.error('Error closing browser:', error.message);
    }
  }

  // ============================================================
  // LOG STATISTICS
  // ============================================================

  logStatistics() {
    const duration = this.stats.startTime ? (Date.now() - this.stats.startTime) / 1000 : 0;

    logger.info('='.repeat(60));
    logger.info('📊 UPCOMING SCRAPER STATISTICS');
    logger.info('='.repeat(60));
    logger.info(`   Discovered: ${this.stats.discovered}`);
    logger.info(`   Duplicates Removed: ${this.stats.duplicateRemoved}`);
    logger.info(`   Total Processed: ${this.stats.processed}`);
    logger.info(`   ✅ Succeeded: ${this.stats.succeeded}`);
    logger.info(`   ❌ Failed: ${this.stats.failed}`);
    logger.info(`   🔄 Retried: ${this.stats.retried}`);
    logger.info(`   Weather Success: ${this.stats.weatherSuccess}`);
    logger.info(`   Weather Failed: ${this.stats.weatherFailed}`);
    logger.info(`   ⏱️  Duration: ${duration}s`);
    logger.info(
      `   📈 Success Rate: ${this.stats.processed > 0 ? Math.round((this.stats.succeeded / this.stats.processed) * 100) : 0}%`
    );
    logger.info('='.repeat(60));

    // Worker stats
    if (Object.keys(this.stats.workerStats).length > 0) {
      logger.info('👷 Worker Stats:');
      for (const [workerId, stats] of Object.entries(this.stats.workerStats)) {
        const workerDuration = (Date.now() - stats.startTime) / 1000;
        logger.info(
          `   Worker ${workerId}: Processed: ${stats.processed}, Succeeded: ${stats.succeeded}, Failed: ${stats.failed}, Duration: ${workerDuration}s`
        );
      }
      logger.info('='.repeat(60));
    }
  }
}

module.exports = UpcomingScraper;