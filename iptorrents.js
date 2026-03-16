require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://iptorrents.com';

function makeClient() {
  const uid = process.env.IPT_UID;
  const pass = process.env.IPT_PASS;
  if (!uid || !pass) throw new Error('IPT_UID or IPT_PASS missing from .env');
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'Cookie': `uid=${uid}; pass=${pass}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Referer': BASE_URL
    },
    maxRedirects: 5
  });
}

// Map IPT category class to human readable label
function getCategoryLabel(tdClass) {
  const map = {
    'p72': 'Movie/HD/Bluray', 'p87': 'Movie/HD', 'p77': 'Movie/Remux',
    'p48': 'Movie/BluRay', 'p56': 'Movie/DVD', 'p54': 'Movie/DVD-R',
    'p80': 'Movie/4K', 'p90': 'Movie/4K/Bluray', 'p96': 'Movie/4K/Remux',
    'p50': 'Movie/XviD', 'p73': 'Movie/x265'
  };
  for (const [key, val] of Object.entries(map)) {
    if (tdClass && tdClass.includes(key)) return val;
  }
  return 'Movie';
}

async function searchMovie(query) {
  const client = makeClient();
  console.log(`[IPT] Searching: "${query}"`);
  const res = await client.get(`/t?87=&77=&101=&89=&90=&96=&6=&48=&54=&62=&38=&68=&20=&100=&7=&q=${encodeURIComponent(query)}&qf=`);

  if (res.data?.includes('name="login"')) {
    throw new Error('IPTorrents session expired — update IPT_UID and IPT_PASS in .env');
  }

  const $ = cheerio.load(res.data);
  const results = [];

  $('table#torrents tbody tr').each((i, row) => {
    const $row = $(row);
    const titleEl = $row.find('a.b').first();
    const title = titleEl.text().trim();
    const href = titleEl.attr('href');
    if (!title || !href) return;

    const dlHref = $row.find('a[href*="/download.php/"]').attr('href');
    const cells = $row.find('td');
    const seeders = parseInt($(cells[cells.length - 2]).text()) || 0;
    const leechers = parseInt($(cells[cells.length - 1]).text()) || 0;
    const size = $(cells[cells.length - 4]).text().trim() || '?';
    const categoryClass = $(cells[0]).attr('class') || '';
    const category = getCategoryLabel(categoryClass);

    results.push({
      title,
      category,
      size,
      seeders,
      leechers,
      detailUrl: `${BASE_URL}${href}`,
      downloadPath: dlHref ? `${BASE_URL}${dlHref}` : null
    });
  });

  // Filter out TV shows — anything with S01E01 / Season patterns
  const tvPattern = /S\d{2}E\d{2}|Season\s+\d+|\d+x\d+/i;
  const moviesOnly = results.filter(r => !tvPattern.test(r.title));
  const final = moviesOnly.length > 0 ? moviesOnly : results;
  final.sort((a, b) => b.seeders - a.seeders);
  console.log(`[IPT] ${results.length} total, ${final.length} movies after TV filter`);
  final.forEach(r => console.log(`  - ${r.title} (${r.seeders} seeders, ${r.size})`));
  return final.slice(0, 10);
}

async function downloadTorrentFile(torrent) {
  const client = makeClient();
  let dlUrl = torrent.downloadPath;
  if (!dlUrl) {
    const res = await client.get(torrent.detailUrl);
    const $ = cheerio.load(res.data);
    const dl = $('a[href*="/download.php/"]').first().attr('href');
    if (!dl) throw new Error('Could not find torrent download link');
    dlUrl = dl.startsWith('http') ? dl : `${BASE_URL}${dl}`;
  }
  console.log(`[IPT] Downloading: ${torrent.title}`);
  const res = await client.get(dlUrl, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

module.exports = { searchMovie, downloadTorrentFile };
