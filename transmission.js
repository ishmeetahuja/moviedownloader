require('dotenv').config();
const axios = require('axios');

const HOST = process.env.TRANSMISSION_HOST;
const PORT = process.env.TRANSMISSION_PORT || 9091;
const USER = process.env.TRANSMISSION_USER;
const PASS = process.env.TRANSMISSION_PASS;
const DOWNLOAD_DIR = process.env.TRANSMISSION_DOWNLOAD_DIR;

const RPC_URL = `http://${HOST}:${PORT}/transmission/rpc`;
let sessionId = '';

async function rpcCall(method, args = {}) {
  try {
    const config = {
      headers: {
        'X-Transmission-Session-Id': sessionId,
        'Content-Type': 'application/json'
      }
    };
    if (USER && PASS) config.auth = { username: USER, password: PASS };
    const res = await axios.post(RPC_URL, { method, arguments: args }, config);
    return res.data;
  } catch (err) {
    if (err.response && err.response.status === 409) {
      sessionId = err.response.headers['x-transmission-session-id'];
      return rpcCall(method, args);
    }
    throw new Error(`Transmission RPC error: ${err.message}`);
  }
}

async function addTorrentBuffer(buffer, torrentName) {
  console.log(`[Transmission] Adding: ${torrentName}`);
  const res = await rpcCall('torrent-add', {
    metainfo: buffer.toString('base64'),
    'download-dir': DOWNLOAD_DIR,
    paused: false
  });
  if (res.result !== 'success') throw new Error(`Transmission rejected: ${res.result}`);
  const torrent = res.arguments['torrent-added'] || res.arguments['torrent-duplicate'];
  if (!torrent) throw new Error('Could not get torrent ID from Transmission');
  console.log(`[Transmission] Added ID: ${torrent.id}`);
  return torrent;
}

async function getTorrentStatus(id) {
  const res = await rpcCall('torrent-get', {
    ids: [id],
    fields: ['id', 'name', 'status', 'percentDone', 'eta', 'rateDownload', 'isFinished', 'error', 'errorString']
  });
  const torrents = res.arguments.torrents;
  if (!torrents || torrents.length === 0) return null;
  return torrents[0];
}

const STATUS = {
  0: 'Stopped',
  1: 'Queued to check',
  2: 'Checking',
  3: 'Queued',
  4: 'Downloading',
  5: 'Queued to seed',
  6: 'Seeding'
};

function getStatusLabel(code) {
  return STATUS[code] || 'Unknown';
}

module.exports = { addTorrentBuffer, getTorrentStatus, getStatusLabel };
