(() => {
  const {
    Simulator,
    Node,
    Vec2,
    buildPathIndex,
    nearestPathPoint,
    detectGridShapes,
    sampleCirclePerimeter,
    sampleRectPerimeter,
    parseSvgGridShapes,
  } = window.SpaceColonization;

  const canvas = document.getElementById("stage");
  const viewport = canvas.parentElement;
  const ctx = canvas.getContext("2d");
  const sim = new Simulator();
  sim.jitter = 0;
  sim.bias.x = 0;
  sim.bias.y = -0.18;
  let debugDrawLogs = 0;

  // #region agent log
  function dbg(hypothesisId, location, message, data) {
    fetch("http://127.0.0.1:7886/ingest/4186916a-28f7-429a-ba45-0f68eddb858a", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "443dc5" },
      body: JSON.stringify({
        sessionId: "443dc5",
        runId: "import-vis",
        hypothesisId,
        location,
        message,
        data,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion

  const ui = {
    play: document.getElementById("play"),
    reset: document.getElementById("reset"),
    count: document.getElementById("count"),
    influence: document.getElementById("influence"),
    kill: document.getElementById("kill"),
    stepSize: document.getElementById("stepSize"),
    iterations: document.getElementById("iterations"),
    importGrid: document.getElementById("importGrid"),
    clearGrid: document.getElementById("clearGrid"),
    prevGrid: document.getElementById("prevGrid"),
    nextGrid: document.getElementById("nextGrid"),
    gridCycleStatus: document.getElementById("gridCycleStatus"),
    gridFile: document.getElementById("gridFile"),
    gridStatus: document.getElementById("gridStatus"),
    seedMode: document.getElementById("seedMode"),
    clearSeeds: document.getElementById("clearSeeds"),
    seedStatus: document.getElementById("seedStatus"),
    seedList: document.getElementById("seedList"),
    seedCount: document.getElementById("seedCount"),
    countVal: document.getElementById("countVal"),
    influenceVal: document.getElementById("influenceVal"),
    killVal: document.getElementById("killVal"),
    stepVal: document.getElementById("stepVal"),
    iterVal: document.getElementById("iterVal"),
    gridOpacity: document.getElementById("gridOpacity"),
    gridOpacityVal: document.getElementById("gridOpacityVal"),
    attractorSize: document.getElementById("attractorSize"),
    attractorSizeVal: document.getElementById("attractorSizeVal"),
    attractorColor: document.getElementById("attractorColor"),
    branchColor: document.getElementById("branchColor"),
    primaryColor: document.getElementById("primaryColor"),
    secondaryColor: document.getElementById("secondaryColor"),
    tertiaryColor: document.getElementById("tertiaryColor"),
    genCount: document.getElementById("genCount"),
    attrCount: document.getElementById("attrCount"),
    identifyBranches: document.getElementById("identifyBranches"),
    branchLegend: document.getElementById("branchLegend"),
    showPrimary: document.getElementById("showPrimary"),
    showSecondary: document.getElementById("showSecondary"),
    showTertiary: document.getElementById("showTertiary"),
    showVoidMask: document.getElementById("showVoidMask"),
    captureVariant: document.getElementById("captureVariant"),
    newAttempt: document.getElementById("newAttempt"),
    generateVariants: document.getElementById("generateVariants"),
    clearVariants: document.getElementById("clearVariants"),
    batchCount: document.getElementById("batchCount"),
    batchCountVal: document.getElementById("batchCountVal"),
    variantStatus: document.getElementById("variantStatus"),
    variantList: document.getElementById("variantList"),
    openAnalyze: document.getElementById("openAnalyze"),
    tabStudio: document.getElementById("tabStudio"),
    tabAnalyze: document.getElementById("tabAnalyze"),
    studioView: document.getElementById("studioView"),
    analyzeView: document.getElementById("analyzeView"),
    studioHud: document.getElementById("studioHud"),
    analyzeScope: document.getElementById("analyzeScope"),
    analyzeOverlay: document.getElementById("analyzeOverlay"),
    analyzeSelectAll: document.getElementById("analyzeSelectAll"),
    analyzeClearSel: document.getElementById("analyzeClearSel"),
    analyzeSummary: document.getElementById("analyzeSummary"),
    analyzeComposite: document.getElementById("analyzeComposite"),
    analyzeMatrix: document.getElementById("analyzeMatrix"),
    analyzeTableBody: document.getElementById("analyzeTableBody"),
  };

  const analyzeCompositeCtx = ui.analyzeComposite.getContext("2d");
  const analyzeSelected = new Set();
  let appPage = "studio";

  const MAX_VARIANTS = 24;
  const variants = [];
  let nextVariantId = 1;
  let activeVariantId = null;
  let batchRunning = false;

  const stars = [];
  const flashes = [];
  let playing = false;
  let dpr = 1;
  let width = 0;
  let height = 0;
  let ready = false;
  let gridSource = null;
  let gridName = "";
  let gridOverlay = null;
  let gridLayout = null;
  let siteLayout = null;
  let imageLayout = null;
  let pixelsPerFoot = 0;
  const SITE_FEET = 20;
  let gridPoints = null;
  let gridPathPoints = null;
  let tracedGridPoints = null;
  let tracedGridPathPoints = null;
  let growthPathPoints = null;
  let growthAttractors = null;
  let gridShapes = null;
  let gridSvgText = null;
  let gridKey = "";
  let gridToken = 0;
  let activeGridId = null;
  let nextGridId = 1;
  const gridLibrary = [];
  const seeds = [];
  let nextSeedId = 1;
  let selectedSeedId = null;
  let seedPlacementMode = false;
  const placedCircles = [];
  let draft = null;
  const view = { scale: 1, x: 0, y: 0 };

  function findRootNode(seed) {
    return sim.nodes.find(
      (node) => !node.parent && Math.hypot(node.pos.x - seed.x, node.pos.y - seed.y) < 3
    );
  }

  function moveSubtree(node, dx, dy) {
    node.pos.x += dx;
    node.pos.y += dy;
    for (const child of node.children) moveSubtree(child, dx, dy);
  }

  function snapSeedPoint(point) {
    if (sim.pathIndex) {
      const hit = nearestPathPoint(point.x, point.y, sim.pathIndex, sim.stepSize * 2.5);
      if (hit) return { x: hit.x, y: hit.y };
    }
    return { x: point.x, y: point.y };
  }

  function addSeedRecord(point) {
    if (!sim.pathIndex) return null;
    const pos = snapSeedPoint(point);
    const seed = { id: nextSeedId++, x: pos.x, y: pos.y };
    seeds.push(seed);
    selectedSeedId = seed.id;
    if (sim.pathIndex) sim.addSeed(seed.x, seed.y);
    updateSeedUI();
    return seed;
  }

  function removeSeed(id) {
    const index = seeds.findIndex((seed) => seed.id === id);
    if (index < 0) return;
    const seed = seeds[index];
    const node = findRootNode(seed);
    if (node) {
      const removeSet = new Set();
      const collect = (item) => {
        removeSet.add(item);
        for (const child of item.children) collect(child);
      };
      collect(node);
      sim.nodes = sim.nodes.filter((item) => !removeSet.has(item));
    }
    seeds.splice(index, 1);
    if (selectedSeedId === id) selectedSeedId = seeds.length ? seeds[seeds.length - 1].id : null;
    updateSeedUI();
  }

  function moveSeed(id, x, y) {
    const seed = seeds.find((item) => item.id === id);
    if (!seed) return;
    const pos = snapSeedPoint({ x, y });
    const node = findRootNode(seed);
    const dx = pos.x - seed.x;
    const dy = pos.y - seed.y;
    seed.x = pos.x;
    seed.y = pos.y;
    if (node) moveSubtree(node, dx, dy);
    updateSeedUI();
  }

  function clearSeeds() {
    seeds.length = 0;
    selectedSeedId = null;
    sim.nodes = sim.nodes.filter((node) => node.parent);
    updateSeedUI();
  }

  function hitSeed(point, radius = 14) {
    for (let i = seeds.length - 1; i >= 0; i--) {
      const seed = seeds[i];
      if (Math.hypot(seed.x - point.x, seed.y - point.y) <= radius) return seed;
    }
    return null;
  }

  function updateSeedUI() {
    ui.seedCount.textContent = String(seeds.length);
    ui.seedList.innerHTML = "";
    if (!seeds.length) {
      ui.seedStatus.textContent = seedPlacementMode
        ? "Click the canvas to place a seed"
        : "0 seeds · turn on Place seed to add";
      ui.clearSeeds.disabled = true;
      return;
    }
    ui.clearSeeds.disabled = false;
    const selected = seeds.find((seed) => seed.id === selectedSeedId);
    ui.seedStatus.textContent = selected
      ? `Seed ${selected.id} · drag to move · Del to remove`
      : `${seeds.length} seed${seeds.length === 1 ? "" : "s"} · click one to select`;
    for (const seed of seeds) {
      const item = document.createElement("li");
      item.className = seed.id === selectedSeedId ? "selected" : "";
      item.innerHTML = `<span>S${seed.id} · ${Math.round(seed.x)}, ${Math.round(seed.y)}</span>`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        removeSeed(seed.id);
      });
      item.addEventListener("click", () => {
        selectedSeedId = seed.id;
        updateSeedUI();
      });
      item.appendChild(remove);
      ui.seedList.appendChild(item);
    }
  }

  function setSeedPlacementMode(on) {
    seedPlacementMode = on;
    ui.seedMode.classList.toggle("active", on);
    canvas.classList.toggle("seed-mode", on);
    updateSeedUI();
  }

  function activeGridEntry() {
    return gridLibrary.find((entry) => entry.id === activeGridId) || null;
  }

  function resolveGrowthField() {
    syncCircles();
    growthPathPoints = tracedGridPathPoints;
    growthAttractors = tracedGridPoints;
    return true;
  }

  function currentPathPoints() {
    return growthPathPoints || tracedGridPathPoints || gridPathPoints;
  }

  function currentAttractors() {
    return growthAttractors || tracedGridPoints || gridPoints;
  }

  function applyParams() {
    sim.attractionRadius = Number(ui.influence.value);
    sim.killDistance = Number(ui.kill.value);
    sim.stepSize = Number(ui.stepSize.value);
    resolveGrowthField();
    const path = currentPathPoints();
    if (path && path.length) {
      sim.pathIndex = buildPathIndex(path, sim.stepSize);
    }
    ui.countVal.textContent = ui.count.value;
    ui.influenceVal.textContent = `${ui.influence.value} px`;
    ui.killVal.textContent = `${ui.kill.value} px`;
    ui.stepVal.textContent = `${Number(ui.stepSize.value).toFixed(1)} px`;
    ui.iterVal.textContent = ui.iterations.value;
    updateDisplayParams();
  }

  function updateDisplayParams() {
    if (ui.gridOpacityVal) ui.gridOpacityVal.textContent = `${ui.gridOpacity.value}%`;
    if (ui.attractorSizeVal) {
      ui.attractorSizeVal.textContent = `${Number(ui.attractorSize.value).toFixed(1)} px`;
    }
    saveDisplayColors();
  }

  const DISPLAY_COLOR_IDS = [
    "attractorColor",
    "branchColor",
    "primaryColor",
    "secondaryColor",
    "tertiaryColor",
  ];

  function hexToRgb(hex) {
    const raw = String(hex || "").replace("#", "").trim();
    const full =
      raw.length === 3
        ? raw
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : raw.padEnd(6, "0").slice(0, 6);
    const n = parseInt(full, 16);
    if (!Number.isFinite(n)) return { r: 159, g: 214, b: 232 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbaFromHex(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function readDisplayColor(id, fallback) {
    const el = ui[id];
    const value = el && el.value ? el.value : fallback;
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
  }

  function displayColors() {
    return {
      attractor: readDisplayColor("attractorColor", "#9fd6e8"),
      branch: readDisplayColor("branchColor", "#9fd6e8"),
      1: readDisplayColor("primaryColor", "#e8d5a3"),
      2: readDisplayColor("secondaryColor", "#9fd6e8"),
      3: readDisplayColor("tertiaryColor", "#d4785a"),
    };
  }

  function saveDisplayColors() {
    const stored = {};
    for (const id of DISPLAY_COLOR_IDS) {
      if (ui[id]) stored[id] = ui[id].value;
    }
    try {
      localStorage.setItem("d7-display-colors", JSON.stringify(stored));
    } catch (_) {
      /* ignore quota */
    }
  }

  function initDisplayColors() {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem("d7-display-colors") || "{}");
    } catch (_) {
      stored = {};
    }
    for (const id of DISPLAY_COLOR_IDS) {
      if (ui[id] && /^#[0-9a-fA-F]{6}$/.test(stored[id] || "")) ui[id].value = stored[id];
    }
  }

  const SLIDER_BOUNDS = [
    { slider: "count", min: "countMin", max: "countMax", kind: "count", hardMin: 1, hardMax: 20000 },
    { slider: "influence", min: "influenceMin", max: "influenceMax", kind: "influence", hardMin: 1, hardMax: 4000 },
    { slider: "kill", min: "killMin", max: "killMax", kind: "kill", hardMin: 0.1, hardMax: 500 },
    { slider: "stepSize", min: "stepSizeMin", max: "stepSizeMax", kind: "step", hardMin: 0.1, hardMax: 200 },
    { slider: "iterations", min: "iterationsMin", max: "iterationsMax", kind: "iterations", hardMin: 1, hardMax: 20000 },
  ];

  function saveSliderBounds() {
    const stored = {};
    for (const item of SLIDER_BOUNDS) {
      const slider = document.getElementById(item.slider);
      if (!slider) continue;
      stored[item.slider] = { min: slider.min, max: slider.max };
    }
    try {
      localStorage.setItem("d7-slider-bounds", JSON.stringify(stored));
    } catch (_) {
      /* ignore quota */
    }
  }

  function applySliderBound(item, silent) {
    const slider = document.getElementById(item.slider);
    const minEl = document.getElementById(item.min);
    const maxEl = document.getElementById(item.max);
    if (!slider || !minEl || !maxEl) return;
    let min = Number(minEl.value);
    let max = Number(maxEl.value);
    if (!Number.isFinite(min)) min = Number(slider.min);
    if (!Number.isFinite(max)) max = Number(slider.max);
    min = Math.max(item.hardMin, min);
    max = Math.min(item.hardMax, max);
    if (max <= min) max = min + (Number(slider.step) || 1);
    minEl.value = String(min);
    maxEl.value = String(max);
    slider.min = String(min);
    slider.max = String(max);
    let value = Number(slider.value);
    if (value < min) value = min;
    if (value > max) value = max;
    slider.value = String(value);
    saveSliderBounds();
    if (!silent) onLiveParamChange(item.kind);
  }

  function initSliderBounds() {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem("d7-slider-bounds") || "{}");
    } catch (_) {
      stored = {};
    }
    for (const item of SLIDER_BOUNDS) {
      const slider = document.getElementById(item.slider);
      const minEl = document.getElementById(item.min);
      const maxEl = document.getElementById(item.max);
      if (!slider || !minEl || !maxEl) continue;
      const saved = stored[item.slider];
      if (saved) {
        minEl.value = saved.min;
        maxEl.value = saved.max;
      } else {
        minEl.value = slider.min;
        maxEl.value = slider.max;
      }
      applySliderBound(item, true);
      minEl.addEventListener("change", () => applySliderBound(item, false));
      maxEl.addEventListener("change", () => applySliderBound(item, false));
    }
  }

  function startPlaying() {
    if (batchRunning) return;
    const path = currentPathPoints();
    const attractors = currentAttractors();
    if (!(attractors && attractors.length && path && path.length)) return;
    playing = true;
    ui.play.textContent = "Pause";
  }

  function stopPlaying() {
    playing = false;
    ui.play.textContent = "Grow";
  }

  function restoreSeedsOnStructure() {
    if (!sim.pathIndex) return;
    if (seeds.length) {
      for (const seed of seeds) sim.addSeed(seed.x, seed.y);
      return;
    }
    const attractors = currentAttractors();
    if (attractors && attractors.length) {
      const seed = seedForGrid(attractors, sim.pathIndex);
      addSeedRecord(seed);
    }
  }

  function restoreAttractorsFromField() {
    sim.attractors = [];
    const points = currentAttractors();
    if (points && points.length) sim.addAttractors(points);
  }

  function replayGrowthFromSeeds() {
    if (!gridSource || batchRunning) return;
    applyParams();
    restoreAttractorsFromField();
    sim.clearStructure();
    restoreSeedsOnStructure();
    flashes.length = 0;
    if (sim.nodes.length && sim.attractors.length) startPlaying();
    updatePlayState();
  }

  function refreshAttractorsLive() {
    if (!gridSource || !width || !height) return;
    const prevKey = gridKey;
    gridKey = "";
    if (!rebuildGrid()) {
      gridKey = prevKey;
      return;
    }
    replayGrowthFromSeeds();
  }

  function onLiveParamChange(kind) {
    applyParams();
    if (batchRunning) return;

    if (kind === "iterations") {
      const cap = Number(ui.iterations.value);
      if (sim.generation < cap && sim.nodes.length) {
        if (!sim.attractors.length) restoreAttractorsFromField();
        startPlaying();
      } else if (sim.generation >= cap) {
        stopPlaying();
      }
      updatePlayState();
      return;
    }

    clearTimeout(onLiveParamChange._timer);
    onLiveParamChange._timer = setTimeout(() => {
      if (kind === "count" && gridSource) {
        refreshAttractorsLive();
        return;
      }
      replayGrowthFromSeeds();
    }, 60);
  }

  function gridEntryExists(id) {
    return gridLibrary.some((entry) => entry.id === id);
  }

  function updateGridCycleUI() {
    const count = gridLibrary.length;
    const multi = count > 1;
    ui.prevGrid.disabled = !multi || batchRunning;
    ui.nextGrid.disabled = !multi || batchRunning;
    ui.clearGrid.disabled = count === 0;
    if (!count) {
      ui.gridCycleStatus.textContent = "No grids loaded";
      return;
    }
    const index = gridLibrary.findIndex((entry) => entry.id === activeGridId);
    const pos = index >= 0 ? index + 1 : 1;
    const entry = gridLibrary[index >= 0 ? index : 0];
    ui.gridCycleStatus.textContent = `Grid ${pos} / ${count} · ${entry.name}`;
    ui.gridCycleStatus.classList.add("active");
  }

  function activateGrid(entry) {
    // #region agent log
    dbg("A", "app.js:activateGrid", "activateGrid enter", {
      hasEntry: !!entry,
      width,
      height,
      viewportW: viewport?.clientWidth,
      viewportH: viewport?.clientHeight,
      canvasW: canvas.width,
      canvasH: canvas.height,
      imgW: entry?.source?.naturalWidth,
      imgH: entry?.source?.naturalHeight,
      studioHidden: ui.studioView?.classList.contains("hidden"),
    });
    // #endregion
    if (!entry || !width || !height) return false;
    activeGridId = entry.id;
    gridSource = entry.source;
    gridName = entry.name;
    gridSvgText = entry.svgText || null;
    gridToken = entry.id;
    gridKey = "";
    if (!rebuildGrid()) return false;
    debugDrawLogs = 0;
    activeVariantId = null;
    clearSeeds();
    resetSim();
    updateGridCycleUI();
    updateVariantUI();
    return true;
  }

  function cycleGrid(delta) {
    if (gridLibrary.length < 2) return;
    const index = gridLibrary.findIndex((entry) => entry.id === activeGridId);
    const start = index >= 0 ? index : 0;
    const next =
      (start + delta + gridLibrary.length) % gridLibrary.length;
    activateGrid(gridLibrary[next]);
  }

  function addGridEntry(entry) {
    gridLibrary.push(entry);
    return activateGrid(entry);
  }

  function removeVariantsForGrid(gridId) {
    for (let i = variants.length - 1; i >= 0; i--) {
      if (variants[i].gridToken === gridId) variants.splice(i, 1);
    }
    if (activeVariantId != null && !variants.some((v) => v.id === activeVariantId)) {
      activeVariantId = null;
    }
  }

  function setGridStatus(message, kind) {
    ui.gridStatus.textContent = message;
    ui.gridStatus.classList.toggle("active", kind === "active");
    ui.gridStatus.classList.toggle("error", kind === "error");
  }

  function isGridFile(file) {
    return (
      /\.(png|jpe?g|svg)$/i.test(file.name) ||
      /image\/(png|jpeg|svg\+xml)/i.test(file.type || "")
    );
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read that image."));
      img.src = src;
    });
  }

  async function imageFromFile(file) {
    const svg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
    let url;
    let svgText = null;
    if (svg) {
      let text = await file.text();
      if (!/<svg[\s>]/i.test(text)) throw new Error("That SVG has no drawable grid.");
      svgText = text;
      const numericWidth = /<svg[^>]*\swidth=["'][\d.]+/i.test(text);
      if (!numericWidth) {
        const vb = text.match(
          /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([-\d.]+)[\s,]+([-\d.]+)\s*["']/i
        );
        const w = vb ? vb[1] : "1000";
        const h = vb ? vb[2] : "1000";
        text = text.replace(/<svg/i, `<svg width="${w}" height="${h}"`);
      }
      url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml;charset=utf-8" }));
    } else {
      url = URL.createObjectURL(file);
    }
    try {
      const img = await loadImage(url);
      if (!img.naturalWidth || !img.naturalHeight) {
        throw new Error("That image has no size.");
      }
      return { img, svgText };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function mapSamplePoint(x, y, layout, sw, sh) {
    return {
      x: layout.x + (x / sw) * layout.w,
      y: layout.y + (y / sh) * layout.h,
    };
  }

  function mapSampleShape(shape, layout, sw, sh) {
    const scale = (layout.w / sw + layout.h / sh) * 0.5;
    if (shape.r != null) {
      const center = mapSamplePoint(shape.x, shape.y, layout, sw, sh);
      return { x: center.x, y: center.y, r: shape.r * scale };
    }
    const topLeft = mapSamplePoint(shape.x, shape.y, layout, sw, sh);
    const bottomRight = mapSamplePoint(shape.x + shape.w, shape.y + shape.h, layout, sw, sh);
    return {
      x: topLeft.x,
      y: topLeft.y,
      w: bottomRight.x - topLeft.x,
      h: bottomRight.y - topLeft.y,
    };
  }

  function shapeStatusLabel(shapes) {
    if (!shapes) return "";
    const parts = [];
    if (shapes.circles.length) {
      parts.push(`${shapes.circles.length} circle${shapes.circles.length === 1 ? "" : "s"}`);
    }
    if (shapes.rectangles.length) {
      parts.push(
        `${shapes.rectangles.length} rectangle${shapes.rectangles.length === 1 ? "" : "s"}`
      );
    }
    return parts.length ? ` · ${parts.join(", ")}` : "";
  }

  function computeSiteLayout(canvasW, canvasH) {
    const margin = 36;
    const maxW = Math.max(1, canvasW - margin * 2);
    const maxH = Math.max(1, canvasH - margin * 2);
    const pxPerFt = Math.min(maxW, maxH) / SITE_FEET;
    const sitePx = SITE_FEET * pxPerFt;
    return {
      layout: {
        x: (canvasW - sitePx) / 2,
        y: (canvasH - sitePx) / 2,
        w: sitePx,
        h: sitePx,
      },
      pixelsPerFoot: pxPerFt,
      siteFeet: SITE_FEET,
    };
  }

  function computeImageLayout(siteRect, imgW, imgH) {
    const scale = Math.min(siteRect.w / imgW, siteRect.h / imgH);
    const w = imgW * scale;
    const h = imgH * scale;
    return {
      x: siteRect.x + (siteRect.w - w) / 2,
      y: siteRect.y + (siteRect.h - h) / 2,
      w,
      h,
    };
  }

  function traceGrid(img, count, canvasW, canvasH) {
    const site = computeSiteLayout(canvasW, canvasH);
    const layout = site.layout;
    const imageRect = computeImageLayout(layout, img.naturalWidth, img.naturalHeight);

    const long = Math.max(imageRect.w, imageRect.h);
    const sampleLong = Math.max(64, Math.min(1100, Math.round(long)));
    const sampleScale = sampleLong / long;
    const sw = Math.max(1, Math.round(imageRect.w * sampleScale));
    const sh = Math.max(1, Math.round(imageRect.h * sampleScale));

    const sample = document.createElement("canvas");
    sample.width = sw;
    sample.height = sh;
    const sctx = sample.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(img, 0, 0, sw, sh);

    let data;
    try {
      data = sctx.getImageData(0, 0, sw, sh);
    } catch (err) {
      return { ok: false, message: "Could not read pixels from that file." };
    }

    const pixels = data.data;
    const alphaVoid = 24;
    const bins = new Float32Array(32);
    let transparent = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < alphaVoid) {
        transparent += 1;
        continue;
      }
      const l = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
      bins[Math.min(31, (l / 256) * 32)] += 1;
    }
    let mode = 0;
    for (let i = 1; i < bins.length; i++) if (bins[i] > bins[mode]) mode = i;
    const modeLum = (mode + 0.5) * 8;
    const threshold = 32;
    const hasAlphaVoid = transparent / (sw * sh) > 0.15;

    const ink = [];
    const overlay = document.createElement("canvas");
    overlay.width = sw;
    overlay.height = sh;
    const octx = overlay.getContext("2d");
    const painted = octx.createImageData(sw, sh);
    const out = painted.data;

    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const i = (y * sw + x) * 4;
        const a = pixels[i + 3];
        if (a < alphaVoid) continue;
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const isSolid = hasAlphaVoid
          ? true
          : Math.abs(l - modeLum) >= threshold;
        if (!isSolid) continue;
        ink.push({ x, y });
        const toward = l < modeLum ? 0.78 : 0.35;
        const contrast = Math.min(1, Math.abs(l - modeLum) / 160);
        out[i] = Math.round(r * (1 - toward) + 159 * toward);
        out[i + 1] = Math.round(g * (1 - toward) + 214 * toward);
        out[i + 2] = Math.round(b * (1 - toward) + 232 * toward);
        out[i + 3] = Math.round(100 + contrast * 140);
      }
    }
    octx.putImageData(painted, 0, 0);

    if (ink.length < 12) {
      const hint = hasAlphaVoid
        ? "Use visible strokes on a transparent background."
        : "Use stronger contrast between lines and background.";
      return { ok: false, message: `No solid grid lines found. ${hint}` };
    }

    const toCanvas = (p) => ({
      x: imageRect.x + ((p.x + 0.5) / sw) * imageRect.w,
      y: imageRect.y + ((p.y + 0.5) / sh) * imageRect.h,
    });

    const svgParsed = gridSvgText
      ? parseSvgGridShapes(gridSvgText, img.naturalWidth, img.naturalHeight)
      : { circles: [], rectangles: [] };
    const sx = sw / img.naturalWidth;
    const sy = sh / img.naturalHeight;
    const svgSample = {
      circles: svgParsed.circles.map((shape) => ({
        x: shape.x * sx,
        y: shape.y * sy,
        r: shape.r * (sx + sy) * 0.5,
        score: shape.score,
      })),
      rectangles: svgParsed.rectangles.map((shape) => ({
        x: shape.x * sx,
        y: shape.y * sy,
        w: shape.w * sx,
        h: shape.h * sy,
        score: shape.score,
      })),
    };
    const rasterParsed = detectGridShapes(ink, sw, sh);
    const sampleShapes = {
      circles: svgSample.circles.length ? svgSample.circles : rasterParsed.circles,
      rectangles: svgSample.rectangles.length ? svgSample.rectangles : rasterParsed.rectangles,
    };
    const shapes = {
      circles: sampleShapes.circles.map((shape) => mapSampleShape(shape, imageRect, sw, sh)),
      rectangles: sampleShapes.rectangles.map((shape) => mapSampleShape(shape, imageRect, sw, sh)),
    };

    const shapeInk = [];
    for (const circle of sampleShapes.circles) {
      shapeInk.push(...sampleCirclePerimeter(circle, Math.round(count * 0.08)));
    }
    for (const rect of sampleShapes.rectangles) {
      shapeInk.push(...sampleRectPerimeter(rect, Math.round(count * 0.08)));
    }
    const attractorPool = shapeInk.length ? shapeInk.concat(ink) : ink;
    const chosen = spreadPoints(attractorPool, count, sw, sh);
    const points = chosen.map(toCanvas);

    const pathPoints = ink.map(toCanvas);
    for (const circle of sampleShapes.circles) {
      pathPoints.push(...sampleCirclePerimeter(circle, 48).map(toCanvas));
    }
    for (const rect of sampleShapes.rectangles) {
      pathPoints.push(...sampleRectPerimeter(rect, 48).map(toCanvas));
    }

    return {
      ok: true,
      overlay,
      layout,
      siteLayout: layout,
      imageLayout: imageRect,
      pixelsPerFoot: site.pixelsPerFoot,
      siteFeet: site.siteFeet,
      points,
      pathPoints,
      shapes,
      solidCount: ink.length,
      sampleArea: sw * sh,
      hasAlphaVoid,
    };
  }

  function spreadPoints(candidates, count, areaW, areaH) {
    let pool = candidates;
    const cap = Math.max(count * 30, 8000);
    if (pool.length > cap) {
      const slim = [];
      for (let i = 0; i < cap; i++) {
        slim.push(pool[(Math.random() * pool.length) | 0]);
      }
      pool = slim;
    }
    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    if (shuffled.length <= count) return shuffled;

    let spacing = Math.sqrt((areaW * areaH) / count) * 0.65;
    let picked = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      picked = [];
      const cell = Math.max(spacing, 1);
      const grid = new Map();
      const spacingSq = spacing * spacing;
      for (const p of shuffled) {
        if (picked.length >= count) break;
        const cx = Math.floor(p.x / cell);
        const cy = Math.floor(p.y / cell);
        let ok = true;
        for (let oy = -1; oy <= 1 && ok; oy++) {
          for (let ox = -1; ox <= 1 && ok; ox++) {
            const bucket = grid.get(`${cx + ox},${cy + oy}`);
            if (!bucket) continue;
            for (const q of bucket) {
              const dx = q.x - p.x;
              const dy = q.y - p.y;
              if (dx * dx + dy * dy < spacingSq) {
                ok = false;
                break;
              }
            }
          }
        }
        if (!ok) continue;
        picked.push(p);
        const key = `${cx},${cy}`;
        let bucket = grid.get(key);
        if (!bucket) {
          bucket = [];
          grid.set(key, bucket);
        }
        bucket.push(p);
      }
      if (picked.length >= count || spacing <= 1) break;
      spacing *= 0.65;
    }

    if (picked.length < count) {
      const used = new Set(picked);
      for (const p of shuffled) {
        if (picked.length >= count) break;
        if (!used.has(p)) picked.push(p);
      }
    }
    return picked;
  }

  function seedForGrid(points, pathIndex) {
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const target = { x: (minX + maxX) / 2, y: maxY + 14 };
    return nearestPathPoint(target.x, target.y, pathIndex, sim.stepSize * 4) || target;
  }

  function readParamsFromUI() {
    return {
      count: Number(ui.count.value),
      influence: Number(ui.influence.value),
      kill: Number(ui.kill.value),
      stepSize: Number(ui.stepSize.value),
      iterationsCap: Number(ui.iterations.value),
      siteFeet: SITE_FEET,
      pixelsPerFoot,
      viewportW: width,
      viewportH: height,
    };
  }

  function applyParamsFromSnapshot(params) {
    ui.count.value = String(params.count);
    ui.influence.value = String(params.influence);
    ui.kill.value = String(params.kill);
    ui.stepSize.value = String(params.stepSize);
    ui.iterations.value = String(params.iterationsCap);
    for (const item of SLIDER_BOUNDS) applySliderBound(item, true);
    if (
      params.viewportW != null &&
      params.viewportH != null &&
      (params.viewportW !== width || params.viewportH !== height)
    ) {
      gridKey = "";
    }
    applyParams();
  }

  function canCaptureVariant() {
    return sim.nodes.some((node) => node.parent);
  }

  function serializeSimSnapshot() {
    const indexOf = new Map();
    sim.nodes.forEach((node, index) => indexOf.set(node, index));
    return {
      generation: sim.generation,
      nodes: sim.nodes.map((node) => ({
        x: node.pos.x,
        y: node.pos.y,
        parentIndex: node.parent ? indexOf.get(node.parent) : -1,
        thickness: node.thickness,
        order: node.order,
      })),
      attractorsLeft: sim.attractors.map((attractor) => ({
        x: attractor.x,
        y: attractor.y,
      })),
    };
  }

  function makeVariantThumb(flatNodes) {
    const thumbSize = 120;
    const c = document.createElement("canvas");
    c.width = thumbSize;
    c.height = thumbSize;
    const g = c.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, thumbSize, thumbSize);
    if (!flatNodes.length) return c.toDataURL("image/png");

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of flatNodes) {
      if (node.x < minX) minX = node.x;
      if (node.x > maxX) maxX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.y > maxY) maxY = node.y;
    }
    const pad = 10;
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const scale = Math.min((thumbSize - pad * 2) / w, (thumbSize - pad * 2) / h);
    const ox = (thumbSize - w * scale) / 2 - minX * scale;
    const oy = (thumbSize - h * scale) / 2 - minY * scale;

    g.lineWidth = 1.2;
    g.lineCap = "round";
    const palette = displayColors();
    const identify = ui.identifyBranches.checked;
    for (const node of flatNodes) {
      if (node.parentIndex < 0) continue;
      const parent = flatNodes[node.parentIndex];
      const order = node.order || 1;
      g.strokeStyle = identify ? palette[order] || palette.branch : palette.branch;
      g.beginPath();
      g.moveTo(parent.x * scale + ox, parent.y * scale + oy);
      g.lineTo(node.x * scale + ox, node.y * scale + oy);
      g.stroke();
    }
    return c.toDataURL("image/png");
  }

  function setVariantStatus(message, kind) {
    ui.variantStatus.textContent = message;
    ui.variantStatus.classList.toggle("active", kind === "active");
    ui.variantStatus.classList.toggle("error", kind === "error");
  }

  function clearVariantsForActiveGrid() {
    removeVariantsForGrid(gridToken);
    setVariantStatus("Capture layouts to compare");
    updateVariantUI();
    updatePlayState();
    if (appPage === "analyze") renderAnalyzeView();
  }

  function clearVariants() {
    variants.length = 0;
    activeVariantId = null;
    setVariantStatus("Capture layouts to compare");
    updateVariantUI();
    updatePlayState();
    if (appPage === "analyze") renderAnalyzeView();
  }

  function gridNameForToken(token) {
    const entry = gridLibrary.find((item) => item.id === token);
    return entry ? entry.name : "Unknown grid";
  }

  function variantMetrics(variant) {
    const branches = variant.nodes.filter((node) => node.parentIndex >= 0).length;
    return {
      branches,
      nodes: variant.nodes.length,
      attractors: variant.attractorsLeft.length,
    };
  }

  function getAnalyzeVariantList() {
    const scope = ui.analyzeScope.value;
    return variants.filter((variant) => {
      if (!gridEntryExists(variant.gridToken)) return false;
      if (scope === "current") return variant.gridToken === gridToken;
      return true;
    });
  }

  function setAppPage(page) {
    appPage = page;
    const analyze = page === "analyze";
    ui.tabStudio.classList.toggle("active", !analyze);
    ui.tabAnalyze.classList.toggle("active", analyze);
    ui.tabStudio.setAttribute("aria-selected", analyze ? "false" : "true");
    ui.tabAnalyze.setAttribute("aria-selected", analyze ? "true" : "false");
    ui.studioView.classList.toggle("hidden", analyze);
    ui.analyzeView.classList.toggle("hidden", !analyze);
    document.querySelector(".app").classList.toggle("analyze-mode", analyze);
    if (analyze) {
      playing = false;
      ui.play.textContent = "Grow";
      renderAnalyzeView();
    }
  }

  function toggleAnalyzeSelection(id) {
    if (analyzeSelected.has(id)) analyzeSelected.delete(id);
    else analyzeSelected.add(id);
    renderAnalyzeView();
  }

  function drawAnalyzeComposite(list) {
    const show = ui.analyzeOverlay.checked;
    const selected = list.filter((variant) => analyzeSelected.has(variant.id));
    ui.analyzeComposite.classList.toggle("hidden-canvas", !show || !selected.length);
    if (!show || !selected.length) return;

    const canvas = ui.analyzeComposite;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(canvas.clientHeight || 220));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const g = analyzeCompositeCtx;
    g.fillStyle = "#000";
    g.fillRect(0, 0, w, h);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const variant of selected) {
      for (const node of variant.nodes) {
        if (node.x < minX) minX = node.x;
        if (node.x > maxX) maxX = node.x;
        if (node.y < minY) minY = node.y;
        if (node.y > maxY) maxY = node.y;
      }
    }
    if (!Number.isFinite(minX)) return;

    const pad = 24;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
    const ox = (w - bw * scale) / 2 - minX * scale;
    const oy = (h - bh * scale) / 2 - minY * scale;
    const colors = ["#e8d5a3", "#9fd6e8", "#d4785a", "#a8e6cf", "#c9a0dc", "#f4a261"];

    selected.forEach((variant, index) => {
      g.strokeStyle = colors[index % colors.length];
      g.globalAlpha = 0.85;
      g.lineWidth = 1.4;
      g.lineCap = "round";
      for (const node of variant.nodes) {
        if (node.parentIndex < 0) continue;
        const parent = variant.nodes[node.parentIndex];
        g.beginPath();
        g.moveTo(parent.x * scale + ox, parent.y * scale + oy);
        g.lineTo(node.x * scale + ox, node.y * scale + oy);
        g.stroke();
      }
    });
    g.globalAlpha = 1;
  }

  function renderAnalyzeView() {
    const list = getAnalyzeVariantList();
    for (const id of [...analyzeSelected]) {
      if (!list.some((variant) => variant.id === id)) analyzeSelected.delete(id);
    }

    if (!list.length) {
      ui.analyzeSummary.textContent =
        "No captured variants yet. Grow in Studio, capture or batch-generate, then return here.";
      ui.analyzeMatrix.innerHTML = "";
      ui.analyzeTableBody.innerHTML = "";
      ui.analyzeComposite.classList.add("hidden-canvas");
      return;
    }

    let totalBranches = 0;
    let totalGen = 0;
    const gridSet = new Set();
    for (const variant of list) {
      const stats = variantMetrics(variant);
      totalBranches += stats.branches;
      totalGen += variant.generation;
      gridSet.add(variant.gridName || gridNameForToken(variant.gridToken));
    }
    const avgGen = (totalGen / list.length).toFixed(1);
    const avgBranches = (totalBranches / list.length).toFixed(0);
    ui.analyzeSummary.textContent = `${list.length} variant${list.length === 1 ? "" : "s"} · ${gridSet.size} grid${gridSet.size === 1 ? "" : "s"} · avg gen ${avgGen} · avg branches ${avgBranches}`;

    ui.analyzeMatrix.innerHTML = "";
    for (const variant of list) {
      const stats = variantMetrics(variant);
      const card = document.createElement("article");
      card.className = `analyze-card${analyzeSelected.has(variant.id) ? " selected" : ""}`;
      const gname = variant.gridName || gridNameForToken(variant.gridToken);
      card.innerHTML = `
        <img src="${variant.thumbDataUrl}" alt="" />
        <div class="analyze-card-meta">
          <strong>${variant.label}</strong>
          ${gname}<br />
          gen ${variant.generation} · ${stats.branches} branches
        </div>`;
      card.addEventListener("click", () => toggleAnalyzeSelection(variant.id));
      card.addEventListener("dblclick", () => {
        setAppPage("studio");
        const entry = gridLibrary.find((item) => item.id === variant.gridToken);
        if (entry) activateGrid(entry);
        restoreVariant(variant);
      });
      ui.analyzeMatrix.appendChild(card);
    }

    ui.analyzeTableBody.innerHTML = "";
    for (const variant of list) {
      const stats = variantMetrics(variant);
      const gname = variant.gridName || gridNameForToken(variant.gridToken);
      const row = document.createElement("tr");
      const checked = analyzeSelected.has(variant.id);
      row.innerHTML = `
        <td><input type="checkbox" data-variant-id="${variant.id}" ${checked ? "checked" : ""} /></td>
        <td>${variant.label}</td>
        <td>${gname}</td>
        <td>${variant.generation}</td>
        <td>${stats.branches}</td>
        <td>${stats.nodes}</td>
        <td>${stats.attractors}</td>`;
      const box = row.querySelector("input");
      box.addEventListener("change", () => {
        if (box.checked) analyzeSelected.add(variant.id);
        else analyzeSelected.delete(variant.id);
        renderAnalyzeView();
      });
      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.textContent = "Studio";
      loadBtn.addEventListener("click", () => {
        setAppPage("studio");
        const entry = gridLibrary.find((item) => item.id === variant.gridToken);
        if (entry) activateGrid(entry);
        restoreVariant(variant);
      });
      const cell = document.createElement("td");
      cell.appendChild(loadBtn);
      row.appendChild(cell);
      ui.analyzeTableBody.appendChild(row);
    }

    drawAnalyzeComposite(list);
  }

  function captureVariant(options = {}) {
    if (!canCaptureVariant()) {
      setVariantStatus("Grow branches before capturing.", "error");
      updatePlayState();
      return;
    }
    if (variants.length >= MAX_VARIANTS) {
      variants.shift();
    }
    const snap = serializeSimSnapshot();
    const variant = {
      id: nextVariantId++,
      label: options.label || `Variant ${variants.length + 1}`,
      createdAt: Date.now(),
      gridToken,
      gridName: gridNameForToken(gridToken),
      params: readParamsFromUI(),
      seeds: seeds.map((seed) => ({ x: seed.x, y: seed.y })),
      generation: snap.generation,
      nodes: snap.nodes,
      attractorsLeft: snap.attractorsLeft,
      thumbDataUrl: makeVariantThumb(snap.nodes),
    };
    variants.push(variant);
    activeVariantId = variant.id;
    setVariantStatus(`${variant.label} saved · gen ${variant.generation}`, "active");
    updateVariantUI();
    updatePlayState();
    if (appPage === "analyze") renderAnalyzeView();
  }

  function deleteVariant(id) {
    const index = variants.findIndex((item) => item.id === id);
    if (index < 0) return;
    variants.splice(index, 1);
    if (activeVariantId === id) activeVariantId = null;
    setVariantStatus(variants.length ? `${variants.length} saved` : "Capture layouts to compare");
    updateVariantUI();
    updatePlayState();
    if (appPage === "analyze") renderAnalyzeView();
  }

  function restoreVariant(variant) {
    if (variant.gridToken !== gridToken || !gridEntryExists(variant.gridToken)) {
      setVariantStatus("Grid changed — cannot load this variant.", "error");
      return false;
    }
    applyParamsFromSnapshot(variant.params);
    seeds.length = 0;
    nextSeedId = 1;
    for (const seed of variant.seeds) {
      seeds.push({ id: nextSeedId++, x: seed.x, y: seed.y });
    }
    selectedSeedId = seeds.length ? seeds[seeds.length - 1].id : null;

    sim.clearAll();
    const path = currentPathPoints();
    if (path && path.length) {
      sim.pathIndex = buildPathIndex(path, sim.stepSize);
    }
    syncCircles();

    const nodes = [];
    for (const rec of variant.nodes) {
      const parent = rec.parentIndex >= 0 ? nodes[rec.parentIndex] : null;
      const node = new Node(new Vec2(rec.x, rec.y), parent);
      node.thickness = rec.thickness;
      node.order = rec.order;
      if (parent) parent.children.push(node);
      nodes.push(node);
    }
    sim.nodes = nodes;
    sim.generation = variant.generation;
    sim.addAttractors(variant.attractorsLeft);

    playing = false;
    ui.play.textContent = "Grow";
    flashes.length = 0;
    activeVariantId = variant.id;
    updateSeedUI();
    setVariantStatus(`Loaded ${variant.label} · gen ${variant.generation}`, "active");
    updateVariantUI();
    updatePlayState();
    return true;
  }

  function updateVariantUI() {
    ui.variantList.innerHTML = "";
    const forGrid = variants.filter((variant) => variant.gridToken === gridToken);
    for (const variant of forGrid) {
      const stale = !gridEntryExists(variant.gridToken);
      const item = document.createElement("li");
      item.className = [variant.id === activeVariantId ? "active" : "", stale ? "stale" : ""]
        .filter(Boolean)
        .join(" ");

      const img = document.createElement("img");
      img.src = variant.thumbDataUrl;
      img.alt = variant.label;
      img.width = 52;
      img.height = 52;

      const meta = document.createElement("div");
      meta.className = "variant-meta";
      meta.innerHTML = `<strong>${variant.label}</strong>gen ${variant.generation} · ${variant.seeds.length} seed${variant.seeds.length === 1 ? "" : "s"}`;

      const actions = document.createElement("div");
      actions.className = "variant-actions";
      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.textContent = "Load";
      loadBtn.disabled = stale;
      loadBtn.title = stale ? "Grid changed" : "Restore this layout";
      loadBtn.addEventListener("click", () => restoreVariant(variant));
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "Del";
      delBtn.addEventListener("click", () => deleteVariant(variant.id));
      actions.appendChild(loadBtn);
      actions.appendChild(delBtn);

      item.appendChild(img);
      item.appendChild(meta);
      item.appendChild(actions);
      ui.variantList.appendChild(item);
    }
  }

  function randomPathSeedPoint() {
    const path = currentPathPoints();
    if (!path || !path.length) return null;
    return path[(Math.random() * path.length) | 0];
  }

  function runGrowthToCap() {
    const cap = Number(ui.iterations.value);
    while (sim.generation < cap && sim.step()) {
      /* run */
    }
  }

  async function generateVariantsBatch() {
    if (batchRunning || !gridSource || !currentPathPoints()) return;
    batchRunning = true;
    playing = false;
    ui.play.textContent = "Grow";
    updatePlayState();

    const total = Number(ui.batchCount.value);
    const savedJitter = sim.jitter;
    for (let i = 0; i < total; i++) {
      setVariantStatus(`Generating ${i + 1}/${total}…`, "active");
      await new Promise((resolve) => requestAnimationFrame(resolve));

      sim.jitter = 0.08 + Math.random() * 0.07;
      clearSeeds();
      resetSim({ randomSeed: true });
      runGrowthToCap();
      if (canCaptureVariant()) {
        captureVariant();
      }
    }
    sim.jitter = savedJitter;
    batchRunning = false;
    const onGrid = variants.filter((v) => v.gridToken === gridToken).length;
    setVariantStatus(`Batch done · ${onGrid} variant${onGrid === 1 ? "" : "s"} on this grid`, "active");
    updateVariantUI();
    updatePlayState();
    if (appPage === "analyze") renderAnalyzeView();
  }

  function newAttempt() {
    if (!gridSource) return;
    activeVariantId = null;
    resetSim();
    setVariantStatus("New attempt — adjust seeds, then grow");
    updateVariantUI();
  }

  function updatePlayState() {
    const path = currentPathPoints();
    const attractors = currentAttractors();
    const ready = !!(attractors && attractors.length && path && path.length);
    ui.play.disabled = !ready || batchRunning;
    ui.newAttempt.disabled = !ready || batchRunning;
    ui.generateVariants.disabled = !ready || batchRunning;
    ui.captureVariant.disabled = !ready || batchRunning || !canCaptureVariant();
    ui.clearVariants.disabled = !variants.some((v) => v.gridToken === gridToken) || batchRunning;
    if (!ready) {
      playing = false;
      ui.play.textContent = "Grow";
    }
  }

  function rebuildGrid() {
    if (!gridSource || !width || !height) {
      // #region agent log
      dbg("A", "app.js:rebuildGrid", "rebuildGrid skipped", {
        hasSource: !!gridSource,
        width,
        height,
      });
      // #endregion
      return false;
    }
    const key = `${width}x${height}x${ui.count.value}x${gridToken}`;
    if (key === gridKey && gridPoints) return true;
    const result = traceGrid(gridSource, Number(ui.count.value), width, height);
    if (!result.ok) {
      // #region agent log
      dbg("B", "app.js:rebuildGrid", "traceGrid failed", { message: result.message, width, height });
      // #endregion
      setGridStatus(result.message, "error");
      return false;
    }
    gridOverlay = result.overlay;
    gridLayout = result.layout;
    siteLayout = result.siteLayout || result.layout;
    imageLayout = result.imageLayout;
    pixelsPerFoot = result.pixelsPerFoot || 0;
    gridPoints = result.points;
    gridPathPoints = result.pathPoints;
    tracedGridPoints = result.points;
    tracedGridPathPoints = result.pathPoints;
    growthPathPoints = result.pathPoints;
    growthAttractors = result.points;
    gridShapes = result.shapes;
    gridKey = key;
    // #region agent log
    dbg("C", "app.js:rebuildGrid", "traceGrid ok", {
      solidCount: result.solidCount,
      overlayW: result.overlay?.width,
      overlayH: result.overlay?.height,
      layout: result.layout,
      imageLayout: result.imageLayout,
      points: result.points?.length,
      pathPoints: result.pathPoints?.length,
      circles: result.shapes?.circles?.length,
    });
    // #endregion

    resolveGrowthField();

    const voidMode = result.hasAlphaVoid ? "transparent void" : "background void";
    const pxFt =
      pixelsPerFoot > 0 ? `${(Math.round(pixelsPerFoot * 10) / 10).toFixed(1)} px/ft` : "";
    const siteLabel = `Site ${SITE_FEET}'×${SITE_FEET}'${pxFt ? ` · ${pxFt}` : ""}`;
    setGridStatus(
      `${siteLabel} · ${gridName} · solid ${result.solidCount} px (${voidMode})${shapeStatusLabel(gridShapes)} · ${(currentAttractors() || []).length} attractors`,
      "active"
    );
    updateGridCycleUI();
    return true;
  }

  function clearGrid() {
    gridLibrary.length = 0;
    activeGridId = null;
    gridSource = null;
    gridName = "";
    gridOverlay = null;
    gridLayout = null;
    siteLayout = null;
    imageLayout = null;
    pixelsPerFoot = 0;
    gridPoints = null;
    gridPathPoints = null;
    tracedGridPoints = null;
    tracedGridPathPoints = null;
    growthPathPoints = null;
    growthAttractors = null;
    gridShapes = null;
    gridSvgText = null;
    gridKey = "";
    gridToken = 0;
    ui.gridFile.value = "";
    setGridStatus("Import a grid to begin");
    clearVariants();
    updateGridCycleUI();
    resetSim();
  }

  async function importGridFile(file) {
    if (!file) return false;
    if (!isGridFile(file)) {
      setGridStatus("Use a PNG, JPG, or SVG file.", "error");
      return false;
    }
    setGridStatus(`Reading ${file.name}…`);
    try {
      const { img, svgText } = await imageFromFile(file);
      const entry = {
        id: nextGridId++,
        name: file.name,
        source: img,
        svgText,
        kind: "file",
      };
      gridLibrary.push(entry);
      if (!activateGrid(entry)) {
        gridLibrary.pop();
        nextGridId -= 1;
        setGridStatus("Could not trace solid paths in that file.", "error");
        // #region agent log
        dbg("B", "app.js:importGridFile", "activateGrid failed", {
          name: file.name,
          width,
          height,
        });
        // #endregion
        return false;
      }
      return true;
    } catch (err) {
      setGridStatus(err.message || "Could not read that file.", "error");
      return false;
    }
  }

  function resetSim(options = {}) {
    const { randomSeed = false } = options;
    applyParams();
    sim.clearAll();
    sim.pathIndex = null;
    const path = currentPathPoints();
    if (path && path.length) {
      sim.pathIndex = buildPathIndex(path, sim.stepSize);
    }
    syncCircles();

    const attractors = currentAttractors();
    if (attractors && attractors.length && sim.pathIndex) {
      sim.addAttractors(attractors);
      if (randomSeed) {
        const pt = randomPathSeedPoint();
        if (pt) addSeedRecord(pt);
      } else if (seeds.length) {
        for (const seed of seeds) sim.addSeed(seed.x, seed.y);
      } else {
        const seed = seedForGrid(attractors, sim.pathIndex);
        addSeedRecord(seed);
      }
    }
    playing = false;
    flashes.length = 0;
    ui.play.textContent = "Grow";
    updatePlayState();
  }

  let lastResizeW = 0;
  let lastResizeH = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextW = viewport.clientWidth;
    const nextH = viewport.clientHeight;
    if (nextW < 8 || nextH < 8) return;
    const sizeChanged =
      Math.abs(nextW - lastResizeW) >= 8 || Math.abs(nextH - lastResizeH) >= 8;
    if (!sizeChanged && ready) {
      if (debugDrawLogs < 2) {
        // #region agent log
        dbg("A", "app.js:resize", "resize skipped", {
          width: nextW,
          height: nextH,
          runId: "post-fix",
        });
        // #endregion
      }
      return;
    }
    width = nextW;
    height = nextH;
    lastResizeW = width;
    lastResizeH = height;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    stars.length = 0;
    const n = Math.floor((width * height) / 14000);
    for (let i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.2 + 0.2,
        a: Math.random() * 0.45 + 0.08,
      });
    }
    const usingGrid = !!gridSource;
    if (usingGrid) rebuildGrid();
    if (!ready) {
      resetSim();
      ready = true;
    } else if (usingGrid && sizeChanged) {
      resetSim();
    }
  }

  function applyViewTransform() {
    ctx.setTransform(
      dpr * view.scale,
      0,
      0,
      dpr * view.scale,
      dpr * view.x,
      dpr * view.y
    );
  }

  function screenToWorld(sx, sy) {
    const rect = canvas.getBoundingClientRect();
    const cx = sx - rect.left;
    const cy = sy - rect.top;
    return {
      x: (cx - view.x) / view.scale,
      y: (cy - view.y) / view.scale,
    };
  }

  function zoomAt(clientX, clientY, factor) {
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const next = Math.min(6, Math.max(0.25, view.scale * factor));
    view.x = mx - ((mx - view.x) * next) / view.scale;
    view.y = my - ((my - view.y) * next) / view.scale;
    view.scale = next;
  }

  function growOnce() {
    if (sim.generation >= Number(ui.iterations.value)) {
      stopPlaying();
      return false;
    }
    const grew = sim.step();
    for (const point of sim.consumed) {
      flashes.push({ x: point.x, y: point.y, life: 1 });
    }
    if (!grew) stopPlaying();
    updatePlayState();
    return grew;
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    applyViewTransform();

    if (!gridSource) {
      ctx.fillStyle = "#dce7f0";
      for (const star of stars) {
        ctx.globalAlpha = star.a;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (debugDrawLogs < 8) {
      debugDrawLogs += 1;
      // #region agent log
      dbg("E", "app.js:draw", "draw frame", {
        n: debugDrawLogs,
        runId: "post-fix",
        hasOverlay: !!gridOverlay,
        hasImageLayout: !!imageLayout,
        hasGridLayout: !!gridLayout,
        hasSource: !!gridSource,
        imageLayout,
        gridLayout,
        nodes: sim.nodes.length,
        attractors: sim.attractors.length,
        width,
        height,
        view,
      });
      // #endregion
    }

    const gridAlpha = Number(ui.gridOpacity?.value ?? 90) / 100;

    if (gridSource && imageLayout) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, gridAlpha));
      ctx.drawImage(
        gridSource,
        imageLayout.x,
        imageLayout.y,
        imageLayout.w,
        imageLayout.h
      );
      ctx.restore();
    }

    if (ui.showVoidMask.checked && gridLayout) {
      ctx.fillStyle = "rgba(4, 6, 10, 0.72)";
      ctx.fillRect(gridLayout.x, gridLayout.y, gridLayout.w, gridLayout.h);
    }

    if (gridOverlay && imageLayout) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, gridAlpha * 0.8));
      ctx.drawImage(
        gridOverlay,
        imageLayout.x,
        imageLayout.y,
        imageLayout.w,
        imageLayout.h
      );
      ctx.restore();
    }

    if (gridLayout && gridSource) {
      ctx.strokeStyle = "rgba(232, 213, 163, 0.85)";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 6]);
      ctx.strokeRect(gridLayout.x, gridLayout.y, gridLayout.w, gridLayout.h);
      ctx.setLineDash([]);
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "rgba(232, 213, 163, 0.9)";
      ctx.fillText(`${SITE_FEET}' × ${SITE_FEET}'`, gridLayout.x + 6, gridLayout.y + 16);
    }

    if (gridShapes && gridShapes.rectangles.length) {
      ctx.strokeStyle = "rgba(232, 213, 163, 0.75)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([7, 5]);
      for (const rect of gridShapes.rectangles) {
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      }
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = "rgba(232, 213, 163, 0.9)";
    ctx.lineWidth = 1.5;
    const circles = draft ? sim.circles.concat(draft) : sim.circles;
    for (const circle of circles) {
      ctx.beginPath();
      ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    const attractorR = Math.max(0.2, Number(ui.attractorSize?.value ?? 2.5));
    const palette = displayColors();
    ctx.fillStyle = rgbaFromHex(palette.attractor, 0.82);
    ctx.strokeStyle = rgbaFromHex(palette.attractor, 1);
    ctx.lineWidth = attractorR >= 2 ? 1.1 : 0.7;
    for (const p of sim.attractors) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, attractorR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const identify = ui.identifyBranches.checked;
    const visible = {
      1: ui.showPrimary.checked,
      2: ui.showSecondary.checked,
      3: ui.showTertiary.checked,
    };
    const widths = { 1: 3.2, 2: 1.8, 3: 1.1 };
    const drawOrder = identify ? [3, 2, 1] : [0];
    for (const rank of drawOrder) {
      if (identify && !visible[rank]) continue;
      ctx.strokeStyle = identify ? palette[rank] : palette.branch;
      for (const node of sim.nodes) {
        if (!node.parent) continue;
        const order = node.order || 1;
        if (identify && order !== rank) continue;
        const thick = Math.min(8, 0.8 + Math.log2(node.parent.thickness + 1) * 0.9);
        ctx.lineWidth = identify ? Math.max(widths[order], thick * (order === 1 ? 1 : order === 2 ? 0.65 : 0.4)) : thick;
        ctx.beginPath();
        ctx.moveTo(node.parent.pos.x, node.parent.pos.y);
        ctx.lineTo(node.pos.x, node.pos.y);
        ctx.stroke();
      }
    }

    ctx.fillStyle = "#e8d5a3";
    for (const seed of seeds) {
      const selected = seed.id === selectedSeedId;
      if (selected) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(232, 213, 163, 0.85)";
        ctx.lineWidth = 2;
        ctx.arc(seed.x, seed.y, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(seed.x, seed.y, selected ? 4.2 : 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const node of sim.nodes) {
      if (node.parent) continue;
      if (seeds.some((seed) => Math.hypot(seed.x - node.pos.x, seed.y - node.pos.y) < 3)) continue;
      ctx.beginPath();
      ctx.arc(node.pos.x, node.pos.y, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      ctx.beginPath();
      ctx.fillStyle = `rgba(232, 213, 163, ${0.35 * f.life})`;
      ctx.arc(f.x, f.y, 4 + (1 - f.life) * 8, 0, Math.PI * 2);
      ctx.fill();
      f.life -= 0.045;
      if (f.life <= 0) flashes.splice(i, 1);
    }

    ctx.restore();

    ui.genCount.textContent = `${sim.generation} / ${ui.iterations.value}`;
    ui.attrCount.textContent = String(sim.attractors.length);
  }

  function loop() {
    if (playing) growOnce();
    try {
      draw();
    } catch (err) {
      // #region agent log
      dbg("G", "app.js:loop", "draw threw", {
        runId: "post-fix",
        error: String(err && err.message ? err.message : err),
      });
      // #endregion
    }
    requestAnimationFrame(loop);
  }

  ui.play.addEventListener("click", () => {
    if (ui.play.disabled) return;
    playing = !playing;
    ui.play.textContent = playing ? "Pause" : "Grow";
  });

  ui.reset.addEventListener("click", resetSim);
  ui.importGrid.addEventListener("click", () => ui.gridFile.click());
  ui.clearGrid.addEventListener("click", clearGrid);
  ui.prevGrid.addEventListener("click", () => cycleGrid(-1));
  ui.nextGrid.addEventListener("click", () => cycleGrid(1));
  ui.seedMode.addEventListener("click", () => setSeedPlacementMode(!seedPlacementMode));
  ui.clearSeeds.addEventListener("click", clearSeeds);
  ui.gridFile.addEventListener("change", async () => {
    const files = ui.gridFile.files ? [...ui.gridFile.files] : [];
    if (!files.length) return;
    let added = 0;
    for (const file of files) {
      if (await importGridFile(file)) added += 1;
    }
    ui.gridFile.value = "";
    if (added > 1) {
      setGridStatus(`${added} grids loaded · use Prev / Next to cycle`, "active");
    }
  });

  ui.count.addEventListener("input", () => onLiveParamChange("count"));
  ui.influence.addEventListener("input", () => onLiveParamChange("influence"));
  ui.kill.addEventListener("input", () => onLiveParamChange("kill"));
  ui.stepSize.addEventListener("input", () => onLiveParamChange("step"));
  ui.iterations.addEventListener("input", () => onLiveParamChange("iterations"));
  ui.gridOpacity.addEventListener("input", updateDisplayParams);
  ui.attractorSize.addEventListener("input", updateDisplayParams);
  for (const id of DISPLAY_COLOR_IDS) {
    if (ui[id]) ui[id].addEventListener("input", saveDisplayColors);
  }
  ui.identifyBranches.addEventListener("change", () => {
    ui.branchLegend.classList.toggle("hidden", !ui.identifyBranches.checked);
  });
  ui.captureVariant.addEventListener("click", captureVariant);
  ui.newAttempt.addEventListener("click", newAttempt);
  ui.generateVariants.addEventListener("click", () => generateVariantsBatch());
  ui.clearVariants.addEventListener("click", clearVariantsForActiveGrid);
  ui.batchCount.addEventListener("change", () => {
    ui.batchCountVal.textContent = ui.batchCount.value;
  });
  ui.tabStudio.addEventListener("click", () => setAppPage("studio"));
  ui.tabAnalyze.addEventListener("click", () => setAppPage("analyze"));
  ui.openAnalyze.addEventListener("click", () => setAppPage("analyze"));
  ui.analyzeScope.addEventListener("change", renderAnalyzeView);
  ui.analyzeOverlay.addEventListener("change", renderAnalyzeView);
  ui.analyzeSelectAll.addEventListener("click", () => {
    for (const variant of getAnalyzeVariantList()) analyzeSelected.add(variant.id);
    renderAnalyzeView();
  });
  ui.analyzeClearSel.addEventListener("click", () => {
    analyzeSelected.clear();
    renderAnalyzeView();
  });

  function canvasPoint(event) {
    return screenToWorld(event.clientX, event.clientY);
  }

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY > 0 ? 0.9 : 1.1);
    },
    { passive: false }
  );

  canvas.addEventListener("auxclick", (event) => {
    if (event.button === 1) event.preventDefault();
  });

  function hitCircle(point) {
    for (let i = placedCircles.length - 1; i >= 0; i--) {
      const circle = placedCircles[i];
      const d = Math.hypot(point.x - circle.x, point.y - circle.y);
      if (Math.abs(d - circle.r) < 10 || d < 12) return { circle, placed: true, index: i };
    }
    if (gridShapes) {
      for (let i = gridShapes.circles.length - 1; i >= 0; i--) {
        const circle = gridShapes.circles[i];
        const d = Math.hypot(point.x - circle.x, point.y - circle.y);
        if (Math.abs(d - circle.r) < 10 || d < 12) return { circle, placed: false, index: i };
      }
    }
    return null;
  }

  function syncCircles() {
    sim.circles = [];
    if (gridShapes && gridShapes.circles.length) {
      sim.circles.push(...gridShapes.circles.map((circle) => ({ ...circle })));
    }
    sim.circles.push(...placedCircles.map((circle) => ({ ...circle })));
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button === 1) {
      event.preventDefault();
      canvas.classList.add("pan-mode");
      canvas.setPointerCapture(event.pointerId);
      canvas._pan = {
        ox: event.clientX,
        oy: event.clientY,
        vx: view.x,
        vy: view.y,
      };
      return;
    }
    if (event.button !== 0) return;
    const point = canvasPoint(event);
    const seed = hitSeed(point);
    if (seed) {
      selectedSeedId = seed.id;
      updateSeedUI();
      canvas.setPointerCapture(event.pointerId);
      canvas._drag = { kind: "seed", seed, origin: point, x: seed.x, y: seed.y };
      return;
    }
    const hit = hitCircle(point);
    if (hit) {
      const d = Math.hypot(point.x - hit.circle.x, point.y - hit.circle.y);
      draft = null;
      canvas.setPointerCapture(event.pointerId);
      canvas._drag = {
        kind: Math.abs(d - hit.circle.r) < 10 ? "resize" : "move",
        placed: hit.placed,
        index: hit.index,
        circle: hit.circle,
        origin: point,
        x: hit.circle.x,
        y: hit.circle.y,
        r: hit.circle.r,
      };
      return;
    }
    if (seedPlacementMode) {
      canvas.setPointerCapture(event.pointerId);
      canvas._drag = { kind: "place-seed", origin: point };
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    canvas._drag = { kind: "new", origin: point };
  });

  canvas.addEventListener("pointermove", (event) => {
    if (canvas._pan) {
      view.x = canvas._pan.vx + (event.clientX - canvas._pan.ox);
      view.y = canvas._pan.vy + (event.clientY - canvas._pan.oy);
      return;
    }
    const drag = canvas._drag;
    if (!drag) return;
    const point = canvasPoint(event);
    if (drag.kind === "seed") {
      moveSeed(drag.seed.id, drag.x + (point.x - drag.origin.x), drag.y + (point.y - drag.origin.y));
      return;
    }
    if (drag.kind === "move") {
      drag.circle.x = drag.x + (point.x - drag.origin.x);
      drag.circle.y = drag.y + (point.y - drag.origin.y);
    } else if (drag.kind === "resize") {
      drag.circle.r = Math.max(8, Math.hypot(point.x - drag.circle.x, point.y - drag.circle.y));
    } else {
      const r = Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y);
      draft = r >= 8 ? { x: drag.origin.x, y: drag.origin.y, r } : null;
    }
  });

  canvas.addEventListener("pointerup", (event) => {
    if (canvas._pan) {
      canvas._pan = null;
      canvas.classList.remove("pan-mode");
      return;
    }
    const drag = canvas._drag;
    canvas._drag = null;
    if (!drag || event.button !== 0) return;
    const point = canvasPoint(event);
    if (drag.kind === "place-seed") {
      if (Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) < 4) {
        addSeedRecord(drag.origin);
      }
      return;
    }
    if (drag.kind === "new") {
      const r = Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y);
      draft = null;
      if (r < 8) return;
      placedCircles.push({ x: drag.origin.x, y: drag.origin.y, r });
      syncCircles();
    }
    syncCircles();
  });

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const point = canvasPoint(event);
    const seed = hitSeed(point);
    if (seed) {
      removeSeed(seed.id);
      return;
    }
    const hit = hitCircle(point);
    if (!hit) return;
    if (hit.placed) placedCircles.splice(hit.index, 1);
    else if (gridShapes) gridShapes.circles.splice(hit.index, 1);
    syncCircles();
  });

  window.addEventListener("keydown", (event) => {
    if (event.target && ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) return;
    if (event.key === "Delete" && selectedSeedId != null) {
      removeSeed(selectedSeedId);
    }
  });

  window.addEventListener("resize", () => {
    if (appPage === "analyze") renderAnalyzeView();
  });
  window.addEventListener("resize", resize);
  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(viewport);
  }
  updateSeedUI();
  initSliderBounds();
  initDisplayColors();
  updateDisplayParams();
  ui.batchCountVal.textContent = ui.batchCount.value;
  updateGridCycleUI();
  updateVariantUI();
  resize();
  loop();
})();
