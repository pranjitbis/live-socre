// src/scraper/crex/index.js
const BaseCrexScraper = require('./BaseCrexScraper');
const LiveScraper = require('./LiveScraper');
const UpcomingScraper = require('./UpcomingScraper');
const FinishedScraper = require('./FinishedScraper');
const liveSelectors = require('./selectors/liveSelectors');
const upcomingSelectors = require('./selectors/upcomingSelectors');
const finishedSelectors = require('./selectors/finishedSelectors');

module.exports = {
  BaseCrexScraper,
  LiveScraper,
  UpcomingScraper,
  FinishedScraper,
  liveSelectors,
  upcomingSelectors,
  finishedSelectors,
};