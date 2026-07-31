// Create src/services/sourceManager.js
const logger = require('../logger');
const { sources, setDebugSource } = require('../config/sources');

class SourceManager {
  constructor() {
    this.currentIndex = 0;
    this.sourceOrder = ['cricbuzz', 'espncricinfo', 'espn'];
    this.failedSources = new Set();
  }

  getCurrentSource() {
    const sourceName = this.sourceOrder[this.currentIndex];
    return sources[sourceName];
  }

  getCurrentSourceName() {
    return this.sourceOrder[this.currentIndex];
  }

  markSourceFailed(sourceName) {
    this.failedSources.add(sourceName);
    logger.warn(`Source ${sourceName} marked as failed`);
    this.rotateSource();
  }

  rotateSource() {
    let attempts = 0;
    while (attempts < this.sourceOrder.length) {
      this.currentIndex = (this.currentIndex + 1) % this.sourceOrder.length;
      const sourceName = this.sourceOrder[this.currentIndex];
      if (!this.failedSources.has(sourceName)) {
        setDebugSource(sourceName);
        logger.info(`Rotated to source: ${sourceName}`);
        return;
      }
      attempts++;
    }
    // If all sources failed, reset
    this.failedSources.clear();
    this.currentIndex = 0;
    setDebugSource(this.sourceOrder[0]);
    logger.info('All sources failed, resetting to first source');
  }

  reset() {
    this.failedSources.clear();
    this.currentIndex = 0;
    setDebugSource(this.sourceOrder[0]);
  }
}

module.exports = new SourceManager();
