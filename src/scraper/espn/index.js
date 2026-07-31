// src/scraper/espn/index.js
const BaseEspnScraper = require('./BaseEspnScraper');
const PreviousScraper = require('./PreviousScraper');
const previousSelectors = require('./selectors/previousSelectors');

module.exports = {
  BaseEspnScraper,
  PreviousScraper,
  previousSelectors
};