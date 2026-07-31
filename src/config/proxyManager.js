// src/config/proxyManager.js
const axios = require('axios');
const logger = require('../logger');
const config = require('./index');

let proxies = [];
let currentIndex = 0;

async function loadProxies() {
  try {
    // Updated working proxy sources
    const sources = [
      'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
      'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt',
      'https://raw.githubusercontent.com/roosterkid/openproxylist/main/http.txt',
      'https://raw.githubusercontent.com/opsxcq/proxy-list/master/list.txt',
      'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list.txt',
    ];

    const allProxies = [];

    for (const source of sources) {
      try {
        const response = await axios.get(source, { timeout: 10000 });
        const lines = response.data.split('\n');
        for (const line of lines) {
          const proxy = line.trim();
          if (proxy && !proxy.startsWith('#') && !proxy.startsWith('//')) {
            const [host, port] = proxy.split(':');
            if (host && port && !isNaN(parseInt(port))) {
              allProxies.push({ host, port: parseInt(port) });
            }
          }
        }
      } catch (error) {
        logger.warn(`Failed to load proxies from ${source}:`, error.message);
      }
    }

    proxies = allProxies;
    logger.info(`Loaded ${proxies.length} proxies`);
    return proxies.length;
  } catch (error) {
    logger.error('Failed to load proxies:', error);
    return 0;
  }
}

function getProxy() {
  if (proxies.length === 0) return null;
  const proxy = proxies[currentIndex % proxies.length];
  currentIndex++;
  return proxy;
}

function getProxyStatus() {
  return {
    total: proxies.length,
    available: proxies.length,
    currentIndex,
    hasProxies: proxies.length > 0,
  };
}

async function refreshProxies() {
  return await loadProxies();
}

module.exports = {
  loadProxies,
  getProxy,
  getProxyStatus,
  refreshProxies,
};
