# 🎵 NoirSync

> Real-time synchronized music-sharing with sliding-window streaming, NTP clock sync, live LRC lyrics, and a cinematic Dark Noir UI.

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-blue)](https://react.dev)
[![Socket.io](https://img.shields.io/badge/Socket.io-4.7-black)](https://socket.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎧 **Synchronized playback** | NTP-calibrated scheduling — all listeners hear the same beat at the same millisecond |
| 📡 **Sliding-window streaming** | Host uploads 5-second chunks; server GC keeps only ±30 s in RAM |
| 🎤 **Live LRC lyrics** | Drop a `.lrc` file to show real-time scrolling lyrics with a gold glow highlight |
| 🌑 **Dark Noir UI** | Glassmorphism panels, grain overlay, gold accents, animated waveform |
| 📱 **PWA ready** | Installable from browser, service worker for offline shell |
| 🔒 **Industry hardened** | Helmet, rate-limiting, structured Winston logging, input validation, graceful shutdown |

---

## 🗂 Project Structure

```
noirsync/
├── server/          Node.js + Express + Socket.io backend (port 3001)
│   └── src/
│       ├── index.js         Entry point (Helmet, CORS, rate-limit, WS)
│       ├── rooms.js         Room & sliding-window buffer manager
│       ├── ntp.js           NTP clock endpoint helper
│       ├── logger.js        Winston structured logger
│       └── middleware/
│           ├── rateLimiter.js
│           └── validate.js
└── client/          React + Vite + Tailwind frontend (port 5173)
    └── src/
        ├── lib/             Core libs (socket, ntp, chunker, lrc, mse)
        ├── hooks/           Custom React hooks
        └── components/      UI components + design system
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9

### 1. Install

```bash
# Clone the repo
git clone https://github.com/your-org/noirsync.git
cd noirsync

# Install all workspace dependencies
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..
```

### 2. Configure

```bash
cp server/.env.example server/.env
# Edit server/.env if needed (default: PORT=3001)
```

### 3. Run (development)

```bash
# Start both server + client with hot reload
npm run dev

# Or individually:
npm run dev:server   # server on :3001
npm run dev:client   # client on :5173
```

Open **http://localhost:5173** in your browser.

---

## 🎮 Usage

### As a Host
1. Open the app → enter your name → **Create Room**
2. Note the **6-character room code** shown
3. Drag & drop an **MP3/WAV** file (+ optional `.lrc` lyrics file)
4. Wait for the upload progress bar to complete
5. Hit **Play** — all listeners hear it simultaneously within ~2 seconds

### As a Listener
1. Open the app → enter your name → **Join Room**
2. Enter the room code shared by the host
3. The player auto-starts when the host hits play

### Share the Room
- Click **Copy Invite Link** — share the URL; anyone opening it gets pre-filled room code

---

## 🏗 Architecture Decisions

### Sliding-Window Buffer
Audio is split into ~5-second chunks. The server keeps:
- **3 chunks behind** current playhead (≈15 s rewind buffer)
- **6 chunks ahead** as prefetch cache

Chunks older than the window are garbage-collected, capping server RAM usage regardless of song length.

### NTP Clock Sync
Clients run 5 HTTP ping/pong rounds on connect and take the **median offset** to compensate for network asymmetry. Re-sync happens every 30 seconds. The host schedules playback `serverTime + 2000ms` so all clients have time to buffer before starting.

### MediaSource Extensions (MSE)
Viewers download chunks sequentially via HTTP and append them to a `SourceBuffer` via the MSE API. A simple queue prevents concurrent appends (the MSE spec forbids them).

---

## 🔒 Security

- **Helmet.js** — sets 11+ security HTTP headers
- **Rate limiting** — 100 req/min on API, 30 req/min on chunk upload
- **CORS** — configurable via `CORS_ORIGIN` env var (defaults to `*` for dev)
- **Input validation** — `roomId` and `chunkIndex` validated before DB/buffer access
- **Max upload size** — 10 MB per chunk enforced by multer + Socket.io config

---

## 📦 Production Deployment

```bash
# Build client
cd client && npm run build

# Serve client dist as static files from server (optional)
# Or deploy client/dist to Vercel/Netlify and server/ to Railway/Render

# Server env vars for production:
PORT=3001
NODE_ENV=production
CORS_ORIGIN=https://your-frontend.com
```

---

## 🧪 Environment Variables

### `server/.env`

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server listening port |
| `NODE_ENV` | `development` | Environment mode |
| `CORS_ORIGIN` | `*` | Allowed CORS origin(s) |
| `MAX_CHUNK_SIZE_MB` | `10` | Max chunk upload size in MB |
| `ROOM_TTL_MS` | `7200000` | Room expiry in ms (2 hours) |
| `LOG_LEVEL` | `info` | Winston log level |

### `client/.env` (create from `.env.example`)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_SERVER_URL` | `http://localhost:3001` | Backend URL |

---

## 📄 License

MIT © NoirSync Contributors
