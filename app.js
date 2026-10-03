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
    hitTestObstacles,
    obstacleAabb,
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
    growthDirection: document.getElementById("growthDirection"),
    iterations: document.getElementById("iterations"),
    gridSlots: document.getElementById("gridSlots"),
    replaceGrid: document.getElementById("replaceGrid"),
    clearGrid: document.getElementById("clearGrid"),
    gridCycleStatus: document.getElementById("gridCycleStatus"),
    gridFile: document.getElementById("gridFile"),
    gridStatus: document.getElementById("gridStatus"),
    seedMode: document.getElementById("seedMode"),
    selectRoot: document.getElementById("selectRoot"),
    drawObstacle: document.getElementById("drawObstacle"),
    deleteSelectedRoot: document.getElementById("deleteSelectedRoot"),
    clearSeeds: document.getElementById("clearSeeds"),
    seedStatus: document.getElementById("seedStatus"),
    seedList: document.getElementById("seedList"),
    seedCount: document.getElementById("seedCount"),
    obstacleRect: document.getElementById("obstacleRect"),
    obstacleCircle: document.getElementById("obstacleCircle"),
    obstaclePolygon: document.getElementById("obstaclePolygon"),
    obstacleHard: document.getElementById("obstacleHard"),
    obstacleRepel: document.getElementById("obstacleRepel"),
    repulsionDistance: document.getElementById("repulsionDistance"),
    repulsionDistanceVal: document.getElementById("repulsionDistanceVal"),
    repulsionStrength: document.getElementById("repulsionStrength"),
    repulsionStrengthVal: document.getElementById("repulsionStrengthVal"),
    deleteSelectedObstacle: document.getElementById("deleteSelectedObstacle"),
    clearObstacles: document.getElementById("clearObstacles"),
    obstacleStatus: document.getElementById("obstacleStatus"),
    obstacleList: document.getElementById("obstacleList"),
    countVal: document.getElementById("countVal"),
    influenceVal: document.getElementById("influenceVal"),
    killVal: document.getElementById("killVal"),
    stepVal: document.getElementById("stepVal"),
    growthDirectionVal: document.getElementById("growthDirectionVal"),
    iterVal: document.getElementById("iterVal"),
    gridOpacity: document.getElementById("gridOpacity"),
    gridOpacityVal: document.getElementById("gridOpacityVal"),
    attractorSize: document.getElementById("attractorSize"),
    attractorSizeVal: document.getElementById("attractorSizeVal"),
    branchThickness: document.getElementById("branchThickness"),
    branchThicknessVal: document.getElementById("branchThicknessVal"),
    attractorColor: document.getElementById("attractorColor"),
    branchColor: document.getElementById("branchColor"),
    primaryColor: document.getElementById("primaryColor"),
    secondaryColor: document.getElementById("secondaryColor"),
    tertiaryColor: document.getElementById("tertiaryColor"),
    genCount: document.getElementById("genCount"),
    attrCount: document.getElementById("attrCount"),
    identifyBranches: document.getElementById("identifyBranches"),
    mergeBranches: document.getElementById("mergeBranches"),
    mergeDistance: document.getElementById("mergeDistance"),
    mergeDistanceVal: document.getElementById("mergeDistanceVal"),
    branchLegend: document.getElementById("branchLegend"),
    showPrimary: document.getElementById("showPrimary"),
    showSecondary: document.getElementById("showSecondary"),
    showTertiary: document.getElementById("showTertiary"),
    showVoidMask: document.getElementById("showVoidMask"),
    showInfluenceRadius: document.getElementById("showInfluenceRadius"),
    exportTransparent: document.getElementById("exportTransparent"),
    importSnapshot: document.getElementById("importSnapshot"),
    importSnapshotFile: document.getElementById("importSnapshotFile"),
    exportStatus: document.getElementById("exportStatus"),
    saveIteration: document.getElementById("saveIteration"),
    saveSvg: document.getElementById("saveSvg"),
    clearIterations: document.getElementById("clearIterations"),
    iterationStatus: document.getElementById("iterationStatus"),
    iterationList: document.getElementById("iterationList"),
    saveSimulation: document.getElementById("saveSimulation"),
    savedSimStatus: document.getElementById("savedSimStatus"),
    saveSimPanel: document.getElementById("saveSimPanel"),
    saveSimName: document.getElementById("saveSimName"),
    confirmSaveSim: document.getElementById("confirmSaveSim"),
    cancelSaveSim: document.getElementById("cancelSaveSim"),
    savedSimList: document.getElementById("savedSimList"),
    savedSimFilters: document.querySelector(".saved-sim-filters"),
    saveSimCats: document.querySelector(".save-sim-cats"),
    captureVariant: document.getElementById("captureVariant"),
    newAttempt: document.getElementById("newAttempt"),
    generateVariants: document.getElementById("generateVariants"),
    clearVariants: document.getElementById("clearVariants"),
    batchCount: document.getElementById("batchCount"),
    batchCountVal: document.getElementById("batchCountVal"),
    variantStatus: document.getElementById("variantStatus"),
    variantList: document.getElementById("variantList"),
    tabStudio: document.getElementById("tabStudio"),
    tabMatrix: document.getElementById("tabMatrix"),
    tabSpace3d: document.getElementById("tabSpace3d"),
    tabGrid3d: document.getElementById("tabGrid3d"),
    studioView: document.getElementById("studioView"),
    studioHud: document.getElementById("studioHud"),
    matrixView: document.getElementById("matrixView"),
    matrixTypeRow: document.getElementById("matrixTypeRow"),
    matrixDescriptorRow: document.getElementById("matrixDescriptorRow"),
    matrixIntensity: document.getElementById("matrixIntensity"),
    matrixIntensityVal: document.getElementById("matrixIntensityVal"),
    matrixVariation: document.getElementById("matrixVariation"),
    matrixVariationVal: document.getElementById("matrixVariationVal"),
    generateMatrix: document.getElementById("generateMatrix"),
    matrixSaveAllPng: document.getElementById("matrixSaveAllPng"),
    matrixSaveAllSvg: document.getElementById("matrixSaveAllSvg"),
    saveMatrix: document.getElementById("saveMatrix"),
    matrixSaveWholePanel: document.getElementById("matrixSaveWholePanel"),
    matrixWholeName: document.getElementById("matrixWholeName"),
    matrixConfirmSaveWhole: document.getElementById("matrixConfirmSaveWhole"),
    matrixCancelSaveWhole: document.getElementById("matrixCancelSaveWhole"),
    savedMatrixList: document.getElementById("savedMatrixList"),
    savedMatrixFilters: document.getElementById("savedMatrixFilters"),
    savedMatrixStatus: document.getElementById("savedMatrixStatus"),
    matrixStatus: document.getElementById("matrixStatus"),
    matrixGrid: document.getElementById("matrixGrid"),
    matrixDetail: document.getElementById("matrixDetail"),
    matrixDetailBody: document.getElementById("matrixDetailBody"),
    matrixDetailTitle: document.getElementById("matrixDetailTitle"),
    matrixDetailDescriptor: document.getElementById("matrixDetailDescriptor"),
    matrixDetailThumb: document.getElementById("matrixDetailThumb"),
    matrixDetailMeta: document.getElementById("matrixDetailMeta"),
    matrixOpenStudio: document.getElementById("matrixOpenStudio"),
    matrixSaveSim: document.getElementById("matrixSaveSim"),
    matrixExportPng: document.getElementById("matrixExportPng"),
    matrixSavePanel: document.getElementById("matrixSavePanel"),
    matrixSaveName: document.getElementById("matrixSaveName"),
    matrixSaveCats: document.getElementById("matrixSaveCats"),
    matrixConfirmSave: document.getElementById("matrixConfirmSave"),
    matrixCancelSave: document.getElementById("matrixCancelSave"),
    space3dView: document.getElementById("space3dView"),
    grid3dView: document.getElementById("grid3dView"),
    space3dStage: document.getElementById("space3dStage"),
    space3dStatus: document.getElementById("space3dStatus"),
  };

  const MAX_VARIANTS = 24;
  const variants = [];
  let nextVariantId = 1;
  let activeVariantId = null;
  const MAX_SAVED_ITERATIONS = 48;
  const savedIterations = [];
  let nextSavedIterationId = 1;
  let activeSavedIterationId = null;
  let batchRunning = false;
  let matrixGenerating = false;
  let matrixExporting = false;
  let appPage = "studio";
  let space3dStudio = null;
  let grid3dStudio = null;
  const MatrixLib = window.D7DescriptorMatrix;
  let matrixType = "lobby";
  let matrixDescriptor = "interlocking";
  const matrixCells = new Array(MatrixLib?.MATRIX_COUNT || 25).fill(null);
  let selectedMatrixIndex = -1;
  let pendingSavePayload = null;
  const SavedSimStore = window.D7SavedSimulations;
  const SavedMatrixStore = window.D7SavedMatrices;
  const savedSimulations = [];
  const savedSimThumbUrls = new Map();
  const savedMatrices = [];
  const savedMatrixThumbUrls = new Map();
  let savedSimFilter = "all";
  let savedMatrixFilter = "all";
  let activeSavedMatrixId = null;
  let savedSimCategory = "lobby";
  let activeSavedLibraryId = null;
  const SAVED_SIM_THUMB_PX = 256;

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
  let customGrowthField = false;
  let gridShapes = null;
  let gridSvgText = null;
  let gridKey = "";
  let gridToken = 0;
  let activeGridId = null;
  let nextGridId = 1;
  const gridLibrary = [];
  const GRID_SLOT_COUNT = 1;
  const GRID_IDB_NAME = "d7-space-colonization";
  const GRID_IDB_STORE = "grid-slots";
  const GRID_IDB_VERSION = 1;
  const ACTIVE_SLOT_STORAGE_KEY = "d7-active-grid-slot";

  function createEmptyGridSlots(count = GRID_SLOT_COUNT) {
    return Array.from({ length: count }, () => ({ entry: null }));
  }

  let gridSlots = createEmptyGridSlots();
  let activeSlotIndex = 0;
  let pendingSlotIndex = 0;
  let restoringGridSlots = false;
  let pendingGridRestore = false;
  const seeds = [];
  let nextSeedId = 1;
  let selectedSeedId = null;
  let interactionMode = "select";
  const obstacles = [];
  let nextObstacleId = 1;
  let selectedObstacleId = null;
  let obstacleTool = "circle";
  let obstacleDraft = null;
  const view = { scale: 1, x: 0, y: 0 };

  function findRootNode(seed) {
    return sim.nodes.find(
      (node) => !node.parent && Math.hypot(node.pos.x - seed.x, node.pos.y - seed.y) < 3
    );
  }

  function pruneRootNetwork(seed) {
    const node = findRootNode(seed);
    if (!node) return;
    const removeSet = new Set();
    const collect = (item) => {
      removeSet.add(item);
      for (const child of item.children) collect(child);
    };
    collect(node);
    sim.nodes = sim.nodes.filter((item) => !removeSet.has(item));
    for (const item of sim.nodes) {
      if (item.children && item.children.length) {
        item.children = item.children.filter((child) => !removeSet.has(child));
      }
    }
    if (sim.dropMergeLinksFor) sim.dropMergeLinksFor(removeSet);
    if (!sim.nodes.length) {
      sim.lastInfluences = [];
      stopPlaying();
    }
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

  function ensurePathIndex() {
    if (sim.pathIndex) return true;
    const path = currentPathPoints();
    if (!path || !path.length) return false;
    sim.pathIndex = buildPathIndex(path, sim.stepSize);
    return !!sim.pathIndex;
  }

  function addSeedRecord(point) {
    if (!ensurePathIndex()) return null;
    const pos = snapSeedPoint(point);
    const seed = { id: nextSeedId++, x: pos.x, y: pos.y };
    seeds.push(seed);
    selectedSeedId = seed.id;
    sim.addSeed(seed.x, seed.y);
    updateSeedUI();
    return seed;
  }

  function selectSeed(id) {
    if (selectedSeedId === id) return;
    selectedSeedId = id;
    selectedObstacleId = null;
    updateSeedUI();
    updateObstacleUI();
  }

  function deselectSeed() {
    if (selectedSeedId == null) return;
    selectedSeedId = null;
    updateSeedUI();
  }

  function removeSeed(id) {
    const index = seeds.findIndex((seed) => seed.id === id);
    if (index < 0) return;
    const seed = seeds[index];
    pruneRootNetwork(seed);
    seeds.splice(index, 1);
    if (selectedSeedId === id) selectedSeedId = null;
    updateSeedUI();
    updatePlayState();
  }

  function deleteSelectedRoot() {
    if (selectedSeedId == null) return;
    removeSeed(selectedSeedId);
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
    sim.clearStructure();
    stopPlaying();
    updateSeedUI();
    updatePlayState();
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;
    return !!(el.closest && el.closest("input, textarea, select, [contenteditable='true']"));
  }

  function hitSeed(point, radius = 16) {
    for (let i = seeds.length - 1; i >= 0; i--) {
      const seed = seeds[i];
      if (Math.hypot(seed.x - point.x, seed.y - point.y) <= radius) return seed;
    }
    return null;
  }

  function updateSeedUI() {
    ui.seedCount.textContent = String(seeds.length);
    ui.seedList.innerHTML = "";
    const hasSelection = selectedSeedId != null && seeds.some((seed) => seed.id === selectedSeedId);
    if (!hasSelection) selectedSeedId = null;
    if (ui.deleteSelectedRoot) {
      ui.deleteSelectedRoot.disabled = selectedSeedId == null || batchRunning;
    }
    if (!seeds.length) {
      ui.seedStatus.textContent =
        interactionMode === "add"
          ? "Click the canvas to place a root"
          : "0 roots · choose Add Root to place";
      ui.clearSeeds.disabled = true;
      return;
    }
    ui.clearSeeds.disabled = batchRunning;
    const selected = seeds.find((seed) => seed.id === selectedSeedId);
    if (selected) {
      ui.seedStatus.textContent =
        interactionMode === "add"
          ? `Root ${selected.id} selected · click canvas to add another`
          : `Root ${selected.id} selected · Esc to deselect · Del to remove`;
    } else if (interactionMode === "add") {
      ui.seedStatus.textContent = `${seeds.length} root${seeds.length === 1 ? "" : "s"} · click empty canvas to add`;
    } else {
      ui.seedStatus.textContent = `${seeds.length} root${seeds.length === 1 ? "" : "s"} · click one to select`;
    }
    for (const seed of seeds) {
      const item = document.createElement("li");
      item.className = seed.id === selectedSeedId ? "selected" : "";
      item.innerHTML = `<span>R${seed.id} · ${Math.round(seed.x)}, ${Math.round(seed.y)}</span>`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Delete this root";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        removeSeed(seed.id);
      });
      item.addEventListener("click", () => {
        if (selectedSeedId === seed.id) deselectSeed();
        else selectSeed(seed.id);
      });
      item.appendChild(remove);
      ui.seedList.appendChild(item);
    }
  }

  function setInteractionMode(mode) {
    interactionMode = mode === "add" || mode === "draw" ? mode : "select";
    if (interactionMode !== "draw") obstacleDraft = null;
    if (interactionMode === "draw") selectedSeedId = null;
    if (interactionMode === "add") selectedObstacleId = null;
    ui.seedMode.classList.toggle("active", interactionMode === "add");
    if (ui.selectRoot) ui.selectRoot.classList.toggle("active", interactionMode === "select");
    if (ui.drawObstacle) ui.drawObstacle.classList.toggle("active", interactionMode === "draw");
    canvas.classList.toggle("seed-mode", interactionMode === "add");
    canvas.classList.toggle("select-mode", interactionMode === "select");
    canvas.classList.toggle("draw-mode", interactionMode === "draw");
    canvas.style.cursor = "";
    updateSeedUI();
    updateObstacleUI();
  }

  function setSeedInteractionMode(mode) {
    setInteractionMode(mode === "add" ? "add" : "select");
  }

  function setSeedPlacementMode(on) {
    setInteractionMode(on ? "add" : "select");
  }

  function setObstacleTool(tool) {
    obstacleTool = tool === "rect" || tool === "polygon" ? tool : "circle";
    if (ui.obstacleRect) ui.obstacleRect.classList.toggle("active", obstacleTool === "rect");
    if (ui.obstacleCircle) ui.obstacleCircle.classList.toggle("active", obstacleTool === "circle");
    if (ui.obstaclePolygon) ui.obstaclePolygon.classList.toggle("active", obstacleTool === "polygon");
    obstacleDraft = null;
    setInteractionMode("draw");
  }

  function setObstacleBehavior(mode) {
    const next = mode === "repel" ? "repel" : "hard";
    if (ui.obstacleHard) ui.obstacleHard.classList.toggle("active", next === "hard");
    if (ui.obstacleRepel) ui.obstacleRepel.classList.toggle("active", next === "repel");
    if (sim.obstacleMode !== next) {
      sim.obstacleMode = next;
      onLiveParamChange("obstacleMode");
    } else {
      applyParams();
    }
    updateObstacleUI();
  }

  function cloneObstacle(obs) {
    if (!obs) return null;
    if (obs.type === "polygon") {
      return {
        id: obs.id,
        type: "polygon",
        points: (obs.points || []).map((p) => ({ x: p.x, y: p.y })),
      };
    }
    if (obs.type === "rect") {
      return { id: obs.id, type: "rect", x: obs.x, y: obs.y, w: obs.w, h: obs.h };
    }
    return { id: obs.id, type: "circle", x: obs.x, y: obs.y, r: obs.r };
  }

  function serializeObstacles() {
    return obstacles.map((obs) => cloneObstacle(obs));
  }

  function restoreObstacles(list) {
    obstacles.length = 0;
    selectedObstacleId = null;
    obstacleDraft = null;
    let maxId = 0;
    for (const rec of list || []) {
      const cloned = cloneObstacle(rec);
      if (!cloned) continue;
      if (cloned.id == null) cloned.id = ++maxId;
      maxId = Math.max(maxId, cloned.id);
      obstacles.push(cloned);
    }
    nextObstacleId = maxId + 1;
    syncObstacles();
    updateObstacleUI();
  }

  function syncObstacles() {
    sim.circles = [];
    if (gridShapes && gridShapes.circles.length) {
      sim.circles.push(...gridShapes.circles.map((circle) => ({ ...circle })));
    }
    sim.obstacles = obstacles.map((obs) => cloneObstacle(obs));
  }

  function syncCircles() {
    syncObstacles();
  }

  function obstacleLabel(obs) {
    if (obs.type === "rect") return `Rect ${obs.id}`;
    if (obs.type === "polygon") return `Poly ${obs.id}`;
    return `Circle ${obs.id}`;
  }

  function selectObstacle(id) {
    selectedObstacleId = id;
    selectedSeedId = null;
    updateSeedUI();
    updateObstacleUI();
  }

  function deselectObstacle() {
    if (selectedObstacleId == null) return;
    selectedObstacleId = null;
    updateObstacleUI();
  }

  function addObstacle(obs) {
    const item = cloneObstacle(obs);
    item.id = nextObstacleId++;
    obstacles.push(item);
    selectedObstacleId = item.id;
    selectedSeedId = null;
    obstacleDraft = null;
    syncObstacles();
    updateObstacleUI();
    updateSeedUI();
    if (sim.generation > 0) replayGrowthFromSeeds();
    return item;
  }

  function deleteSelectedObstacle() {
    if (selectedObstacleId == null) return;
    const index = obstacles.findIndex((obs) => obs.id === selectedObstacleId);
    if (index < 0) return;
    obstacles.splice(index, 1);
    selectedObstacleId = null;
    syncObstacles();
    updateObstacleUI();
    if (sim.generation > 0) replayGrowthFromSeeds();
  }

  function clearObstacles() {
    if (!obstacles.length) return;
    obstacles.length = 0;
    selectedObstacleId = null;
    obstacleDraft = null;
    syncObstacles();
    updateObstacleUI();
    if (sim.generation > 0) replayGrowthFromSeeds();
  }

  function moveObstacleBy(obs, dx, dy) {
    if (obs.type === "polygon") {
      for (const p of obs.points) {
        p.x += dx;
        p.y += dy;
      }
      return;
    }
    obs.x += dx;
    obs.y += dy;
  }

  function updateObstacleUI() {
    const mode = sim.obstacleMode === "repel" ? "repel" : "hard";
    if (ui.obstacleHard) ui.obstacleHard.classList.toggle("active", mode === "hard");
    if (ui.obstacleRepel) ui.obstacleRepel.classList.toggle("active", mode === "repel");
    if (ui.obstacleRect) ui.obstacleRect.classList.toggle("active", obstacleTool === "rect");
    if (ui.obstacleCircle) ui.obstacleCircle.classList.toggle("active", obstacleTool === "circle");
    if (ui.obstaclePolygon) ui.obstaclePolygon.classList.toggle("active", obstacleTool === "polygon");
    if (ui.deleteSelectedObstacle) {
      ui.deleteSelectedObstacle.disabled = selectedObstacleId == null || batchRunning;
    }
    if (ui.clearObstacles) ui.clearObstacles.disabled = !obstacles.length || batchRunning;
    if (ui.obstacleList) {
      ui.obstacleList.innerHTML = "";
      for (const obs of obstacles) {
        const item = document.createElement("li");
        item.className = obs.id === selectedObstacleId ? "selected" : "";
        item.innerHTML = `<span>${obstacleLabel(obs)}</span>`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.title = "Delete this obstacle";
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          selectedObstacleId = obs.id;
          deleteSelectedObstacle();
        });
        item.addEventListener("click", () => {
          if (selectedObstacleId === obs.id) deselectObstacle();
          else selectObstacle(obs.id);
        });
        item.appendChild(remove);
        ui.obstacleList.appendChild(item);
      }
    }
    if (!ui.obstacleStatus) return;
    if (interactionMode === "draw") {
      if (obstacleTool === "rect") {
        ui.obstacleStatus.textContent = "Draw Obstacle · drag to create a rectangle";
      } else if (obstacleTool === "polygon") {
        const n = obstacleDraft && obstacleDraft.points ? obstacleDraft.points.length : 0;
        ui.obstacleStatus.textContent =
          n < 3
            ? "Draw Obstacle · click to add vertices · Enter or click first point to close"
            : `Draw Obstacle · ${n} points · Enter / click first point to close`;
      } else {
        ui.obstacleStatus.textContent = "Draw Obstacle · drag from the center to set the radius";
      }
      return;
    }
    const selected = obstacles.find((obs) => obs.id === selectedObstacleId);
    if (selected) {
      ui.obstacleStatus.textContent = `${obstacleLabel(selected)} selected · Del to remove`;
    } else if (!obstacles.length) {
      ui.obstacleStatus.textContent = "No obstacles · Draw Obstacle to place geometry";
    } else {
      ui.obstacleStatus.textContent = `${obstacles.length} obstacle${
        obstacles.length === 1 ? "" : "s"
      } · Select to edit`;
    }
  }

  function readObstacleMode() {
    if (ui.obstacleRepel && ui.obstacleRepel.classList.contains("active")) return "repel";
    return sim.obstacleMode === "repel" ? "repel" : "hard";
  }

  function readRepulsionDistance() {
    const raw = Number(ui.repulsionDistance?.value ?? 40);
    if (!Number.isFinite(raw)) return 40;
    return Math.max(8, Math.min(160, raw));
  }

  function readRepulsionStrength() {
    const raw = Number(ui.repulsionStrength?.value ?? 1.2);
    if (!Number.isFinite(raw)) return 1.2;
    return Math.max(0, Math.min(4, raw));
  }

  function activeGridEntry() {
    return gridLibrary.find((entry) => entry.id === activeGridId) || null;
  }

  function resolveGrowthField() {
    syncCircles();
    if (!customGrowthField) {
      growthPathPoints = tracedGridPathPoints;
      growthAttractors = tracedGridPoints;
    }
    return true;
  }

  function currentPathPoints() {
    return growthPathPoints || tracedGridPathPoints || gridPathPoints;
  }

  function currentAttractors() {
    return growthAttractors || tracedGridPoints || gridPoints;
  }

  function readGrowthDirection() {
    const raw = Number(ui.growthDirection?.value ?? 0);
    if (!Number.isFinite(raw)) return 0;
    return Math.max(-1, Math.min(1, raw));
  }

  function formatGrowthDirection(value) {
    const v = Number(value) || 0;
    const signed = `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
    if (Math.abs(v) < 0.05) return `${signed} · neutral`;
    return v < 0 ? `${signed} · horizontal` : `${signed} · vertical`;
  }

  function applyParams() {
    sim.attractionRadius = Number(ui.influence.value);
    sim.killDistance = Number(ui.kill.value);
    sim.stepSize = Number(ui.stepSize.value);
    sim.growthDirection = readGrowthDirection();
    sim.mergeBranches = !!(ui.mergeBranches && ui.mergeBranches.checked);
    sim.mergeDistance = Math.max(0, Number(ui.mergeDistance?.value ?? 20) || 0);
    sim.obstacleMode = readObstacleMode();
    sim.repulsionDistance = readRepulsionDistance();
    sim.repulsionStrength = readRepulsionStrength();
    resolveGrowthField();
    const path = currentPathPoints();
    if (path && path.length) {
      sim.pathIndex = buildPathIndex(path, sim.stepSize);
    }
    ui.countVal.textContent = ui.count.value;
    ui.influenceVal.textContent = `${ui.influence.value} px`;
    ui.killVal.textContent = `${ui.kill.value} px`;
    ui.stepVal.textContent = `${Number(ui.stepSize.value).toFixed(1)} px`;
    if (ui.growthDirectionVal) {
      ui.growthDirectionVal.textContent = formatGrowthDirection(sim.growthDirection);
    }
    if (ui.mergeDistanceVal) {
      ui.mergeDistanceVal.textContent = `${Math.round(sim.mergeDistance)} px`;
    }
    if (ui.repulsionDistanceVal) {
      ui.repulsionDistanceVal.textContent = `${Math.round(sim.repulsionDistance)} px`;
    }
    if (ui.repulsionStrengthVal) {
      ui.repulsionStrengthVal.textContent = Number(sim.repulsionStrength).toFixed(1);
    }
    ui.iterVal.textContent = ui.iterations.value;
    updateDisplayParams();
  }

  function updateDisplayParams() {
    if (ui.gridOpacityVal) ui.gridOpacityVal.textContent = `${ui.gridOpacity.value}%`;
    if (ui.attractorSizeVal) {
      ui.attractorSizeVal.textContent = `${Number(ui.attractorSize.value).toFixed(1)} px`;
    }
    if (ui.branchThicknessVal) {
      ui.branchThicknessVal.textContent = `${Number(ui.branchThickness?.value ?? 1).toFixed(1)}×`;
    }
    saveDisplayColors();
  }

  function branchStrokeWidth(parentThickness, order, identify) {
    const scale = Number(ui.branchThickness?.value ?? 1);
    const thick = Math.max(
      0.3,
      (0.8 + Math.log2((parentThickness || 1) + 1) * 0.9) * scale
    );
    const capped = Math.min(28, thick);
    if (!identify) return capped;
    const factor = order === 1 ? 1 : order === 2 ? 0.65 : 0.4;
    const floors = { 1: 3.2 * scale, 2: 1.8 * scale, 3: 1.1 * scale };
    return Math.max(floors[order] || 1, capped * factor);
  }

  const DISPLAY_COLOR_IDS = [
    "attractorColor",
    "branchColor",
    "primaryColor",
    "secondaryColor",
    "tertiaryColor",
  ];

  const DEFAULT_DISPLAY_SETTINGS = {
    gridOpacity: 10,
    attractorSize: 2,
    branchThickness: 0.5,
  };

  const DEFAULT_DISPLAY_COLORS = {
    attractorColor: "#FF0000",
    branchColor: "#FFFFFF",
    primaryColor: "#C80000",
    secondaryColor: "#00fffe",
    tertiaryColor: "#ffd900",
  };

  const LEGACY_DISPLAY_COLORS = {
    attractorColor: ["#9fd6e8"],
    branchColor: ["#9fd6e8", "#ff0000"],
    primaryColor: ["#e8d5a3"],
    secondaryColor: ["#9fd6e8", "#007ac7"],
    tertiaryColor: ["#d4785a", "#c7c400"],
  };

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
      attractor: readDisplayColor("attractorColor", DEFAULT_DISPLAY_COLORS.attractorColor),
      branch: readDisplayColor("branchColor", DEFAULT_DISPLAY_COLORS.branchColor),
      1: readDisplayColor("primaryColor", DEFAULT_DISPLAY_COLORS.primaryColor),
      2: readDisplayColor("secondaryColor", DEFAULT_DISPLAY_COLORS.secondaryColor),
      3: readDisplayColor("tertiaryColor", DEFAULT_DISPLAY_COLORS.tertiaryColor),
    };
  }

  function saveDisplayColors() {
    const stored = {};
    for (const id of DISPLAY_COLOR_IDS) {
      if (ui[id]) stored[id] = ui[id].value;
    }
    if (ui.branchThickness) stored.branchThickness = ui.branchThickness.value;
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
      const storedHex = String(stored[id] || "").toLowerCase();
      const legacyList = LEGACY_DISPLAY_COLORS[id] || [];
      const isLegacy = legacyList.some((hex) => String(hex).toLowerCase() === storedHex);
      if (isLegacy && ui[id] && DEFAULT_DISPLAY_COLORS[id]) {
        ui[id].value = DEFAULT_DISPLAY_COLORS[id];
        continue;
      }
      if (ui[id] && /^#[0-9a-fA-F]{6}$/.test(stored[id] || "")) ui[id].value = stored[id];
    }
    if (ui.branchThickness) {
      ui.branchThickness.value = String(DEFAULT_DISPLAY_SETTINGS.branchThickness);
    }
    if (ui.gridOpacity) {
      ui.gridOpacity.value = String(DEFAULT_DISPLAY_SETTINGS.gridOpacity);
    }
    if (ui.attractorSize) {
      ui.attractorSize.value = String(DEFAULT_DISPLAY_SETTINGS.attractorSize);
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
    const points = currentAttractors();
    if (points && points.length) sim.seedAttractorField(points);
    else {
      sim.attractors = [];
      sim.originalAttractors = [];
    }
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
    if (kind === "mergeDistance" && !sim.mergeBranches) return;
    if (kind === "repulsionDistance" && sim.obstacleMode !== "repel") return;
    if (kind === "repulsionStrength" && sim.obstacleMode !== "repel") return;

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

  function filledGridSlotCount() {
    return gridSlots.reduce((n, slot) => n + (slot.entry ? 1 : 0), 0);
  }

  function firstEmptyGridSlotIndex() {
    return gridSlots.findIndex((slot) => !slot.entry);
  }

  function persistActiveSlotIndex() {
    if (restoringGridSlots) return;
    try {
      localStorage.setItem(ACTIVE_SLOT_STORAGE_KEY, String(activeSlotIndex));
    } catch (_) {
      /* ignore quota / private mode */
    }
  }

  function openGridSlotDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB is not available"));
        return;
      }
      const request = indexedDB.open(GRID_IDB_NAME, GRID_IDB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(GRID_IDB_STORE)) {
          db.createObjectStore(GRID_IDB_STORE, { keyPath: "slotIndex" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function idbPutGridSlot(db, record) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(GRID_IDB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(GRID_IDB_STORE).put(record);
    });
  }

  function idbDeleteGridSlot(db, slotIndex) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(GRID_IDB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(GRID_IDB_STORE).delete(slotIndex);
    });
  }

  function idbClearGridSlots(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(GRID_IDB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(GRID_IDB_STORE).clear();
    });
  }

  function idbGetGridSlot(db, slotIndex) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(GRID_IDB_STORE, "readonly");
      const request = tx.objectStore(GRID_IDB_STORE).get(slotIndex);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  function idbGetAllGridSlots(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(GRID_IDB_STORE, "readonly");
      const store = tx.objectStore(GRID_IDB_STORE);
      if (typeof store.getAll === "function") {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
        return;
      }
      const results = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function persistGridSlot(slotIndex, file, entry) {
    if (restoringGridSlots || slotIndex < 0 || slotIndex >= GRID_SLOT_COUNT) return;
    try {
      const buffer = await file.arrayBuffer();
      const db = await openGridSlotDb();
      await idbPutGridSlot(db, {
        slotIndex,
        id: entry.id,
        name: entry.name,
        type: file.type || "",
        svgText: entry.svgText || null,
        buffer,
      });
      db.close();
    } catch (err) {
      console.warn("Could not persist grid slot", err);
    }
  }

  async function deletePersistedGridSlot(slotIndex) {
    try {
      const db = await openGridSlotDb();
      await idbDeleteGridSlot(db, slotIndex);
      db.close();
    } catch (_) {
      /* ignore */
    }
  }

  async function clearPersistedGridSlots() {
    try {
      const db = await openGridSlotDb();
      await idbClearGridSlots(db);
      db.close();
    } catch (_) {
      /* ignore */
    }
  }

  function buildGridSlotButtons() {
    if (!ui.gridSlots) return;
    ui.gridSlots.innerHTML = "";
    for (let i = 0; i < GRID_SLOT_COUNT; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "grid-slot empty";
      btn.dataset.slot = String(i);
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", "false");
      btn.textContent = `Grid ${i + 1}`;
      btn.addEventListener("click", () => onGridSlotClick(i));
      ui.gridSlots.appendChild(btn);
    }
  }

  function updateGridCycleUI() {
    const buttons = ui.gridSlots
      ? ui.gridSlots.querySelectorAll(".grid-slot")
      : [];
    buttons.forEach((btn) => {
      const i = Number(btn.dataset.slot);
      const entry = gridSlots[i]?.entry;
      const isActive = !!(entry && entry.id === activeGridId);
      btn.classList.toggle("empty", !entry);
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
      btn.title = entry ? `${entry.name} · click to switch` : `Upload Grid ${i + 1}`;
      btn.disabled = batchRunning;
    });
    const filled = filledGridSlotCount();
    if (ui.clearGrid) ui.clearGrid.disabled = filled === 0 || batchRunning;
    if (ui.replaceGrid) {
      ui.replaceGrid.disabled = batchRunning;
      ui.replaceGrid.textContent = gridSlots[activeSlotIndex]?.entry
        ? "Replace site drawing"
        : "Upload site drawing";
    }
    if (!filled) {
      ui.gridCycleStatus.textContent = "No grids loaded";
      ui.gridCycleStatus.classList.remove("active");
      return;
    }
    const entry = gridSlots[activeSlotIndex]?.entry || activeGridEntry();
    if (entry) {
      ui.gridCycleStatus.textContent = `Active site drawing: ${entry.name}`;
      ui.gridCycleStatus.classList.add("active");
    } else {
      ui.gridCycleStatus.textContent = `${filled} grid${filled === 1 ? "" : "s"} loaded`;
      ui.gridCycleStatus.classList.remove("active");
    }
  }

  function openGridFilePicker(slotIndex) {
    pendingSlotIndex = Math.max(0, Math.min(GRID_SLOT_COUNT - 1, slotIndex));
    if (!ui.gridFile) return;
    ui.gridFile.value = "";
    ui.gridFile.click();
  }

  function onGridSlotClick(index) {
    if (batchRunning) return;
    selectGridSlot(index);
  }

  function selectGridSlot(index) {
    if (index < 0 || index >= GRID_SLOT_COUNT) return;
    const entry = gridSlots[index]?.entry;
    if (!entry) {
      openGridFilePicker(index);
      return;
    }
    if (entry.id === activeGridId) {
      updateGridCycleUI();
      return;
    }
    activateGrid(entry);
  }

  function tryActivateRestoredGrid() {
    if (!pendingGridRestore || !width || !height) return;
    const preferred =
      gridSlots[activeSlotIndex]?.entry || gridSlots.find((slot) => slot.entry)?.entry;
    if (!preferred) {
      pendingGridRestore = false;
      return;
    }
    if (activateGrid(preferred)) pendingGridRestore = false;
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
    if (typeof entry.slotIndex === "number") {
      activeSlotIndex = entry.slotIndex;
      persistActiveSlotIndex();
    }
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
    restoreObstacles([]);
    resetSim();
    updateGridCycleUI();
    updateVariantUI();
    updateIterationUI();
    return true;
  }

  function cycleGrid(delta) {
    const filledIndexes = gridSlots
      .map((slot, index) => (slot.entry ? index : -1))
      .filter((index) => index >= 0);
    if (filledIndexes.length < 2) return;
    const currentPos = filledIndexes.indexOf(activeSlotIndex);
    const start = currentPos >= 0 ? currentPos : 0;
    const next =
      filledIndexes[(start + delta + filledIndexes.length) % filledIndexes.length];
    selectGridSlot(next);
  }

  function addGridEntry(entry) {
    const slotIndex =
      typeof entry.slotIndex === "number" ? entry.slotIndex : firstEmptyGridSlotIndex();
    if (slotIndex < 0) return false;
    entry.slotIndex = slotIndex;
    gridSlots[slotIndex].entry = entry;
    if (!gridLibrary.some((item) => item.id === entry.id)) gridLibrary.push(entry);
    return activateGrid(entry);
  }

  async function restoreGridSlots() {
    restoringGridSlots = true;
    pendingGridRestore = false;
    try {
      const db = await openGridSlotDb();
      const records = await idbGetAllGridSlots(db);
      db.close();
      records.sort((a, b) => a.slotIndex - b.slotIndex);
      let maxId = 0;
      for (const rec of records) {
        if (rec.slotIndex < 0 || rec.slotIndex >= GRID_SLOT_COUNT || !rec.buffer) continue;
        try {
          const fallbackName = rec.svgText
            ? `grid-${rec.slotIndex + 1}.svg`
            : `grid-${rec.slotIndex + 1}.png`;
          const file = new File([rec.buffer], rec.name || fallbackName, {
            type: rec.type || (rec.svgText ? "image/svg+xml" : ""),
          });
          if (!isGridFile(file) && !rec.svgText) continue;
          const { img, svgText } = await imageFromFile(file);
          const id = Number.isFinite(rec.id) ? rec.id : nextGridId++;
          maxId = Math.max(maxId, id);
          const entry = {
            id,
            name: rec.name || file.name,
            source: img,
            svgText: rec.svgText || svgText,
            kind: "file",
            slotIndex: rec.slotIndex,
          };
          gridSlots[rec.slotIndex].entry = entry;
          if (!gridLibrary.some((item) => item.id === entry.id)) gridLibrary.push(entry);
        } catch (err) {
          console.warn(`Could not restore grid slot ${rec.slotIndex + 1}`, err);
        }
      }
      nextGridId = Math.max(nextGridId, maxId + 1);
      let preferred = 0;
      try {
        const stored = parseInt(localStorage.getItem(ACTIVE_SLOT_STORAGE_KEY) || "0", 10);
        if (Number.isFinite(stored) && stored >= 0 && stored < GRID_SLOT_COUNT) {
          preferred = stored;
        }
      } catch (_) {
        /* ignore */
      }
      activeSlotIndex = preferred;
      const target =
        gridSlots[preferred]?.entry || gridSlots.find((slot) => slot.entry)?.entry;
      if (target) {
        if (typeof target.slotIndex === "number") activeSlotIndex = target.slotIndex;
        if (!activateGrid(target)) pendingGridRestore = true;
      }
    } catch (err) {
      console.warn("Could not restore grid slots", err);
    } finally {
      restoringGridSlots = false;
      updateGridCycleUI();
    }
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
      growthDirection: readGrowthDirection(),
      mergeBranches: !!(ui.mergeBranches && ui.mergeBranches.checked),
      mergeDistance: Math.max(0, Number(ui.mergeDistance?.value ?? 20) || 0),
      obstacleMode: readObstacleMode(),
      repulsionDistance: readRepulsionDistance(),
      repulsionStrength: readRepulsionStrength(),
      iterationsCap: Number(ui.iterations.value),
      siteFeet: SITE_FEET,
      pixelsPerFoot,
      viewportW: width,
      viewportH: height,
      siteLayout: cloneSiteRect(currentSiteRect()),
    };
  }

  function applyParamsFromSnapshot(params) {
    ui.count.value = String(params.count);
    ui.influence.value = String(params.influence);
    ui.kill.value = String(params.kill);
    ui.stepSize.value = String(params.stepSize);
    if (ui.growthDirection) {
      const dir = Number(params.growthDirection);
      ui.growthDirection.value = Number.isFinite(dir) ? String(Math.max(-1, Math.min(1, dir))) : "0";
    }
    if (ui.mergeBranches) ui.mergeBranches.checked = !!params.mergeBranches;
    if (ui.mergeDistance) {
      const dist = Number(params.mergeDistance);
      ui.mergeDistance.value = Number.isFinite(dist) ? String(Math.max(4, Math.min(80, dist))) : "20";
    }
    const obsMode = params.obstacleMode === "repel" ? "repel" : "hard";
    if (ui.obstacleHard) ui.obstacleHard.classList.toggle("active", obsMode === "hard");
    if (ui.obstacleRepel) ui.obstacleRepel.classList.toggle("active", obsMode === "repel");
    sim.obstacleMode = obsMode;
    if (ui.repulsionDistance) {
      const dist = Number(params.repulsionDistance);
      ui.repulsionDistance.value = Number.isFinite(dist) ? String(Math.max(8, Math.min(160, dist))) : "40";
    }
    if (ui.repulsionStrength) {
      const str = Number(params.repulsionStrength);
      ui.repulsionStrength.value = Number.isFinite(str) ? String(Math.max(0, Math.min(4, str))) : "1.2";
    }
    ui.iterations.value = String(params.iterationsCap);
    for (const item of SLIDER_BOUNDS) applySliderBound(item, true);
    applyParams();
  }

  function cloneSiteRect(rect) {
    if (!rect) return null;
    const x = Number(rect.x);
    const y = Number(rect.y);
    const w = Number(rect.w);
    const h = Number(rect.h);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    return { x, y, w, h };
  }

  function siteRectFromParams(params) {
    const saved = cloneSiteRect(params?.siteLayout);
    if (saved) return saved;
    const vw = Number(params?.viewportW);
    const vh = Number(params?.viewportH);
    if (vw > 8 && vh > 8) return cloneSiteRect(computeSiteLayout(vw, vh).layout);
    return null;
  }

  function siteRectsDiffer(a, b, eps = 0.75) {
    if (!a || !b) return false;
    return (
      Math.abs(a.x - b.x) > eps ||
      Math.abs(a.y - b.y) > eps ||
      Math.abs(a.w - b.w) > eps ||
      Math.abs(a.h - b.h) > eps
    );
  }

  function mapSitePoint(point, from, to) {
    if (!point || !from || !to || !(from.w > 0) || !(from.h > 0)) return point;
    return {
      ...point,
      x: to.x + ((point.x - from.x) / from.w) * to.w,
      y: to.y + ((point.y - from.y) / from.h) * to.h,
    };
  }

  function mapSitePoints(list, from, to) {
    if (!Array.isArray(list) || !list.length) return list || [];
    return list.map((point) => mapSitePoint(point, from, to));
  }

  function mapSiteObstacle(obs, from, to) {
    if (!obs || !from || !to) return obs;
    const sx = to.w / from.w;
    const sy = to.h / from.h;
    if (obs.type === "circle") {
      return {
        ...obs,
        x: to.x + ((obs.x - from.x) / from.w) * to.w,
        y: to.y + ((obs.y - from.y) / from.h) * to.h,
        r: obs.r * Math.min(sx, sy),
      };
    }
    if (obs.type === "rect") {
      return {
        ...obs,
        x: to.x + ((obs.x - from.x) / from.w) * to.w,
        y: to.y + ((obs.y - from.y) / from.h) * to.h,
        w: obs.w * sx,
        h: obs.h * sy,
      };
    }
    if (obs.type === "polygon") {
      return { ...obs, points: mapSitePoints(obs.points, from, to) };
    }
    return obs;
  }

  function remapSnapshotToCurrentSite(params, seedRecords, snap) {
    const from = siteRectFromParams(params);
    const to = cloneSiteRect(currentSiteRect());
    if (!from || !to || !siteRectsDiffer(from, to)) {
      return { params, seedRecords, snap };
    }
    const scale = to.w / from.w;
    const nextParams = { ...params };
    for (const key of ["influence", "kill", "stepSize", "mergeDistance", "repulsionDistance"]) {
      const value = Number(nextParams[key]);
      if (Number.isFinite(value)) nextParams[key] = value * scale;
    }
    nextParams.siteLayout = to;
    nextParams.viewportW = width;
    nextParams.viewportH = height;
    nextParams.pixelsPerFoot = pixelsPerFoot;
    return {
      params: nextParams,
      seedRecords: mapSitePoints(seedRecords || [], from, to),
      snap: {
        ...snap,
        nodes: (snap.nodes || []).map((node) => {
          const mapped = mapSitePoint(node, from, to);
          if (node.thickness != null) mapped.thickness = node.thickness * scale;
          return mapped;
        }),
        attractorsLeft: mapSitePoints(snap.attractorsLeft || [], from, to),
        originalAttractors: mapSitePoints(snap.originalAttractors || [], from, to),
        pathPoints: mapSitePoints(snap.pathPoints || [], from, to),
        obstacles: (snap.obstacles || []).map((obs) => mapSiteObstacle(obs, from, to)),
      },
    };
  }

  function canCaptureVariant() {
    return sim.nodes.some((node) => node.parent);
  }

  function canSaveIteration() {
    return sim.generation > 0 && canCaptureVariant();
  }

  function setIterationStatus(message, kind) {
    if (!ui.iterationStatus) return;
    ui.iterationStatus.textContent = message;
    ui.iterationStatus.classList.toggle("active", kind === "active");
    ui.iterationStatus.classList.toggle("error", kind === "error");
  }

  function persistSavedIterations() {
    try {
      localStorage.setItem(
        "d7-saved-iterations",
        JSON.stringify({
          nextId: nextSavedIterationId,
          items: savedIterations,
        })
      );
    } catch (_) {
      /* ignore quota */
    }
  }

  function loadSavedIterationsFromStorage() {
    try {
      const raw = localStorage.getItem("d7-saved-iterations");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!Array.isArray(data.items)) return;
      savedIterations.length = 0;
      savedIterations.push(...data.items);
      nextSavedIterationId =
        Number(data.nextId) ||
        savedIterations.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
    } catch (_) {
      /* ignore corrupt storage */
    }
  }

  function applySimSnapshot(params, seedRecords, snap) {
    const mapped = remapSnapshotToCurrentSite(params || {}, seedRecords || [], snap || {});
    params = mapped.params;
    seedRecords = mapped.seedRecords;
    snap = mapped.snap;
    customGrowthField = false;
    applyParamsFromSnapshot(params);
    seeds.length = 0;
    nextSeedId = 1;
    for (const seed of seedRecords) {
      seeds.push({ id: nextSeedId++, x: seed.x, y: seed.y });
    }
    selectedSeedId = seeds.length ? seeds[seeds.length - 1].id : null;

    sim.clearAll();
    if (snap.pathPoints && snap.pathPoints.length) {
      growthPathPoints = snap.pathPoints.map((p) => ({ x: p.x, y: p.y }));
      customGrowthField = true;
    }
    if (snap.originalAttractors && snap.originalAttractors.length) {
      growthAttractors = snap.originalAttractors.map((p) => ({ x: p.x, y: p.y }));
      customGrowthField = true;
    }
    resolveGrowthField();
    const path =
      snap.pathPoints && snap.pathPoints.length ? growthPathPoints : currentPathPoints();
    if (path && path.length) {
      sim.pathIndex = buildPathIndex(path, sim.stepSize);
    }
    syncCircles();

    const nodes = [];
    let maxRoot = 0;
    for (const rec of snap.nodes || []) {
      const parent = rec.parentIndex >= 0 ? nodes[rec.parentIndex] : null;
      const node = new Node(new Vec2(rec.x, rec.y), parent);
      node.thickness = rec.thickness;
      node.order = rec.order;
      node.fused = !!rec.fused;
      if (rec.rootId != null) {
        node.rootId = rec.rootId;
      } else if (parent && parent.rootId != null) {
        node.rootId = parent.rootId;
      } else if (!parent) {
        node.rootId = ++maxRoot;
      }
      if (node.rootId != null) maxRoot = Math.max(maxRoot, node.rootId);
      if (parent) parent.children.push(node);
      nodes.push(node);
    }
    sim.nodes = nodes;
    sim.nextRootId = maxRoot + 1;
    sim.mergeLinks = [];
    sim.rebuildMergeComponents();
    for (const link of snap.mergeLinks || []) {
      const a = nodes[link.a];
      const b = nodes[link.b];
      if (a && b) sim._connectNetworks(a, b, { ignoreDistance: true });
    }
    sim.generation = snap.generation;
    const originalField =
      (snap.originalAttractors && snap.originalAttractors.length
        ? snap.originalAttractors
        : null) ||
      currentAttractors() ||
      snap.attractorsLeft ||
      [];
    sim.setOriginalAttractors(originalField);
    sim.setActiveAttractors(snap.attractorsLeft || []);

    restoreObstacles(snap.obstacles || []);

    playing = false;
    ui.play.textContent = "Grow";
    flashes.length = 0;
    updateSeedUI();
    updatePlayState();
  }

  function persistIterationRecord() {
    if (savedIterations.length >= MAX_SAVED_ITERATIONS) {
      savedIterations.shift();
    }
    const snap = serializeSimSnapshot();
    const sameGen = savedIterations.filter(
      (item) => item.gridToken === gridToken && item.generation === snap.generation
    ).length;
    const label =
      sameGen > 0
        ? `Iteration ${snap.generation} (${sameGen + 1})`
        : `Iteration ${snap.generation}`;
    const record = {
      id: nextSavedIterationId++,
      label,
      createdAt: Date.now(),
      gridToken,
      gridName: gridNameForToken(gridToken),
      params: readParamsFromUI(),
      seeds: seeds.map((seed) => ({ x: seed.x, y: seed.y })),
      generation: snap.generation,
      nodes: snap.nodes,
      mergeLinks: snap.mergeLinks || [],
      attractorsLeft: snap.attractorsLeft,
      originalAttractors: snap.originalAttractors || [],
      pathPoints: snap.pathPoints || [],
      obstacles: serializeObstacles(),
      thumbDataUrl: makeVariantThumb(snap.nodes, snap.mergeLinks),
    };
    savedIterations.push(record);
    activeSavedIterationId = record.id;
    activeVariantId = null;
    persistSavedIterations();
    updateIterationUI();
    updateVariantUI();
    return record;
  }

  function saveCurrentIteration() {
    if (!gridSource) {
      setIterationStatus("Import a grid before saving iterations.", "error");
      return;
    }
    if (!canSaveIteration()) {
      setIterationStatus("Grow branches before saving an iteration.", "error");
      return;
    }
    const record = persistIterationRecord();
    downloadPngSnapshot().then((ok) => {
      if (ok) {
        setIterationStatus(
          `${record.label} saved as PNG · ${record.attractorsLeft.length} attractors left`,
          "active"
        );
      } else {
        setIterationStatus(
          `${record.label} kept in session, but PNG download failed.`,
          "error"
        );
      }
    });
  }

  function restoreSavedIteration(record) {
    if (record.gridToken !== gridToken || !gridEntryExists(record.gridToken)) {
      setIterationStatus("Grid changed — cannot load this iteration.", "error");
      return false;
    }
    applySimSnapshot(record.params, record.seeds, {
      generation: record.generation,
      nodes: record.nodes,
      attractorsLeft: record.attractorsLeft,
      originalAttractors: record.originalAttractors || [],
      pathPoints: record.pathPoints || [],
      mergeLinks: record.mergeLinks || [],
      obstacles: record.obstacles || [],
    });
    activeSavedIterationId = record.id;
    activeVariantId = null;
    setIterationStatus(`Loaded ${record.label}`, "active");
    updateIterationUI();
    updateVariantUI();
    return true;
  }

  function deleteSavedIteration(id) {
    const index = savedIterations.findIndex((item) => item.id === id);
    if (index < 0) return;
    savedIterations.splice(index, 1);
    if (activeSavedIterationId === id) activeSavedIterationId = null;
    persistSavedIterations();
    setIterationStatus(
      savedIterations.some((item) => item.gridToken === gridToken)
        ? `${savedIterations.filter((item) => item.gridToken === gridToken).length} saved on this grid`
        : "Grow, then save the current step to reload later."
    );
    updateIterationUI();
    updatePlayState();
  }

  function clearSavedIterationsForGrid() {
    for (let i = savedIterations.length - 1; i >= 0; i--) {
      if (savedIterations[i].gridToken === gridToken) savedIterations.splice(i, 1);
    }
    activeSavedIterationId = null;
    persistSavedIterations();
    setIterationStatus("Cleared saved iterations for this grid");
    updateIterationUI();
    updatePlayState();
  }

  function updateIterationUI() {
    if (!ui.iterationList) return;
    ui.iterationList.innerHTML = "";
    const forGrid = savedIterations
      .filter((item) => item.gridToken === gridToken)
      .sort((a, b) => b.createdAt - a.createdAt);
    for (const record of forGrid) {
      const item = document.createElement("li");
      item.className = record.id === activeSavedIterationId ? "selected" : "";
      const label = document.createElement("span");
      label.textContent = `${record.label} · ${record.attractorsLeft.length} attr`;
      const actions = document.createElement("span");
      actions.className = "iteration-actions";
      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.textContent = "Load";
      loadBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        restoreSavedIteration(record);
      });
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "×";
      delBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteSavedIteration(record.id);
      });
      actions.appendChild(loadBtn);
      actions.appendChild(delBtn);
      item.appendChild(label);
      item.appendChild(actions);
      item.addEventListener("click", () => restoreSavedIteration(record));
      ui.iterationList.appendChild(item);
    }
    if (ui.clearIterations) {
      ui.clearIterations.disabled = !forGrid.length || batchRunning;
    }
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
        rootId: node.rootId,
        fused: !!node.fused,
      })),
      mergeLinks: (sim.mergeLinks || [])
        .map((link) => ({
          a: indexOf.get(link.a),
          b: indexOf.get(link.b),
        }))
        .filter((link) => link.a != null && link.b != null),
      attractorsLeft: sim.attractors.map((attractor) => ({
        x: attractor.x,
        y: attractor.y,
      })),
      originalAttractors: (sim.originalAttractors || []).map((attractor) => ({
        x: attractor.x,
        y: attractor.y,
      })),
      pathPoints: (currentPathPoints() || []).map((p) => ({ x: p.x, y: p.y })),
      obstacles: serializeObstacles(),
    };
  }

  function setSavedSimStatus(message, kind) {
    if (!ui.savedSimStatus) return;
    ui.savedSimStatus.textContent = message;
    ui.savedSimStatus.classList.toggle("active", kind === "active");
    ui.savedSimStatus.classList.toggle("error", kind === "error");
  }

  function readDisplayFromUI() {
    const colors = displayColors();
    return {
      gridOpacity: Number(ui.gridOpacity?.value ?? DEFAULT_DISPLAY_SETTINGS.gridOpacity),
      attractorSize: Number(ui.attractorSize?.value ?? DEFAULT_DISPLAY_SETTINGS.attractorSize),
      branchThickness: Number(ui.branchThickness?.value ?? DEFAULT_DISPLAY_SETTINGS.branchThickness),
      identifyBranches: !!ui.identifyBranches?.checked,
      showPrimary: !!ui.showPrimary?.checked,
      showSecondary: !!ui.showSecondary?.checked,
      showTertiary: !!ui.showTertiary?.checked,
      showVoidMask: !!ui.showVoidMask?.checked,
      showInfluenceRadius: !!ui.showInfluenceRadius?.checked,
      exportTransparent: !!(ui.exportTransparent && ui.exportTransparent.checked),
      colors: {
        attractor: colors.attractor,
        branch: colors.branch,
        primary: colors[1],
        secondary: colors[2],
        tertiary: colors[3],
      },
    };
  }

  function canvasToBlob(target, type, quality) {
    return new Promise((resolve, reject) => {
      target.toBlob(
        (blob) => {
          if (!blob) reject(new Error("Could not encode image."));
          else resolve(blob);
        },
        type,
        quality
      );
    });
  }

  async function captureCurrentGridPayload() {
    const slotIndex = activeSlotIndex;
    try {
      const db = await openGridSlotDb();
      const rec = await idbGetGridSlot(db, slotIndex);
      db.close();
      if (rec && rec.buffer) {
        return {
          slotIndex,
          name: rec.name || gridName || `grid-${slotIndex + 1}`,
          type: rec.type || "",
          svgText: rec.svgText || gridSvgText || null,
          buffer: rec.buffer,
        };
      }
    } catch (_) {
      /* fall through to raster fallback */
    }
    if (!gridSource) return null;
    const w = gridSource.naturalWidth || 1;
    const h = gridSource.naturalHeight || 1;
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    off.getContext("2d").drawImage(gridSource, 0, 0);
    const blob = await canvasToBlob(off, "image/png", 1);
    return {
      slotIndex,
      name: gridName || `grid-${slotIndex + 1}.png`,
      type: "image/png",
      svgText: gridSvgText || null,
      buffer: await blob.arrayBuffer(),
    };
  }

  async function makeSavedSimulationThumb() {
    const site = currentSiteRect();
    const size = SAVED_SIM_THUMB_PX;
    const off = document.createElement("canvas");
    off.width = size;
    off.height = size;
    const ectx = off.getContext("2d");
    ectx.setTransform(1, 0, 0, 1, 0, 0);
    renderStudioFrame(ectx, {
      transparentBackground: false,
      outputWidth: size,
      outputHeight: size,
      camera: cameraForSiteRect(site, size),
      pixelRatio: 1,
      clipToOutput: true,
      hideSiteBoundary: true,
      hideInfluencePreview: true,
      hideEditingChrome: true,
      hideDraft: true,
    });
    return canvasToBlob(off, "image/jpeg", 0.72);
  }

  function formatSavedSimDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function revokeSavedSimThumbUrls() {
    for (const url of savedSimThumbUrls.values()) URL.revokeObjectURL(url);
    savedSimThumbUrls.clear();
  }

  function savedSimThumbSrc(record) {
    if (!record) return "";
    if (record.thumbnail instanceof Blob) {
      let url = savedSimThumbUrls.get(record.id);
      if (!url) {
        url = URL.createObjectURL(record.thumbnail);
        savedSimThumbUrls.set(record.id, url);
      }
      return url;
    }
    if (typeof record.thumbnail === "string") return record.thumbnail;
    return "";
  }

  function setSavedSimCategory(category) {
    savedSimCategory = SavedSimStore
      ? SavedSimStore.normalizeCategory(category)
      : "lobby";
    if (!ui.saveSimCats) return;
    ui.saveSimCats.querySelectorAll("[data-sim-cat]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.simCat === savedSimCategory);
    });
  }

  function setSavedSimFilter(filter) {
    savedSimFilter = filter === "all" ? "all" : (SavedSimStore ? SavedSimStore.normalizeCategory(filter) : "lobby");
    if (!ui.savedSimFilters) return;
    ui.savedSimFilters.querySelectorAll("[data-sim-filter]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.simFilter === savedSimFilter);
    });
    renderSavedSimulationList();
    if (!savedSimulations.length) return;
    if (savedSimFilter === "all") {
      setSavedSimStatus(`${savedSimulations.length} saved in this browser`, "active");
    } else {
      const n = visibleSavedSimulations().length;
      const label = SavedSimStore ? SavedSimStore.categoryLabel(savedSimFilter) : savedSimFilter;
      setSavedSimStatus(`${n} in ${label}`, "active");
    }
  }

  function visibleSavedSimulations() {
    if (savedSimFilter === "all") return savedSimulations;
    return savedSimulations.filter((item) => item.category === savedSimFilter);
  }

  function hideSaveSimPanel() {
    pendingSavePayload = null;
    if (ui.saveSimPanel) ui.saveSimPanel.classList.add("hidden");
    if (ui.matrixSavePanel) ui.matrixSavePanel.classList.add("hidden");
    if (ui.matrixSaveWholePanel) ui.matrixSaveWholePanel.classList.add("hidden");
  }

  async function openSaveSimPanel() {
    if (!gridSource) {
      setSavedSimStatus("Import a grid before saving a simulation.", "error");
      return;
    }
    if (!SavedSimStore) {
      setSavedSimStatus("Saved Simulations are unavailable in this browser.", "error");
      return;
    }
    try {
      const names = await SavedSimStore.list();
      if (ui.saveSimName) {
        ui.saveSimName.value = "";
        ui.saveSimName.placeholder = SavedSimStore.nextIterationName(names);
      }
    } catch (_) {
      if (ui.saveSimName) {
        ui.saveSimName.value = "";
        ui.saveSimName.placeholder = SavedSimStore.nextIterationName(savedSimulations);
      }
    }
    setSavedSimCategory(savedSimCategory || "lobby");
    if (ui.saveSimPanel) ui.saveSimPanel.classList.remove("hidden");
    if (ui.saveSimName) ui.saveSimName.focus();
  }

  function renderSavedSimulationList() {
    if (!ui.savedSimList) return;
    revokeSavedSimThumbUrls();
    ui.savedSimList.innerHTML = "";
    const items = visibleSavedSimulations();
    for (const record of items) {
      const item = document.createElement("li");
      if (record.id === activeSavedLibraryId) item.className = "active";
      const thumbSrc = savedSimThumbSrc(record);
      const img = document.createElement("img");
      img.alt = "";
      img.width = 72;
      img.height = 72;
      if (thumbSrc) img.src = thumbSrc;
      const body = document.createElement("div");
      body.className = "saved-sim-card-body";
      const title = document.createElement("strong");
      title.className = "saved-sim-card-title";
      title.textContent = record.name || "Untitled";
      const cat = document.createElement("span");
      cat.className = "saved-sim-card-cat";
      cat.textContent = SavedSimStore ? SavedSimStore.categoryLabel(record.category) : record.category;
      const params = record.params || {};
      const meta = document.createElement("div");
      meta.className = "saved-sim-card-meta";
      meta.innerHTML = `${formatSavedSimDate(record.createdAt)}<br>${
        record.descriptorLabel && record.descriptorScore != null
          ? `${record.descriptorLabel} — ${Math.round(record.descriptorScore)}%<br>`
          : ""
      }Attractors: ${params.count ?? "—"}<br>Influence: ${params.influence ?? "—"}<br>Kill: ${
        params.kill ?? "—"
      }<br>Step: ${params.stepSize ?? "—"}`;
      const actions = document.createElement("div");
      actions.className = "saved-sim-card-actions";
      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.textContent = "Load";
      loadBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        loadSavedLibrarySimulation(record.id);
      });
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "ghost";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteSavedLibrarySimulation(record.id);
      });
      actions.appendChild(loadBtn);
      actions.appendChild(delBtn);
      body.appendChild(title);
      body.appendChild(cat);
      body.appendChild(meta);
      body.appendChild(actions);
      item.appendChild(img);
      item.appendChild(body);
      ui.savedSimList.appendChild(item);
    }
  }

  async function refreshSavedSimulationLibrary() {
    if (!SavedSimStore) {
      setSavedSimStatus("Saved Simulations need IndexedDB in this browser.", "error");
      return;
    }
    try {
      const records = await SavedSimStore.list();
      savedSimulations.length = 0;
      savedSimulations.push(...records);
      renderSavedSimulationList();
      if (!savedSimulations.length) {
        setSavedSimStatus("Save the current layout in this browser. It stays on this computer only.");
      } else if (savedSimFilter === "all") {
        setSavedSimStatus(
          `${savedSimulations.length} saved in this browser`,
          "active"
        );
      } else {
        const n = visibleSavedSimulations().length;
        const label = SavedSimStore.categoryLabel(savedSimFilter);
        setSavedSimStatus(`${n} in ${label}`, "active");
      }
    } catch (err) {
      setSavedSimStatus(err.message || "Could not read saved simulations.", "error");
    }
  }

  function formatSavedMatrixShortDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleString(undefined, { month: "short", day: "numeric" });
  }

  function revokeSavedMatrixThumbUrls() {
    for (const url of savedMatrixThumbUrls.values()) URL.revokeObjectURL(url);
    savedMatrixThumbUrls.clear();
  }

  function savedMatrixThumbSrc(record) {
    if (!record) return "";
    if (record.thumbnail instanceof Blob) {
      let url = savedMatrixThumbUrls.get(record.id);
      if (!url) {
        url = URL.createObjectURL(record.thumbnail);
        savedMatrixThumbUrls.set(record.id, url);
      }
      return url;
    }
    return "";
  }

  function setSavedMatrixStatus(message, kind) {
    if (!ui.savedMatrixStatus) return;
    ui.savedMatrixStatus.textContent = message;
    ui.savedMatrixStatus.classList.toggle("active", kind === "active");
    ui.savedMatrixStatus.classList.toggle("error", kind === "error");
  }

  function setSavedMatrixFilter(filter) {
    savedMatrixFilter = filter === "all" ? "all" : (SavedMatrixStore ? SavedMatrixStore.normalizeCategory(filter) : "lobby");
    if (!ui.savedMatrixFilters) return;
    ui.savedMatrixFilters.querySelectorAll("[data-matrix-filter]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.matrixFilter === savedMatrixFilter);
    });
    renderSavedMatrixList();
  }

  function visibleSavedMatrices() {
    if (savedMatrixFilter === "all") return savedMatrices;
    return savedMatrices.filter((item) => item.spatialType === savedMatrixFilter);
  }

  function renderSavedMatrixList() {
    if (!ui.savedMatrixList) return;
    revokeSavedMatrixThumbUrls();
    ui.savedMatrixList.innerHTML = "";
    const items = visibleSavedMatrices();
    for (const record of items) {
      const item = document.createElement("li");
      if (record.id === activeSavedMatrixId) item.className = "active";
      const thumbSrc = savedMatrixThumbSrc(record);
      const img = document.createElement("img");
      img.alt = "";
      img.width = 72;
      img.height = 72;
      if (thumbSrc) img.src = thumbSrc;
      const body = document.createElement("div");
      body.className = "saved-sim-card-body";
      const title = document.createElement("strong");
      title.className = "saved-sim-card-title";
      title.textContent = record.name || "Untitled matrix";
      const cat = document.createElement("span");
      cat.className = "saved-sim-card-cat";
      const typeLabel = SavedMatrixStore
        ? SavedMatrixStore.categoryLabel(record.spatialType)
        : record.spatialType;
      cat.textContent = `${typeLabel} · ${record.descriptorLabel || record.descriptor || "—"}`;
      const meta = document.createElement("div");
      meta.className = "saved-sim-card-meta";
      meta.innerHTML = `25 iterations<br>Saved ${formatSavedMatrixShortDate(record.createdAt)}`;
      const actions = document.createElement("div");
      actions.className = "saved-sim-card-actions";
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.textContent = "Open Matrix";
      openBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        loadSavedMatrix(record.id);
      });
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "ghost";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteSavedMatrix(record.id);
      });
      actions.appendChild(openBtn);
      actions.appendChild(delBtn);
      body.appendChild(title);
      body.appendChild(cat);
      body.appendChild(meta);
      body.appendChild(actions);
      item.appendChild(img);
      item.appendChild(body);
      ui.savedMatrixList.appendChild(item);
    }
    if (!savedMatrices.length) {
      setSavedMatrixStatus("Saved matrices stay in this browser only.");
    } else if (savedMatrixFilter === "all") {
      setSavedMatrixStatus(`${savedMatrices.length} saved in this browser`, "active");
    } else {
      setSavedMatrixStatus(`${items.length} in ${SavedMatrixStore.categoryLabel(savedMatrixFilter)}`, "active");
    }
  }

  async function refreshSavedMatrixLibrary() {
    if (!SavedMatrixStore) {
      setSavedMatrixStatus("Saved Matrices need IndexedDB in this browser.", "error");
      return;
    }
    try {
      const records = await SavedMatrixStore.list();
      savedMatrices.length = 0;
      savedMatrices.push(...records);
      renderSavedMatrixList();
    } catch (err) {
      setSavedMatrixStatus(err.message || "Could not read saved matrices.", "error");
    }
  }

  async function openSaveWholeMatrixPanel() {
    if (!matrixHasCompleteSet()) {
      setMatrixStatus("Generate a complete 5 × 5 matrix before saving.", "error");
      return;
    }
    if (!SavedMatrixStore) {
      setMatrixStatus("Saved Matrices are unavailable in this browser.", "error");
      return;
    }
    const descriptorLabel = matrixDescriptorLabel(matrixType, matrixDescriptor);
    try {
      const existing = await SavedMatrixStore.list();
      if (ui.matrixWholeName) {
        ui.matrixWholeName.value = "";
        ui.matrixWholeName.placeholder = SavedMatrixStore.nextDefaultName(
          matrixType,
          descriptorLabel,
          existing
        );
      }
    } catch (_) {
      if (ui.matrixWholeName) {
        ui.matrixWholeName.placeholder = SavedMatrixStore.nextDefaultName(
          matrixType,
          descriptorLabel,
          savedMatrices
        );
      }
    }
    if (ui.matrixSaveWholePanel) ui.matrixSaveWholePanel.classList.remove("hidden");
    if (ui.matrixWholeName) ui.matrixWholeName.focus();
  }

  async function confirmSaveWholeMatrix() {
    if (!matrixHasCompleteSet()) {
      setMatrixStatus("Generate a complete 5 × 5 matrix before saving.", "error");
      return;
    }
    if (!SavedMatrixStore) {
      setMatrixStatus("Saved Matrices are unavailable in this browser.", "error");
      return;
    }
    if (ui.matrixConfirmSaveWhole) ui.matrixConfirmSaveWhole.disabled = true;
    try {
      const descriptorLabel = matrixDescriptorLabel(matrixType, matrixDescriptor);
      const existing = await SavedMatrixStore.list();
      const typed = ui.matrixWholeName ? ui.matrixWholeName.value.trim() : "";
      const name =
        typed ||
        SavedMatrixStore.nextDefaultName(matrixType, descriptorLabel, existing);
      const grid = matrixCells[0]?.grid || (await captureCurrentGridPayload());
      if (!grid) {
        setMatrixStatus("Could not capture the grid for this matrix.", "error");
        return;
      }
      const cells = matrixCells.map((cell) => serializeMatrixCellForStore(cell));
      const record = {
        id: SavedMatrixStore.createId(),
        name,
        spatialType: matrixType,
        descriptor: matrixDescriptor,
        descriptorLabel,
        intensity: Number(ui.matrixIntensity?.value ?? 50),
        variation: Number(ui.matrixVariation?.value ?? 40),
        matrixSize: matrixSlotCount(),
        candidateSettings: {
          poolSize: MatrixLib?.CANDIDATE_COUNT || 100,
          keep: MatrixLib?.MATRIX_COUNT || 25,
          baseParams: readParamsFromUI(),
        },
        createdAt: Date.now(),
        grid,
        gridToken,
        gridName: gridNameForToken(gridToken),
        gridSlotIndex: activeSlotIndex,
        cells,
        thumbnail: cells[0]?.thumbnail || null,
      };
      await SavedMatrixStore.put(record);
      if (ui.matrixWholeName) ui.matrixWholeName.value = "";
      if (ui.matrixSaveWholePanel) ui.matrixSaveWholePanel.classList.add("hidden");
      activeSavedMatrixId = record.id;
      await refreshSavedMatrixLibrary();
      setMatrixStatus(`Saved ${name} · 25 iterations`, "active");
    } catch (err) {
      setMatrixStatus(err.message || "Could not save this matrix.", "error");
    } finally {
      if (ui.matrixConfirmSaveWhole) ui.matrixConfirmSaveWhole.disabled = false;
    }
  }

  async function deleteSavedMatrix(id) {
    if (!SavedMatrixStore) return;
    const record = savedMatrices.find((item) => item.id === id);
    const label = record?.name || "this saved matrix";
    if (!global.confirm(`Delete this saved matrix?\n\n${label}`)) return;
    try {
      await SavedMatrixStore.remove(id);
      if (activeSavedMatrixId === id) activeSavedMatrixId = null;
      await refreshSavedMatrixLibrary();
      setSavedMatrixStatus("Matrix deleted.", "active");
    } catch (err) {
      setSavedMatrixStatus(err.message || "Could not delete that matrix.", "error");
    }
  }

  async function confirmSaveSimulation() {
    if (!gridSource && !(pendingSavePayload && pendingSavePayload.grid)) {
      setSavedSimStatus("Import a grid before saving a simulation.", "error");
      return;
    }
    if (!SavedSimStore) {
      setSavedSimStatus("Saved Simulations are unavailable in this browser.", "error");
      return;
    }
    if (ui.confirmSaveSim) ui.confirmSaveSim.disabled = true;
    if (ui.matrixConfirmSave) ui.matrixConfirmSave.disabled = true;
    try {
      const existing = await SavedSimStore.list();
      const nameInput = pendingSavePayload && ui.matrixSaveName ? ui.matrixSaveName : ui.saveSimName;
      const typed = nameInput ? nameInput.value.trim() : "";
      const name = typed || SavedSimStore.nextIterationName(existing);
      const source = pendingSavePayload;
      const grid = source?.grid || (await captureCurrentGridPayload());
      if (!grid) {
        setSavedSimStatus("Could not capture the current grid for this save.", "error");
        return;
      }
      let thumbnail = source?.thumbnailBlob || source?.thumbnail || null;
      if (!thumbnail) {
        try {
          thumbnail = await makeSavedSimulationThumb();
        } catch (_) {
          thumbnail = null;
        }
      }
      const record = {
        id: SavedSimStore.createId(),
        name,
        category: savedSimCategory,
        createdAt: Date.now(),
        gridSlotIndex: grid.slotIndex,
        grid,
        params: source?.params || readParamsFromUI(),
        display: source?.display || readDisplayFromUI(),
        jitter: source?.jitter ?? sim.jitter,
        seeds: source?.seeds || seeds.map((seed) => ({ x: seed.x, y: seed.y })),
        sim: source?.sim || serializeSimSnapshot(),
        thumbnail,
        spatialType: source?.spatialType || null,
        descriptor: source?.descriptor || null,
        descriptorLabel: source?.descriptorLabel || null,
        descriptorScore: source?.descriptorScore ?? null,
        scoreBreakdown: source?.scoreBreakdown || null,
        seed: source?.seed ?? null,
      };
      await SavedSimStore.put(record);
      hideSaveSimPanel();
      if (ui.saveSimName) ui.saveSimName.value = "";
      if (ui.matrixSaveName) ui.matrixSaveName.value = "";
      activeSavedLibraryId = record.id;
      activeSavedIterationId = null;
      activeVariantId = null;
      await refreshSavedSimulationLibrary();
      setSavedSimStatus(`Saved ${name} · ${SavedSimStore.categoryLabel(record.category)}`, "active");
      setMatrixStatus(`Saved ${name} · ${SavedSimStore.categoryLabel(record.category)}`, "active");
    } catch (err) {
      setSavedSimStatus(err.message || "Could not save this simulation.", "error");
      setMatrixStatus(err.message || "Could not save this simulation.", "error");
    } finally {
      if (ui.confirmSaveSim) ui.confirmSaveSim.disabled = false;
      if (ui.matrixConfirmSave) ui.matrixConfirmSave.disabled = false;
    }
  }

  async function restoreSavedGrid(record) {
    const slotIndex =
      Number.isInteger(record.gridSlotIndex) &&
      record.gridSlotIndex >= 0 &&
      record.gridSlotIndex < GRID_SLOT_COUNT
        ? record.gridSlotIndex
        : activeSlotIndex;
    if (record.grid && record.grid.buffer) {
      const file = new File([record.grid.buffer], record.grid.name || `grid-${slotIndex + 1}`, {
        type: record.grid.type || (record.grid.svgText ? "image/svg+xml" : "image/png"),
      });
      const ok = await importGridFile(file, slotIndex);
      if (!ok) throw new Error("Could not restore the saved grid.");
      return;
    }
    const entry = gridSlots[slotIndex]?.entry;
    if (entry) {
      if (!activateGrid(entry)) throw new Error("Could not open the saved grid slot.");
      return;
    }
    if (!gridSource) throw new Error("This save has no grid to restore.");
  }

  async function loadSavedLibrarySimulation(id) {
    if (!SavedSimStore) return;
    try {
      const record = await SavedSimStore.get(id);
      if (!record || !record.sim) {
        setSavedSimStatus("That saved simulation is missing.", "error");
        return;
      }
      applyParamsFromSnapshot(record.params || {});
      await restoreSavedGrid(record);
      applyDisplayFromExportMeta(record.display);
      if (record.display && record.display.exportTransparent != null && ui.exportTransparent) {
        ui.exportTransparent.checked = !!record.display.exportTransparent;
      }
      if (record.jitter != null) sim.jitter = record.jitter;
      applySimSnapshot(record.params, record.seeds || [], record.sim);
      playing = false;
      ui.play.textContent = "Grow";
      activeSavedLibraryId = record.id;
      activeSavedIterationId = null;
      activeVariantId = null;
      updatePlayState();
      updateIterationUI();
      updateVariantUI();
      renderSavedSimulationList();
      setSavedSimStatus(`Loaded ${record.name} · ${SavedSimStore.categoryLabel(record.category)}`, "active");
    } catch (err) {
      setSavedSimStatus(err.message || "Could not load that simulation.", "error");
    }
  }

  async function deleteSavedLibrarySimulation(id) {
    if (!SavedSimStore) return;
    if (!window.confirm("Delete this saved simulation?")) return;
    try {
      await SavedSimStore.remove(id);
      if (activeSavedLibraryId === id) activeSavedLibraryId = null;
      const url = savedSimThumbUrls.get(id);
      if (url) {
        URL.revokeObjectURL(url);
        savedSimThumbUrls.delete(id);
      }
      await refreshSavedSimulationLibrary();
      setSavedSimStatus("Deleted saved simulation", "active");
    } catch (err) {
      setSavedSimStatus(err.message || "Could not delete that simulation.", "error");
    }
  }

  function fitNodesToBox(flatNodes, size, pad) {
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
    if (!Number.isFinite(minX)) return null;
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const scale = Math.min((size - pad * 2) / w, (size - pad * 2) / h);
    return {
      scale,
      ox: (size - w * scale) / 2 - minX * scale,
      oy: (size - h * scale) / 2 - minY * scale,
    };
  }

  function drawNodesPreview(g, flatNodes, size, options = {}) {
    g.fillStyle = "#000";
    g.fillRect(0, 0, size, size);
    if (!flatNodes.length) return;
    const fit = fitNodesToBox(flatNodes, size, options.pad ?? 16);
    if (!fit) return;
    const { scale, ox, oy } = fit;
    const palette = displayColors();
    const identify = ui.identifyBranches.checked;
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const node of flatNodes) {
      if (node.parentIndex < 0) continue;
      const parent = flatNodes[node.parentIndex];
      if (!parent) continue;
      const order = node.order || 1;
      const parentThickness = parent.thickness != null ? parent.thickness : 1;
      g.strokeStyle = identify ? palette[order] || palette.branch : palette.branch;
      g.lineWidth = Math.max(0.6, branchStrokeWidth(parentThickness, order, identify) * (options.widthScale ?? 0.55));
      g.beginPath();
      g.moveTo(parent.x * scale + ox, parent.y * scale + oy);
      g.lineTo(node.x * scale + ox, node.y * scale + oy);
      g.stroke();
    }
    const links = options.mergeLinks || [];
    for (const link of links) {
      const a = flatNodes[link.a];
      const b = flatNodes[link.b];
      if (!a || !b) continue;
      const order = Math.min(a.order || 1, b.order || 1);
      const parentThickness = Math.max(a.thickness || 1, b.thickness || 1);
      g.strokeStyle = identify ? palette[order] || palette.branch : palette.branch;
      g.lineWidth = Math.max(
        0.6,
        branchStrokeWidth(parentThickness, order, identify) * (options.widthScale ?? 0.55)
      );
      g.beginPath();
      g.moveTo(a.x * scale + ox, a.y * scale + oy);
      g.lineTo(b.x * scale + ox, b.y * scale + oy);
      g.stroke();
    }
  }

  function makeVariantThumb(flatNodes, mergeLinks) {
    const thumbSize = 120;
    const c = document.createElement("canvas");
    c.width = thumbSize;
    c.height = thumbSize;
    drawNodesPreview(c.getContext("2d"), flatNodes, thumbSize, {
      pad: 10,
      widthScale: 0.4,
      mergeLinks,
    });
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
  }

  function clearVariants() {
    variants.length = 0;
    activeVariantId = null;
    setVariantStatus("Capture layouts to compare");
    updateVariantUI();
    updatePlayState();
  }

  function gridNameForToken(token) {
    const entry = gridLibrary.find((item) => item.id === token);
    return entry ? entry.name : "Unknown grid";
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
      mergeLinks: snap.mergeLinks || [],
      attractorsLeft: snap.attractorsLeft,
      originalAttractors: snap.originalAttractors || [],
      pathPoints: snap.pathPoints || [],
      obstacles: serializeObstacles(),
      thumbDataUrl: makeVariantThumb(snap.nodes, snap.mergeLinks),
    };
    variants.push(variant);
    activeVariantId = variant.id;
    activeSavedIterationId = null;
    setVariantStatus(`${variant.label} saved · gen ${variant.generation}`, "active");
    updateVariantUI();
    updateIterationUI();
    updatePlayState();
  }

  function deleteVariant(id) {
    const index = variants.findIndex((item) => item.id === id);
    if (index < 0) return;
    variants.splice(index, 1);
    if (activeVariantId === id) activeVariantId = null;
    setVariantStatus(variants.length ? `${variants.length} saved` : "Capture layouts to compare");
    updateVariantUI();
    updatePlayState();
  }

  function restoreVariant(variant) {
    if (variant.gridToken !== gridToken || !gridEntryExists(variant.gridToken)) {
      setVariantStatus("Grid changed — cannot load this variant.", "error");
      return false;
    }
    applySimSnapshot(variant.params, variant.seeds, {
      generation: variant.generation,
      nodes: variant.nodes,
      attractorsLeft: variant.attractorsLeft,
      originalAttractors: variant.originalAttractors || [],
      pathPoints: variant.pathPoints || [],
      mergeLinks: variant.mergeLinks || [],
      obstacles: variant.obstacles || [],
    });
    activeVariantId = variant.id;
    activeSavedIterationId = null;
    setVariantStatus(`Loaded ${variant.label} · gen ${variant.generation}`, "active");
    updateVariantUI();
    updateIterationUI();
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
    updateGridCycleUI();
    updateSeedUI();

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
    updateGridCycleUI();
    updateSeedUI();
  }

  function newAttempt() {
    if (!gridSource) return;
    activeVariantId = null;
    activeSavedIterationId = null;
    resetSim();
    setVariantStatus("New attempt — adjust seeds, then grow");
    updateVariantUI();
    updateIterationUI();
  }

  function setAppPage(page) {
    if (page === "matrix") appPage = "matrix";
    else if (page === "space3d") appPage = "space3d";
    else if (page === "grid3d") appPage = "grid3d";
    else appPage = "studio";
    const matrix = appPage === "matrix";
    const space3d = appPage === "space3d";
    const grid3d = appPage === "grid3d";
    if (ui.tabStudio) {
      ui.tabStudio.classList.toggle("active", appPage === "studio");
      ui.tabStudio.setAttribute("aria-selected", appPage === "studio" ? "true" : "false");
    }
    if (ui.tabMatrix) {
      ui.tabMatrix.classList.toggle("active", matrix);
      ui.tabMatrix.setAttribute("aria-selected", matrix ? "true" : "false");
    }
    if (ui.tabSpace3d) {
      ui.tabSpace3d.classList.toggle("active", space3d);
      ui.tabSpace3d.setAttribute("aria-selected", space3d ? "true" : "false");
    }
    if (ui.tabGrid3d) {
      ui.tabGrid3d.classList.toggle("active", grid3d);
      ui.tabGrid3d.setAttribute("aria-selected", grid3d ? "true" : "false");
    }
    if (ui.studioView) ui.studioView.classList.toggle("hidden", appPage !== "studio");
    if (ui.matrixView) ui.matrixView.classList.toggle("hidden", !matrix);
    if (ui.space3dView) ui.space3dView.classList.toggle("hidden", !space3d);
    if (ui.grid3dView) ui.grid3dView.classList.toggle("hidden", !grid3d);
    const appEl = document.querySelector(".app");
    if (appEl) {
      appEl.classList.toggle("matrix-mode", matrix);
      appEl.classList.toggle("space3d-mode", space3d);
      appEl.classList.toggle("grid3d-mode", grid3d);
    }
    if (space3dStudio) {
      if (space3d) space3dStudio.show();
      else space3dStudio.hide();
    }
    if (grid3dStudio) {
      if (grid3d) grid3dStudio.show();
      else grid3dStudio.hide();
    }
    if (matrix || grid3d || space3d) {
      playing = false;
      ui.play.textContent = "Grow";
    }
    if (matrix) {
      renderDescriptorButtons();
      renderMatrixGrid();
      updateMatrixGenerateState();
    }
    if (appPage === "studio") resize();
  }

  function setMatrixStatus(message, kind) {
    if (!ui.matrixStatus) return;
    ui.matrixStatus.textContent = message;
    ui.matrixStatus.classList.toggle("active", kind === "active");
    ui.matrixStatus.classList.toggle("error", kind === "error");
  }

  function matrixSlotCount() {
    return MatrixLib?.MATRIX_COUNT || 25;
  }

  function ensureMatrixCellSlots() {
    const n = matrixSlotCount();
    while (matrixCells.length < n) matrixCells.push(null);
    if (matrixCells.length > n) matrixCells.length = n;
  }

  function matrixIterationLabel(index) {
    return `Iteration ${String(index + 1).padStart(2, "0")}`;
  }

  function matrixDescriptorLabel(type, id) {
    const found = (MatrixLib?.descriptorsFor(type) || []).find((item) => item.id === id);
    return found ? found.label : id;
  }

  function renderDescriptorButtons() {
    if (!ui.matrixDescriptorRow || !MatrixLib) return;
    const list = MatrixLib.descriptorsFor(matrixType);
    if (!list.some((item) => item.id === matrixDescriptor)) {
      matrixDescriptor = list[0].id;
    }
    ui.matrixDescriptorRow.innerHTML = "";
    for (const item of list) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = item.id === matrixDescriptor ? "ghost active" : "ghost";
      btn.dataset.matrixDescriptor = item.id;
      btn.textContent = item.label;
      btn.addEventListener("click", () => {
        matrixDescriptor = item.id;
        renderDescriptorButtons();
      });
      ui.matrixDescriptorRow.appendChild(btn);
    }
    if (ui.matrixTypeRow) {
      ui.matrixTypeRow.querySelectorAll("[data-matrix-type]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.matrixType === matrixType);
      });
    }
  }

  function matrixHasCompleteSet() {
    const n = matrixSlotCount();
    if (matrixCells.length < n) return false;
    for (let i = 0; i < n; i++) {
      if (!matrixCells[i] || !matrixCells[i].sim) return false;
    }
    return true;
  }

  function revokeMatrixCellPreviewUrls() {
    for (const cell of matrixCells) {
      if (cell && cell.previewUrl) URL.revokeObjectURL(cell.previewUrl);
    }
  }

  function serializeMatrixCellForStore(cell) {
    if (!cell) return null;
    return {
      index: cell.index,
      label: cell.label,
      spatialType: cell.spatialType,
      descriptor: cell.descriptor,
      descriptorLabel: cell.descriptorLabel,
      descriptorScore: cell.descriptorScore,
      scoreBreakdown: cell.scoreBreakdown ? { ...cell.scoreBreakdown } : {},
      seed: cell.seed,
      params: cell.params,
      display: cell.display,
      jitter: cell.jitter,
      seeds: (cell.seeds || []).map((seed) => ({ x: seed.x, y: seed.y })),
      sim: cell.sim,
      grid: cell.grid,
      gridToken: cell.gridToken,
      thumbnail: cell.thumbnailBlob || null,
    };
  }

  function hydrateMatrixCellFromStore(stored, index) {
    let previewUrl = "";
    let thumbnailBlob = null;
    const thumb = stored.thumbnail;
    if (thumb instanceof Blob) {
      thumbnailBlob = thumb;
      previewUrl = URL.createObjectURL(thumb);
    } else if (thumb instanceof ArrayBuffer) {
      thumbnailBlob = new Blob([thumb], { type: "image/jpeg" });
      previewUrl = URL.createObjectURL(thumbnailBlob);
    }
    return {
      index: stored.index ?? index,
      label: stored.label || matrixIterationLabel(index),
      spatialType: stored.spatialType,
      descriptor: stored.descriptor,
      descriptorLabel: stored.descriptorLabel,
      descriptorScore: stored.descriptorScore,
      scoreBreakdown: stored.scoreBreakdown || {},
      seed: stored.seed,
      params: stored.params,
      display: stored.display,
      jitter: stored.jitter,
      seeds: stored.seeds || [],
      sim: stored.sim,
      grid: stored.grid,
      gridToken: stored.gridToken,
      previewUrl,
      thumbnailBlob,
    };
  }

  async function loadSavedMatrix(id) {
    if (!SavedMatrixStore) return;
    if (matrixGenerating || matrixExporting) return;
    try {
      const record = await SavedMatrixStore.get(id);
      const need = matrixSlotCount();
      if (!record || !Array.isArray(record.cells) || record.cells.length < need) {
        setSavedMatrixStatus("That saved matrix is incomplete or missing.", "error");
        return;
      }
      await restoreSavedGrid(record);
      matrixType = record.spatialType || "lobby";
      matrixDescriptor = record.descriptor || matrixDescriptor;
      if (ui.matrixIntensity) {
        ui.matrixIntensity.value = String(record.intensity ?? 50);
        if (ui.matrixIntensityVal) ui.matrixIntensityVal.textContent = ui.matrixIntensity.value;
      }
      if (ui.matrixVariation) {
        ui.matrixVariation.value = String(record.variation ?? 40);
        if (ui.matrixVariationVal) ui.matrixVariationVal.textContent = ui.matrixVariation.value;
      }
      renderDescriptorButtons();
      revokeMatrixCellPreviewUrls();
      ensureMatrixCellSlots();
      for (let i = 0; i < need; i++) {
        matrixCells[i] = hydrateMatrixCellFromStore(record.cells[i], i);
      }
      selectedMatrixIndex = 0;
      activeSavedMatrixId = record.id;
      if (ui.matrixSaveWholePanel) ui.matrixSaveWholePanel.classList.add("hidden");
      renderMatrixGrid();
      updateMatrixGenerateState();
      setAppPage("matrix");
      setMatrixStatus(`Opened ${record.name} · 25 iterations restored`, "active");
      setSavedMatrixStatus(`Opened ${record.name}`, "active");
      renderSavedMatrixList();
    } catch (err) {
      setSavedMatrixStatus(err.message || "Could not open that matrix.", "error");
      setMatrixStatus(err.message || "Could not open that matrix.", "error");
    }
  }

  function updateMatrixGenerateState() {
    const busy = matrixGenerating || matrixExporting || batchRunning;
    if (ui.generateMatrix) {
      ui.generateMatrix.disabled = !gridSource || busy;
    }
    const canExport = matrixHasCompleteSet() && !busy;
    if (ui.matrixSaveAllPng) ui.matrixSaveAllPng.disabled = !canExport;
    if (ui.matrixSaveAllSvg) ui.matrixSaveAllSvg.disabled = !canExport;
    if (ui.saveMatrix) ui.saveMatrix.disabled = !canExport;
    if (ui.tabStudio) ui.tabStudio.disabled = matrixGenerating || matrixExporting;
    if (ui.tabMatrix) ui.tabMatrix.disabled = matrixGenerating || matrixExporting;
    if (ui.tabSpace3d) ui.tabSpace3d.disabled = matrixGenerating || matrixExporting;
    if (ui.tabGrid3d) ui.tabGrid3d.disabled = matrixGenerating || matrixExporting;
  }

  function captureStudioSession() {
    return {
      params: readParamsFromUI(),
      display: readDisplayFromUI(),
      jitter: sim.jitter,
      seeds: seeds.map((seed) => ({ x: seed.x, y: seed.y })),
      sim: serializeSimSnapshot(),
    };
  }

  function restoreStudioSession(session) {
    if (!session) return;
    applyDisplayFromExportMeta(session.display);
    if (session.display && session.display.exportTransparent != null && ui.exportTransparent) {
      ui.exportTransparent.checked = !!session.display.exportTransparent;
    }
    applyParamsFromSnapshot(session.params);
    gridKey = "";
    customGrowthField = false;
    if (gridSource && width && height) rebuildGrid();
    sim.jitter = session.jitter;
    applySimSnapshot(session.params, session.seeds || [], session.sim);
  }

  function matrixSiteBox() {
    if (gridLayout && gridLayout.w > 0) return gridLayout;
    return { x: 0, y: 0, w: width || 1, h: height || 1 };
  }

  function applyCandidateRun(plan) {
    sim.attractionRadius = Number(plan.params.influence);
    sim.killDistance = Number(plan.params.kill);
    sim.stepSize = Number(plan.params.stepSize);
    sim.growthDirection = Number(plan.params.growthDirection) || 0;
    sim.mergeBranches = !!plan.params.mergeBranches;
    sim.mergeDistance = Math.max(0, Number(plan.params.mergeDistance) || 0);
    sim.jitter = plan.jitter;
    restoreObstacles([]);
    sim.circles = [];
    customGrowthField = true;
    growthAttractors = plan.attractors || [];
    growthPathPoints = tracedGridPathPoints || currentPathPoints();
    sim.clearAll();
    sim.pathIndex = growthPathPoints && growthPathPoints.length
      ? buildPathIndex(growthPathPoints, sim.stepSize)
      : null;
    if (growthAttractors.length) sim.seedAttractorField(growthAttractors);
    seeds.length = 0;
    nextSeedId = 1;
    selectedSeedId = null;
    for (const pt of plan.roots || []) {
      const seed = { id: nextSeedId++, x: pt.x, y: pt.y };
      seeds.push(seed);
      if (sim.pathIndex) sim.addSeed(seed.x, seed.y);
    }
    flashes.length = 0;
    playing = false;
    const cap = Number(plan.params.iterationsCap) || 250;
    while (sim.generation < cap && sim.step()) {
      /* run */
    }
  }

  function applyMatrixIterationToSim(cell) {
    applyDisplayFromExportMeta(cell.display);
    if (cell.display && cell.display.exportTransparent != null && ui.exportTransparent) {
      ui.exportTransparent.checked = !!cell.display.exportTransparent;
    }
    sim.jitter = cell.jitter ?? 0;
    applySimSnapshot(cell.params, cell.seeds || [], cell.sim);
  }

  function matrixScoreLabel(cell) {
    const n = Number(cell.descriptorScore);
    const value = Number.isFinite(n) ? `${Math.round(n)}%` : "—";
    return `${cell.descriptorLabel} — ${value}`;
  }

  function matrixScoreBreakdownHtml(cell) {
    const parts = cell.scoreBreakdown || {};
    const keys = Object.keys(parts);
    if (!keys.length) return "";
    return keys
      .map((key) => `${key}: ${Math.round(Number(parts[key]) || 0)}%`)
      .join("<br>");
  }

  function matrixCellMetaHtml(cell) {
    return matrixScoreLabel(cell);
  }

  function renderMatrixGrid() {
    if (!ui.matrixGrid) return;
    ensureMatrixCellSlots();
    ui.matrixGrid.innerHTML = "";
    for (let i = 0; i < matrixSlotCount(); i++) {
      const cell = matrixCells[i];
      const item = document.createElement("article");
      item.className = `matrix-cell${cell ? "" : " empty"}${i === selectedMatrixIndex ? " active" : ""}`;
      const title = document.createElement("strong");
      title.className = "matrix-cell-title";
      title.textContent = matrixIterationLabel(i);
      item.appendChild(title);
      if (cell && cell.previewUrl) {
        const img = document.createElement("img");
        img.className = "matrix-cell-preview";
        img.alt = "";
        img.src = cell.previewUrl;
        item.appendChild(img);
        const meta = document.createElement("div");
        meta.className = "matrix-cell-meta";
        meta.innerHTML = matrixCellMetaHtml(cell);
        item.appendChild(meta);
        item.addEventListener("click", () => selectMatrixCell(i));
      } else {
        const ph = document.createElement("div");
        ph.className = "matrix-cell-preview placeholder";
        item.appendChild(ph);
        const meta = document.createElement("div");
        meta.className = "matrix-cell-meta";
        meta.textContent = "Not generated";
        item.appendChild(meta);
      }
      ui.matrixGrid.appendChild(item);
    }
    renderMatrixDetail();
  }

  function renderMatrixDetail() {
    const cell = selectedMatrixIndex >= 0 ? matrixCells[selectedMatrixIndex] : null;
    const empty = ui.matrixDetail?.querySelector(".matrix-detail-empty");
    if (!cell) {
      if (empty) empty.classList.remove("hidden");
      if (ui.matrixDetailBody) ui.matrixDetailBody.classList.add("hidden");
      return;
    }
    if (empty) empty.classList.add("hidden");
    if (ui.matrixDetailBody) ui.matrixDetailBody.classList.remove("hidden");
    if (ui.matrixDetailTitle) ui.matrixDetailTitle.textContent = cell.label;
    if (ui.matrixDetailDescriptor) ui.matrixDetailDescriptor.textContent = matrixScoreLabel(cell);
    if (ui.matrixDetailThumb && cell.previewUrl) ui.matrixDetailThumb.src = cell.previewUrl;
    if (ui.matrixDetailMeta) {
      const breakdown = matrixScoreBreakdownHtml(cell);
      ui.matrixDetailMeta.innerHTML = `${breakdown}${breakdown ? "<br>" : ""}Seed: ${cell.seed}`;
    }
  }

  function selectMatrixCell(index) {
    selectedMatrixIndex = index;
    if (ui.matrixSavePanel) ui.matrixSavePanel.classList.add("hidden");
    renderMatrixGrid();
  }

  async function generateDescriptorMatrix() {
    if (!MatrixLib) {
      setMatrixStatus("Descriptor Matrix is unavailable.", "error");
      return;
    }
    if (!gridSource || !gridLayout) {
      setMatrixStatus("Import a grid in Studio before generating.", "error");
      return;
    }
    if (matrixGenerating || matrixExporting || batchRunning) return;
    matrixGenerating = true;
    activeSavedMatrixId = null;
    playing = false;
    ui.play.textContent = "Grow";
    updateMatrixGenerateState();
    updatePlayState();

    const intensity = Number(ui.matrixIntensity?.value ?? 50);
    const variation = Number(ui.matrixVariation?.value ?? 40);
    const masterSeed = (Date.now() ^ ((Math.random() * 0xffffffff) | 0)) >>> 0;
    const session = captureStudioSession();
    const grid = await captureCurrentGridPayload();
    const descriptorLabel = matrixDescriptorLabel(matrixType, matrixDescriptor);
    const site = matrixSiteBox();
    const path = tracedGridPathPoints || currentPathPoints();
    const attractorPool = tracedGridPoints || currentAttractors();
    const poolSize = MatrixLib.CANDIDATE_COUNT || 100;
    const keep = MatrixLib.MATRIX_COUNT || 25;
    ensureMatrixCellSlots();

    try {
      if (!path || !path.length || !attractorPool || !attractorPool.length) {
        throw new Error("Import a grid in Studio before generating.");
      }
      const pool = [];
      for (let i = 0; i < poolSize; i++) {
        if (i % 5 === 0 || i === poolSize - 1) {
          setMatrixStatus(`Evaluating candidate ${i + 1} / ${poolSize}…`, "active");
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        const seed = MatrixLib.hashSeed(masterSeed, i);
        const rng = MatrixLib.createRng(seed);
        const plan = MatrixLib.planCandidate({
          seed,
          index: i,
          variation,
          baseParams: session.params,
          site,
          path,
          attractorPool,
          rng,
        });
        if (!plan.attractors.length) continue;
        applyCandidateRun(plan);
        const segments = MatrixLib.collectSegments(sim.nodes, sim.mergeLinks);
        if (segments.length < 8) continue;
        const analysis = MatrixLib.analyzeSection(segments, site, { roots: plan.roots });
        const scored = MatrixLib.scoreDescriptor(
          matrixType,
          matrixDescriptor,
          analysis,
          intensity
        );
        pool.push({
          plan,
          seed,
          score: scored.score,
          breakdown: scored.breakdown,
          fingerprint: analysis.fingerprint,
          jitter: sim.jitter,
          seeds: seeds.map((item) => ({ x: item.x, y: item.y })),
          sim: serializeSimSnapshot(),
        });
      }
      pool.sort((a, b) => b.score - a.score || a.seed - b.seed);
      const picked = MatrixLib.selectDiverse(pool, keep);
      if (!picked.length) throw new Error("No scored candidates were produced.");
      setMatrixStatus(`Selecting ${picked.length} diverse results…`, "active");
      await new Promise((resolve) => requestAnimationFrame(resolve));
      for (let i = 0; i < keep; i++) {
        if (matrixCells[i] && matrixCells[i].previewUrl) {
          URL.revokeObjectURL(matrixCells[i].previewUrl);
        }
        matrixCells[i] = null;
      }
      for (let i = 0; i < picked.length; i++) {
        const item = picked[i];
        applySimSnapshot(item.plan.params, item.seeds, item.sim);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        let previewUrl = "";
        let thumbnailBlob = null;
        try {
          thumbnailBlob = await makeSavedSimulationThumb();
          previewUrl = URL.createObjectURL(thumbnailBlob);
        } catch (_) {
          previewUrl = "";
        }
        matrixCells[i] = {
          index: i,
          label: matrixIterationLabel(i),
          spatialType: matrixType,
          descriptor: matrixDescriptor,
          descriptorLabel,
          descriptorScore: item.score,
          scoreBreakdown: item.breakdown,
          seed: item.seed,
          params: { ...item.plan.params },
          display: session.display || readDisplayFromUI(),
          jitter: item.jitter,
          seeds: item.seeds,
          sim: item.sim,
          grid,
          gridToken,
          previewUrl,
          thumbnailBlob,
        };
      }
      selectedMatrixIndex = 0;
      renderMatrixGrid();
      const top = picked[0] ? Math.round(picked[0].score) : 0;
      setMatrixStatus(
        `${descriptorLabel} · ${picked.length} of ${pool.length} candidates · top ${top}%`,
        "active"
      );
    } catch (err) {
      setMatrixStatus(err.message || "Could not generate the matrix.", "error");
    } finally {
      restoreStudioSession(session);
      matrixGenerating = false;
      updateMatrixGenerateState();
      updatePlayState();
    }
  }

  function openMatrixCellInStudio() {
    const cell = matrixCells[selectedMatrixIndex];
    if (!cell) return;
    applyMatrixIterationToSim(cell);
    setAppPage("studio");
    setSavedSimStatus(`Loaded ${cell.label} from Descriptor Matrix`, "active");
  }

  async function exportMatrixCellPng() {
    const cell = matrixCells[selectedMatrixIndex];
    if (!cell) return;
    const session = captureStudioSession();
    const previousSelected = selectedSeedId;
    try {
      applyMatrixIterationToSim(cell);
      selectedSeedId = null;
      const blob = await capturePngSnapshotBlob(matrixCaptionMeta(cell));
      if (!blob) {
        setMatrixStatus("Could not export PNG.", "error");
        return;
      }
      const url = URL.createObjectURL(blob);
      triggerDownload(`${matrixExportStem(cell)}.png`, url);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setMatrixStatus(`Exported PNG for ${cell.label}`, "active");
    } finally {
      selectedSeedId = previousSelected;
      restoreStudioSession(session);
    }
  }

  async function downloadZipArchive(filename, files) {
    if (!window.JSZip) {
      setMatrixStatus("ZIP export needs JSZip, which did not load.", "error");
      return false;
    }
    const zip = new window.JSZip();
    for (const file of files) zip.file(file.name, file.data);
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    triggerDownload(filename, url);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  }

  async function exportMatrixBatch(kind) {
    if (!matrixHasCompleteSet()) {
      setMatrixStatus("Generate a complete 5 × 5 matrix first.", "error");
      return;
    }
    if (matrixGenerating || matrixExporting || batchRunning) return;
    const ext = kind === "svg" ? "svg" : "png";
    const cells = matrixCells.slice();
    const prefix = matrixExportPrefix(cells[0]);
    const zipName = `${prefix}_${ext.toUpperCase()}.zip`;
    matrixExporting = true;
    updateMatrixGenerateState();
    const session = captureStudioSession();
    const previousSelected = selectedSeedId;
    const files = [];
    try {
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        setMatrixStatus(`Exporting ${cell.label} (${i + 1}/${cells.length})…`, "active");
        await new Promise((resolve) => requestAnimationFrame(resolve));
        applyMatrixIterationToSim(cell);
        selectedSeedId = null;
        const extra = matrixCaptionMeta(cell);
        const name = `${matrixExportStem(cell)}.${ext}`;
        if (ext === "png") {
          const blob = await capturePngSnapshotBlob(extra);
          if (!blob) throw new Error(`Could not encode PNG for ${cell.label}.`);
          files.push({ name, data: blob });
        } else {
          const transparentBackground = !!(ui.exportTransparent && ui.exportTransparent.checked);
          const { svg } = buildStudioSvg(transparentBackground, {
            fitSite: true,
            extraMeta: extra,
          });
          files.push({ name, data: svg });
        }
      }
      const ok = await downloadZipArchive(zipName, files);
      if (ok) setMatrixStatus(`Saved ${zipName}`, "active");
    } catch (err) {
      setMatrixStatus(err.message || "Could not export the matrix.", "error");
    } finally {
      selectedSeedId = previousSelected;
      restoreStudioSession(session);
      matrixExporting = false;
      updateMatrixGenerateState();
    }
  }

  async function openMatrixSavePanel() {
    const cell = matrixCells[selectedMatrixIndex];
    if (!cell) return;
    if (!SavedSimStore) {
      setMatrixStatus("Saved Simulations are unavailable in this browser.", "error");
      return;
    }
    pendingSavePayload = {
      grid: cell.grid,
      params: cell.params,
      display: cell.display,
      jitter: cell.jitter,
      seeds: cell.seeds,
      sim: cell.sim,
      thumbnailBlob: cell.thumbnailBlob,
      thumbnail: cell.thumbnailBlob,
      spatialType: cell.spatialType,
      descriptor: cell.descriptor,
      descriptorLabel: cell.descriptorLabel,
      descriptorScore: cell.descriptorScore,
      scoreBreakdown: cell.scoreBreakdown,
      seed: cell.seed,
    };
    setSavedSimCategory(cell.spatialType);
    if (ui.matrixSaveCats) {
      ui.matrixSaveCats.querySelectorAll("[data-sim-cat]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.simCat === savedSimCategory);
      });
    }
    try {
      const names = await SavedSimStore.list();
      if (ui.matrixSaveName) {
        ui.matrixSaveName.value = cell.label;
        ui.matrixSaveName.placeholder = SavedSimStore.nextIterationName(names);
      }
    } catch (_) {
      if (ui.matrixSaveName) ui.matrixSaveName.value = cell.label;
    }
    if (ui.matrixSavePanel) ui.matrixSavePanel.classList.remove("hidden");
    if (ui.matrixSaveName) ui.matrixSaveName.focus();
  }

  function updatePlayState() {
    const path = currentPathPoints();
    const attractors = currentAttractors();
    const ready = !!(attractors && attractors.length && path && path.length);
    ui.play.disabled = !ready || batchRunning || matrixGenerating || matrixExporting;
    ui.newAttempt.disabled = !ready || batchRunning;
    ui.generateVariants.disabled = !ready || batchRunning;
    ui.captureVariant.disabled = !ready || batchRunning || !canCaptureVariant();
    if (ui.saveIteration) ui.saveIteration.disabled = !ready || batchRunning || !canSaveIteration();
    if (ui.saveSvg) ui.saveSvg.disabled = !ready || batchRunning || !canSaveIteration();
    if (ui.saveSimulation) ui.saveSimulation.disabled = !gridSource || batchRunning;
    ui.clearVariants.disabled = !variants.some((v) => v.gridToken === gridToken) || batchRunning;
    updateIterationUI();
    updateMatrixGenerateState();
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
    customGrowthField = false;
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
    gridSlots = createEmptyGridSlots();
    gridLibrary.length = 0;
    activeGridId = null;
    activeSlotIndex = 0;
    pendingSlotIndex = 0;
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
    customGrowthField = false;
    gridShapes = null;
    gridSvgText = null;
    gridKey = "";
    gridToken = 0;
    ui.gridFile.value = "";
    setGridStatus("Import a grid to begin");
    clearVariants();
    updateGridCycleUI();
    resetSim();
    clearPersistedGridSlots();
    try {
      localStorage.removeItem(ACTIVE_SLOT_STORAGE_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  async function syncSharedCustomGridFromStudioUpload(file, svgText) {
    if (!window.D7CustomGrid || !file) return;
    try {
      await window.D7CustomGrid.init();
      const name = file.name || "Custom grid";
      const lower = name.toLowerCase();
      if (svgText || lower.endsWith(".svg")) {
        const text = svgText || (await file.text());
        await window.D7CustomGrid.importSvgTextAndActivate(text, name, 1);
      }
    } catch (err) {
      console.warn("Could not sync site drawing to shared 3D grid", err);
    }
  }

  async function importGridFile(file, slotIndex = pendingSlotIndex) {
    if (!file) return false;
    if (slotIndex == null || slotIndex < 0 || slotIndex >= GRID_SLOT_COUNT) {
      const empty = firstEmptyGridSlotIndex();
      slotIndex = empty >= 0 ? empty : activeSlotIndex;
    }
    if (!isGridFile(file)) {
      setGridStatus("Use a PNG, JPG, or SVG file.", "error");
      return false;
    }
    setGridStatus(`Reading ${file.name}…`);
    try {
      const { img, svgText } = await imageFromFile(file);
      const slot = gridSlots[slotIndex];
      const previous = slot.entry;
      const entry = {
        id: nextGridId++,
        name: file.name,
        source: img,
        svgText,
        kind: "file",
        slotIndex,
      };
      if (previous) {
        const libIndex = gridLibrary.findIndex((item) => item.id === previous.id);
        if (libIndex >= 0) gridLibrary.splice(libIndex, 1);
      }
      slot.entry = entry;
      gridLibrary.push(entry);
      if (!activateGrid(entry)) {
        gridLibrary.pop();
        slot.entry = previous;
        if (previous && !gridLibrary.some((item) => item.id === previous.id)) {
          gridLibrary.push(previous);
        }
        nextGridId -= 1;
        if (previous) activateGrid(previous);
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
      if (previous) removeVariantsForGrid(previous.id);
      await persistGridSlot(slotIndex, file, entry);
      await syncSharedCustomGridFromStudioUpload(file, svgText);
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
      sim.seedAttractorField(attractors);
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
    tryActivateRestoredGrid();
  }

  function applyViewTransform(targetCtx = ctx, camera = view, pixelRatio = dpr) {
    targetCtx.setTransform(
      pixelRatio * camera.scale,
      0,
      0,
      pixelRatio * camera.scale,
      pixelRatio * camera.x,
      pixelRatio * camera.y
    );
  }

  function obstacleStrokeFill(obs, selected) {
    const repel = sim.obstacleMode === "repel";
    if (selected) {
      return {
        stroke: "rgba(232, 213, 163, 0.95)",
        fill: "rgba(232, 213, 163, 0.16)",
        line: 2.2,
      };
    }
    if (repel) {
      return {
        stroke: "rgba(120, 176, 232, 0.92)",
        fill: "rgba(120, 176, 232, 0.12)",
        line: 1.6,
      };
    }
    return {
      stroke: "rgba(232, 140, 96, 0.92)",
      fill: "rgba(232, 140, 96, 0.12)",
      line: 1.6,
    };
  }

  function drawOneObstacle(targetCtx, obs, selected) {
    if (!obs) return;
    const style = obstacleStrokeFill(obs, selected);
    targetCtx.save();
    targetCtx.fillStyle = style.fill;
    targetCtx.strokeStyle = style.stroke;
    targetCtx.lineWidth = style.line;
    if (obs.type === "circle") {
      targetCtx.beginPath();
      targetCtx.arc(obs.x, obs.y, obs.r, 0, Math.PI * 2);
      targetCtx.fill();
      targetCtx.stroke();
      if (sim.obstacleMode === "repel" && sim.repulsionDistance > 0) {
        targetCtx.setLineDash([7, 5]);
        targetCtx.globalAlpha = 0.55;
        targetCtx.beginPath();
        targetCtx.arc(obs.x, obs.y, obs.r + sim.repulsionDistance, 0, Math.PI * 2);
        targetCtx.stroke();
        targetCtx.setLineDash([]);
        targetCtx.globalAlpha = 1;
      }
    } else if (obs.type === "rect") {
      const x = Math.min(obs.x, obs.x + obs.w);
      const y = Math.min(obs.y, obs.y + obs.h);
      const w = Math.abs(obs.w);
      const h = Math.abs(obs.h);
      targetCtx.beginPath();
      targetCtx.rect(x, y, w, h);
      targetCtx.fill();
      targetCtx.stroke();
      if (sim.obstacleMode === "repel" && sim.repulsionDistance > 0) {
        const pad = sim.repulsionDistance;
        targetCtx.setLineDash([7, 5]);
        targetCtx.globalAlpha = 0.55;
        targetCtx.strokeRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
        targetCtx.setLineDash([]);
        targetCtx.globalAlpha = 1;
      }
    } else if (obs.type === "polygon" && obs.points && obs.points.length) {
      const pts = obs.points;
      const drafting = !!obs.draft;
      targetCtx.beginPath();
      targetCtx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) targetCtx.lineTo(pts[i].x, pts[i].y);
      if (obs.hover) targetCtx.lineTo(obs.hover.x, obs.hover.y);
      if (!drafting && pts.length >= 3) {
        targetCtx.closePath();
        targetCtx.fill();
      }
      targetCtx.stroke();
      if (drafting) {
        targetCtx.fillStyle = style.stroke;
        for (const p of pts) {
          targetCtx.beginPath();
          targetCtx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
          targetCtx.fill();
        }
      }
    }
    if (selected && obs.type === "rect") {
      const box = obstacleAabb(obs);
      const corners = [
        [box.minX, box.minY],
        [box.maxX, box.minY],
        [box.maxX, box.maxY],
        [box.minX, box.maxY],
      ];
      targetCtx.fillStyle = "#fff";
      for (const [cx, cy] of corners) {
        targetCtx.fillRect(cx - 3, cy - 3, 6, 6);
      }
    }
    targetCtx.restore();
  }

  function drawObstacleShapes(targetCtx, list, options = {}) {
    for (const obs of list) {
      if (!obs) continue;
      const selected =
        !options.hideEditingChrome && obs.id != null && obs.id === selectedObstacleId;
      drawOneObstacle(targetCtx, obs, selected);
    }
  }

  function displayAttractors() {
    if (sim.originalAttractors && sim.originalAttractors.length) return sim.originalAttractors;
    return sim.attractors || [];
  }

  function renderStudioFrame(targetCtx, options = {}) {
    const transparent = !!options.transparentBackground;
    const outW = options.outputWidth ?? width;
    const outH = options.outputHeight ?? height;
    const camera = options.camera || view;
    const pixelRatio = options.pixelRatio ?? dpr;
    const hideChrome = !!options.hideEditingChrome;
    if (!transparent) {
      targetCtx.fillStyle = "#000";
      targetCtx.fillRect(0, 0, outW, outH);
    }

    targetCtx.save();
    if (options.clipToOutput) {
      targetCtx.beginPath();
      targetCtx.rect(0, 0, outW, outH);
      targetCtx.clip();
    }
    applyViewTransform(targetCtx, camera, pixelRatio);

    if (!transparent && !gridSource && !hideChrome) {
      targetCtx.fillStyle = "#dce7f0";
      for (const star of stars) {
        targetCtx.globalAlpha = star.a;
        targetCtx.beginPath();
        targetCtx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        targetCtx.fill();
      }
      targetCtx.globalAlpha = 1;
    }

    const gridAlpha = Number(ui.gridOpacity?.value ?? DEFAULT_DISPLAY_SETTINGS.gridOpacity) / 100;

    if (gridSource && imageLayout) {
      targetCtx.save();
      targetCtx.globalAlpha = Math.max(0, Math.min(1, gridAlpha));
      targetCtx.drawImage(
        gridSource,
        imageLayout.x,
        imageLayout.y,
        imageLayout.w,
        imageLayout.h
      );
      targetCtx.restore();
    }

    if (!transparent && ui.showVoidMask.checked && gridLayout) {
      targetCtx.fillStyle = "rgba(4, 6, 10, 0.72)";
      targetCtx.fillRect(gridLayout.x, gridLayout.y, gridLayout.w, gridLayout.h);
    }

    if (gridOverlay && imageLayout) {
      targetCtx.save();
      targetCtx.globalAlpha = Math.max(0, Math.min(1, gridAlpha * 0.8));
      targetCtx.drawImage(
        gridOverlay,
        imageLayout.x,
        imageLayout.y,
        imageLayout.w,
        imageLayout.h
      );
      targetCtx.restore();
    }

    if (!options.hideSiteBoundary && gridLayout && gridSource) {
      targetCtx.strokeStyle = "rgba(232, 213, 163, 0.85)";
      targetCtx.lineWidth = 2;
      targetCtx.setLineDash([10, 6]);
      targetCtx.strokeRect(gridLayout.x, gridLayout.y, gridLayout.w, gridLayout.h);
      targetCtx.setLineDash([]);
      targetCtx.font = "12px system-ui, sans-serif";
      targetCtx.fillStyle = "rgba(232, 213, 163, 0.9)";
      targetCtx.fillText(`${SITE_FEET}' × ${SITE_FEET}'`, gridLayout.x + 6, gridLayout.y + 16);
    }

    if (gridShapes && gridShapes.rectangles.length) {
      targetCtx.strokeStyle = "rgba(232, 213, 163, 0.75)";
      targetCtx.lineWidth = 1.5;
      targetCtx.setLineDash([7, 5]);
      for (const rect of gridShapes.rectangles) {
        targetCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      }
      targetCtx.setLineDash([]);
    }

    targetCtx.strokeStyle = "rgba(232, 213, 163, 0.9)";
    targetCtx.lineWidth = 1.5;
    const gridCircles = sim.circles || [];
    for (const circle of gridCircles) {
      targetCtx.beginPath();
      targetCtx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
      targetCtx.stroke();
    }
    drawObstacleShapes(
      targetCtx,
      hideChrome || options.hideDraft ? obstacles : obstacles.concat(obstacleDraft ? [obstacleDraft] : []),
      { hideEditingChrome: hideChrome }
    );

    const attractorR = Math.max(0.2, Number(ui.attractorSize?.value ?? DEFAULT_DISPLAY_SETTINGS.attractorSize));
    const palette = displayColors();
    if (
      !options.hideInfluencePreview &&
      ui.showInfluenceRadius?.checked &&
      sim.attractors.length
    ) {
      const radius = Number(ui.influence?.value ?? sim.attractionRadius);
      const { r, g, b } = hexToRgb(palette.attractor);
      const zoom = Math.max(0.25, camera.scale);
      targetCtx.save();
      targetCtx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.38)`;
      targetCtx.lineWidth = Math.max(0.5, 1 / zoom);
      targetCtx.setLineDash([6 / zoom, 5 / zoom]);
      for (const p of sim.attractors) {
        targetCtx.beginPath();
        targetCtx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        targetCtx.stroke();
      }
      targetCtx.restore();
    }
    const field = displayAttractors();
    targetCtx.fillStyle = rgbaFromHex(palette.attractor, 0.82);
    targetCtx.strokeStyle = rgbaFromHex(palette.attractor, 1);
    targetCtx.lineWidth = attractorR >= 2 ? 1.1 : 0.7;
    for (const p of field) {
      targetCtx.beginPath();
      targetCtx.arc(p.x, p.y, attractorR, 0, Math.PI * 2);
      targetCtx.fill();
      targetCtx.stroke();
    }

    targetCtx.lineCap = "round";
    targetCtx.lineJoin = "round";
    const identify = ui.identifyBranches.checked;
    const visible = {
      1: ui.showPrimary.checked,
      2: ui.showSecondary.checked,
      3: ui.showTertiary.checked,
    };
    const drawOrder = identify ? [3, 2, 1] : [0];
    for (const rank of drawOrder) {
      if (identify && !visible[rank]) continue;
      targetCtx.strokeStyle = identify ? palette[rank] : palette.branch;
      for (const node of sim.nodes) {
        if (!node.parent) continue;
        const order = node.order || 1;
        if (identify && order !== rank) continue;
        const thick = branchStrokeWidth(node.parent.thickness, order, identify);
        targetCtx.lineWidth = thick;
        targetCtx.beginPath();
        targetCtx.moveTo(node.parent.pos.x, node.parent.pos.y);
        targetCtx.lineTo(node.pos.x, node.pos.y);
        targetCtx.stroke();
      }
    }

    if (sim.mergeLinks && sim.mergeLinks.length) {
      targetCtx.strokeStyle = identify ? palette[1] : palette.branch;
      for (const link of sim.mergeLinks) {
        if (!link.a || !link.b) continue;
        const order = Math.min(link.a.order || 1, link.b.order || 1);
        if (identify && !visible[order]) continue;
        targetCtx.strokeStyle = identify ? palette[order] || palette.branch : palette.branch;
        const thick = branchStrokeWidth(
          Math.max(link.a.thickness || 1, link.b.thickness || 1),
          order,
          identify
        );
        targetCtx.lineWidth = thick;
        targetCtx.beginPath();
        targetCtx.moveTo(link.a.pos.x, link.a.pos.y);
        targetCtx.lineTo(link.b.pos.x, link.b.pos.y);
        targetCtx.stroke();
      }
    }

    for (const seed of seeds) {
      const selected = !hideChrome && seed.id === selectedSeedId;
      if (selected) {
        targetCtx.beginPath();
        targetCtx.strokeStyle = "rgba(255, 255, 255, 0.35)";
        targetCtx.lineWidth = 1.2;
        targetCtx.setLineDash([4, 3]);
        targetCtx.arc(seed.x, seed.y, 16, 0, Math.PI * 2);
        targetCtx.stroke();
        targetCtx.setLineDash([]);
        targetCtx.beginPath();
        targetCtx.strokeStyle = "#ffffff";
        targetCtx.lineWidth = 2.4;
        targetCtx.arc(seed.x, seed.y, 10, 0, Math.PI * 2);
        targetCtx.stroke();
      }
      targetCtx.beginPath();
      targetCtx.fillStyle = selected ? "#ffffff" : "#e8d5a3";
      targetCtx.arc(seed.x, seed.y, selected ? 5 : 3.4, 0, Math.PI * 2);
      targetCtx.fill();
    }
    for (const node of sim.nodes) {
      if (node.parent) continue;
      if (seeds.some((seed) => Math.hypot(seed.x - node.pos.x, seed.y - node.pos.y) < 3)) continue;
      targetCtx.beginPath();
      targetCtx.arc(node.pos.x, node.pos.y, 3.4, 0, Math.PI * 2);
      targetCtx.fill();
    }

    if (!hideChrome) {
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        targetCtx.beginPath();
        targetCtx.fillStyle = `rgba(232, 213, 163, ${0.35 * f.life})`;
        targetCtx.arc(f.x, f.y, 4 + (1 - f.life) * 8, 0, Math.PI * 2);
        targetCtx.fill();
      }
    }

    targetCtx.restore();
  }

  function tickFlashes() {
    for (let i = flashes.length - 1; i >= 0; i--) {
      flashes[i].life -= 0.045;
      if (flashes[i].life <= 0) flashes.splice(i, 1);
    }
  }

  const EXPORT_CAPTION_HEIGHT = 72;

  function exportFileBaseName() {
    const raw = (gridName || "studio").replace(/\.[^.]+$/, "");
    const safe = raw.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
    return safe || "studio";
  }

  function sanitizeExportToken(value) {
    return (
      String(value || "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^A-Za-z0-9._-]+/g, "")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "") || "item"
    );
  }

  function matrixTypeLabel(type) {
    const found = (MatrixLib?.TYPES || []).find((item) => item.id === type);
    return found ? found.label : type || "Lobby";
  }

  function matrixExportStem(cell) {
    const type = sanitizeExportToken(matrixTypeLabel(cell.spatialType));
    const descriptor = sanitizeExportToken(cell.descriptorLabel || cell.descriptor);
    const n = String((cell.index ?? 0) + 1).padStart(2, "0");
    return `${type}_${descriptor}_${n}`;
  }

  function matrixExportPrefix(cell) {
    const type = sanitizeExportToken(matrixTypeLabel(cell.spatialType));
    const descriptor = sanitizeExportToken(cell.descriptorLabel || cell.descriptor);
    return `${type}_${descriptor}`;
  }

  function matrixCaptionMeta(cell) {
    if (!cell) return null;
    return {
      matrix: {
        typeLabel: matrixTypeLabel(cell.spatialType),
        descriptorLabel: cell.descriptorLabel || cell.descriptor || "",
        score: cell.descriptorScore,
        iteration: String((cell.index ?? 0) + 1).padStart(2, "0"),
      },
    };
  }

  function exportCaptionText(meta) {
    const params = meta.params || {};
    const simSnap = meta.sim || {};
    const gridLabel = meta.gridName || "untitled grid";
    const line1 = `${gridLabel}  ·  ${formatExportTimestamp(meta.exportedAt)}`;
    let line2 = `gen ${simSnap.generation ?? 0}  ·  attractors ${
      simSnap.attractorsLeft ? simSnap.attractorsLeft.length : 0
    }  ·  seeds ${(meta.seeds || []).length}`;
    if (meta.matrix) {
      const score = Number.isFinite(Number(meta.matrix.score))
        ? `${Math.round(Number(meta.matrix.score))}%`
        : "—";
      line2 += `  ·  Type: ${meta.matrix.typeLabel}  ·  Descriptor: ${meta.matrix.descriptorLabel}  ·  Descriptor Score: ${score}  ·  Iteration: ${meta.matrix.iteration}`;
    }
    const line3 = `count ${params.count}  ·  influence ${params.influence}  ·  kill ${params.kill}  ·  step ${params.stepSize}  ·  dir ${Number(params.growthDirection ?? 0).toFixed(2)}  ·  merge ${params.mergeBranches ? "on" : "off"}/${Number(params.mergeDistance ?? 20).toFixed(0)}  ·  obs ${params.obstacleMode === "repel" ? "repel" : "hard"}/${Number(params.repulsionDistance ?? 40).toFixed(0)}/${Number(params.repulsionStrength ?? 1.2).toFixed(1)}  ·  cap ${params.iterationsCap}  ·  thick ${Number(ui.branchThickness?.value ?? 1).toFixed(1)}`;
    return { line1, line2, line3 };
  }

  function formatExportTimestamp(iso) {
    return String(iso || "").replace("T", " ").slice(0, 19);
  }

  const EXPORT_CAPTION_FONT = '300 12px "Arkitech Light"';

  function ensureExportCaptionFont() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return document.fonts
      .load(EXPORT_CAPTION_FONT)
      .then(() => document.fonts.ready)
      .catch(() => {});
  }

  function drawExportCaption(targetCtx, meta, frame = {}) {
    const y0 = frame.y0 ?? height;
    const band = frame.band ?? EXPORT_CAPTION_HEIGHT;
    const outW = frame.width ?? width;
    const pixelRatio = frame.dpr ?? dpr;
    const { line1, line2, line3 } = exportCaptionText(meta);

    targetCtx.save();
    targetCtx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    targetCtx.fillStyle = "#111";
    targetCtx.fillRect(0, y0, outW, band);
    targetCtx.fillStyle = "#2a2a2a";
    targetCtx.fillRect(0, y0, outW, 1);
    const pad = 12;
    const maxW = Math.max(40, outW - pad * 2);
    targetCtx.textBaseline = "top";
    targetCtx.font = EXPORT_CAPTION_FONT;
    if (targetCtx.letterSpacing !== undefined) targetCtx.letterSpacing = "0.06em";
    targetCtx.fillStyle = "#9a9a9a";
    targetCtx.fillText("D7 snapshot", pad, y0 + 10, maxW);
    targetCtx.fillStyle = "#e0e0e0";
    targetCtx.fillText(line1, pad, y0 + 24, maxW);
    targetCtx.fillStyle = "#c0c0c0";
    targetCtx.fillText(line2, pad, y0 + 40, maxW);
    targetCtx.fillText(line3, pad, y0 + 54, maxW);
    targetCtx.restore();
  }

  function buildExportMetadata(transparentBackground, extra) {
    const colors = displayColors();
    const meta = {
      app: "D7-Space-Colonization",
      format: 1,
      exportedAt: new Date().toISOString(),
      gridName: gridName || null,
      gridToken: gridToken || null,
      transparentBackground: !!transparentBackground,
      params: readParamsFromUI(),
      jitter: sim.jitter,
      seeds: seeds.map((seed) => ({ x: seed.x, y: seed.y })),
      obstacles: serializeObstacles(),
      display: {
        gridOpacity: Number(ui.gridOpacity?.value ?? DEFAULT_DISPLAY_SETTINGS.gridOpacity),
        attractorSize: Number(ui.attractorSize?.value ?? DEFAULT_DISPLAY_SETTINGS.attractorSize),
        branchThickness: Number(ui.branchThickness?.value ?? DEFAULT_DISPLAY_SETTINGS.branchThickness),
        identifyBranches: !!ui.identifyBranches?.checked,
        showPrimary: !!ui.showPrimary?.checked,
        showSecondary: !!ui.showSecondary?.checked,
        showTertiary: !!ui.showTertiary?.checked,
        showVoidMask: !!ui.showVoidMask?.checked,
        showInfluenceRadius: !!ui.showInfluenceRadius?.checked,
        colors: {
          attractor: colors.attractor,
          branch: colors.branch,
          primary: colors[1],
          secondary: colors[2],
          tertiary: colors[3],
        },
      },
      sim: serializeSimSnapshot(),
    };
    if (extra && extra.matrix) meta.matrix = extra.matrix;
    return meta;
  }

  let pngCrcTable = null;

  function getPngCrcTable() {
    if (pngCrcTable) return pngCrcTable;
    pngCrcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      pngCrcTable[n] = c >>> 0;
    }
    return pngCrcTable;
  }

  function pngCrc32(bytes, start, end) {
    const table = getPngCrcTable();
    let c = 0xffffffff;
    for (let i = start; i < end; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function readUint32BE(bytes, offset) {
    return (
      ((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>>
      0
    );
  }

  function writeUint32BE(bytes, offset, value) {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  }

  function makePngChunk(type, data) {
    const chunk = new Uint8Array(12 + data.length);
    writeUint32BE(chunk, 0, data.length);
    for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
    chunk.set(data, 8);
    writeUint32BE(chunk, 8 + data.length, pngCrc32(chunk, 4, 8 + data.length));
    return chunk;
  }

  function buildPngTExtData(keyword, text) {
    const enc = new TextEncoder();
    const keywordBytes = enc.encode(keyword);
    const textBytes = enc.encode(text);
    const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
    data.set(keywordBytes, 0);
    data[keywordBytes.length] = 0;
    data.set(textBytes, keywordBytes.length + 1);
    return data;
  }

  function buildPngITxtData(keyword, text) {
    const enc = new TextEncoder();
    const keywordBytes = enc.encode(keyword);
    const textBytes = enc.encode(text);
    const data = new Uint8Array(keywordBytes.length + 1 + 2 + 1 + 1 + textBytes.length);
    let o = 0;
    data.set(keywordBytes, o);
    o += keywordBytes.length;
    data[o++] = 0;
    data[o++] = 0;
    data[o++] = 0;
    data[o++] = 0;
    data[o++] = 0;
    data.set(textBytes, o);
    return data.subarray(0, o + textBytes.length);
  }

  function parsePngTextChunk(type, bytes, dataStart, dataEnd) {
    const latin1 = new TextDecoder("latin1");
    const utf8 = new TextDecoder("utf-8");
    if (type === "tEXt") {
      let n = dataStart;
      while (n < dataEnd && bytes[n] !== 0) n++;
      return {
        keyword: latin1.decode(bytes.subarray(dataStart, n)),
        text: latin1.decode(bytes.subarray(n + 1, dataEnd)),
      };
    }
    if (type === "iTXt") {
      let n = dataStart;
      while (n < dataEnd && bytes[n] !== 0) n++;
      const keyword = latin1.decode(bytes.subarray(dataStart, n));
      n += 1;
      if (n + 2 > dataEnd) return null;
      const compressed = bytes[n++];
      n += 1;
      while (n < dataEnd && bytes[n] !== 0) n++;
      n += 1;
      while (n < dataEnd && bytes[n] !== 0) n++;
      n += 1;
      if (compressed !== 0) return null;
      return { keyword, text: utf8.decode(bytes.subarray(n, dataEnd)) };
    }
    return null;
  }

  function readPngD7Snapshot(pngBytes) {
    let o = 8;
    while (o + 12 <= pngBytes.length) {
      const len = readUint32BE(pngBytes, o);
      const type = String.fromCharCode(
        pngBytes[o + 4],
        pngBytes[o + 5],
        pngBytes[o + 6],
        pngBytes[o + 7]
      );
      const dataStart = o + 8;
      const dataEnd = dataStart + len;
      if (type === "tEXt" || type === "iTXt") {
        const parsed = parsePngTextChunk(type, pngBytes, dataStart, dataEnd);
        if (parsed && parsed.keyword === "d7-snapshot" && parsed.text) {
          try {
            return JSON.parse(parsed.text);
          } catch (_) {
            /* try next chunk */
          }
        }
      }
      if (type === "IEND") break;
      o += 12 + len;
    }
    return null;
  }

  function findPngIendOffset(bytes) {
    let o = 8;
    while (o + 12 <= bytes.length) {
      const len = readUint32BE(bytes, o);
      const type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
      if (type === "IEND") return o;
      o += 12 + len;
    }
    return -1;
  }

  function isLatin1Text(text) {
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) > 255) return false;
    }
    return true;
  }

  function embedPngSnapshotMetadata(pngBytes, jsonText) {
    const iend = findPngIendOffset(pngBytes);
    if (iend < 0) return pngBytes;
    const chunks = [makePngChunk("iTXt", buildPngITxtData("d7-snapshot", jsonText))];
    if (isLatin1Text(jsonText) && jsonText.length <= 32768) {
      chunks.unshift(makePngChunk("tEXt", buildPngTExtData("d7-snapshot", jsonText)));
    }
    let extra = 0;
    for (const chunk of chunks) extra += chunk.length;
    const out = new Uint8Array(pngBytes.length + extra);
    out.set(pngBytes.subarray(0, iend));
    let o = iend;
    for (const chunk of chunks) {
      out.set(chunk, o);
      o += chunk.length;
    }
    out.set(pngBytes.subarray(iend), o);
    return out;
  }

  function setExportStatus(message, kind) {
    if (!ui.exportStatus) return;
    ui.exportStatus.textContent = message;
    ui.exportStatus.classList.toggle("active", kind === "active");
    ui.exportStatus.classList.toggle("error", kind === "error");
  }

  function applyDisplayFromExportMeta(display) {
    if (!display) return;
    if (ui.gridOpacity && display.gridOpacity != null) {
      ui.gridOpacity.value = String(display.gridOpacity);
    }
    if (ui.attractorSize && display.attractorSize != null) {
      ui.attractorSize.value = String(display.attractorSize);
    }
    if (ui.branchThickness && display.branchThickness != null) {
      ui.branchThickness.value = String(display.branchThickness);
    }
    if (ui.identifyBranches) ui.identifyBranches.checked = !!display.identifyBranches;
    if (ui.showPrimary) ui.showPrimary.checked = !!display.showPrimary;
    if (ui.showSecondary) ui.showSecondary.checked = !!display.showSecondary;
    if (ui.showTertiary) ui.showTertiary.checked = !!display.showTertiary;
    if (ui.showVoidMask) ui.showVoidMask.checked = !!display.showVoidMask;
    if (ui.showInfluenceRadius && display.showInfluenceRadius != null) {
      ui.showInfluenceRadius.checked = !!display.showInfluenceRadius;
    }
    const colors = display.colors;
    if (colors) {
      if (ui.attractorColor && colors.attractor) ui.attractorColor.value = colors.attractor;
      if (ui.branchColor && colors.branch) ui.branchColor.value = colors.branch;
      if (ui.primaryColor && colors.primary) ui.primaryColor.value = colors.primary;
      if (ui.secondaryColor && colors.secondary) ui.secondaryColor.value = colors.secondary;
      if (ui.tertiaryColor && colors.tertiary) ui.tertiaryColor.value = colors.tertiary;
    }
    if (ui.branchLegend) {
      ui.branchLegend.classList.toggle("hidden", !ui.identifyBranches?.checked);
    }
    updateDisplayParams();
  }

  async function importSnapshotFromPngFile(file) {
    if (!file) return;
    let meta;
    try {
      const buf = await file.arrayBuffer();
      meta = readPngD7Snapshot(new Uint8Array(buf));
    } catch (_) {
      meta = null;
    }
    if (!meta || !meta.params || !meta.sim) {
      setExportStatus("No D7 snapshot in this PNG. Use Save PNG snapshot from Studio.", "error");
      setIterationStatus("This PNG is not a restorable snapshot.", "error");
      return;
    }
    if (meta.gridToken && meta.gridToken !== gridToken) {
      const entry = gridLibrary.find((item) => item.id === meta.gridToken);
      if (!entry) {
        setExportStatus("Import the same grid first, then load this PNG snapshot.", "error");
        setIterationStatus("Same grid required to restore this snapshot.", "error");
        return;
      }
      if (!activateGrid(entry)) {
        setExportStatus("Could not open the grid for this snapshot.", "error");
        return;
      }
    } else if (!gridSource) {
      setExportStatus("Import a grid before loading a snapshot PNG.", "error");
      setIterationStatus("Import the original grid, then load the PNG.", "error");
      return;
    }
    applyDisplayFromExportMeta(meta.display);
    if (meta.jitter != null) sim.jitter = meta.jitter;
    if (meta.transparentBackground != null && ui.exportTransparent) {
      ui.exportTransparent.checked = !!meta.transparentBackground;
    }
    applySimSnapshot(meta.params, meta.seeds || [], {
      ...meta.sim,
      obstacles: (meta.sim && meta.sim.obstacles) || meta.obstacles || [],
    });
    activeVariantId = null;
    activeSavedIterationId = null;
    const loadedMsg = `Loaded snapshot · gen ${meta.sim.generation} · ${meta.sim.attractorsLeft.length} attractors left`;
    setExportStatus(loadedMsg, "active");
    setIterationStatus(loadedMsg, "active");
    updateVariantUI();
    updateIterationUI();
  }

  function triggerDownload(filename, href) {
    const link = document.createElement("a");
    link.download = filename;
    link.href = href;
    link.click();
  }

  function xmlEscape(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function svgNum(n) {
    const v = Math.round(Number(n) * 100) / 100;
    if (!Number.isFinite(v)) return "0";
    return String(v);
  }

  function sourceToDataUrl(source) {
    if (!source) return null;
    try {
      if (source instanceof HTMLCanvasElement) return source.toDataURL("image/png");
      const w = source.naturalWidth || source.width;
      const h = source.naturalHeight || source.height;
      if (!w || !h) return null;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(source, 0, 0);
      return c.toDataURL("image/png");
    } catch (_) {
      return null;
    }
  }

  function buildStudioSvg(transparentBackground, options = {}) {
    const fitSite = !!options.fitSite;
    const extraMeta = options.extraMeta || null;
    const site = currentSiteRect();
    const cam = fitSite ? cameraForSiteRect(site, EXPORT_SITE_PX) : view;
    const svgW = fitSite ? EXPORT_SITE_PX : width;
    const sceneH = fitSite ? EXPORT_SITE_PX : height;
    const svgH = sceneH + EXPORT_CAPTION_HEIGHT;
    const meta = buildExportMetadata(transparentBackground, extraMeta);
    const palette = displayColors();
    const gridAlpha = Math.max(
      0,
      Math.min(1, Number(ui.gridOpacity?.value ?? DEFAULT_DISPLAY_SETTINGS.gridOpacity) / 100)
    );
    const attractorR = Math.max(0.2, Number(ui.attractorSize?.value ?? DEFAULT_DISPLAY_SETTINGS.attractorSize));
    const identify = ui.identifyBranches.checked;
    const visible = {
      1: ui.showPrimary.checked,
      2: ui.showSecondary.checked,
      3: ui.showTertiary.checked,
    };
    const parts = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${svgNum(svgW)}" height="${svgNum(
        svgH
      )}" viewBox="0 0 ${svgNum(svgW)} ${svgNum(svgH)}">`
    );
    parts.push(`<title>${xmlEscape(exportFileBaseName())} D7 snapshot</title>`);
    parts.push(
      `<metadata><d7-snapshot>${xmlEscape(JSON.stringify(meta))}</d7-snapshot></metadata>`
    );
    if (!transparentBackground) {
      parts.push(`<rect width="${svgNum(svgW)}" height="${svgNum(sceneH)}" fill="#000"/>`);
    }

    if (fitSite) {
      parts.push(
        `<clipPath id="d7-site-clip"><rect width="${svgNum(svgW)}" height="${svgNum(sceneH)}"/></clipPath>`
      );
      parts.push(`<g clip-path="url(#d7-site-clip)">`);
    }
    parts.push(
      `<g transform="translate(${svgNum(cam.x)} ${svgNum(cam.y)}) scale(${svgNum(cam.scale)})">`
    );

    if (gridSource && imageLayout) {
      const href = sourceToDataUrl(gridSource);
      if (href) {
        parts.push(
          `<image href="${href}" x="${svgNum(imageLayout.x)}" y="${svgNum(
            imageLayout.y
          )}" width="${svgNum(imageLayout.w)}" height="${svgNum(
            imageLayout.h
          )}" opacity="${svgNum(gridAlpha)}" preserveAspectRatio="none"/>`
        );
      }
    }

    if (!transparentBackground && ui.showVoidMask.checked && gridLayout) {
      parts.push(
        `<rect x="${svgNum(gridLayout.x)}" y="${svgNum(gridLayout.y)}" width="${svgNum(
          gridLayout.w
        )}" height="${svgNum(gridLayout.h)}" fill="rgba(4,6,10,0.72)"/>`
      );
    }

    if (gridOverlay && imageLayout) {
      const href = sourceToDataUrl(gridOverlay);
      if (href) {
        parts.push(
          `<image href="${href}" x="${svgNum(imageLayout.x)}" y="${svgNum(
            imageLayout.y
          )}" width="${svgNum(imageLayout.w)}" height="${svgNum(
            imageLayout.h
          )}" opacity="${svgNum(gridAlpha * 0.8)}" preserveAspectRatio="none"/>`
        );
      }
    }

    if (gridShapes && gridShapes.rectangles.length) {
      parts.push(`<g fill="none" stroke="rgba(232,213,163,0.75)" stroke-width="1.5" stroke-dasharray="7 5">`);
      for (const rect of gridShapes.rectangles) {
        parts.push(
          `<rect x="${svgNum(rect.x)}" y="${svgNum(rect.y)}" width="${svgNum(
            rect.w
          )}" height="${svgNum(rect.h)}"/>`
        );
      }
      parts.push(`</g>`);
    }

    const circles = sim.circles || [];
    if (circles.length) {
      parts.push(`<g fill="none" stroke="rgba(232,213,163,0.9)" stroke-width="1.5">`);
      for (const circle of circles) {
        parts.push(
          `<circle cx="${svgNum(circle.x)}" cy="${svgNum(circle.y)}" r="${svgNum(circle.r)}"/>`
        );
      }
      parts.push(`</g>`);
    }

    if (obstacles.length) {
      const repel = sim.obstacleMode === "repel";
      const stroke = repel ? "rgba(120,176,232,0.92)" : "rgba(232,140,96,0.92)";
      const fill = repel ? "rgba(120,176,232,0.12)" : "rgba(232,140,96,0.12)";
      parts.push(`<g fill="${fill}" stroke="${stroke}" stroke-width="1.6">`);
      for (const obs of obstacles) {
        if (obs.type === "circle") {
          parts.push(
            `<circle cx="${svgNum(obs.x)}" cy="${svgNum(obs.y)}" r="${svgNum(obs.r)}"/>`
          );
        } else if (obs.type === "rect") {
          const x = Math.min(obs.x, obs.x + obs.w);
          const y = Math.min(obs.y, obs.y + obs.h);
          parts.push(
            `<rect x="${svgNum(x)}" y="${svgNum(y)}" width="${svgNum(Math.abs(obs.w))}" height="${svgNum(
              Math.abs(obs.h)
            )}"/>`
          );
        } else if (obs.type === "polygon" && obs.points && obs.points.length >= 3) {
          const d = obs.points.map((p, i) => `${i ? "L" : "M"}${svgNum(p.x)} ${svgNum(p.y)}`).join(" ");
          parts.push(`<path d="${d} Z"/>`);
        }
      }
      parts.push(`</g>`);
    }

    const attractorField = displayAttractors();
    if (attractorField.length) {
      const fill = rgbaFromHex(palette.attractor, 0.82);
      const stroke = rgbaFromHex(palette.attractor, 1);
      const sw = attractorR >= 2 ? 1.1 : 0.7;
      parts.push(`<g fill="${xmlEscape(fill)}" stroke="${xmlEscape(stroke)}" stroke-width="${svgNum(sw)}">`);
      for (const p of attractorField) {
        parts.push(`<circle cx="${svgNum(p.x)}" cy="${svgNum(p.y)}" r="${svgNum(attractorR)}"/>`);
      }
      parts.push(`</g>`);
    }

    const drawOrder = identify ? [3, 2, 1] : [0];
    parts.push(`<g fill="none" stroke-linecap="round" stroke-linejoin="round">`);
    for (const rank of drawOrder) {
      if (identify && !visible[rank]) continue;
      const color = identify ? palette[rank] : palette.branch;
      for (const node of sim.nodes) {
        if (!node.parent) continue;
        const order = node.order || 1;
        if (identify && order !== rank) continue;
        const thick = branchStrokeWidth(node.parent.thickness, order, identify);
        parts.push(
          `<line x1="${svgNum(node.parent.pos.x)}" y1="${svgNum(node.parent.pos.y)}" x2="${svgNum(
            node.pos.x
          )}" y2="${svgNum(node.pos.y)}" stroke="${xmlEscape(color)}" stroke-width="${svgNum(thick)}"/>`
        );
      }
    }
    if (sim.mergeLinks && sim.mergeLinks.length) {
      for (const link of sim.mergeLinks) {
        if (!link.a || !link.b) continue;
        const order = Math.min(link.a.order || 1, link.b.order || 1);
        if (identify && !visible[order]) continue;
        const color = identify ? palette[order] || palette.branch : palette.branch;
        const thick = branchStrokeWidth(
          Math.max(link.a.thickness || 1, link.b.thickness || 1),
          order,
          identify
        );
        parts.push(
          `<line x1="${svgNum(link.a.pos.x)}" y1="${svgNum(link.a.pos.y)}" x2="${svgNum(
            link.b.pos.x
          )}" y2="${svgNum(link.b.pos.y)}" stroke="${xmlEscape(color)}" stroke-width="${svgNum(thick)}"/>`
        );
      }
    }
    parts.push(`</g>`);

    for (const seed of seeds) {
      const selected = seed.id === selectedSeedId;
      if (selected) {
        parts.push(
          `<circle cx="${svgNum(seed.x)}" cy="${svgNum(
            seed.y
          )}" r="16" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.2" stroke-dasharray="4 3"/>`
        );
        parts.push(
          `<circle cx="${svgNum(seed.x)}" cy="${svgNum(
            seed.y
          )}" r="10" fill="none" stroke="#ffffff" stroke-width="2.4"/>`
        );
      }
      parts.push(
        `<circle cx="${svgNum(seed.x)}" cy="${svgNum(seed.y)}" r="${
          selected ? 5 : 3.4
        }" fill="${selected ? "#ffffff" : "#e8d5a3"}"/>`
      );
    }
    for (const node of sim.nodes) {
      if (node.parent) continue;
      if (seeds.some((seed) => Math.hypot(seed.x - node.pos.x, seed.y - node.pos.y) < 3)) continue;
      parts.push(
        `<circle cx="${svgNum(node.pos.x)}" cy="${svgNum(node.pos.y)}" r="3.4" fill="#e8d5a3"/>`
      );
    }
    parts.push(`</g>`);
    if (fitSite) parts.push(`</g>`);

    const { line1, line2, line3 } = exportCaptionText(meta);
    const y0 = sceneH;
    parts.push(`<g>`);
    parts.push(`<rect x="0" y="${svgNum(y0)}" width="${svgNum(svgW)}" height="${svgNum(EXPORT_CAPTION_HEIGHT)}" fill="#111"/>`);
    parts.push(`<rect x="0" y="${svgNum(y0)}" width="${svgNum(svgW)}" height="1" fill="#2a2a2a"/>`);
    parts.push(
      `<g font-family="Arkitech Light, sans-serif" font-weight="300" font-size="12" letter-spacing="0.06em">`
    );
    parts.push(
      `<text x="12" y="${svgNum(y0 + 20)}" fill="#9a9a9a">D7 snapshot</text>`
    );
    parts.push(`<text x="12" y="${svgNum(y0 + 34)}" fill="#e0e0e0">${xmlEscape(line1)}</text>`);
    parts.push(`<text x="12" y="${svgNum(y0 + 48)}" fill="#c0c0c0">${xmlEscape(line2)}</text>`);
    parts.push(`<text x="12" y="${svgNum(y0 + 62)}" fill="#c0c0c0">${xmlEscape(line3)}</text>`);
    parts.push(`</g></g></svg>`);
    return { svg: parts.join(""), meta };
  }

  function downloadSvgSnapshot() {
    if (!width || !height) {
      setExportStatus("Canvas is not ready to export.", "error");
      return false;
    }
    const transparentBackground = !!(ui.exportTransparent && ui.exportTransparent.checked);
    const { svg } = buildStudioSvg(transparentBackground);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const suffix = transparentBackground ? "transparent" : "opaque";
    const filename = `${exportFileBaseName()}-d7-${suffix}-${stamp}.svg`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    triggerDownload(filename, url);
    URL.revokeObjectURL(url);
    setExportStatus(`Saved ${filename} · vector branches`, "active");
    return true;
  }

  const EXPORT_SITE_PX = 2000;

  function currentSiteRect() {
    if (gridLayout && gridLayout.w > 0 && gridLayout.h > 0) return gridLayout;
    return computeSiteLayout(width || EXPORT_SITE_PX, height || EXPORT_SITE_PX).layout;
  }

  function cameraForSiteRect(site, destSize) {
    const scale = destSize / Math.max(1, site.w);
    return {
      scale,
      x: -site.x * scale,
      y: -site.y * scale,
    };
  }

  function buildPngExportCanvas(transparentBackground) {
    const site = currentSiteRect();
    const scene = EXPORT_SITE_PX;
    const band = EXPORT_CAPTION_HEIGHT;
    const off = document.createElement("canvas");
    off.width = scene;
    off.height = scene + band;
    const ectx = off.getContext("2d");
    ectx.setTransform(1, 0, 0, 1, 0, 0);
    renderStudioFrame(ectx, {
      transparentBackground,
      outputWidth: scene,
      outputHeight: scene,
      camera: cameraForSiteRect(site, scene),
      pixelRatio: 1,
      clipToOutput: true,
      hideSiteBoundary: true,
      hideInfluencePreview: true,
      hideEditingChrome: true,
      hideDraft: true,
    });
    return { canvas: off, ctx: ectx, scene, band };
  }

  function capturePngSnapshotBlob(extraMeta) {
    return ensureExportCaptionFont().then(
      () =>
        new Promise((resolve) => {
          const transparentBackground = !!(ui.exportTransparent && ui.exportTransparent.checked);
          const { canvas: off, ctx: ectx, scene, band } = buildPngExportCanvas(transparentBackground);
          const meta = buildExportMetadata(transparentBackground, extraMeta);
          drawExportCaption(ectx, meta, {
            width: scene,
            y0: scene,
            band,
            dpr: 1,
          });
          off.toBlob(
            (blob) => {
              if (!blob) {
                resolve(null);
                return;
              }
              blob
                .arrayBuffer()
                .then((buf) => {
                  const png = embedPngSnapshotMetadata(new Uint8Array(buf), JSON.stringify(meta));
                  if (!readPngD7Snapshot(png)) {
                    resolve(null);
                    return;
                  }
                  resolve(new Blob([png], { type: "image/png" }));
                })
                .catch(() => resolve(null));
            },
            "image/png",
            1
          );
        })
    );
  }

  function downloadPngSnapshot() {
    if (!gridLayout && !gridSource) {
      setExportStatus("Import a grid before exporting a PNG.", "error");
      return Promise.resolve(false);
    }
    return capturePngSnapshotBlob().then((blob) => {
      if (!blob) {
        setExportStatus("Could not encode PNG.", "error");
        return false;
      }
      const transparentBackground = !!(ui.exportTransparent && ui.exportTransparent.checked);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const suffix = transparentBackground ? "transparent" : "opaque";
      const filename = `${exportFileBaseName()}-d7-${suffix}-${stamp}.png`;
      const url = URL.createObjectURL(blob);
      triggerDownload(filename, url);
      URL.revokeObjectURL(url);
      setExportStatus(`Saved ${filename} · caption + restorable snapshot`, "active");
      return true;
    });
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

  function canvasPoint(event) {
    return screenToWorld(event.clientX, event.clientY);
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
    renderStudioFrame(ctx, { transparentBackground: false });
    tickFlashes();

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
  if (ui.replaceGrid) {
    ui.replaceGrid.addEventListener("click", () => {
      const target = gridSlots[activeSlotIndex]?.entry
        ? activeSlotIndex
        : Math.max(0, firstEmptyGridSlotIndex());
      openGridFilePicker(target);
    });
  }
  ui.clearGrid.addEventListener("click", clearGrid);
  ui.seedMode.addEventListener("click", () => setInteractionMode("add"));
  if (ui.selectRoot) {
    ui.selectRoot.addEventListener("click", () => setInteractionMode("select"));
  }
  if (ui.drawObstacle) {
    ui.drawObstacle.addEventListener("click", () => setInteractionMode("draw"));
  }
  if (ui.deleteSelectedRoot) {
    ui.deleteSelectedRoot.addEventListener("click", deleteSelectedRoot);
  }
  ui.clearSeeds.addEventListener("click", clearSeeds);
  if (ui.obstacleRect) ui.obstacleRect.addEventListener("click", () => setObstacleTool("rect"));
  if (ui.obstacleCircle) ui.obstacleCircle.addEventListener("click", () => setObstacleTool("circle"));
  if (ui.obstaclePolygon) ui.obstaclePolygon.addEventListener("click", () => setObstacleTool("polygon"));
  if (ui.obstacleHard) ui.obstacleHard.addEventListener("click", () => setObstacleBehavior("hard"));
  if (ui.obstacleRepel) ui.obstacleRepel.addEventListener("click", () => setObstacleBehavior("repel"));
  if (ui.deleteSelectedObstacle) {
    ui.deleteSelectedObstacle.addEventListener("click", deleteSelectedObstacle);
  }
  if (ui.clearObstacles) ui.clearObstacles.addEventListener("click", clearObstacles);
  if (ui.repulsionDistance) {
    ui.repulsionDistance.addEventListener("input", () => onLiveParamChange("repulsionDistance"));
  }
  if (ui.repulsionStrength) {
    ui.repulsionStrength.addEventListener("input", () => onLiveParamChange("repulsionStrength"));
  }
  ui.gridFile.addEventListener("change", async () => {
    const file = ui.gridFile.files && ui.gridFile.files[0];
    ui.gridFile.value = "";
    if (!file) return;
    await importGridFile(file, pendingSlotIndex);
  });

  ui.count.addEventListener("input", () => onLiveParamChange("count"));
  ui.influence.addEventListener("input", () => onLiveParamChange("influence"));
  ui.kill.addEventListener("input", () => onLiveParamChange("kill"));
  ui.stepSize.addEventListener("input", () => onLiveParamChange("step"));
  if (ui.growthDirection) {
    ui.growthDirection.addEventListener("input", () => onLiveParamChange("growthDirection"));
  }
  if (ui.mergeBranches) {
    ui.mergeBranches.addEventListener("change", () => onLiveParamChange("merge"));
  }
  if (ui.mergeDistance) {
    ui.mergeDistance.addEventListener("input", () => onLiveParamChange("mergeDistance"));
  }
  ui.iterations.addEventListener("input", () => onLiveParamChange("iterations"));
  ui.gridOpacity.addEventListener("input", updateDisplayParams);
  ui.attractorSize.addEventListener("input", updateDisplayParams);
  if (ui.branchThickness) ui.branchThickness.addEventListener("input", updateDisplayParams);
  for (const id of DISPLAY_COLOR_IDS) {
    if (ui[id]) ui[id].addEventListener("input", saveDisplayColors);
  }
  ui.identifyBranches.addEventListener("change", () => {
    ui.branchLegend.classList.toggle("hidden", !ui.identifyBranches.checked);
  });
  ui.captureVariant.addEventListener("click", captureVariant);
  if (ui.saveIteration) ui.saveIteration.addEventListener("click", saveCurrentIteration);
  if (ui.saveSvg) ui.saveSvg.addEventListener("click", downloadSvgSnapshot);
  if (ui.saveSimulation) ui.saveSimulation.addEventListener("click", openSaveSimPanel);
  if (ui.confirmSaveSim) ui.confirmSaveSim.addEventListener("click", confirmSaveSimulation);
  if (ui.cancelSaveSim) ui.cancelSaveSim.addEventListener("click", hideSaveSimPanel);
  if (ui.saveSimName) {
    ui.saveSimName.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        confirmSaveSimulation();
      }
      if (event.key === "Escape") hideSaveSimPanel();
    });
  }
  if (ui.saveSimCats) {
    ui.saveSimCats.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-sim-cat]");
      if (!btn) return;
      setSavedSimCategory(btn.dataset.simCat);
    });
  }
  if (ui.savedSimFilters) {
    ui.savedSimFilters.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-sim-filter]");
      if (!btn) return;
      setSavedSimFilter(btn.dataset.simFilter);
    });
  }
  if (ui.clearIterations) ui.clearIterations.addEventListener("click", clearSavedIterationsForGrid);
  if (ui.importSnapshot && ui.importSnapshotFile) {
    ui.importSnapshot.addEventListener("click", () => ui.importSnapshotFile.click());
    ui.importSnapshotFile.addEventListener("change", async () => {
      const file = ui.importSnapshotFile.files && ui.importSnapshotFile.files[0];
      await importSnapshotFromPngFile(file);
      ui.importSnapshotFile.value = "";
    });
  }
  ui.newAttempt.addEventListener("click", newAttempt);
  ui.generateVariants.addEventListener("click", () => generateVariantsBatch());
  ui.clearVariants.addEventListener("click", clearVariantsForActiveGrid);
  ui.batchCount.addEventListener("change", () => {
    ui.batchCountVal.textContent = ui.batchCount.value;
  });
  if (ui.tabStudio) ui.tabStudio.addEventListener("click", () => setAppPage("studio"));
  if (ui.tabMatrix) ui.tabMatrix.addEventListener("click", () => setAppPage("matrix"));
  if (ui.tabSpace3d) ui.tabSpace3d.addEventListener("click", () => setAppPage("space3d"));
  if (ui.tabGrid3d) ui.tabGrid3d.addEventListener("click", () => setAppPage("grid3d"));
  if (ui.matrixTypeRow) {
    ui.matrixTypeRow.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-matrix-type]");
      if (!btn) return;
      matrixType = btn.dataset.matrixType;
      renderDescriptorButtons();
    });
  }
  if (ui.matrixIntensity) {
    ui.matrixIntensity.addEventListener("input", () => {
      if (ui.matrixIntensityVal) ui.matrixIntensityVal.textContent = ui.matrixIntensity.value;
    });
  }
  if (ui.matrixVariation) {
    ui.matrixVariation.addEventListener("input", () => {
      if (ui.matrixVariationVal) ui.matrixVariationVal.textContent = ui.matrixVariation.value;
    });
  }
  if (ui.generateMatrix) ui.generateMatrix.addEventListener("click", generateDescriptorMatrix);
  if (ui.saveMatrix) ui.saveMatrix.addEventListener("click", openSaveWholeMatrixPanel);
  if (ui.matrixConfirmSaveWhole) {
    ui.matrixConfirmSaveWhole.addEventListener("click", confirmSaveWholeMatrix);
  }
  if (ui.matrixCancelSaveWhole) {
    ui.matrixCancelSaveWhole.addEventListener("click", () => {
      if (ui.matrixSaveWholePanel) ui.matrixSaveWholePanel.classList.add("hidden");
    });
  }
  if (ui.matrixWholeName) {
    ui.matrixWholeName.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        confirmSaveWholeMatrix();
      }
      if (event.key === "Escape" && ui.matrixSaveWholePanel) {
        ui.matrixSaveWholePanel.classList.add("hidden");
      }
    });
  }
  if (ui.savedMatrixFilters) {
    ui.savedMatrixFilters.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-matrix-filter]");
      if (!btn) return;
      setSavedMatrixFilter(btn.dataset.matrixFilter);
    });
  }
  if (ui.matrixSaveAllPng) {
    ui.matrixSaveAllPng.addEventListener("click", () => exportMatrixBatch("png"));
  }
  if (ui.matrixSaveAllSvg) {
    ui.matrixSaveAllSvg.addEventListener("click", () => exportMatrixBatch("svg"));
  }
  if (ui.matrixOpenStudio) ui.matrixOpenStudio.addEventListener("click", openMatrixCellInStudio);
  if (ui.matrixSaveSim) ui.matrixSaveSim.addEventListener("click", openMatrixSavePanel);
  if (ui.matrixExportPng) ui.matrixExportPng.addEventListener("click", exportMatrixCellPng);
  if (ui.matrixConfirmSave) ui.matrixConfirmSave.addEventListener("click", confirmSaveSimulation);
  if (ui.matrixCancelSave) ui.matrixCancelSave.addEventListener("click", hideSaveSimPanel);
  if (ui.matrixSaveCats) {
    ui.matrixSaveCats.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-sim-cat]");
      if (!btn) return;
      setSavedSimCategory(btn.dataset.simCat);
      ui.matrixSaveCats.querySelectorAll("[data-sim-cat]").forEach((el) => {
        el.classList.toggle("active", el.dataset.simCat === savedSimCategory);
      });
    });
  }
  if (ui.matrixSaveName) {
    ui.matrixSaveName.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        confirmSaveSimulation();
      }
      if (event.key === "Escape") hideSaveSimPanel();
    });
  }

  function captureCanvasPointer(event) {
    if (!event || event.pointerId == null) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (_) {
      /* synthetic or inactive pointer */
    }
  }

  function closePolygonDraft() {
    if (!obstacleDraft || obstacleDraft.type !== "polygon") return false;
    const pts = obstacleDraft.points || [];
    if (pts.length < 3) {
      obstacleDraft = null;
      updateObstacleUI();
      return false;
    }
    addObstacle({ type: "polygon", points: pts });
    return true;
  }

  function resizeRectObstacle(obs, handle, point) {
    const box = obstacleAabb(obs);
    let minX = box.minX;
    let minY = box.minY;
    let maxX = box.maxX;
    let maxY = box.maxY;
    if (handle === "nw") {
      minX = point.x;
      minY = point.y;
    } else if (handle === "ne") {
      maxX = point.x;
      minY = point.y;
    } else if (handle === "se") {
      maxX = point.x;
      maxY = point.y;
    } else if (handle === "sw") {
      minX = point.x;
      maxY = point.y;
    }
    obs.x = Math.min(minX, maxX);
    obs.y = Math.min(minY, maxY);
    obs.w = Math.max(8, Math.abs(maxX - minX));
    obs.h = Math.max(8, Math.abs(maxY - minY));
  }

  let spacePan = false;
  let suppressContextMenu = false;

  function beginCanvasPan(event) {
    event.preventDefault();
    canvas.classList.add("pan-mode");
    captureCanvasPointer(event);
    canvas._pan = {
      ox: event.clientX,
      oy: event.clientY,
      vx: view.x,
      vy: view.y,
      moved: false,
    };
  }

  function isCanvasPanEvent(event) {
    return event.button === 1 || event.button === 2 || (event.button === 0 && spacePan);
  }

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (event.ctrlKey) {
        zoomAt(event.clientX, event.clientY, event.deltaY > 0 ? 0.9 : 1.1);
        return;
      }
      if (Math.abs(event.deltaX) > 0.01 || event.shiftKey) {
        view.x -= event.deltaX;
        view.y -= event.deltaY;
        return;
      }
      zoomAt(event.clientX, event.clientY, event.deltaY > 0 ? 0.9 : 1.1);
    },
    { passive: false }
  );

  canvas.addEventListener("auxclick", (event) => {
    if (event.button === 1 || event.button === 2) event.preventDefault();
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (isCanvasPanEvent(event)) {
      beginCanvasPan(event);
      return;
    }
    if (event.button !== 0) return;
    const point = canvasPoint(event);

    if (interactionMode === "draw") {
      captureCanvasPointer(event);
      if (obstacleTool === "polygon") {
        canvas._drag = { kind: "poly-click", origin: point };
        return;
      }
      canvas._drag = { kind: "draw-shape", origin: point };
      return;
    }

    if (interactionMode === "add") {
      const seed = hitSeed(point);
      if (seed) {
        const wasSelected = selectedSeedId === seed.id;
        if (!wasSelected) selectSeed(seed.id);
        captureCanvasPointer(event);
        canvas._drag = {
          kind: "seed",
          seed,
          origin: point,
          x: seed.x,
          y: seed.y,
          toggleDeselect: wasSelected,
          moved: false,
        };
        return;
      }
      captureCanvasPointer(event);
      canvas._drag = { kind: "place-seed", origin: point };
      return;
    }

    const seed = hitSeed(point);
    if (seed) {
      deselectObstacle();
      const wasSelected = selectedSeedId === seed.id;
      if (!wasSelected) selectSeed(seed.id);
      captureCanvasPointer(event);
      canvas._drag = {
        kind: "seed",
        seed,
        origin: point,
        x: seed.x,
        y: seed.y,
        toggleDeselect: wasSelected,
        moved: false,
      };
      return;
    }

    const hit = hitTestObstacles(obstacles, point.x, point.y, 10);
    if (hit) {
      deselectSeed();
      selectObstacle(hit.obs.id);
      captureCanvasPointer(event);
      canvas._drag = {
        kind: "obstacle",
        obs: hit.obs,
        handle: hit.handle,
        vertex: hit.vertex,
        origin: point,
        start: cloneObstacle(hit.obs),
        moved: false,
      };
      return;
    }

    captureCanvasPointer(event);
    canvas._drag = { kind: "empty-select", origin: point };
  });

  function onCanvasPointerMove(event) {
    if (canvas._pan) {
      const dx = event.clientX - canvas._pan.ox;
      const dy = event.clientY - canvas._pan.oy;
      if (Math.hypot(dx, dy) >= 3) canvas._pan.moved = true;
      view.x = canvas._pan.vx + dx;
      view.y = canvas._pan.vy + dy;
      return;
    }
    const point = canvasPoint(event);
    const drag = canvas._drag;
    if (
      !drag &&
      interactionMode === "draw" &&
      obstacleTool === "polygon" &&
      obstacleDraft &&
      obstacleDraft.points
    ) {
      obstacleDraft.hover = point;
      return;
    }
    if (!drag) return;
    if (drag.kind === "seed") {
      const nx = drag.x + (point.x - drag.origin.x);
      const ny = drag.y + (point.y - drag.origin.y);
      if (Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) >= 4) {
        drag.moved = true;
        drag.toggleDeselect = false;
      }
      if (drag.moved) moveSeed(drag.seed.id, nx, ny);
      return;
    }
    if (drag.kind === "place-seed" || drag.kind === "empty-select" || drag.kind === "poly-click") {
      return;
    }
    if (drag.kind === "draw-shape") {
      if (obstacleTool === "circle") {
        const r = Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y);
        obstacleDraft = r >= 8 ? { type: "circle", x: drag.origin.x, y: drag.origin.y, r, draft: true } : null;
      } else {
        const w = point.x - drag.origin.x;
        const h = point.y - drag.origin.y;
        obstacleDraft =
          Math.abs(w) >= 8 && Math.abs(h) >= 8
            ? { type: "rect", x: drag.origin.x, y: drag.origin.y, w, h, draft: true }
            : null;
      }
      return;
    }
    if (drag.kind === "obstacle") {
      const dx = point.x - drag.origin.x;
      const dy = point.y - drag.origin.y;
      if (Math.hypot(dx, dy) >= 3) drag.moved = true;
      const obs = drag.obs;
      const start = drag.start;
      if (obs.type === "circle" && drag.handle === "rim") {
        obs.r = Math.max(8, Math.hypot(point.x - obs.x, point.y - obs.y));
      } else if (obs.type === "circle") {
        obs.x = start.x + dx;
        obs.y = start.y + dy;
      } else if (obs.type === "rect" && drag.handle && drag.handle !== "body") {
        resizeRectObstacle(obs, drag.handle, point);
      } else if (obs.type === "polygon" && drag.handle === "vertex") {
        const p = obs.points[drag.vertex];
        if (p) {
          p.x = start.points[drag.vertex].x + dx;
          p.y = start.points[drag.vertex].y + dy;
        }
      } else {
        moveObstacleBy(obs, dx - (drag._lastDx || 0), dy - (drag._lastDy || 0));
        drag._lastDx = dx;
        drag._lastDy = dy;
      }
      syncObstacles();
    }
  }

  function onCanvasPointerUp(event) {
    if (canvas._pan) {
      if (canvas._pan.moved) suppressContextMenu = true;
      canvas._pan = null;
      if (!spacePan) canvas.classList.remove("pan-mode");
      if (event.button === 1 || event.button === 2 || !canvas._drag) return;
    }
    const drag = canvas._drag;
    canvas._drag = null;
    if (!drag || event.button !== 0) return;
    const point = canvasPoint(event);
    if (drag.kind === "place-seed") {
      if (Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) < 4) {
        if (!hitSeed(drag.origin)) addSeedRecord(drag.origin);
      }
      return;
    }
    if (drag.kind === "seed") {
      if (drag.toggleDeselect && !drag.moved) deselectSeed();
      return;
    }
    if (drag.kind === "empty-select") {
      if (Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) < 4) {
        deselectSeed();
        deselectObstacle();
      }
      return;
    }
    if (drag.kind === "poly-click") {
      if (Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) >= 4) return;
      if (!obstacleDraft || obstacleDraft.type !== "polygon") {
        obstacleDraft = { type: "polygon", points: [{ x: point.x, y: point.y }], draft: true };
        updateObstacleUI();
        return;
      }
      const first = obstacleDraft.points[0];
      if (
        obstacleDraft.points.length >= 3 &&
        Math.hypot(point.x - first.x, point.y - first.y) <= 12
      ) {
        closePolygonDraft();
        return;
      }
      obstacleDraft.points.push({ x: point.x, y: point.y });
      obstacleDraft.hover = null;
      updateObstacleUI();
      return;
    }
    if (drag.kind === "draw-shape") {
      const draft = obstacleDraft;
      obstacleDraft = null;
      if (!draft) return;
      if (draft.type === "circle" && draft.r >= 8) {
        addObstacle({ type: "circle", x: draft.x, y: draft.y, r: draft.r });
      } else if (draft.type === "rect" && Math.abs(draft.w) >= 8 && Math.abs(draft.h) >= 8) {
        addObstacle({
          type: "rect",
          x: Math.min(draft.x, draft.x + draft.w),
          y: Math.min(draft.y, draft.y + draft.h),
          w: Math.abs(draft.w),
          h: Math.abs(draft.h),
        });
      }
      return;
    }
    if (drag.kind === "obstacle") {
      if (drag.moved) {
        syncObstacles();
        if (sim.generation > 0) replayGrowthFromSeeds();
      }
    }
  }

  canvas.addEventListener("pointermove", onCanvasPointerMove);
  canvas.addEventListener("pointerup", onCanvasPointerUp);
  canvas.addEventListener("pointercancel", onCanvasPointerUp);
  window.addEventListener("pointermove", (event) => {
    if (!canvas._pan && !canvas._drag) return;
    if (event.target === canvas) return;
    onCanvasPointerMove(event);
  });
  window.addEventListener("pointerup", (event) => {
    if (!canvas._pan && !canvas._drag) return;
    if (event.target === canvas) return;
    onCanvasPointerUp(event);
  });
  window.addEventListener("pointercancel", (event) => {
    if (!canvas._pan && !canvas._drag) return;
    onCanvasPointerUp(event);
  });

  canvas.addEventListener("dblclick", (event) => {
    if (interactionMode !== "draw" || obstacleTool !== "polygon") return;
    event.preventDefault();
    closePolygonDraft();
  });

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (suppressContextMenu) {
      suppressContextMenu = false;
      return;
    }
    if (interactionMode === "draw" && obstacleDraft) {
      obstacleDraft = null;
      updateObstacleUI();
      return;
    }
    const point = canvasPoint(event);
    if (interactionMode === "add") {
      const seed = hitSeed(point);
      if (seed) removeSeed(seed.id);
      return;
    }
    const seed = hitSeed(point);
    if (seed) {
      removeSeed(seed.id);
      return;
    }
    const hit = hitTestObstacles(obstacles, point.x, point.y, 10);
    if (hit) {
      selectedObstacleId = hit.obs.id;
      deleteSelectedObstacle();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (isTypingTarget(event.target)) return;
    if (event.code === "Space" && appPage === "studio") {
      event.preventDefault();
      spacePan = true;
      canvas.classList.add("pan-mode");
      return;
    }
    if (event.key === "Escape") {
      if (obstacleDraft) {
        obstacleDraft = null;
        updateObstacleUI();
        return;
      }
      deselectSeed();
      deselectObstacle();
      return;
    }
    if (event.key === "Enter" && interactionMode === "draw" && obstacleTool === "polygon") {
      event.preventDefault();
      closePolygonDraft();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (selectedObstacleId != null) {
        event.preventDefault();
        deleteSelectedObstacle();
        return;
      }
      if (selectedSeedId != null) {
        event.preventDefault();
        deleteSelectedRoot();
      }
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.code !== "Space") return;
    spacePan = false;
    if (!canvas._pan) canvas.classList.remove("pan-mode");
  });
  window.addEventListener("blur", () => {
    spacePan = false;
    if (!canvas._pan) canvas.classList.remove("pan-mode");
  });

  window.addEventListener("resize", resize);
  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(viewport);
    if (ui.space3dStage) {
      new ResizeObserver(() => {
        if (appPage === "space3d" && space3dStudio) space3dStudio.resize();
      }).observe(ui.space3dStage);
    }
    const grid3dStage = document.getElementById("grid3dStage");
    if (grid3dStage) {
      new ResizeObserver(() => {
        if (appPage === "grid3d" && grid3dStudio) grid3dStudio.resize();
      }).observe(grid3dStage);
    }
  }
  loadSavedIterationsFromStorage();
  setInteractionMode("select");
  applyParams();
  initSliderBounds();
  initDisplayColors();
  updateDisplayParams();
  ui.batchCountVal.textContent = ui.batchCount.value;
  buildGridSlotButtons();
  updateGridCycleUI();
  updateVariantUI();
  updateIterationUI();
  renderDescriptorButtons();
  renderMatrixGrid();
  updateMatrixGenerateState();
  if (window.D7Spatial3D && typeof window.D7Spatial3D.mount === "function") {
    space3dStudio = window.D7Spatial3D.mount({
      draw2dPreview(target) {
        if (!target) return;
        const ctx = target.getContext("2d");
        if (!ctx) return;
        const size = target.width || 240;
        const site = currentSiteRect();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        renderStudioFrame(ctx, {
          transparentBackground: false,
          outputWidth: size,
          outputHeight: size,
          camera: cameraForSiteRect(site, size),
          pixelRatio: 1,
          clipToOutput: true,
          hideInfluencePreview: true,
          hideEditingChrome: true,
          hideDraft: true,
        });
      },
      capture2d() {
        const site = currentSiteRect();
        const indexOf = new Map();
        sim.nodes.forEach((node, index) => indexOf.set(node, index));
        return {
          site: { x: site.x, y: site.y, w: site.w, h: site.h },
          nodes: sim.nodes.map((node) => ({
            x: node.pos.x,
            y: node.pos.y,
            parentIndex: node.parent ? indexOf.get(node.parent) : -1,
            thickness: node.thickness,
            order: node.order || 1,
            rootId: node.rootId,
            fused: !!node.fused,
          })),
          mergeLinks: (sim.mergeLinks || [])
            .map((link) => ({
              a: indexOf.get(link.a),
              b: indexOf.get(link.b),
            }))
            .filter((link) => link.a != null && link.b != null),
          roots: seeds.map((seed) => ({ id: seed.id, x: seed.x, y: seed.y })),
          attractors: (sim.originalAttractors || currentAttractors() || []).map((p) => ({
            x: p.x,
            y: p.y,
          })),
        };
      },
    });
  }
  if (window.D7GridGrowth && typeof window.D7GridGrowth.mount === "function") {
    grid3dStudio = window.D7GridGrowth.mount();
  }
  if (window.D7CustomGrid && typeof window.D7CustomGrid.init === "function") {
    window.D7CustomGrid.init().catch((err) => console.warn("Shared grid load failed", err));
  }
  resize();
  async function maybeMigrateSharedCustomGridFromSlot0() {
    if (!window.D7CustomGrid) return;
    try {
      await window.D7CustomGrid.init();
      if (window.D7CustomGrid.isCustom()) return;
      const entry = gridSlots[0]?.entry;
      if (!entry?.svgText) return;
      await window.D7CustomGrid.importSvgTextAndActivate(
        entry.svgText,
        entry.name || "Custom grid",
        1
      );
    } catch (err) {
      console.warn("Could not migrate site SVG to shared custom grid", err);
    }
  }

  restoreGridSlots().then(() => maybeMigrateSharedCustomGridFromSlot0());
  refreshSavedSimulationLibrary();
  refreshSavedMatrixLibrary();
  loop();
})();
