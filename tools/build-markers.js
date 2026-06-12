#!/usr/bin/env node
/**
 * Regenerates `data/markers.json` and `data/marker-sources.json` from
 * `tools/mapgenie-locations-export.json`.
 *
 * Pixel coordinates are derived from each entry's latitude/longitude using
 * the basemap's `coordinateSystem.bounds`. The export's own `x`/`y` fields
 * are ignored because a handful of them contain typos (e.g. Bench -
 * Ancestral Mound has x=15000), while latitude/longitude are internally
 * consistent for all 122 entries.
 *
 * Usage: `node tools/build-markers.js`
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXPORT_PATH = path.join(ROOT, 'tools/mapgenie-locations-export.json');
const MARKERS_PATH = path.join(ROOT, 'data/markers.json');
const SOURCES_PATH = path.join(ROOT, 'data/marker-sources.json');

const MAP = {
  width: 4498,
  height: 2901,
  src: 'assets/hollownest-basemap/hallownest.jpeg',
  coordinateSystem: {
    type: 'mapgenie-mapbox',
    bounds: [-1.4, 0, 0, 1.4],
  },
};

// Category order mirrors CATEGORIES in script.js so the sidebar and the
// generated JSON stay in sync.
const CATEGORY_ORDER = ['bench', 'stag', 'springs', 'tram', 'grub', 'cocoon'];

const NAME_OVERRIDES = {
  // Drop the trailing region from the canonical bench title so the tooltip
  // stays compact ("Bench - Dirtmouth" -> "Bench - Dirtmouth"). Add custom
  // overrides here if a particular entry needs a different display name.
};

function latLonToXY(latitude, longitude) {
  const [lonMin, latMin, lonMax, latMax] = MAP.coordinateSystem.bounds;
  const x = ((longitude - lonMin) / (lonMax - lonMin)) * MAP.width;
  const y = ((latMax - latitude) / (latMax - latMin)) * MAP.height;
  return { x: Math.round(x), y: Math.round(y) };
}

function buildEntry(category, item, index) {
  const lat = parseFloat(item.latitude);
  const lon = parseFloat(item.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(
      `Missing or invalid lat/lon for ${category} id=${item.id} (${item.title})`,
    );
  }

  const { x, y } = latLonToXY(lat, lon);
  if (x < 0 || x > MAP.width || y < 0 || y > MAP.height) {
    console.warn(
      `[warn] derived position out of bounds: ${category} id=${item.id} ` +
        `(${item.title}) -> (${x}, ${y})`,
    );
  }

  const id = `${category}-${index + 1}`;
  const name = NAME_OVERRIDES[item.id] ?? item.title;

  const marker = {
    id,
    category,
    name,
    x,
    y,
    ref: {
      source: 'mapgenie',
      mapgenieId: item.id,
      title: item.title,
      region: item.region,
      latitude: item.latitude,
      longitude: item.longitude,
      positionNote: null,
    },
  };

  const source = {
    id,
    mapgenieId: item.id,
    mapgenieTitle: item.title,
    mapgenieRegion: item.region,
    matchMethod: 'export',
    matchScore: 100,
  };

  return { marker, source };
}

function main() {
  const raw = fs.readFileSync(EXPORT_PATH, 'utf8');
  const exportData = JSON.parse(raw);

  const markers = [];
  const sources = [];
  const counts = {};

  for (const category of CATEGORY_ORDER) {
    const items = exportData[category];
    if (!Array.isArray(items)) {
      console.warn(`[warn] no entries for category "${category}" in export`);
      counts[category] = 0;
      continue;
    }

    items.forEach((item, idx) => {
      const { marker, source } = buildEntry(category, item, idx);
      markers.push(marker);
      sources.push(source);
    });

    counts[category] = items.length;
  }

  // Surface any extra categories present in the export but missing from
  // CATEGORY_ORDER so we don't silently drop new data later.
  for (const key of Object.keys(exportData)) {
    if (!CATEGORY_ORDER.includes(key)) {
      console.warn(
        `[warn] export contains unknown category "${key}" with ` +
          `${exportData[key]?.length ?? 0} entries (skipped)`,
      );
    }
  }

  const markersJson = { map: MAP, markers };
  const sourcesJson = { sources };

  fs.writeFileSync(MARKERS_PATH, JSON.stringify(markersJson, null, 2) + '\n');
  fs.writeFileSync(SOURCES_PATH, JSON.stringify(sourcesJson, null, 2) + '\n');

  const total = markers.length;
  console.log(`Wrote ${total} markers to ${path.relative(ROOT, MARKERS_PATH)}`);
  console.log(`Wrote ${total} sources to ${path.relative(ROOT, SOURCES_PATH)}`);
  console.log('Per-category counts:');
  for (const category of CATEGORY_ORDER) {
    console.log(`  ${category.padEnd(8)} ${counts[category] ?? 0}`);
  }
}

main();
