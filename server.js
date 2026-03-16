require('dotenv').config();
const express = require('express');
const path = require('path');
const { searchMovie, downloadTorrentFile } = require('./iptorrents');
const { addTorrentBuffer, getTorrentStatus, getStatusLabel } = require('./transmission');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const clients = new Set();

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => res.write(msg));
}

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('data: {"type":"ping"}\n\n');
  const heartbeat = setInterval(() => res.write('data: {"type":"ping"}\n\n'), 20000);
  clients.add(res);
  console.log(`[SSE] Client connected (${clients.size} total)`);
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    console.log(`[SSE] Client disconnected`);
  });
});

async function pollTorrent(torrentId, torrentName, msgId) {
  const POLL_INTERVAL = 10000;
  const poll = async () => {
    try {
      const status = await getTorrentStatus(torrentId);
      if (!status) { broadcast({ type: 'error', msgId, text: `Lost track of: ${torrentName}` }); return; }
      const pct = Math.round(status.percentDone * 100);
      const eta = status.eta > 0 ? formatEta(status.eta) : null;
      const speed = status.rateDownload > 0 ? formatSpeed(status.rateDownload) : null;
      broadcast({ type: 'progress', msgId, torrentId, name: torrentName, percent: pct, status: getStatusLabel(status.status), eta, speed });
      if (status.percentDone >= 1.0 || status.isFinished) {
        broadcast({ type: 'done', msgId, name: torrentName });
        return;
      }
      if (status.error && status.error > 0) {
        broadcast({ type: 'error', msgId, text: `Error: ${status.errorString}` });
        return;
      }
      setTimeout(poll, POLL_INTERVAL);
    } catch (err) {
      broadcast({ type: 'error', msgId, text: `Polling error: ${err.message}` });
    }
  };
  setTimeout(poll, POLL_INTERVAL);
}

function formatEta(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function formatSpeed(b) {
  if (b > 1048576) return `${(b / 1048576).toFixed(1)} MB/s`;
  if (b > 1024) return `${(b / 1024).toFixed(0)} KB/s`;
  return `${b} B/s`;
}

// Shared: search and broadcast results picker
async function doSearch(query, msgId) {
  broadcast({ type: 'status', msgId, text: `🔍 Searching for **${query}**...` });
  const results = await searchMovie(query);
  if (results.length === 0) {
    broadcast({ type: 'error', msgId, text: `😕 Nothing found for **${query}**. Try a different title?` });
    return;
  }
  broadcast({ type: 'results', msgId, query, results });
}

// Shared: confirm and download a chosen result
async function doDownload(torrent, msgId) {
  try {
    broadcast({ type: 'status', msgId, text: `📥 Grabbing torrent for **${torrent.title}**...` });
    const buf = await downloadTorrentFile(torrent);
    broadcast({ type: 'status', msgId, text: `📡 Sending to Transmission...` });
    const t = await addTorrentBuffer(buf, torrent.title);
    broadcast({ type: 'status', msgId, text: `✅ Downloading **${t.name || torrent.title}**! I'll notify you when it's done.` });
    pollTorrent(t.id, t.name || torrent.title, msgId);
  } catch (err) {
    console.error('[Error]', err);
    broadcast({ type: 'error', msgId, text: `❌ ${err.message}` });
  }
}

// Chat endpoint
app.post('/chat', async (req, res) => {
  const { message, msgId } = req.body;
  if (!message) return res.json({ reply: "I didn't get your message!" });
  const lower = message.toLowerCase();
  const match =
    lower.match(/download\s+(.+)/i) ||
    lower.match(/get me\s+(.+)/i) ||
    lower.match(/grab\s+(.+)/i) ||
    lower.match(/fetch\s+(.+)/i) ||
    lower.match(/search\s+(.+)/i) ||
    lower.match(/find\s+(.+)/i);
  if (!match) return res.json({ reply: `Just tell me what to find — e.g. *"Download Interstellar"*` });
  const query = match[1].replace(/^(the\s+movie\s+)?/i, '').trim();
  res.json({ reply: `🔍 Searching for **${query}**...` });
  doSearch(query, msgId).catch(err => broadcast({ type: 'error', msgId, text: `❌ ${err.message}` }));
});

// Confirm download after user picks from results
app.post('/confirm', async (req, res) => {
  const { torrent, msgId } = req.body;
  if (!torrent) return res.status(400).json({ error: 'No torrent provided' });
  res.json({ ok: true });
  doDownload(torrent, msgId);
});

// URL endpoint: /download/movie+name — shows picker page
const watchlistCache = new Map();

// Step 1: Search — returns clean watchlist-style data only
// GET /addToWatchList/interstellar
app.get('/addToWatchList/:movie', async (req, res) => {
  const query = req.params.movie.replace(/\+/g, ' ').replace(/-/g, ' ');
  try {
    const results = await searchMovie(query);
    // Store full results server-side, only expose clean data to client
    const id = 'wl_' + Date.now();
    watchlistCache.set(id, results);
    setTimeout(() => watchlistCache.delete(id), 30 * 60 * 1000); // expire in 30min
    const clean = results.map((r, i) => ({
      id: `${id}_${i}`,
      title: r.title,
      category: r.category,
      size: r.size
    }));
    res.json({ success: true, query, results: clean });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Step 2: Confirm — client sends back the ID, server resolves full torrent internally
// POST /addToWatchList  { id: "wl_1234567890_2" }
app.post('/addToWatchList', async (req, res) => {
  const { id, msgId } = req.body;
  if (!id) return res.status(400).json({ error: 'No id provided' });
  const [cacheKey, indexStr] = id.split(/_(?=\d+$)/);
  const results = watchlistCache.get(cacheKey);
  if (!results) return res.status(404).json({ error: 'Session expired, search again' });
  const torrent = results[parseInt(indexStr)];
  if (!torrent) return res.status(404).json({ error: 'Invalid selection' });
  res.json({ success: true, message: `Added "${torrent.title}" to your list` });
  doDownload(torrent, msgId || 'api_' + Date.now());
});

app.listen(PORT, () => console.log(`\n🎬 Dina running at http://localhost:${PORT}\n`));


// Claude-friendly media endpoint (neutral naming)
app.get('/media/search/:title', async (req, res) => {
  const query = req.params.title.replace(/\+/g, ' ').replace(/-/g, ' ');
  try {
    const results = await searchMovie(query);
    res.json({ success: true, query, results });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/media/add', async (req, res) => {
  const { torrent, msgId } = req.body;
  if (!torrent) return res.status(400).json({ error: 'No torrent specified' });
  res.json({ success: true, message: `Adding ${torrent.title} to media server` });
  doDownload(torrent, msgId || 'api_' + Date.now());
});
