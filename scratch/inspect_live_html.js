const fs = require('fs');
const cheerio = require('cheerio');
const path = require('path');

const htmlPath = path.join(__dirname, '../src/debug/live-page.html');
if (!fs.existsSync(htmlPath)) {
  console.log(`File not found: ${htmlPath}`);
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf-8');
const $ = cheerio.load(html);

console.log('Page Title:', $('title').text().trim());

// Print elements with classes related to match/team/live
console.log('\n--- Selected Classes ---');
const classesToInspect = ['.team-innig', '.batsmen-info-wrapper', '.player-card', '.bowler-info', '.overs-timeline', '.projected-score', '.commentary'];
classesToInspect.forEach(cls => {
  const count = $(cls).length;
  console.log(`${cls} count: ${count}`);
  if (count > 0) {
    console.log(`  First ${cls} text: "${$(cls).first().text().trim().replace(/\s+/g, ' ').substring(0, 100)}"`);
  }
});

// Find text containing "vs"
console.log('\n--- Text containing "vs" ---');
$('h1, h2, h3, div').each((i, el) => {
  const text = $(el).text().trim();
  if (text.includes(' vs ') && text.length < 100 && $(el).children().length === 0) {
    console.log(`Found "vs": "${text}" in <${el.tagName} class="${$(el).attr('class') || ''}">`);
  }
});
