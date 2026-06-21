const MAP = {
  width: 4498,
  height: 2901,
  src: 'assets/hollownest-basemap/hallownest.jpeg',
};

const CATEGORIES = [
  {
    id: 'bench',
    label: 'Benches',
    icon: 'assets/pins/Map_Pin_Bench_green.webp',
  },
  {
    id: 'stag',
    label: 'Stag Stations',
    icon: 'assets/pins/Map_Pin_Stag.webp',
  },
  {
    id: 'springs',
    label: 'Hot Springs',
    icon: 'assets/pins/Map_Pin_Springs.webp',
  },
  {
    id: 'tram',
    label: 'Trams',
    icon: 'assets/pins/Map_Pin_Tram.webp',
  },
  {
    id: 'grub',
    label: 'Grubs',
    icon: 'assets/pins/Map_Pin_Grub.webp',
  },
  {
    id: 'cocoon',
    label: 'Lifeblood Cocoons',
    icon: 'assets/pins/Map_Pin_Cocoon.webp',
  },
];

const categoryEnabled = Object.fromEntries(
  CATEGORIES.map((cat) => [cat.id, true]),
);

const categoryIconById = Object.fromEntries(
  CATEGORIES.map((cat) => [cat.id, cat.icon]),
);

let MARKERS = [];

let viewportEl;
let transformEl;
let markersLayerEl;
let categoryListEl;
let tooltipEl;
let resetViewBtn;
let appEl;
let sidebarToggleBtn;
let mobileSidebarToggleBtn;

let scale = 1;
let translateX = 0;
let translateY = 0;
let targetScale = 1;
let targetTranslateX = 0;
let targetTranslateY = 0;
let zoomRafId = null;
let lastViewportWidth = 0;
let lastViewportHeight = 0;
let isSidebarAutoHidden = false;
let isMobileSidebarOpen = false;
let desktopSidebarCollapsed = false;
let hasAppliedSidebarVisibility = false;

let searchQuery = '';
let searchInputEl;
let searchClearBtn;

const FOUND_STORAGE_KEY = 'hk-map-found-markers';
let foundMarkers = new Set();
let pinPopupEl = null;
let activePopupMarkerId = null;
let activePopupMarker = null;

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOriginX = 0;
let dragOriginY = 0;
let activePointerId = null;

const pressedKeys = new Set();
let panRafId = null;
let lastPanTimestamp = 0;

const MAX_SCALE = 4;
const MIN_SCALE = 0.2;
const ZOOM_SENSITIVITY = 0.0016;
const ZOOM_EASING = 0.24;
const SIDEBAR_STORAGE_KEY = 'hk-map-sidebar-collapsed';
const SIDEBAR_HIDE_BREAKPOINT = 900;

const PAN_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
const KEYBOARD_PAN_SPEED = 900; // pixels per second
const KEYBOARD_PAN_SPEED_FAST = 2200; // pixels per second when Shift is held

// Pin sizing — pins live inside the zoomed layer so they would shrink/grow
// proportionally with the map. We smoothly interpolate their on-screen size
// between PIN_MAX_VISUAL_PX (fully zoomed out) and PIN_MIN_VISUAL_PX (fully
// zoomed in) using a smoothstep curve, so pins are bounded by fixed limits
// without producing a visible "knee" at the endpoints.
const PIN_BASE_SIZE_PX = 50; // must match .map-pin width/height in CSS
const PIN_MIN_VISUAL_PX = 100; // smallest on-screen pin size (at MAX_SCALE)
const PIN_MAX_VISUAL_PX = 84; // largest on-screen pin size (at MIN_SCALE)

function pixelToPercent(x, y, width = MAP.width, height = MAP.height) {
  return {
    x: (x / width) * 100,
    y: (y / height) * 100,
  };
}

function normalizeMarkers(rawMarkers, mapMeta) {
  const width = mapMeta?.width ?? MAP.width;
  const height = mapMeta?.height ?? MAP.height;

  return rawMarkers.map((marker) => {
    const percent = pixelToPercent(marker.x, marker.y, width, height);
    return {
      id: marker.id,
      category: marker.category,
      name: marker.ref?.title ?? marker.name,
      region: marker.ref?.region ?? null,
      x: percent.x,
      y: percent.y,
    };
  });
}

async function loadMarkerData() {
  const response = await fetch('data/markers.json');
  if (!response.ok) {
    throw new Error(`Failed to load markers.json (${response.status})`);
  }

  const data = await response.json();

  if (data.map) {
    MAP.width = data.map.width ?? MAP.width;
    MAP.height = data.map.height ?? MAP.height;
    MAP.src = data.map.src ?? MAP.src;
  }

  return normalizeMarkers(data.markers ?? [], data.map);
}

function getCategoryCount(categoryId) {
  return MARKERS.filter((m) => m.category === categoryId).length;
}

function smoothstep(t) {
  // Hermite smoothstep: zero slope at both endpoints, smooth S-curve between.
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function computePinScale(currentScale) {
  const safeScale = Math.max(currentScale, 1e-6);
  // Normalize the current zoom to a 0..1 range on a log scale, because zoom
  // is multiplicative (each step doubles/halves), so log space feels even.
  const logMin = Math.log(MIN_SCALE);
  const logMax = Math.log(MAX_SCALE);
  const rawT = (Math.log(safeScale) - logMin) / (logMax - logMin);
  // Smoothstep ensures the curve flattens out exactly at the min/max bounds,
  // so the on-screen pin size approaches PIN_MAX/PIN_MIN gradually without
  // abrupt clamping when reaching MIN_SCALE or MAX_SCALE.
  const eased = smoothstep(rawT);
  const desiredVisualPx =
    PIN_MAX_VISUAL_PX + eased * (PIN_MIN_VISUAL_PX - PIN_MAX_VISUAL_PX);
  // Pins live inside the zoomed layer, so on-screen size equals
  // PIN_BASE_SIZE_PX * mapScale * pinScale. Solve for pinScale.
  return desiredVisualPx / (PIN_BASE_SIZE_PX * safeScale);
}

function updatePinScale() {
  if (!markersLayerEl) return;
  const pinScale = computePinScale(scale);
  markersLayerEl.style.setProperty('--pin-scale', pinScale.toFixed(4));
}

function applyTransform() {
  transformEl.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  updatePinScale();
}

function stopZoomAnimation() {
  if (!zoomRafId) return;
  cancelAnimationFrame(zoomRafId);
  zoomRafId = null;
}

function animateZoomStep() {
  const scaleDelta = targetScale - scale;
  const xDelta = targetTranslateX - translateX;
  const yDelta = targetTranslateY - translateY;

  scale += scaleDelta * ZOOM_EASING;
  translateX += xDelta * ZOOM_EASING;
  translateY += yDelta * ZOOM_EASING;
  applyTransform();

  if (
    Math.abs(scaleDelta) < 0.0005 &&
    Math.abs(xDelta) < 0.2 &&
    Math.abs(yDelta) < 0.2
  ) {
    scale = targetScale;
    translateX = targetTranslateX;
    translateY = targetTranslateY;
    applyTransform();
    zoomRafId = null;
    return;
  }

  zoomRafId = requestAnimationFrame(animateZoomStep);
}

function startZoomAnimation() {
  if (zoomRafId) return;
  zoomRafId = requestAnimationFrame(animateZoomStep);
}

function getFitScale(rect) {
  const scaleX = rect.width / MAP.width;
  const scaleY = rect.height / MAP.height;
  return Math.min(scaleX, scaleY);
}

function fitMapToViewport() {
  stopZoomAnimation();
  const rect = viewportEl.getBoundingClientRect();
  scale = getFitScale(rect) * 0.95;
  translateX = (rect.width - MAP.width * scale) / 2;
  translateY = (rect.height - MAP.height * scale) / 2;
  targetScale = scale;
  targetTranslateX = translateX;
  targetTranslateY = translateY;
  lastViewportWidth = rect.width;
  lastViewportHeight = rect.height;
  applyTransform();
}

function onViewportResize() {
  stopZoomAnimation();
  const rect = viewportEl.getBoundingClientRect();

  if (!lastViewportWidth || !lastViewportHeight) {
    lastViewportWidth = rect.width;
    lastViewportHeight = rect.height;
    return;
  }

  // Keep current zoom level; only shift map so the current view stays centered.
  translateX += (rect.width - lastViewportWidth) / 2;
  translateY += (rect.height - lastViewportHeight) / 2;
  targetScale = scale;
  targetTranslateX = translateX;
  targetTranslateY = translateY;
  lastViewportWidth = rect.width;
  lastViewportHeight = rect.height;
  applyTransform();
}

function syncSidebarToggleUI(isCollapsed) {
  if (!sidebarToggleBtn) return;
  const expanded = String(!isCollapsed);
  sidebarToggleBtn.setAttribute('aria-expanded', expanded);
  sidebarToggleBtn.setAttribute(
    'aria-label',
    isCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
  );
}

function toggleSidebar(forceCollapsed) {
  if (!appEl || isSidebarAutoHidden) return;
  const shouldCollapse =
    typeof forceCollapsed === 'boolean'
      ? forceCollapsed
      : !appEl.classList.contains('sidebar-collapsed');

  appEl.classList.toggle('sidebar-collapsed', shouldCollapse);
  desktopSidebarCollapsed = shouldCollapse;
  syncSidebarToggleUI(shouldCollapse);
  window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(shouldCollapse));

  // Sidebar width changes viewport size; keep scale fixed and only reposition.
  onViewportResize();
}

function syncMobileSidebarToggleUI() {
  if (!mobileSidebarToggleBtn) return;
  mobileSidebarToggleBtn.setAttribute(
    'aria-expanded',
    String(isMobileSidebarOpen),
  );
  mobileSidebarToggleBtn.setAttribute(
    'aria-label',
    isMobileSidebarOpen ? 'Close filters sidebar' : 'Open filters sidebar',
  );
}

function setMobileSidebarOpen(isOpen) {
  if (!appEl) return;
  isMobileSidebarOpen = isOpen && isSidebarAutoHidden;
  appEl.classList.toggle('mobile-sidebar-open', isMobileSidebarOpen);
  syncMobileSidebarToggleUI();
}

function applyResponsiveSidebarVisibility() {
  if (!appEl) return;
  const wasAutoHidden = isSidebarAutoHidden;
  const shouldHide = window.innerWidth <= SIDEBAR_HIDE_BREAKPOINT;
  const isFirstApply = !hasAppliedSidebarVisibility;
  hasAppliedSidebarVisibility = true;
  // True only when an actual resize crosses the breakpoint — not the
  // initial call during page load. Used to (a) carry the open/closed state
  // across the breakpoint so the user's choice survives, and (b) suppress
  // the curtain animation that would otherwise trigger from the rule change.
  const breakpointCrossed = !isFirstApply && shouldHide !== wasAutoHidden;

  isSidebarAutoHidden = shouldHide;

  if (breakpointCrossed) {
    appEl.classList.remove('transitions-ready');
  }

  appEl.classList.toggle('sidebar-hidden', shouldHide);

  if (shouldHide && !wasAutoHidden) {
    desktopSidebarCollapsed = appEl.classList.contains('sidebar-collapsed');
    appEl.classList.remove('sidebar-collapsed');
    syncSidebarToggleUI(false);
    if (breakpointCrossed) {
      // Mirror the desktop open/closed state onto mobile so the sidebar
      // doesn't roll up on every resize down to the mobile breakpoint.
      setMobileSidebarOpen(!desktopSidebarCollapsed);
    }
  } else if (!shouldHide && wasAutoHidden) {
    appEl.classList.toggle('sidebar-collapsed', desktopSidebarCollapsed);
    syncSidebarToggleUI(desktopSidebarCollapsed);
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      String(desktopSidebarCollapsed),
    );
  }

  if (!shouldHide) {
    setMobileSidebarOpen(false);
  } else {
    syncMobileSidebarToggleUI();
  }

  if (sidebarToggleBtn) {
    sidebarToggleBtn.disabled = shouldHide;
    sidebarToggleBtn.setAttribute('aria-hidden', String(shouldHide));
  }

  if (breakpointCrossed) {
    // Force a synchronous style/layout flush so the new state is committed
    // while transitions are still disabled, then re-enable transitions.
    // No property change happens after this read, so no animation fires.
    void appEl.offsetWidth;
    appEl.classList.add('transitions-ready');
  }
}

function onWheel(event) {
  closePopup();
  event.preventDefault();

  const rect = viewportEl.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  const mapX = (mouseX - targetTranslateX) / targetScale;
  const mapY = (mouseY - targetTranslateY) / targetScale;

  const delta = -event.deltaY * ZOOM_SENSITIVITY;
  const newScale = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, targetScale * Math.exp(delta)),
  );

  targetTranslateX = mouseX - mapX * newScale;
  targetTranslateY = mouseY - mapY * newScale;
  targetScale = newScale;

  startZoomAnimation();
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  if (event.target.closest('.map-pin')) return;
  if (event.target.closest('.pin-popup')) return;
  closePopup();

  stopZoomAnimation();
  targetScale = scale;
  targetTranslateX = translateX;
  targetTranslateY = translateY;

  isDragging = true;
  activePointerId = event.pointerId;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  dragOriginX = translateX;
  dragOriginY = translateY;
  viewportEl.classList.add('is-dragging');
  viewportEl.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!isDragging || event.pointerId !== activePointerId) return;

  translateX = dragOriginX + (event.clientX - dragStartX);
  translateY = dragOriginY + (event.clientY - dragStartY);
  targetTranslateX = translateX;
  targetTranslateY = translateY;
  applyTransform();
}

function onPointerUp(event) {
  if (!isDragging || event.pointerId !== activePointerId) return;

  isDragging = false;
  activePointerId = null;
  viewportEl.classList.remove('is-dragging');
  viewportEl.releasePointerCapture(event.pointerId);
}

function isTypingInFormControl(target) {
  if (!target) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

function startKeyboardPan() {
  if (panRafId !== null) return;
  // Cancel any in-flight zoom easing so keyboard pans are immediate and the
  // current rendered position becomes the new target.
  stopZoomAnimation();
  targetScale = scale;
  targetTranslateX = translateX;
  targetTranslateY = translateY;
  lastPanTimestamp = performance.now();
  panRafId = requestAnimationFrame(animatePanStep);
}

function animatePanStep(timestamp) {
  // Cap dt so a long tab-switch pause doesn't produce a huge jump on resume.
  const dt = Math.min(0.05, (timestamp - lastPanTimestamp) / 1000);
  lastPanTimestamp = timestamp;

  let dx = 0;
  let dy = 0;
  if (pressedKeys.has('ArrowLeft')) dx += 1;
  if (pressedKeys.has('ArrowRight')) dx -= 1;
  if (pressedKeys.has('ArrowUp')) dy += 1;
  if (pressedKeys.has('ArrowDown')) dy -= 1;

  if (dx === 0 && dy === 0) {
    panRafId = null;
    return;
  }

  if (dx !== 0 && dy !== 0) {
    const inv = 1 / Math.SQRT2;
    dx *= inv;
    dy *= inv;
  }

  const speed = pressedKeys.has('Shift')
    ? KEYBOARD_PAN_SPEED_FAST
    : KEYBOARD_PAN_SPEED;

  translateX += dx * speed * dt;
  translateY += dy * speed * dt;
  targetTranslateX = translateX;
  targetTranslateY = translateY;
  applyTransform();

  panRafId = requestAnimationFrame(animatePanStep);
}

function onKeyDown(event) {
  if (isTypingInFormControl(event.target)) return;
  if (event.key === 'Escape') {
    closePopup();
    return;
  }
  pressedKeys.add(event.key);
  if (!PAN_KEYS.has(event.key)) return;
  // Prevent default browser scroll/focus-move behavior on arrow keys.
  event.preventDefault();
  startKeyboardPan();
}

function onKeyUp(event) {
  pressedKeys.delete(event.key);
}

function onWindowBlur() {
  // If the window loses focus mid-press, keyup events may never fire — drop
  // tracked keys so movement doesn't get "stuck" when focus returns.
  pressedKeys.clear();
}

function loadFoundMarkers() {
  try {
    const saved = JSON.parse(localStorage.getItem(FOUND_STORAGE_KEY) ?? '[]');
    foundMarkers = new Set(Array.isArray(saved) ? saved : []);
  } catch {
    foundMarkers = new Set();
  }
}

function saveFoundMarkers() {
  localStorage.setItem(FOUND_STORAGE_KEY, JSON.stringify([...foundMarkers]));
}

function openPopup(marker, pinEl) {
  if (activePopupMarkerId === marker.id) {
    closePopup();
    return;
  }
  closePopup();
  hideTooltip();

  activePopupMarkerId = marker.id;
  activePopupMarker = marker;

  pinPopupEl.querySelector('.pin-popup-icon').src = categoryIconById[marker.category];
  pinPopupEl.querySelector('.pin-popup-name').textContent = marker.name;
  const regionEl = pinPopupEl.querySelector('.pin-popup-region');
  if (marker.region) {
    regionEl.textContent = marker.region;
    regionEl.hidden = false;
  } else {
    regionEl.hidden = true;
  }
  refreshPopupFoundState();

  pinPopupEl.removeAttribute('aria-hidden');
  pinPopupEl.classList.add('is-visible');
  positionPopupAt(pinEl);
}

function positionPopupAt(pinEl) {
  const rect = pinEl.getBoundingClientRect();
  pinPopupEl.style.left = `${rect.left + rect.width / 2}px`;
  pinPopupEl.style.top = `${rect.top}px`;
}

function closePopup() {
  if (!activePopupMarkerId) return;
  pinPopupEl.classList.remove('is-visible');
  pinPopupEl.setAttribute('aria-hidden', 'true');
  activePopupMarkerId = null;
  activePopupMarker = null;
}

function refreshPopupFoundState() {
  if (!activePopupMarkerId) return;
  const isFnd = foundMarkers.has(activePopupMarkerId);
  const btn = pinPopupEl.querySelector('.pin-popup-found-btn');
  const label = pinPopupEl.querySelector('.pin-popup-found-label');
  btn.classList.toggle('is-found', isFnd);
  btn.setAttribute('aria-pressed', String(isFnd));
  label.textContent = isFnd ? 'Found' : 'Mark as found';
}

function toggleFound(markerId) {
  if (foundMarkers.has(markerId)) {
    foundMarkers.delete(markerId);
  } else {
    foundMarkers.add(markerId);
  }
  saveFoundMarkers();

  const isFnd = foundMarkers.has(markerId);
  const pin = markersLayerEl.querySelector(`.map-pin[data-id="${markerId}"]`);
  if (pin) {
    pin.classList.toggle('is-found', isFnd);
  }

  refreshPopupFoundState();
}


function showTooltip(name, clientX, clientY) {
  tooltipEl.textContent = name;
  tooltipEl.classList.add('is-visible');
  tooltipEl.setAttribute('aria-hidden', 'false');

  const offset = 14;
  let left = clientX + offset;
  let top = clientY + offset;

  const rect = tooltipEl.getBoundingClientRect();
  if (left + rect.width > window.innerWidth - 8) {
    left = clientX - rect.width - offset;
  }
  if (top + rect.height > window.innerHeight - 8) {
    top = clientY - rect.height - offset;
  }

  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

function hideTooltip() {
  tooltipEl.classList.remove('is-visible');
  tooltipEl.setAttribute('aria-hidden', 'true');
}

function updateCategoryRowUI(categoryId) {
  const row = categoryListEl.querySelector(`[data-category="${categoryId}"]`);
  if (!row) return;

  const enabled = categoryEnabled[categoryId];
  row.classList.toggle('is-enabled', enabled);
  row.classList.toggle('is-disabled', !enabled);
  row.setAttribute('aria-pressed', String(enabled));
}

function toggleCategory(categoryId) {
  categoryEnabled[categoryId] = !categoryEnabled[categoryId];
  updateCategoryRowUI(categoryId);
  updateMarkerVisibility(categoryId);
}

function updateMarkerVisibility(categoryId) {
  const pins = markersLayerEl.querySelectorAll(
    `.map-pin[data-category="${categoryId}"]`,
  );
  const visible = categoryEnabled[categoryId];
  pins.forEach((pin) => {
    pin.classList.toggle('is-hidden', !visible);
  });
}

function showAllCategories() {
  CATEGORIES.forEach((cat) => {
    if (!categoryEnabled[cat.id]) {
      categoryEnabled[cat.id] = true;
      updateCategoryRowUI(cat.id);
      updateMarkerVisibility(cat.id);
    }
  });
}

function hideAllCategories() {
  CATEGORIES.forEach((cat) => {
    if (categoryEnabled[cat.id]) {
      categoryEnabled[cat.id] = false;
      updateCategoryRowUI(cat.id);
      updateMarkerVisibility(cat.id);
    }
  });
}

function renderSidebar() {
  categoryListEl.innerHTML = '';

  CATEGORIES.forEach((cat) => {
    const count = getCategoryCount(cat.id);
    const enabled = categoryEnabled[cat.id];

    const row = document.createElement('button');
    row.type = 'button';
    row.className = `category-row ${enabled ? 'is-enabled' : 'is-disabled'}`;
    row.dataset.category = cat.id;
    row.setAttribute('aria-pressed', String(enabled));

    row.innerHTML = `
      <img class="category-icon" src="${cat.icon}" alt="" width="22" height="22">
      <span class="category-label">${cat.label}</span>
      <span class="category-count">${count}</span>
    `;

    row.addEventListener('click', () => toggleCategory(cat.id));
    categoryListEl.appendChild(row);
  });
}

function onSearchInput() {
  const q = searchInputEl.value.trim();
  searchQuery = q;
  searchClearBtn.hidden = q === '';
  applySearch(q);
}

function clearSearch() {
  searchInputEl.value = '';
  searchQuery = '';
  searchClearBtn.hidden = true;
  applySearch('');
  searchInputEl.focus();
}

function applySearch(query) {
  const showHideRow = document.querySelector('.show-hide-row');
  const resultCount = document.getElementById('search-result-count');
  if (!query) {
    showHideRow.hidden = false;
    resultCount.hidden = true;
    renderSidebar();
    CATEGORIES.forEach((cat) => updateMarkerVisibility(cat.id));
    return;
  }
  showHideRow.hidden = true;
  const lower = query.toLowerCase();
  const matches = MARKERS.filter(
    (m) =>
      m.name.toLowerCase().includes(lower) ||
      (m.region && m.region.toLowerCase().includes(lower)),
  );
  const n = matches.length;
  resultCount.textContent = `${n} ${n === 1 ? 'result' : 'results'}`;
  resultCount.hidden = false;
  renderSearchResults(matches);
  updateMapForSearch(matches);
}

function renderSearchResults(matches) {
  categoryListEl.innerHTML = '';
  if (matches.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'search-empty';
    empty.textContent = 'No results found';
    categoryListEl.appendChild(empty);
    return;
  }
  const groups = new Map();
  matches.forEach((marker) => {
    const key = marker.region ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(marker);
  });

  const items = [];
  groups.forEach((groupMarkers, region) => {
    groupMarkers.forEach((marker, idx) => {
      items.push({ marker, region, isLastInGroup: idx === groupMarkers.length - 1 });
    });
  });

  items.forEach(({ marker, region, isLastInGroup }, idx) => {
    if (idx > 0) {
      const hr = document.createElement('hr');
      hr.className = 'result-separator';
      categoryListEl.appendChild(hr);
    }

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'category-row';
    row.dataset.markerId = marker.id;
    row.innerHTML = `
        <img class="category-icon" src="${categoryIconById[marker.category]}" alt="" width="22" height="22">
        <span class="category-label">${marker.name}</span>
      `;
    row.addEventListener('click', () => panToMarker(marker));
    row.addEventListener('mouseenter', () => {
      const pin = markersLayerEl.querySelector(`.map-pin[data-id="${marker.id}"]`);
      if (pin) pin.classList.add('is-hovered');
    });
    row.addEventListener('mouseleave', () => {
      const pin = markersLayerEl.querySelector(`.map-pin[data-id="${marker.id}"]`);
      if (pin) pin.classList.remove('is-hovered');
    });
    categoryListEl.appendChild(row);

    if (isLastInGroup && region) {
      const label = document.createElement('p');
      label.className = 'result-region-label';
      label.textContent = `Location: ${region}`;
      categoryListEl.appendChild(label);
    }
  });
}

function panToMarker(marker) {
  const rect = viewportEl.getBoundingClientRect();
  const mapX = (marker.x / 100) * MAP.width;
  const mapY = (marker.y / 100) * MAP.height;

  targetTranslateX = rect.width / 2 - mapX * targetScale;
  targetTranslateY = rect.height / 2 - mapY * targetScale;

  startZoomAnimation();
}

function updateMapForSearch(matches) {
  const matchIds = new Set(matches.map((m) => m.id));
  markersLayerEl.querySelectorAll('.map-pin').forEach((pin) => {
    pin.classList.toggle('is-hidden', !matchIds.has(pin.dataset.id));
  });
}


function createPinElement(marker) {
  const pin = document.createElement('button');
  pin.type = 'button';
  pin.className = 'map-pin';
  pin.dataset.category = marker.category;
  pin.dataset.id = marker.id;
  pin.style.left = `${marker.x}%`;
  pin.style.top = `${marker.y}%`;
  pin.setAttribute('aria-label', marker.name);

  const icon = document.createElement('img');
  icon.src = categoryIconById[marker.category];
  icon.alt = '';
  pin.appendChild(icon);

  if (!categoryEnabled[marker.category]) {
    pin.classList.add('is-hidden');
  }

  if (foundMarkers.has(marker.id)) {
    pin.classList.add('is-found');
  }

  pin.addEventListener('mouseenter', (e) => {
    if (!activePopupMarkerId) showTooltip(marker.name, e.clientX, e.clientY);
  });
  pin.addEventListener('mousemove', (e) => {
    if (!activePopupMarkerId) showTooltip(marker.name, e.clientX, e.clientY);
  });
  pin.addEventListener('mouseleave', hideTooltip);
  pin.addEventListener('focus', () => {
    if (!activePopupMarkerId) {
      const rect = pin.getBoundingClientRect();
      showTooltip(marker.name, rect.left + rect.width / 2, rect.top);
    }
  });
  pin.addEventListener('blur', hideTooltip);
  pin.addEventListener('click', (e) => {
    e.stopPropagation();
    openPopup(marker, pin);
  });

  return pin;
}

function renderMarkers() {
  markersLayerEl.innerHTML = '';
  const fragment = document.createDocumentFragment();

  MARKERS.forEach((marker) => {
    fragment.appendChild(createPinElement(marker));
  });

  markersLayerEl.appendChild(fragment);
}

function initPanZoom() {
  viewportEl.addEventListener('wheel', onWheel, { passive: false });
  viewportEl.addEventListener('pointerdown', onPointerDown);
  viewportEl.addEventListener('pointermove', onPointerMove);
  viewportEl.addEventListener('pointerup', onPointerUp);
  viewportEl.addEventListener('pointercancel', onPointerUp);
  viewportEl.addEventListener('lostpointercapture', onPointerUp);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onWindowBlur);

  resetViewBtn.addEventListener('click', fitMapToViewport);
  window.addEventListener('resize', () => {
    applyResponsiveSidebarVisibility();
    onViewportResize();
  });
}

function initSidebarToggle() {
  if (!sidebarToggleBtn) return;
  const isCollapsed =
    window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  desktopSidebarCollapsed = isCollapsed;
  toggleSidebar(isCollapsed);
  sidebarToggleBtn.addEventListener('click', () => toggleSidebar());
}

function initMobileSidebarToggle() {
  if (!mobileSidebarToggleBtn) return;
  syncMobileSidebarToggleUI();
  mobileSidebarToggleBtn.addEventListener('click', () =>
    setMobileSidebarOpen(!isMobileSidebarOpen),
  );
}

function showLoadError(message) {
  const stage = document.querySelector('.map-stage');
  if (!stage) return;
  const banner = document.createElement('p');
  banner.className = 'map-error';
  banner.textContent = message;
  stage.prepend(banner);
}

async function init() {
  appEl = document.querySelector('.app');
  viewportEl = document.getElementById('map-viewport');
  transformEl = document.getElementById('map-transform');
  markersLayerEl = document.getElementById('markers-layer');
  categoryListEl = document.getElementById('category-list');
  tooltipEl = document.getElementById('tooltip');
  resetViewBtn = document.getElementById('reset-view');
  sidebarToggleBtn = document.getElementById('sidebar-toggle');
  mobileSidebarToggleBtn = document.getElementById('mobile-sidebar-toggle');
  pinPopupEl = document.getElementById('pin-popup');

  loadFoundMarkers();

  pinPopupEl.querySelector('.pin-popup-found-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (activePopupMarkerId) toggleFound(activePopupMarkerId);
  });

  document.addEventListener('click', (e) => {
    if (!activePopupMarkerId) return;
    if (pinPopupEl.contains(e.target)) return;
    closePopup();
  });

  try {
    MARKERS = await loadMarkerData();
  } catch (error) {
    console.error(error);
    showLoadError(
      'Could not load marker data. Serve this project over HTTP (e.g. npx serve) so data/markers.json can be fetched.',
    );
    return;
  }

  renderSidebar();
  renderMarkers();
  checkAdminAuth();

  const showAllBtn = document.getElementById('show-all');
  const hideAllBtn = document.getElementById('hide-all');
  if (showAllBtn) showAllBtn.addEventListener('click', showAllCategories);
  if (hideAllBtn) hideAllBtn.addEventListener('click', hideAllCategories);

  searchInputEl = document.getElementById('sidebar-search');
  searchClearBtn = document.getElementById('sidebar-search-clear');
  if (searchInputEl) searchInputEl.addEventListener('input', onSearchInput);
  if (searchClearBtn) searchClearBtn.addEventListener('click', clearSearch);

  initPanZoom();
  initSidebarToggle();
  initMobileSidebarToggle();
  applyResponsiveSidebarVisibility();

  // Enable sidebar slide transitions only after the restored open/collapsed
  // state has been painted, so reloading with a collapsed sidebar doesn't
  // animate from the default-open position.
  requestAnimationFrame(() => {
    appEl.classList.add('transitions-ready');
  });

  const basemap = document.getElementById('basemap');
  if (basemap.complete) {
    fitMapToViewport();
  } else {
    basemap.addEventListener('load', fitMapToViewport);
  }
}

document.addEventListener('DOMContentLoaded', init);

// =============================================================================
// Admin CMS — Cloudflare Access + drag-and-drop pin repositioning
// =============================================================================

let isAdminMode = false;
const pendingChanges = new Map(); // markerId → { x: pixelX, y: pixelY }

let adminToolbarEl = null;
let adminUnsavedCountEl = null;
let adminSaveBtnEl = null;
let adminSaveFeedbackEl = null;

// ---------------------------------------------------------------------------
// Auth check — runs after markers are rendered
// ---------------------------------------------------------------------------

async function checkAdminAuth() {
  if (!window.location.pathname.startsWith('/admin-login')) return;
  try {
    const res = await fetch('/api/auth/status');
    if (!res.ok) return;
    const data = await res.json();
    if (data.isAdmin) enterAdminMode();
  } catch {
    // Non-critical: silently fail if server isn't running or endpoint not found
  }
}

// ---------------------------------------------------------------------------
// Enter admin mode
// ---------------------------------------------------------------------------

function enterAdminMode() {
  isAdminMode = true;

  adminToolbarEl = document.getElementById('admin-toolbar');
  adminUnsavedCountEl = document.getElementById('admin-unsaved-count');
  adminSaveBtnEl = document.getElementById('admin-save');
  adminSaveFeedbackEl = document.getElementById('admin-save-feedback');

  adminToolbarEl.hidden = false;
  document.body.classList.add('is-admin');

  // Attach drag listeners to all already-rendered pins
  MARKERS.forEach((marker) => {
    const pin = markersLayerEl.querySelector(`.map-pin[data-id="${marker.id}"]`);
    if (pin) initAdminDrag(pin, marker);
  });

  adminSaveBtnEl.addEventListener('click', saveAdminChanges);

  document.getElementById('admin-logout').addEventListener('click', (e) => {
    e.preventDefault();
    logoutAdmin();
  });
}

// ---------------------------------------------------------------------------
// Drag-and-drop
// ---------------------------------------------------------------------------

function initAdminDrag(pinEl, marker) {
  let dragPointerId = null;
  let startClientX = 0;
  let startClientY = 0;
  let startPctX = 0;
  let startPctY = 0;

  pinEl.addEventListener('pointerdown', (e) => {
    if (!isAdminMode) return;
    if (e.button !== 0) return;

    // Prevent map pan from starting
    e.stopPropagation();
    e.preventDefault();

    dragPointerId = e.pointerId;
    startClientX = e.clientX;
    startClientY = e.clientY;
    startPctX = parseFloat(pinEl.style.left);
    startPctY = parseFloat(pinEl.style.top);

    pinEl.setPointerCapture(e.pointerId);
    pinEl.classList.add('is-admin-dragging');

    // Close any open popup/tooltip so it doesn't follow the pin
    closePopup();
    hideTooltip();
  });

  pinEl.addEventListener('pointermove', (e) => {
    if (dragPointerId === null || e.pointerId !== dragPointerId) return;

    const rect = transformEl.getBoundingClientRect();
    const dxPct = ((e.clientX - startClientX) / rect.width) * 100;
    const dyPct = ((e.clientY - startClientY) / rect.height) * 100;

    pinEl.style.left = `${startPctX + dxPct}%`;
    pinEl.style.top = `${startPctY + dyPct}%`;
  });

  pinEl.addEventListener('pointerup', (e) => {
    if (dragPointerId === null || e.pointerId !== dragPointerId) return;
    dragPointerId = null;

    pinEl.classList.remove('is-admin-dragging');
    pinEl.classList.add('is-dirty');

    const finalPctX = parseFloat(pinEl.style.left);
    const finalPctY = parseFloat(pinEl.style.top);
    const pixelX = Math.round((finalPctX / 100) * MAP.width);
    const pixelY = Math.round((finalPctY / 100) * MAP.height);

    // Update the in-memory MARKERS array so the popup reads the new position
    const m = MARKERS.find((mk) => mk.id === marker.id);
    if (m) {
      m.x = finalPctX;
      m.y = finalPctY;
    }

    pendingChanges.set(marker.id, { x: pixelX, y: pixelY });
    updateAdminToolbar();
  });

  pinEl.addEventListener('pointercancel', (e) => {
    if (dragPointerId === null || e.pointerId !== dragPointerId) return;
    dragPointerId = null;

    pinEl.classList.remove('is-admin-dragging');

    // Revert visual position to last saved value (or original if not yet saved)
    const saved = pendingChanges.get(marker.id);
    if (saved) {
      pinEl.style.left = `${(saved.x / MAP.width) * 100}%`;
      pinEl.style.top = `${(saved.y / MAP.height) * 100}%`;
    } else {
      pinEl.style.left = `${startPctX}%`;
      pinEl.style.top = `${startPctY}%`;
    }
  });
}

// ---------------------------------------------------------------------------
// Toolbar state
// ---------------------------------------------------------------------------

function updateAdminToolbar() {
  const count = pendingChanges.size;
  adminUnsavedCountEl.textContent =
    count > 0 ? `${count} unsaved ${count === 1 ? 'change' : 'changes'}` : '';
  adminSaveBtnEl.classList.toggle('has-changes', count > 0);
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

async function saveAdminChanges() {
  if (pendingChanges.size === 0) return;

  adminSaveBtnEl.disabled = true;
  adminSaveBtnEl.textContent = 'Saving…';

  const payload = {
    markers: [...pendingChanges.entries()].map(([id, pos]) => ({
      id,
      x: pos.x,
      y: pos.y,
    })),
  };

  try {
    const res = await fetch('/api/admin/markers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok) {
      pendingChanges.clear();
      markersLayerEl
        .querySelectorAll('.map-pin.is-dirty')
        .forEach((p) => p.classList.remove('is-dirty'));
      updateAdminToolbar();
      showAdminFeedback('Saved successfully', 'success');
    } else {
      showAdminFeedback(data.error ?? 'Save failed', 'error');
    }
  } catch {
    showAdminFeedback('Network error — could not reach server', 'error');
  } finally {
    adminSaveBtnEl.disabled = false;
    adminSaveBtnEl.textContent = 'Save Changes';
  }
}

function showAdminFeedback(message, type) {
  adminSaveFeedbackEl.textContent = message;
  adminSaveFeedbackEl.className = `admin-save-feedback ${type}`;
  adminSaveFeedbackEl.hidden = false;
  clearTimeout(adminSaveFeedbackEl._timer);
  adminSaveFeedbackEl._timer = setTimeout(() => {
    adminSaveFeedbackEl.hidden = true;
  }, 3000);
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

async function logoutAdmin() {
  try {
    // Cloudflare Access logout — redirect to CF's logout URL.
    // The CF_TEAM_NAME is not available in the browser, so we derive the
    // logout URL from the CF-Access-Jwt-Assertion cookie domain if present,
    // or fall back to a server-side redirect endpoint.
    const res = await fetch('/api/auth/logout', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (data.logoutUrl) {
      window.location.href = data.logoutUrl;
    } else {
      // Reload — if the CF JWT has expired/been cleared the toolbar won't reappear
      window.location.reload();
    }
  } catch {
    window.location.reload();
  }
}
