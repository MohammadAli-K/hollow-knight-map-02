# Hallownest Map

**Live at [cornimap.com](https://cornimap.com)**

An interactive map for the game *Hollow Knight*, built as a full-stack web app. Users can explore the Hallownest map, filter collectibles by category, search for specific locations, and track which items they have found — all synced to a personal account.

## Features

- **Pan & zoom** — drag to pan, scroll wheel or pinch-to-zoom, keyboard arrow keys to navigate
- **Category filters** — toggle visibility of Benches, Stag Stations, Hot Springs, Trams, Grubs, and Lifeblood Cocoons
- **Search** — filter markers by name or region; clicking a search result pans and zooms directly to the pin
- **Mark as Found** — track collected items per account; state is persisted server-side
- **User accounts** — register/login with email + password; JWT session stored in an HttpOnly cookie
- **Admin CMS** — authenticated admins can drag pins to reposition them and save coordinates back to `data/markers.json`
- **Responsive** — sidebar auto-hides on narrow screens with a mobile toggle

## Tech stack

| Layer | Technology |
|---|---|
| Server | Node.js + Express |
| Database | SQLite via `better-sqlite3` |
| Auth (users) | `jose` (HS256 JWTs), `bcryptjs` |
| Auth (admin) | Cloudflare Access (Zero Trust) |
| Security headers | `helmet` |
| Frontend | Vanilla JS + HTML + CSS (no framework) |

## Project structure

```
├── server.js          # Express server — API routes and static file serving
├── script.js          # All frontend logic (map, sidebar, auth, admin CMS)
├── index.html         # Single-page app shell
├── assets/
│   ├── css/style.css  # All styles
│   ├── pins/          # WebP pin icons (bench, stag, springs, tram, grub, cocoon)
│   ├── hollownest-basemap/  # Map background image
│   └── logo/          # App logo
├── data/
│   └── markers.json   # Marker definitions (id, category, name, x/y coordinates)
├── tools/
│   └── build-markers.js  # One-off script: converts MapGenie export → markers.json
└── .env.example       # Required environment variables
```

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in the values:

```env
# Cloudflare Access (only needed for the admin CMS)
CF_TEAM_NAME=your-team-name
CF_AUD=your-audience-tag

# Port (defaults to 3000)
PORT=3000

# Secret for signing user session JWTs — generate a strong random value:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
USER_JWT_SECRET=replace-with-a-long-random-string
```

`CF_TEAM_NAME` and `CF_AUD` are optional for local development — if omitted, the admin endpoints are unprotected (a warning is printed on startup). `USER_JWT_SECRET` defaults to an insecure dev value if not set.

### 3. Start the server

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## API reference

### User auth

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/user/register` | Create account (`{ email, password }`) |
| `POST` | `/api/user/login` | Log in (`{ email, password }`) |
| `POST` | `/api/user/logout` | Clear session cookie |
| `GET` | `/api/user/status` | Check if logged in |

### Found markers

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/user/found` | Get all found marker IDs |
| `POST` | `/api/user/found` | Mark a pin found (`{ markerId }`) |
| `DELETE` | `/api/user/found/:markerId` | Unmark a pin |

### Admin (requires Cloudflare Access JWT)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/auth/status` | Check admin access |
| `POST` | `/api/admin/markers` | Save repositioned markers (`{ markers: [{id, x, y}] }`) |
| `POST` | `/api/auth/logout` | Get CF logout URL |

## Admin CMS

Navigate to `/admin-login` while authenticated through Cloudflare Access. In admin mode, every pin becomes draggable. Drag a pin to its correct position and click **Save Changes** — coordinates are written back to `data/markers.json` atomically (write to `.tmp`, then rename).

## Marker data

`data/markers.json` stores pixel coordinates relative to the basemap dimensions (4498 × 2901 px). The `tools/build-markers.js` script was used to convert a MapGenie location export into this format and can be re-run if the source data changes.

## Deployment

The app is designed to run on [Railway](https://railway.app). Mount a persistent volume at `/app/userdata` so the SQLite database survives deploys. `data/markers.json` stays in the repo and is read-only at runtime (admin saves write directly to the filesystem, so the volume should also cover `data/` if pin repositioning needs to persist across deploys).

Set the three environment variables (`CF_TEAM_NAME`, `CF_AUD`, `USER_JWT_SECRET`) in your Railway service settings before deploying to production.
