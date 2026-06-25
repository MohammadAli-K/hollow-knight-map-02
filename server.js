'use strict';

const express = require('express');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const { createRemoteJWKSet, jwtVerify, SignJWT } = require('jose');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const PORT = process.env.PORT || 3000;
const CF_TEAM_NAME = process.env.CF_TEAM_NAME;
const CF_AUD = process.env.CF_AUD;
const USER_JWT_SECRET = process.env.USER_JWT_SECRET;

const app = express();

// Security headers (CSP, X-Frame-Options, HSTS, etc.)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  })
);

app.use(express.json({ limit: '512kb' }));

// ---------------------------------------------------------------------------
// SQLite database — user accounts and found markers
// ---------------------------------------------------------------------------

// Keep data/ for markers.json (read-only from repo).
// Store the database in a separate directory so a Railway Volume mounted at
// /app/userdata doesn't shadow data/markers.json.
const DB_DIR = process.env.DB_DIR || path.join(__dirname, 'userdata');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'users.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT    UNIQUE NOT NULL,
    password_hash TEXT   NOT NULL,
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_found_markers (
    user_id   INTEGER NOT NULL,
    marker_id TEXT    NOT NULL,
    found_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, marker_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// ---------------------------------------------------------------------------
// User session JWT helpers
// ---------------------------------------------------------------------------

function getUserJwtSecret() {
  if (!USER_JWT_SECRET) {
    // Dev fallback — warn but allow running locally without env var
    return new TextEncoder().encode('dev-secret-change-me');
  }
  return new TextEncoder().encode(USER_JWT_SECRET);
}

async function signUserToken(userId, email) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setExpirationTime('30d')
    .sign(getUserJwtSecret());
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `hk_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 30}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'hk_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k) cookies[k.trim()] = rest.join('=');
  }
  return cookies;
}

// ---------------------------------------------------------------------------
// Cloudflare Access JWT verification (admin)
// ---------------------------------------------------------------------------

let JWKS = null;

function getJWKS() {
  if (!JWKS) {
    const certsUrl = new URL(
      `https://${CF_TEAM_NAME}.cloudflareaccess.com/cdn-cgi/access/certs`
    );
    JWKS = createRemoteJWKSet(certsUrl);
  }
  return JWKS;
}

async function requireCFAccess(req, res, next) {
  if (!CF_TEAM_NAME || !CF_AUD) return next();

  const token =
    req.headers['cf-access-jwt-assertion'] ||
    (req.headers.cookie || '')
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('CF_Authorization='))
      ?.split('=')
      .slice(1)
      .join('=');

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }

  try {
    await jwtVerify(token, getJWKS(), {
      audience: CF_AUD,
      issuer: `https://${CF_TEAM_NAME}.cloudflareaccess.com`,
    });
    next();
  } catch {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
}

// ---------------------------------------------------------------------------
// User auth middleware
// ---------------------------------------------------------------------------

async function requireUserAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies['hk_session'];
  if (!token) return res.status(401).json({ ok: false, error: 'Not logged in' });

  try {
    const { payload } = await jwtVerify(token, getUserJwtSecret());
    req.userId = Number(payload.sub);
    req.userEmail = payload.email;
    next();
  } catch {
    return res.status(401).json({ ok: false, error: 'Session expired' });
  }
}

// Tries to resolve user session but never blocks the request.
async function optionalUserAuth(req, _res, next) {
  const cookies = parseCookies(req);
  const token = cookies['hk_session'];
  if (token) {
    try {
      const { payload } = await jwtVerify(token, getUserJwtSecret());
      req.userId = Number(payload.sub);
      req.userEmail = payload.email;
    } catch {
      // invalid/expired — treat as logged out
    }
  }
  next();
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateAuth(email, password) {
  if (!email || !EMAIL_RE.test(email)) return 'Valid email is required';
  if (!password || password.length < 8) return 'Password must be at least 8 characters';
  return null;
}

// ---------------------------------------------------------------------------
// API routes — admin (Cloudflare Access)
// ---------------------------------------------------------------------------

app.get('/api/auth/status', requireCFAccess, (_req, res) => {
  res.json({ isAdmin: true });
});

app.post('/api/admin/markers', requireCFAccess, (req, res) => {
  const updates = req.body?.markers;
  if (!Array.isArray(updates)) {
    return res.status(400).json({ ok: false, error: 'Invalid payload' });
  }

  const markersPath = path.join(__dirname, 'data', 'markers.json');
  const tmpPath = markersPath + '.tmp';

  let data;
  try {
    data = JSON.parse(fs.readFileSync(markersPath, 'utf8'));
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not read markers' });
  }

  const byId = new Map(data.markers.map((m) => [m.id, m]));
  const mapWidth = data.map.width;
  const mapHeight = data.map.height;

  let saved = 0;
  for (const { id, x, y } of updates) {
    const marker = byId.get(id);
    if (!marker) continue;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !isFinite(x) ||
      !isFinite(y) ||
      x < 0 || x > mapWidth ||
      y < 0 || y > mapHeight
    ) {
      continue;
    }
    marker.x = Math.round(x);
    marker.y = Math.round(y);
    saved++;
  }

  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, markersPath);
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not write markers' });
  }

  res.json({ ok: true, saved });
});

app.post('/api/auth/logout', (req, res) => {
  const logoutUrl = CF_TEAM_NAME
    ? `https://${CF_TEAM_NAME}.cloudflareaccess.com/cdn-cgi/access/logout`
    : null;
  res.json({ ok: true, logoutUrl });
});

// ---------------------------------------------------------------------------
// API routes — user accounts
// ---------------------------------------------------------------------------

app.post('/api/user/register', async (req, res) => {
  const { email, password } = req.body ?? {};
  const err = validateAuth(email, password);
  if (err) return res.status(400).json({ ok: false, error: err });

  const passwordHash = await bcrypt.hash(password, 12);
  let user;
  try {
    const stmt = db.prepare(
      'INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)'
    );
    const result = stmt.run(email.toLowerCase(), passwordHash, Date.now());
    user = { id: result.lastInsertRowid, email: email.toLowerCase() };
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ ok: false, error: 'An account with that email already exists' });
    }
    return res.status(500).json({ ok: false, error: 'Could not create account' });
  }

  const token = await signUserToken(user.id, user.email);
  setSessionCookie(res, token);
  res.json({ ok: true, email: user.email });
});

app.post('/api/user/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const err = validateAuth(email, password);
  if (err) return res.status(400).json({ ok: false, error: err });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return res.status(401).json({ ok: false, error: 'Incorrect email or password' });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ ok: false, error: 'Incorrect email or password' });

  const token = await signUserToken(user.id, user.email);
  setSessionCookie(res, token);
  res.json({ ok: true, email: user.email });
});

app.post('/api/user/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/user/status', optionalUserAuth, (req, res) => {
  if (req.userId) {
    res.json({ loggedIn: true, email: req.userEmail });
  } else {
    res.json({ loggedIn: false });
  }
});

app.get('/api/user/found', requireUserAuth, (req, res) => {
  const rows = db
    .prepare('SELECT marker_id FROM user_found_markers WHERE user_id = ?')
    .all(req.userId);
  res.json({ ok: true, found: rows.map((r) => r.marker_id) });
});

app.post('/api/user/found', requireUserAuth, (req, res) => {
  const { markerId } = req.body ?? {};
  if (!markerId || typeof markerId !== 'string') {
    return res.status(400).json({ ok: false, error: 'markerId required' });
  }
  db.prepare(
    'INSERT OR IGNORE INTO user_found_markers (user_id, marker_id, found_at) VALUES (?, ?, ?)'
  ).run(req.userId, markerId, Date.now());
  res.json({ ok: true });
});

app.delete('/api/user/found/:markerId', requireUserAuth, (req, res) => {
  db.prepare('DELETE FROM user_found_markers WHERE user_id = ? AND marker_id = ?').run(
    req.userId,
    req.params.markerId
  );
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Static file serving (must come after API routes)
// ---------------------------------------------------------------------------
app.use(
  express.static(path.join(__dirname), {
    setHeaders(res) {
      res.removeHeader('X-Powered-By');
    },
  })
);

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Hollow Knight Map server running on http://localhost:${PORT}`);
  if (!CF_TEAM_NAME || !CF_AUD) {
    console.warn(
      '  WARNING: CF_TEAM_NAME / CF_AUD not set. Admin endpoints are unprotected.\n' +
        '  Set these env vars before deploying to production.'
    );
  }
  if (!USER_JWT_SECRET) {
    console.warn(
      '  WARNING: USER_JWT_SECRET not set. Using insecure dev default.\n' +
        '  Set this env var before deploying to production.'
    );
  }
});
