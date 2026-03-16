# 🎬 Dina — Your Personal Movie Download Assistant

Dina is a Node.js/Express app with a beautiful web chat UI. Tell her what movie you want, and she'll:

1. Search **IPTorrents** for the best quality match
2. Auto-pick the best result (prefers 1080p BluRay/WEB-DL)
3. Send the torrent to **Transmission** on your server
4. Show **live download progress** in the chat UI
5. Notify you the moment it's done and ready in **Plex**

---

## 🚀 Setup

### 1. Copy this folder to your server

```bash
scp -r dina/ user@192.168.1.191:~/dina
```

### 2. Install dependencies

```bash
cd ~/dina
npm install
```

### 3. Verify your .env file

```env
TRANSMISSION_HOST=192.168.1.191
TRANSMISSION_PORT=9091
TRANSMISSION_USER=
TRANSMISSION_PASS=
TRANSMISSION_DOWNLOAD_DIR=

IPT_USER=
IPT_PASS=
IPT_BASE_URL=https://iptorrents.com

PORT=3010
```

### 4. Start Dina

```bash
npm start
```

Then open **http://<IP>:3010** in your browser.

---

## 💬 How to Talk to Dina

Just type naturally in the chat:

- `download Inception`
- `hey dina get me The Dark Knight`
- `fetch Dune Part Two`
- `I want to watch Oppenheimer`

---

## 🔧 Run as a Service (optional, keeps Dina running after reboot)

```bash
# Install pm2
npm install -g pm2

# Start Dina with pm2
cd ~/dina
pm2 start server.js --name dina

# Auto-start on reboot
pm2 startup
pm2 save
```

---

## 📁 Project Structure

```
dina/
├── server.js           # Express + WebSocket server
├── src/
│   ├── iptorrents.js   # IPTorrents login, search, download
│   └── transmission.js # Transmission RPC client
├── public/
│   └── index.html      # Chat UI
├── .env                # Your credentials (keep private!)
└── package.json
```

---

## ⚠️ Notes

- Dina picks the **best torrent automatically** based on quality + seeders
- Progress updates every **10 seconds** in the UI
- Multiple downloads can run simultaneously
- If IPTorrents changes their HTML structure, the scraper in `src/iptorrents.js` may need tweaking
