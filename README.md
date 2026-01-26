# All-in

[中文说明 / Chinese README](./README.zh-CN.md)

An offline Texas Hold’em chip + session helper for live home games.

## Features

- Table setup: blinds/ante, players, dealer position, rebuy
- In-hand tracking: actions, pot and side pots, rollback, forced next street
- Showdown settlement: manual winners selection + optional auto-evaluation from card text input
- Session summary: per-player initial/rebuy/final/net and save to history
- Real-time sync: broadcast snapshots across devices via WebSocket (`/sync`)

## Tech Stack

- React + TypeScript + Vite
- `ws` for WebSocket sync (runs inside Vite dev/preview server)
- File-based history storage under `./history/`

## Quick Start

```bash
npm install
npm run dev
```

Open the URL printed by Vite (usually http://localhost:5173).

## Scripts

- `npm run dev`: start dev server
- `npm run build`: typecheck + build
- `npm run lint`: eslint
- `npm run preview`: serve the built `dist` with the same APIs (see below)

## Built-in APIs

These endpoints are provided by a Vite plugin in [vite.config.ts](./vite.config.ts):

- **WebSocket**: `GET /sync`
  - Broadcasts latest game snapshot to all connected clients
- **History REST API**:
  - `GET /api/history` → list `*.json` in `./history/`
  - `GET /api/history/:name` → read a history file
  - `POST /api/history` → write a new history file

History files are stored on the server filesystem under `./history/` (auto-created).

## Docker

Build and run:

```bash
docker build -t allin .
docker run --rm -p 4173:4173 -v "$PWD/history:/app/history" allin
```

Or use docker compose:

```bash
docker compose up --build
```

The default `docker-compose.yml` mounts `./allin/history` into `/app/history`. Adjust it if you prefer `./history`.

## Project Structure

- `src/poker/`: engine and hand evaluation
- `src/views/`: UI pages (home/game/history/rules/summary)
- `src/hooks/`: sync/state hooks (WebSocket snapshot sync)
