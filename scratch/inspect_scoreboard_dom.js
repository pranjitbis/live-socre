const fs = require('fs');
const cheerio = require('cheerio');
const path = require('path');

const htmlPath = path.join(__dirname, '../debug/live-page.html');
if (!fs.existsSync(htmlPath)) {
  console.log(`File not found: ${htmlPath}`);
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf-8');
const $ = cheerio.load(html);

console.log('Page Title:', $('title').text().trim());

console.log('\n--- Inning Containers ---');
const containers = $('.live-score-card, .scoreboard, .match-header, .team-result, .team-innig, .live-data, .team-inning-card');
console.log(`Found ${containers.length} containers:`);
containers.each((i, el) => {
  console.log(`\nContainer [${i}]: tag=${el.tagName}, class="${$(el).attr('class') || ''}"`);
  console.log(`  Text: "${$(el).text().trim().replace(/\s+/g, ' ')}"`);
  console.log(`  HTML snippet:`);
  console.log($(el).html().substring(0, 1000).replace(/\s+/g, ' '));
});

console.log('\n--- Team Inning Details ---');
$('.team-inning, .team-innig, .team-result').each((i, el) => {
  console.log(`\nTeam Inning [${i}]: class="${$(el).attr('class') || ''}"`);
  console.log(`  HTML:`, $(el).html().replace(/\s+/g, ' ').substring(0, 500));
  const activeClass = $(el).hasClass('active') || $(el).hasClass('selected') || $(el).attr('class').includes('active') || $(el).attr('class').includes('selected');
  console.log(`  Is Active class directly:`, activeClass);
});

// Also check for sub-elements and attributes like angular tags
console.log('\n--- Searching for angular attributes or highlighting indicators ---');
$('*').each((i, el) => {
  const attribs = el.attribs || {};
  for (const [key, val] of Object.entries(attribs)) {
    if (key.includes('active') || key.includes('selected') || key.includes('batting') || key.includes('innings') || val.includes('active') || val.includes('selected') || val.includes('batting')) {
      console.log(`Tag <${el.tagName} class="${$(el).attr('class') || ''}"> attribute ${key}="${val}"`);
    }
  }
});
