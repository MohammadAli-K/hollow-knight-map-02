const MAP = {
  width: 4498,
  height: 2901,
  src: "assets/hollownest-basemap/hallownest.jpeg",
};

const CATEGORIES = [
  {
    id: "bench",
    label: "Benches",
    icon: "assets/pins/Map_Pin_Bench_green.webp",
  },
  {
    id: "stag",
    label: "Stag Stations",
    icon: "assets/pins/Map_Pin_Stag.webp",
  },
  {
    id: "springs",
    label: "Hot Springs",
    icon: "assets/pins/Map_Pin_Springs.webp",
  },
  {
    id: "tram",
    label: "Trams",
    icon: "assets/pins/Map_Pin_Tram.webp",
  },
  {
    id: "grub",
    label: "Grubs",
    icon: "assets/pins/Map_Pin_Grub.webp",
  },
  {
    id: "cocoon",
    label: "Lifeblood Cocoons",
    icon: "assets/pins/Map_Pin_Cocoon.webp",
  },
];

const categoryEnabled = Object.fromEntries(
  CATEGORIES.map((cat) => [cat.id, true])
);

const categoryIconById = Object.fromEntries(
  CATEGORIES.map((cat) => [cat.id, cat.icon])
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

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOriginX = 0;
let dragOriginY = 0;
let activePointerId = null;

const MAX_SCALE = 4;
const MIN_SCALE = 0.2;
const ZOOM_SENSITIVITY = 0.0016;
const ZOOM_EASING = 0.24;
const SIDEBAR_STORAGE_KEY = "hk-map-sidebar-collapsed";
const SIDEBAR_HIDE_BREAKPOINT = 900;

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
      x: percent.x,
      y: percent.y,
    };
  });
}

async function loadMarkerData() {
  const response = await fetch("data/markers.json");
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

function applyTransform() {
  transformEl.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
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
  sidebarToggleBtn.setAttribute("aria-expanded", expanded);
  sidebarToggleBtn.setAttribute(
    "aria-label",
    isCollapsed ? "Expand sidebar" : "Collapse sidebar"
  );
}

function toggleSidebar(forceCollapsed) {
  if (!appEl || isSidebarAutoHidden) return;
  const shouldCollapse =
    typeof forceCollapsed === "boolean"
      ? forceCollapsed
      : !appEl.classList.contains("sidebar-collapsed");

  appEl.classList.toggle("sidebar-collapsed", shouldCollapse);
  desktopSidebarCollapsed = shouldCollapse;
  syncSidebarToggleUI(shouldCollapse);
  window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(shouldCollapse));

  // Sidebar width changes viewport size; keep scale fixed and only reposition.
  onViewportResize();
}

function syncMobileSidebarToggleUI() {
  if (!mobileSidebarToggleBtn) return;
  mobileSidebarToggleBtn.setAttribute("aria-expanded", String(isMobileSidebarOpen));
  mobileSidebarToggleBtn.setAttribute(
    "aria-label",
    isMobileSidebarOpen ? "Close filters sidebar" : "Open filters sidebar"
  );
}

function setMobileSidebarOpen(isOpen) {
  if (!appEl) return;
  isMobileSidebarOpen = isOpen && isSidebarAutoHidden;
  appEl.classList.toggle("mobile-sidebar-open", isMobileSidebarOpen);
  syncMobileSidebarToggleUI();
}

function applyResponsiveSidebarVisibility() {
  if (!appEl) return;
  const wasAutoHidden = isSidebarAutoHidden;
  const shouldHide = window.innerWidth <= SIDEBAR_HIDE_BREAKPOINT;
  isSidebarAutoHidden = shouldHide;
  appEl.classList.toggle("sidebar-hidden", shouldHide);

  if (shouldHide && !wasAutoHidden) {
    desktopSidebarCollapsed = appEl.classList.contains("sidebar-collapsed");
    appEl.classList.remove("sidebar-collapsed");
    syncSidebarToggleUI(false);
  } else if (!shouldHide && wasAutoHidden) {
    appEl.classList.toggle("sidebar-collapsed", desktopSidebarCollapsed);
    syncSidebarToggleUI(desktopSidebarCollapsed);
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      String(desktopSidebarCollapsed)
    );
  }

  if (!shouldHide) {
    setMobileSidebarOpen(false);
  } else {
    syncMobileSidebarToggleUI();
  }

  if (!sidebarToggleBtn) return;
  sidebarToggleBtn.disabled = shouldHide;
  sidebarToggleBtn.setAttribute("aria-hidden", String(shouldHide));
}

function onWheel(event) {
  event.preventDefault();

  const rect = viewportEl.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  const mapX = (mouseX - targetTranslateX) / targetScale;
  const mapY = (mouseY - targetTranslateY) / targetScale;

  const delta = -event.deltaY * ZOOM_SENSITIVITY;
  const newScale = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, targetScale * Math.exp(delta))
  );

  targetTranslateX = mouseX - mapX * newScale;
  targetTranslateY = mouseY - mapY * newScale;
  targetScale = newScale;

  startZoomAnimation();
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  if (event.target.closest(".map-pin")) return;

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
  viewportEl.classList.add("is-dragging");
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
  viewportEl.classList.remove("is-dragging");
  viewportEl.releasePointerCapture(event.pointerId);
}

function showTooltip(name, clientX, clientY) {
  tooltipEl.textContent = name;
  tooltipEl.classList.add("is-visible");
  tooltipEl.setAttribute("aria-hidden", "false");

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
  tooltipEl.classList.remove("is-visible");
  tooltipEl.setAttribute("aria-hidden", "true");
}

function updateCategoryRowUI(categoryId) {
  const row = categoryListEl.querySelector(`[data-category="${categoryId}"]`);
  if (!row) return;

  const enabled = categoryEnabled[categoryId];
  row.classList.toggle("is-enabled", enabled);
  row.classList.toggle("is-disabled", !enabled);
  row.setAttribute("aria-pressed", String(enabled));
}

function toggleCategory(categoryId) {
  categoryEnabled[categoryId] = !categoryEnabled[categoryId];
  updateCategoryRowUI(categoryId);
  updateMarkerVisibility(categoryId);
}

function updateMarkerVisibility(categoryId) {
  const pins = markersLayerEl.querySelectorAll(
    `.map-pin[data-category="${categoryId}"]`
  );
  const visible = categoryEnabled[categoryId];
  pins.forEach((pin) => {
    pin.classList.toggle("is-hidden", !visible);
  });
}

function renderSidebar() {
  categoryListEl.innerHTML = "";

  CATEGORIES.forEach((cat) => {
    const count = getCategoryCount(cat.id);
    const enabled = categoryEnabled[cat.id];

    const row = document.createElement("button");
    row.type = "button";
    row.className = `category-row ${enabled ? "is-enabled" : "is-disabled"}`;
    row.dataset.category = cat.id;
    row.setAttribute("aria-pressed", String(enabled));

    row.innerHTML = `
      <span class="category-checkbox" aria-hidden="true"></span>
      <img class="category-icon" src="${cat.icon}" alt="" width="22" height="22">
      <span class="category-label">${cat.label}</span>
      <span class="category-count">${count}</span>
    `;

    row.addEventListener("click", () => toggleCategory(cat.id));
    categoryListEl.appendChild(row);
  });
}

function createPinElement(marker) {
  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = "map-pin";
  pin.dataset.category = marker.category;
  pin.dataset.id = marker.id;
  pin.style.left = `${marker.x}%`;
  pin.style.top = `${marker.y}%`;
  pin.setAttribute("aria-label", marker.name);

  const icon = document.createElement("img");
  icon.src = categoryIconById[marker.category];
  icon.alt = "";
  pin.appendChild(icon);

  if (!categoryEnabled[marker.category]) {
    pin.classList.add("is-hidden");
  }

  pin.addEventListener("mouseenter", (e) => showTooltip(marker.name, e.clientX, e.clientY));
  pin.addEventListener("mousemove", (e) => showTooltip(marker.name, e.clientX, e.clientY));
  pin.addEventListener("mouseleave", hideTooltip);
  pin.addEventListener("focus", () => {
    const rect = pin.getBoundingClientRect();
    showTooltip(marker.name, rect.left + rect.width / 2, rect.top);
  });
  pin.addEventListener("blur", hideTooltip);

  return pin;
}

function renderMarkers() {
  markersLayerEl.innerHTML = "";
  const fragment = document.createDocumentFragment();

  MARKERS.forEach((marker) => {
    fragment.appendChild(createPinElement(marker));
  });

  markersLayerEl.appendChild(fragment);
}

function initPanZoom() {
  viewportEl.addEventListener("wheel", onWheel, { passive: false });
  viewportEl.addEventListener("pointerdown", onPointerDown);
  viewportEl.addEventListener("pointermove", onPointerMove);
  viewportEl.addEventListener("pointerup", onPointerUp);
  viewportEl.addEventListener("pointercancel", onPointerUp);
  viewportEl.addEventListener("lostpointercapture", onPointerUp);

  resetViewBtn.addEventListener("click", fitMapToViewport);
  window.addEventListener("resize", () => {
    applyResponsiveSidebarVisibility();
    onViewportResize();
  });
}

function initSidebarToggle() {
  if (!sidebarToggleBtn) return;
  const isCollapsed = window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  desktopSidebarCollapsed = isCollapsed;
  toggleSidebar(isCollapsed);
  sidebarToggleBtn.addEventListener("click", () => toggleSidebar());
}

function initMobileSidebarToggle() {
  if (!mobileSidebarToggleBtn) return;
  syncMobileSidebarToggleUI();
  mobileSidebarToggleBtn.addEventListener("click", () =>
    setMobileSidebarOpen(!isMobileSidebarOpen)
  );
}

function showLoadError(message) {
  const stage = document.querySelector(".map-stage");
  if (!stage) return;
  const banner = document.createElement("p");
  banner.className = "map-error";
  banner.textContent = message;
  stage.prepend(banner);
}

async function init() {
  appEl = document.querySelector(".app");
  viewportEl = document.getElementById("map-viewport");
  transformEl = document.getElementById("map-transform");
  markersLayerEl = document.getElementById("markers-layer");
  categoryListEl = document.getElementById("category-list");
  tooltipEl = document.getElementById("tooltip");
  resetViewBtn = document.getElementById("reset-view");
  sidebarToggleBtn = document.getElementById("sidebar-toggle");
  mobileSidebarToggleBtn = document.getElementById("mobile-sidebar-toggle");

  try {
    MARKERS = await loadMarkerData();
  } catch (error) {
    console.error(error);
    showLoadError(
      "Could not load marker data. Serve this project over HTTP (e.g. npx serve) so data/markers.json can be fetched."
    );
    return;
  }

  renderSidebar();
  renderMarkers();
  initPanZoom();
  initSidebarToggle();
  initMobileSidebarToggle();
  applyResponsiveSidebarVisibility();

  const basemap = document.getElementById("basemap");
  if (basemap.complete) {
    fitMapToViewport();
  } else {
    basemap.addEventListener("load", fitMapToViewport);
  }
}

document.addEventListener("DOMContentLoaded", init);
