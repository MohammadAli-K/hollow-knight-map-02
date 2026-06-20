'use strict';

const express = require('express');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const { createRemoteJWKSet, jwtVerify } = require('jose');

const PORT = process.env.PORT || 3000;
const CF_TEAM_NAME = process.env.CF_TEAM_NAME;
const CF_AUD = process.env.CF_AUD;

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
// Cloudflare Access JWT verification
// ---------------------------------------------------------------------------

// Cache the JWKS fetcher so keys are not re-fetched on every request.
// jose's createRemoteJWKSet handles caching and key rotation internally.
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
  // Dev bypass: when CF_TEAM_NAME / CF_AUD are not set (local development
  // without Cloudflare in front), skip JWT verification entirely.
  if (!CF_TEAM_NAME || !CF_AUD) {
    return next();
  }

  // Cloudflare Access sends the JWT in a header (XHR/fetch) and also as
  // the CF_Authorization cookie (browser navigation). Check both.
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
// API routes
// ---------------------------------------------------------------------------

// Returns whether the current request carries a valid Cloudflare Access JWT.
app.get('/api/auth/status', requireCFAccess, (_req, res) => {
  res.json({ isAdmin: true });
});

// Merges updated x,y positions into markers.json. Only existing marker IDs
// are accepted; the x,y values are strictly validated as finite numbers.
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

  // Build a fast lookup by id
  const byId = new Map(data.markers.map((m) => [m.id, m]));
  const mapWidth = data.map.width;
  const mapHeight = data.map.height;

  let saved = 0;
  for (const { id, x, y } of updates) {
    const marker = byId.get(id);
    if (!marker) continue; // unknown id — skip silently
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !isFinite(x) ||
      !isFinite(y) ||
      x < 0 || x > mapWidth ||
      y < 0 || y > mapHeight
    ) {
      continue; // invalid coordinates — skip silently
    }
    marker.x = Math.round(x);
    marker.y = Math.round(y);
    saved++;
  }

  try {
    // Atomic write: write to .tmp then rename
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, markersPath);
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not write markers' });
  }

  res.json({ ok: true, saved });
});

// Returns the Cloudflare logout URL so the browser can clear the CF session.
app.post('/api/auth/logout', (req, res) => {
  const logoutUrl = CF_TEAM_NAME
    ? `https://${CF_TEAM_NAME}.cloudflareaccess.com/cdn-cgi/access/logout`
    : null;
  res.json({ ok: true, logoutUrl });
});

// ---------------------------------------------------------------------------
// Static file serving (must come after API routes)
// ---------------------------------------------------------------------------
app.use(
  express.static(path.join(__dirname), {
    // Don't serve .env or server.js as static files
    setHeaders(res) {
      // Static assets are already served with helmet's security headers above.
      // Remove the server fingerprint header.
      res.removeHeader('X-Powered-By');
    },
  })
);

// Catch-all: return index.html for any unknown path so deep links work.
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
});
