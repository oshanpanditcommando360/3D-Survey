const state = {
  mode: "scan",
  stream: null,
  samplingTimer: null,
  surveyActive: false,
  frames: [],
  coverageCells: new Map(),
  location: null,
  locationStatus: "pending",
  coverage: 0,
  processing: false,
  modelReady: false,
  scanId: null,
  model: null,
  mapViewer: null,
  mapEntity: null,
  mapReady: false,
  rotationX: -0.45,
  rotationY: 0.65,
  zoom: 1,
  dragging: false,
  lastPointer: null,
};

const els = {
  cameraFeed: document.querySelector("#cameraFeed"),
  cameraEmpty: document.querySelector("#cameraEmpty"),
  scanOverlay: document.querySelector("#scanOverlay"),
  viewerStage: document.querySelector("#viewerStage"),
  mapStage: document.querySelector("#mapStage"),
  scanStage: document.querySelector("#scanStage"),
  modelViewer: document.querySelector("#modelViewer"),
  cesiumMap: document.querySelector("#cesiumMap"),
  mapHint: document.querySelector("#mapHint"),
  deviceStatus: document.querySelector("#deviceStatus"),
  frameCount: document.querySelector("#frameCount"),
  coverageValue: document.querySelector("#coverageValue"),
  qualityValue: document.querySelector("#qualityValue"),
  modelState: document.querySelector("#modelState"),
  startScan: document.querySelector("#startScan"),
  finishScan: document.querySelector("#finishScan"),
  exportPackage: document.querySelector("#exportPackage"),
  actionNote: document.querySelector("#actionNote"),
  tabs: Array.from(document.querySelectorAll(".mode-tab")),
  steps: Array.from(document.querySelectorAll("#steps li")),
};

const overlayContext = els.scanOverlay.getContext("2d");
const viewerContext = els.modelViewer.getContext("2d");
const COVERAGE_ROWS = 5;
const COVERAGE_COLS = 8;
const SAMPLE_INTERVAL_MS = 1500;
const MAX_FRAMES = 40;
const MIN_FRAMES_TO_FINISH = 8;
const MIN_COVERAGE_TO_FINISH = 60;

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function updateMetrics() {
  els.frameCount.textContent = String(state.frames.length);
  els.coverageValue.textContent = `${state.coverage}%`;
  els.qualityValue.textContent = state.frames.length < 3 ? "-" : state.coverage > 70 ? "Good" : "Draft";
  els.modelState.textContent = state.modelReady ? "Ready" : state.processing ? "Building" : "None";
  els.finishScan.disabled =
    !state.surveyActive ||
    state.frames.length < MIN_FRAMES_TO_FINISH ||
    state.coverage < MIN_COVERAGE_TO_FINISH ||
    state.processing;
  els.exportPackage.disabled = state.frames.length === 0;
}

function setStep(index) {
  els.steps.forEach((step, stepIndex) => {
    step.classList.toggle("is-active", stepIndex === index);
    step.classList.toggle("is-done", stepIndex < index);
  });
}

function setMode(mode) {
  state.mode = mode;
  els.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.mode === mode));
  els.scanStage.classList.toggle("is-hidden", mode === "view" || mode === "map");
  els.viewerStage.classList.toggle("is-hidden", mode !== "view");
  els.mapStage.classList.toggle("is-hidden", mode !== "map");
  if (mode === "view") {
    setStep(4);
    drawModel();
  }
  if (mode === "map") {
    setStep(4);
    updateMapPlacement();
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    els.deviceStatus.textContent = "Unsupported";
    els.actionNote.textContent = "This browser does not expose camera capture. Use a modern Android/iPhone browser or wrap the scanner in a native shell.";
    return;
  }

  try {
    stopSurvey();
    stopCameraStream();
    state.frames = [];
    state.coverageCells.clear();
    state.coverage = 0;
    state.modelReady = false;
    state.model = null;
    state.scanId = null;
    state.location = null;
    state.locationStatus = "pending";

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    state.stream = stream;
    els.cameraFeed.srcObject = stream;
    await els.cameraFeed.play();
    els.cameraEmpty.classList.add("is-hidden");
    els.deviceStatus.textContent = "Surveying";
    els.startScan.textContent = "Restart survey";
    els.actionNote.textContent = "Move slowly. Blue dots show areas already covered. Survey done unlocks after 60% coverage and 8 samples.";
    setStep(1);
    getSurveyLocation();
    startSurveySampling();
    updateMetrics();
    drawOverlay();
  } catch (error) {
    els.deviceStatus.textContent = "Camera blocked";
    els.actionNote.textContent = "Camera permission failed. Run on localhost/HTTPS and allow camera access.";
  }
}

function getSurveyLocation() {
  if (!navigator.geolocation) {
    state.locationStatus = "unsupported";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude,
        altitudeAccuracy: position.coords.altitudeAccuracy,
        capturedAt: new Date().toISOString(),
      };
      state.locationStatus = "captured";
    },
    () => {
      state.location = null;
      state.locationStatus = "denied";
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
  );
}

function startSurveySampling() {
  state.surveyActive = true;
  sampleSurveyFrame();
  state.samplingTimer = window.setInterval(sampleSurveyFrame, SAMPLE_INTERVAL_MS);
}

function stopSurvey() {
  if (state.samplingTimer) {
    window.clearInterval(state.samplingTimer);
    state.samplingTimer = null;
  }
  state.surveyActive = false;
}

function stopCameraStream() {
  if (!state.stream) return;
  state.stream.getTracks().forEach((track) => track.stop());
  state.stream = null;
  els.cameraFeed.srcObject = null;
}

function nextCoverageCell() {
  const index = state.frames.length % (COVERAGE_ROWS * COVERAGE_COLS);
  const sweep = Math.floor(state.frames.length / COVERAGE_COLS);
  const col = sweep % 2 === 0 ? index % COVERAGE_COLS : COVERAGE_COLS - 1 - (index % COVERAGE_COLS);
  const row = Math.min(COVERAGE_ROWS - 1, Math.floor(index / COVERAGE_COLS));
  return { row, col };
}

function sampleSurveyFrame() {
  if (!state.stream || !els.cameraFeed.videoWidth || state.frames.length >= MAX_FRAMES) return;
  const frameCanvas = document.createElement("canvas");
  const width = 360;
  const height = Math.round((els.cameraFeed.videoHeight / els.cameraFeed.videoWidth) * width);
  frameCanvas.width = width;
  frameCanvas.height = height;
  frameCanvas.getContext("2d").drawImage(els.cameraFeed, 0, 0, width, height);
  const cell = nextCoverageCell();
  const cellKey = `${cell.row}:${cell.col}`;
  state.coverageCells.set(cellKey, {
    ...cell,
    confidence: Math.min(0.98, 0.62 + state.frames.length * 0.012),
    sampledAt: new Date().toISOString(),
  });
  state.frames.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `frame-${Date.now()}-${state.frames.length}`,
    createdAt: new Date().toISOString(),
    coverageCell: cell,
    pose: {
      heading: Math.round((state.frames.length * 31) % 360),
      pitch: -4 + Math.round(Math.random() * 8),
      confidence: Math.round(72 + Math.random() * 24),
    },
    image: frameCanvas.toDataURL("image/jpeg", 0.6),
  });
  state.coverage = Math.min(100, Math.round((state.coverageCells.size / (COVERAGE_ROWS * COVERAGE_COLS)) * 100));
  if (state.frames.length >= MAX_FRAMES) {
    stopSurvey();
    els.deviceStatus.textContent = "Coverage full";
    els.actionNote.textContent = "Maximum prototype samples reached. Tap Survey done to process the model.";
  }
  updateMetrics();
  drawOverlay();
}

function buildScanPackage(includeImages = true) {
  return {
    app: "SiteMapper Scan",
    version: 1,
    exportedAt: new Date().toISOString(),
    targetModelFormat: "glb",
    captureMode: "continuous-survey",
    location: state.location,
    locationStatus: state.locationStatus,
    coverageMap: Array.from(state.coverageCells.values()),
    frames: state.frames.map((frame) => {
      if (includeImages) return frame;
      const { image, ...metadata } = frame;
      return metadata;
    }),
    summary: {
      frameCount: state.frames.length,
      coverage: state.coverage,
      quality: els.qualityValue.textContent,
    },
  };
}

async function uploadScanPackage() {
  const response = await fetch("/api/scans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildScanPackage(true)),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Scan upload failed");
  }
  return response.json();
}

async function waitForModel(scanId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`/api/scans/${scanId}`);
    if (!response.ok) throw new Error("Could not read scan status");
    const scan = await response.json();
    els.modelState.textContent = `${scan.progress || 0}%`;
    if (scan.status === "complete") return scan;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Model processing timed out");
}

async function loadBackendModel(scanId) {
  const response = await fetch(`/api/scans/${scanId}/model`);
  if (!response.ok) throw new Error("Could not load generated model");
  state.model = await response.json();
}

async function finishScan() {
  stopSurvey();
  stopCameraStream();
  state.processing = true;
  state.modelReady = false;
  state.model = null;
  setMode("process");
  setStep(2);
  updateMetrics();
  els.finishScan.disabled = true;
  els.deviceStatus.textContent = "Uploading";
  els.actionNote.textContent = "Uploading survey samples, coverage mesh, and location metadata to the backend.";

  try {
    const scan = await uploadScanPackage();
    state.scanId = scan.id;
    setStep(3);
    els.deviceStatus.textContent = "Processing";
    els.actionNote.textContent = `Backend job ${scan.id} is generating a draft model and map placement metadata.`;
    updateMetrics();
    await waitForModel(scan.id);
    await loadBackendModel(scan.id);
    state.processing = false;
    state.modelReady = true;
    els.deviceStatus.textContent = "Model ready";
    els.actionNote.textContent = state.model?.placement?.accuracyLabel === "manual_required"
      ? "Model is ready. GPS was unavailable, so map placement needs a manual pin later."
      : "Model is ready with approximate map placement. Rotate it and check scan completeness.";
    updateMetrics();
    setMode("view");
    updateMapPlacement();
  } catch (error) {
    state.processing = false;
    els.deviceStatus.textContent = "Backend error";
    els.actionNote.textContent = error.message || "Backend upload or processing failed.";
    updateMetrics();
  }
}

function exportPackage() {
  const payload = buildScanPackage(false);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "scan-package.json";
  link.click();
  URL.revokeObjectURL(url);
}

function drawOverlay() {
  resizeCanvas(els.scanOverlay);
  const { width, height } = els.scanOverlay.getBoundingClientRect();
  overlayContext.clearRect(0, 0, width, height);
  overlayContext.strokeStyle = "rgba(87, 166, 255, 0.75)";
  overlayContext.lineWidth = 2;

  const inset = Math.min(width, height) * 0.08;
  overlayContext.strokeRect(inset, inset, width - inset * 2, height - inset * 2);

  const meshWidth = width - inset * 2;
  const meshHeight = height - inset * 2;
  const cellWidth = meshWidth / COVERAGE_COLS;
  const cellHeight = meshHeight / COVERAGE_ROWS;
  for (let row = 0; row < COVERAGE_ROWS; row += 1) {
    for (let col = 0; col < COVERAGE_COLS; col += 1) {
      const key = `${row}:${col}`;
      const covered = state.coverageCells.has(key);
      const centerX = inset + col * cellWidth + cellWidth / 2;
      const centerY = inset + row * cellHeight + cellHeight / 2;

      if (covered) {
        overlayContext.fillStyle = "rgba(87, 166, 255, 0.13)";
        overlayContext.fillRect(inset + col * cellWidth, inset + row * cellHeight, cellWidth, cellHeight);
      }

      overlayContext.beginPath();
      overlayContext.arc(centerX, centerY, covered ? 5.5 : 3.5, 0, Math.PI * 2);
      overlayContext.fillStyle = covered ? "#57a6ff" : "rgba(245,247,251,0.28)";
      overlayContext.fill();
    }
  }

  overlayContext.fillStyle = "rgba(14,17,22,0.72)";
  overlayContext.fillRect(16, 16, 285, 66);
  overlayContext.fillStyle = "#f5f7fb";
  overlayContext.font = "700 15px system-ui";
  overlayContext.fillText(`Coverage ${state.coverage}%`, 30, 42);
  overlayContext.fillStyle = state.locationStatus === "captured" ? "#39d59f" : "rgba(245,247,251,0.68)";
  overlayContext.font = "700 12px system-ui";
  const locationText = state.locationStatus === "captured"
    ? `GPS +/- ${Math.round(state.location.accuracy)}m`
    : state.locationStatus === "denied"
      ? "GPS denied: manual map pin needed"
      : "Getting GPS for map placement";
  overlayContext.fillText(locationText, 30, 64);
}

function project(point, width, height) {
  const [x, y, z] = point;
  const cy = Math.cos(state.rotationY);
  const sy = Math.sin(state.rotationY);
  const cx = Math.cos(state.rotationX);
  const sx = Math.sin(state.rotationX);

  const dx = x * cy - z * sy;
  const dz = x * sy + z * cy;
  const dy = y * cx - dz * sx;
  const depth = y * sx + dz * cx + 6;
  const scale = (Math.min(width, height) * 0.34 * state.zoom) / depth;

  return {
    x: width / 2 + dx * scale,
    y: height / 2 - dy * scale,
    depth,
  };
}

function drawFace(points, color) {
  viewerContext.beginPath();
  points.forEach((point, index) => {
    if (index === 0) viewerContext.moveTo(point.x, point.y);
    else viewerContext.lineTo(point.x, point.y);
  });
  viewerContext.closePath();
  viewerContext.fillStyle = color;
  viewerContext.fill();
  viewerContext.strokeStyle = "rgba(245,247,251,0.24)";
  viewerContext.lineWidth = 1;
  viewerContext.stroke();
}

function drawModel() {
  resizeCanvas(els.modelViewer);
  const { width, height } = els.modelViewer.getBoundingClientRect();
  viewerContext.clearRect(0, 0, width, height);
  viewerContext.fillStyle = "#0e1116";
  viewerContext.fillRect(0, 0, width, height);

  const modelVertices = state.model?.vertices || [
    [-2.2, -1, -1.4],
    [2.2, -1, -1.4],
    [2.2, -1, 1.4],
    [-2.2, -1, 1.4],
    [-2.2, 0.9, -1.4],
    [2.2, 0.9, -1.4],
    [2.2, 0.9, 1.4],
    [-2.2, 0.9, 1.4],
    [0, 1.75, -1.4],
    [0, 1.75, 1.4],
  ];
  const vertices = modelVertices.map((point) => project(point, width, height));

  const faces = (state.model?.faces || [
    { indexes: [0, 1, 2, 3], color: "#202631" },
    { indexes: [0, 4, 5, 1], color: "#3b4657" },
    { indexes: [1, 5, 6, 2], color: "#2f3948" },
    { indexes: [2, 6, 7, 3], color: "#465366" },
    { indexes: [3, 7, 4, 0], color: "#26303d" },
    { indexes: [4, 8, 5], color: "#39d59f" },
    { indexes: [7, 6, 9], color: "#57a6ff" },
    { indexes: [4, 7, 9, 8], color: "#223141" },
    { indexes: [5, 8, 9, 6], color: "#1b2633" },
  ]).sort((a, b) => {
    const da = a.indexes.reduce((sum, index) => sum + vertices[index].depth, 0) / a.indexes.length;
    const db = b.indexes.reduce((sum, index) => sum + vertices[index].depth, 0) / b.indexes.length;
    return db - da;
  });

  faces.forEach((face) => drawFace(face.indexes.map((index) => vertices[index]), face.color));

  viewerContext.fillStyle = "rgba(245,247,251,0.86)";
  viewerContext.font = "800 16px system-ui";
  viewerContext.fillText(state.model?.label || "Draft GLB property model", 18, 32);
  if (state.model?.dimensions_m) {
    const { length, width: modelWidth, height: modelHeight } = state.model.dimensions_m;
    viewerContext.font = "700 13px system-ui";
    viewerContext.fillStyle = "rgba(245,247,251,0.62)";
    viewerContext.fillText(`${length}m x ${modelWidth}m x ${modelHeight}m`, 18, 54);
  }
  if (state.model?.placement) {
    const placement = state.model.placement;
    viewerContext.font = "700 13px system-ui";
    viewerContext.fillStyle = placement.accuracyLabel === "manual_required" ? "#ffcf66" : "#57a6ff";
    const placementText = placement.accuracyLabel === "manual_required"
      ? "Map placement: manual pin required"
      : `Map placement: ${placement.latitude.toFixed(5)}, ${placement.longitude.toFixed(5)}`;
    viewerContext.fillText(placementText, 18, 76);
  }
}

function modelDimensions() {
  const dimensions = state.model?.dimensions_m;
  return {
    length: Math.max(1, dimensions?.length || 5),
    width: Math.max(1, dimensions?.width || 4),
    height: Math.max(1, dimensions?.height || 3),
  };
}

function initMap() {
  if (state.mapViewer) return true;
  if (!window.Cesium) {
    els.mapHint.textContent = "CesiumJS did not load. Check internet access, then reload to use map placement.";
    return false;
  }

  try {
    state.mapViewer = new Cesium.Viewer(els.cesiumMap, {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      imageryProvider: new Cesium.OpenStreetMapImageryProvider({
        url: "https://tile.openstreetmap.org/",
      }),
    });
    state.mapViewer.scene.globe.depthTestAgainstTerrain = false;
    state.mapReady = true;
    return true;
  } catch (error) {
    els.mapHint.textContent = "Could not initialize the free 3D map viewer.";
    return false;
  }
}

function updateMapPlacement() {
  if (!initMap()) return;

  const placement = state.model?.placement;
  if (!state.modelReady || !placement) {
    els.mapHint.textContent = "Complete a survey to place the generated model on the map.";
    return;
  }

  if (placement.accuracyLabel === "manual_required" || placement.latitude == null || placement.longitude == null) {
    els.mapHint.textContent = "The model is ready, but GPS was unavailable. A manual map pin is needed before placement.";
    return;
  }

  const { length, width, height } = modelDimensions();
  const altitude = placement.altitude || 0;
  const center = Cesium.Cartesian3.fromDegrees(
    placement.longitude,
    placement.latitude,
    altitude + height / 2,
  );
  const heading = Cesium.Math.toRadians(placement.rotation || 0);
  const orientation = Cesium.Transforms.headingPitchRollQuaternion(
    center,
    new Cesium.HeadingPitchRoll(heading, 0, 0),
  );

  if (state.mapEntity) {
    state.mapViewer.entities.remove(state.mapEntity);
  }

  state.mapEntity = state.mapViewer.entities.add({
    name: "Survey model placement",
    position: center,
    orientation,
    box: {
      dimensions: new Cesium.Cartesian3(width, length, height),
      material: Cesium.Color.fromCssColorString("#57a6ff").withAlpha(0.52),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString("#39d59f"),
    },
    label: {
      text: "Survey model",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -28),
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    },
  });

  state.mapViewer.flyTo(state.mapEntity, {
    duration: 0.8,
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(25),
      Cesium.Math.toRadians(-35),
      Math.max(80, length * 18),
    ),
  });
  els.mapHint.textContent = `Placed from phone GPS: ${placement.latitude.toFixed(5)}, ${placement.longitude.toFixed(5)}. Accuracy +/- ${Math.round(placement.horizontalAccuracyM || 0)}m.`;
}

function bindViewerControls() {
  els.modelViewer.addEventListener("pointerdown", (event) => {
    state.dragging = true;
    state.lastPointer = { x: event.clientX, y: event.clientY };
    els.modelViewer.setPointerCapture(event.pointerId);
  });

  els.modelViewer.addEventListener("pointermove", (event) => {
    if (!state.dragging || !state.lastPointer) return;
    const dx = event.clientX - state.lastPointer.x;
    const dy = event.clientY - state.lastPointer.y;
    state.rotationY += dx * 0.01;
    state.rotationX += dy * 0.01;
    state.rotationX = Math.max(-1.1, Math.min(0.4, state.rotationX));
    state.lastPointer = { x: event.clientX, y: event.clientY };
    drawModel();
  });

  els.modelViewer.addEventListener("pointerup", () => {
    state.dragging = false;
    state.lastPointer = null;
  });

  els.modelViewer.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      state.zoom = Math.max(0.65, Math.min(1.8, state.zoom - event.deltaY * 0.001));
      drawModel();
    },
    { passive: false },
  );
}

els.startScan.addEventListener("click", startCamera);
els.finishScan.addEventListener("click", finishScan);
els.exportPackage.addEventListener("click", exportPackage);
els.tabs.forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
window.addEventListener("resize", () => {
  drawOverlay();
  drawModel();
});

bindViewerControls();
updateMetrics();
drawOverlay();
drawModel();
