// scratch/inspect_crex_dom.js
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Load step1 JSON
const jsonPath = path.join(__dirname, '../debug/match-info-investigation/2026-08-23T14-46-20-145Z-step1.json');
if (!fs.existsSync(jsonPath)) {
  console.log(`❌ JSON file not found at ${jsonPath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const $ = cheerio.load(data.html);

let out = [];
function log(...args) {
  out.push(args.join(' '));
}

log('============================================================');
log('DETAILED HIERARCHY DUMP FOR KEY SECTIONS');
log('============================================================');
log('URL:', data.url);
log('Title:', data.title);

// 1. Match Info/Header structure
log('\n--- 1. Match Info/Header Area ---');
const matchHeader = $('.match-header, .match-info, .series-name').first();
if (matchHeader.length > 0) {
  let parent = $('.series-name').parent();
  log('Series Name Parent tag:', parent.prop('tagName'), 'class:', parent.attr('class'));
  log('Series Name Parent HTML:\n', parent.html().substring(0, 1000).replace(/\s+/g, ' '));
}

// 2. Scoreboard / Team Innings structure
log('\n--- 2. Team Inning Containers ---');
const teamInnings = $('.team-inning');
teamInnings.each((i, el) => {
  log(`\nInning ${i + 1} HTML (tag=${el.tagName} class="${$(el).attr('class') || ''}"):`);
  log($(el).html().replace(/\s+/g, ' '));
});

// 3. Current Batsmen & Bowler container structure
log('\n--- 3. Batsmen Partnership Container ---');
const batsPart = $('.batsmen-partnership');
if (batsPart.length > 0) {
  const parent = batsPart.first().parent();
  log('Parent tag:', parent.prop('tagName'), 'class:', parent.attr('class'));
  log('Parent HTML:\n', parent.html().replace(/\s+/g, ' '));
}

// 4. Overs timeline structure
log('\n--- 4. Overs Timeline Container ---');
const overs = $('.overs-timeline');
if (overs.length > 0) {
  log('Overs HTML:\n', overs.first().html().replace(/\s+/g, ' '));
}

// 5. Commentary structure
log('\n--- 5. Commentary Items ---');
const commentaryRows = $('.commentary-row, [class*="commentary"]');
log('Total commentary elements:', commentaryRows.length);
commentaryRows.slice(0, 3).each((i, el) => {
  log(`\nCommentary ${i + 1} HTML (class="${$(el).attr('class') || ''}"):`);
  log($(el).html().replace(/\s+/g, ' '));
});

// 6. Projected Score
log('\n--- 6. Projected Score Section ---');
$('div, span, p').each((i, el) => {
  const text = $(el).text().trim();
  if (text.includes('Projected') || text.includes('Proj. Score')) {
    log(`Found text at tag ${el.tagName} class="${$(el).attr('class') || ''}": "${text}"`);
    log('HTML:\n', $(el).parent().html().substring(0, 500).replace(/\s+/g, ' '));
  }
});

log('============================================================');

fs.writeFileSync(path.join(__dirname, 'inspect_crex_dom_output.txt'), out.join('\n'));
console.log('✅ Done! Output written to inspect_crex_dom_output.txt');
