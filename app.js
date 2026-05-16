const canvas = document.getElementById("output");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const sourceCanvas = document.getElementById("source");
const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
const statusEl = document.getElementById("status") || { textContent: "" };
const blobCountEl = document.getElementById("blobCount");
const CANVAS_PRESETS = {
  portrait: { width: 1080, height: 1920, ratio: "9 / 16" },
  landscape: { width: 1920, height: 1080, ratio: "16 / 9" },
};
const DEFAULT_ORIENTATION = "portrait";
const CENTER_SNAP_THRESHOLD = 24;

const state = {
  running: true,
  style: "scope",
  filter: "none",
  threshold: 128,
  sample: 3,
  minArea: 64,
  maxBlobs: 22,
  stroke: 1.5,
  linkRate: 0.45,
  fontSize: 12,
  color: "#111111",
  invertMask: false,
  singleMode: false,
  showText: false,
  crazyColor: false,
  blink: false,
  dashed: false,
  hub: false,
  hideTracking: false,
  recording: false,
  recorder: null,
  chunks: [],
  facingMode: "environment",
  cameraActive: false,
  qualityMode: "quality",
  orientation: DEFAULT_ORIENTATION,
  renderWidth: CANVAS_PRESETS[DEFAULT_ORIENTATION].width,
  renderHeight: CANVAS_PRESETS[DEFAULT_ORIENTATION].height,
  dpr: 1,
  mediaObjects: [],
  selectedId: null,
  selectedIds: [],
  lastBlobs: [],
  nextMediaId: 1,
  interaction: null,
  snapGuides: null,
};

const controls = [
  ["threshold", "thresholdOut", Number],
  ["sample", "sampleOut", Number],
  ["minArea", "minAreaOut", Number],
  ["maxBlobs", "maxBlobsOut", Number],
  ["stroke", "strokeOut", Number],
  ["linkRate", "linkOut", Number],
  ["fontSize", "fontOut", Number],
];

for (const [id, outId, cast] of controls) {
  const input = document.getElementById(id);
  const out = document.getElementById(outId);
  input.addEventListener("input", () => {
    state[id] = cast(input.value);
    out.value = input.value;
  });
}

for (const id of ["invertMask", "singleMode", "showText", "crazyColor", "blink", "dashed", "hub", "hideTracking"]) {
  const input = document.getElementById(id);
  input.checked = Boolean(state[id]);
  input.addEventListener("change", (event) => {
    state[id] = event.target.checked;
  });
}

const mainColorInput = document.getElementById("mainColor");
mainColorInput.value = state.color;
mainColorInput.addEventListener("input", syncMainColor);
mainColorInput.addEventListener("change", syncMainColor);

function syncMainColor(event) {
  state.color = normalizeColor(event.target.value);
}

document.querySelectorAll("[data-style]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-style]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.style = button.dataset.style;
  });
});

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-filter]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.filter = button.dataset.filter;
  });
});

document.querySelectorAll("[data-quality]").forEach((button) => {
  button.addEventListener("click", async () => {
    document.querySelectorAll("[data-quality]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    await setQualityMode(button.dataset.quality);
  });
});

document.querySelectorAll("[data-orientation]").forEach((button) => {
  button.addEventListener("click", () => {
    setCanvasOrientation(button.dataset.orientation);
  });
});

document.getElementById("fileInput").addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;
  stopCameraTracks();
  for (const file of files) {
    await importMediaFile(file);
  }
  setStatus(`${files.length} media imported`);
  event.target.value = "";
});

async function importMediaFile(file) {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith("video/")) {
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    await waitForVideo(video);
    await video.play().catch(() => {});
    addMediaObject({ type: "video", element: video, naturalWidth: video.videoWidth, naturalHeight: video.videoHeight });
  } else {
    const image = new Image();
    image.src = url;
    await image.decode();
    addMediaObject({ type: "image", element: image, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight });
  }
}

document.getElementById("cameraBtn").addEventListener("click", async () => {
  await startCamera(state.facingMode);
});

document.getElementById("flipCameraBtn").addEventListener("click", flipCamera);

document.getElementById("playBtn").addEventListener("click", (event) => {
  state.running = !state.running;
  event.currentTarget.textContent = state.running ? "Pause" : "Play";
  if (state.running) requestAnimationFrame(render);
});

document.getElementById("snapshotBtn").addEventListener("click", exportHighResolutionPng);
document.getElementById("exportSvgBtn").addEventListener("click", exportConnectionSvg);

document.getElementById("recordBtn").addEventListener("click", () => {
  if (state.recording) {
    state.recorder?.stop();
    return;
  }
  const stream = canvas.captureStream(60);
  state.chunks = [];
  state.recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  state.recorder.ondataavailable = (event) => {
    if (event.data.size) state.chunks.push(event.data);
  };
  state.recorder.onstop = () => {
    const blob = new Blob(state.chunks, { type: "video/webm" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `baby-track-${Date.now()}.webm`;
    link.click();
    state.recording = false;
    document.getElementById("recordBtn").textContent = "Record WebM";
  };
  state.recorder.start();
  state.recording = true;
  document.getElementById("recordBtn").textContent = "Stop Recording";
});

document.getElementById("resetBtn").addEventListener("click", () => location.reload());

document.getElementById("mediaSize").addEventListener("input", (event) => {
  const objects = selectedObjects();
  if (objects.length === 0) return;
  const scale = Number(event.target.value) / 100;
  objects.forEach((object) => {
    object.scale = scale;
  });
  updateMediaSizeOutput();
});

document.getElementById("fitCanvasBtn").addEventListener("click", () => fitSelectedMedia("contain"));
document.getElementById("fillCanvasBtn").addEventListener("click", () => fitSelectedMedia("cover"));
document.getElementById("deleteMediaBtn").addEventListener("click", deleteSelectedMedia);

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", endInteraction);
canvas.addEventListener("pointercancel", endInteraction);
window.addEventListener("keydown", onKeyDown);
window.addEventListener("resize", syncCanvasDisplayRatio);
window.visualViewport?.addEventListener("resize", syncCanvasDisplayRatio);

function waitForVideo(video) {
  return new Promise((resolve) => {
    if (video.readyState >= 1) {
      resolve();
      return;
    }
    video.addEventListener("loadedmetadata", resolve, { once: true });
  });
}

function addMediaObject({ type, element, naturalWidth, naturalHeight, camera = false }) {
  const width = naturalWidth || state.renderWidth;
  const height = naturalHeight || state.renderHeight;
  const object = {
    id: state.nextMediaId++,
    type,
    element,
    x: state.renderWidth / 2,
    y: state.renderHeight / 2,
    width,
    height,
    scale: 1,
    rotation: 0,
    opacity: 1,
    selected: true,
    camera,
    mirror: false,
  };
  state.mediaObjects.forEach((item) => {
    item.selected = false;
  });
  state.mediaObjects.push(object);
  state.selectedId = object.id;
  state.selectedIds = [object.id];
  fitMediaObject(object, "contain", 0.82);
  updateMediaSizeOutput();
  return object;
}

async function startCamera(facingMode) {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera unsupported");
    return;
  }
  const nextMode = facingMode || state.facingMode;
  try {
    stopCameraTracks();
    const video = document.createElement("video");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: getCameraConstraints(nextMode),
    });
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    state.facingMode = nextMode;
    state.cameraActive = true;
    const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
    const object = addMediaObject({
      type: "video",
      element: video,
      naturalWidth: video.videoWidth || settings.width || state.renderWidth,
      naturalHeight: video.videoHeight || settings.height || state.renderHeight,
      camera: true,
    });
    object.mirror = nextMode === "user";
    setStatus(settings.width && settings.height ? `${settings.width}x${settings.height}` : "Camera active");
  } catch {
    state.cameraActive = false;
    setStatus("Camera unavailable");
  }
  updateCameraButtons();
}

function getCameraConstraints(facingMode) {
  const high = state.qualityMode === "quality";
  return {
    facingMode: { ideal: facingMode },
    width: { ideal: high ? 1920 : 1280 },
    height: { ideal: high ? 1080 : 720 },
    frameRate: { ideal: high ? 30 : 60, max: 60 },
  };
}

async function setQualityMode(mode) {
  state.qualityMode = mode === "performance" ? "performance" : "quality";
  setRangeValue("sample", state.qualityMode === "quality" ? 3 : 5);
  setStatus(state.qualityMode === "quality" ? "High quality" : "Performance");
  if (state.cameraActive) await startCamera(state.facingMode);
}

function setRangeValue(id, value) {
  const input = document.getElementById(id);
  const output = document.getElementById(`${id}Out`);
  state[id] = value;
  input.value = String(value);
  if (output) output.value = String(value);
}

async function flipCamera() {
  if (!state.cameraActive) return;
  const nextMode = state.facingMode === "user" ? "environment" : "user";
  await startCamera(nextMode);
}

function stopCameraTracks(removeCameraObjects = true) {
  for (const object of state.mediaObjects) {
    if (object.camera && object.element?.srcObject) {
      object.element.srcObject.getTracks().forEach((track) => track.stop());
      object.element.srcObject = null;
    }
  }
  if (removeCameraObjects) {
    state.mediaObjects = state.mediaObjects.filter((object) => !object.camera);
    if (!selectedObject()) {
      const lastObject = state.mediaObjects[state.mediaObjects.length - 1];
      selectObject(lastObject ? lastObject.id : null);
    }
  }
  state.cameraActive = false;
  updateCameraButtons();
}

function updateCameraButtons() {
  const button = document.getElementById("flipCameraBtn");
  button.disabled = !state.cameraActive;
  button.textContent = state.facingMode === "user" ? "Back Camera" : "Front Camera";
}

function selectedObject() {
  return state.mediaObjects.find((object) => object.id === state.selectedId) || selectedObjects().at(-1) || null;
}

function selectedObjects() {
  return state.mediaObjects.filter((object) => state.selectedIds.includes(object.id));
}

function updateMediaSizeOutput() {
  const objects = selectedObjects();
  const value = objects.length ? Math.round(objects.reduce((sum, object) => sum + object.scale, 0) / objects.length * 100) : 100;
  const input = document.getElementById("mediaSize");
  const output = document.getElementById("mediaSizeOut");
  input.value = String(Math.max(10, Math.min(300, value)));
  output.value = String(value);
}

function fitSelectedMedia(mode) {
  const objects = selectedObjects();
  if (objects.length === 0) return;
  objects.forEach((object) => fitMediaObject(object, mode, 1));
  updateMediaSizeOutput();
}

function deleteSelectedMedia() {
  const objects = selectedObjects();
  if (objects.length === 0) return;
  const ids = new Set(objects.map((object) => object.id));
  for (const object of objects) {
    if (object.camera && object.element?.srcObject) {
      object.element.srcObject.getTracks().forEach((track) => track.stop());
      state.cameraActive = false;
      updateCameraButtons();
    }
  }
  state.mediaObjects = state.mediaObjects.filter((item) => !ids.has(item.id));
  const nextObject = state.mediaObjects[state.mediaObjects.length - 1];
  selectObject(nextObject ? nextObject.id : null);
}

function onKeyDown(event) {
  const isDeleteKey = event.key === "Backspace" || event.key === "Delete" || event.code === "Backspace" || event.code === "Delete" || event.keyCode === 8 || event.keyCode === 46;
  if (!isDeleteKey) return;
  const tagName = document.activeElement?.tagName?.toLowerCase();
  if (["input", "textarea", "select", "button"].includes(tagName)) return;
  if (selectedObjects().length === 0) return;
  event.preventDefault();
  deleteSelectedMedia();
}

function fitMediaObject(object, mode, paddingScale) {
  const scaleX = state.renderWidth / object.width;
  const scaleY = state.renderHeight / object.height;
  object.scale = (mode === "cover" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)) * paddingScale;
  object.x = state.renderWidth / 2;
  object.y = state.renderHeight / 2;
}

function currentCanvasPreset() {
  return CANVAS_PRESETS[state.orientation] || CANVAS_PRESETS[DEFAULT_ORIENTATION];
}

function setCanvasOrientation(orientation) {
  if (!CANVAS_PRESETS[orientation] || orientation === state.orientation) return;
  const oldWidth = state.renderWidth;
  const oldHeight = state.renderHeight;
  const nextPreset = CANVAS_PRESETS[orientation];
  const scaleX = nextPreset.width / oldWidth;
  const scaleY = nextPreset.height / oldHeight;
  const sizeScale = Math.min(scaleX, scaleY);
  state.orientation = orientation;
  state.renderWidth = nextPreset.width;
  state.renderHeight = nextPreset.height;
  for (const object of state.mediaObjects) {
    object.x *= scaleX;
    object.y *= scaleY;
    object.scale *= sizeScale;
  }
  document.querySelectorAll("[data-orientation]").forEach((button) => {
    button.classList.toggle("active", button.dataset.orientation === orientation);
  });
  applyCanvasDisplayPreset();
  syncCanvasDisplayRatio();
  updateMediaSizeOutput();
}

function applyCanvasDisplayPreset() {
  const preset = currentCanvasPreset();
  const aspect = preset.width / preset.height;
  document.documentElement.style.setProperty("--canvas-aspect", String(aspect));
  document.documentElement.style.setProperty("--canvas-ratio", preset.ratio);
  canvas.style.aspectRatio = preset.ratio;
  const backingWidth = Math.round(preset.width * state.dpr);
  const backingHeight = Math.round(preset.height * state.dpr);
  if (canvas.width !== backingWidth) canvas.width = backingWidth;
  if (canvas.height !== backingHeight) canvas.height = backingHeight;
}

function resizeCanvasToDisplay() {
  const preset = currentCanvasPreset();
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, state.qualityMode === "quality" ? 3 : 2));
  const backingWidth = Math.round(preset.width * dpr);
  const backingHeight = Math.round(preset.height * dpr);
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  state.renderWidth = preset.width;
  state.renderHeight = preset.height;
  state.dpr = dpr;
  applyCanvasDisplayPreset();
  syncCanvasDisplayRatio();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function syncCanvasDisplayRatio() {
  const preset = currentCanvasPreset();
  const aspect = preset.width / preset.height;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const expectedHeight = rect.width / aspect;
  if (Math.abs(rect.height - expectedHeight) > 0.5) {
    canvas.style.height = `${expectedHeight}px`;
  }
}

function render(time = 0) {
  if (!state.running) return;
  resizeCanvasToDisplay();
  drawBaseScene(ctx, state.renderWidth, state.renderHeight, time);
  const blobs = detectBlobs();
  state.lastBlobs = blobs;
  applyFilterToCanvas(ctx, canvas);
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  if (!state.hideTracking) drawTracking(ctx, state.renderWidth, state.renderHeight, blobs, time);
  drawSelectionHandles(ctx);
  if (blobCountEl) blobCountEl.textContent = `${blobs.length} blobs`;
  requestAnimationFrame(render);
}

function drawBaseScene(targetCtx, width, height, time) {
  targetCtx.clearRect(0, 0, width, height);
  if (state.mediaObjects.length === 0) {
    drawDemo(targetCtx, time, width, height);
    return;
  }
  targetCtx.fillStyle = "#e7e7e7";
  targetCtx.fillRect(0, 0, width, height);
  for (const object of state.mediaObjects) {
    drawMediaObject(targetCtx, object);
  }
}

function drawMediaObject(targetCtx, object) {
  const drawWidth = object.width * object.scale;
  const drawHeight = object.height * object.scale;
  targetCtx.save();
  targetCtx.globalAlpha = object.opacity;
  targetCtx.translate(object.x, object.y);
  targetCtx.rotate(object.rotation);
  if (object.mirror) targetCtx.scale(-1, 1);
  targetCtx.drawImage(object.element, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  targetCtx.restore();
}

function drawDemo(targetCtx, time, width, height) {
  const t = time * 0.001;
  const grd = targetCtx.createLinearGradient(0, 0, width, height);
  grd.addColorStop(0, "#08100d");
  grd.addColorStop(0.45, "#1b141f");
  grd.addColorStop(1, "#07161b");
  targetCtx.fillStyle = grd;
  targetCtx.fillRect(0, 0, width, height);
  targetCtx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 15; i++) {
    const x = width * (0.5 + 0.38 * Math.sin(t * (0.42 + i * 0.05) + i));
    const y = height * (0.5 + 0.36 * Math.cos(t * (0.33 + i * 0.04) + i * 1.7));
    const r = 18 + Math.min(width, height) * 0.055 * (0.5 + 0.5 * Math.sin(t + i));
    targetCtx.fillStyle = `hsla(${(i * 37 + t * 90) % 360}, 84%, 62%, 0.56)`;
    targetCtx.beginPath();
    targetCtx.arc(x, y, r, 0, Math.PI * 2);
    targetCtx.fill();
  }
  targetCtx.globalCompositeOperation = "source-over";
}

function applyFilterToCanvas(targetCtx, targetCanvas) {
  if (state.filter === "none") return;
  targetCtx.save();
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  const img = targetCtx.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = r * 0.299 + g * 0.587 + b * 0.114;
    if (state.filter === "invert") {
      data[i] = 255 - r;
      data[i + 1] = 255 - g;
      data[i + 2] = 255 - b;
    } else if (state.filter === "crt") {
      const y = Math.floor(i / 4 / targetCanvas.width);
      const scan = y % 4 < 2 ? 0.78 : 1;
      data[i] = r * scan;
      data[i + 1] = g * scan;
      data[i + 2] = b * scan;
    }
  }
  targetCtx.putImageData(img, 0, 0);
  targetCtx.restore();
}

function detectBlobs() {
  const scale = state.sample;
  const w = Math.max(1, Math.floor(state.renderWidth / scale));
  const h = Math.max(1, Math.floor(state.renderHeight / scale));
  sourceCanvas.width = w;
  sourceCanvas.height = h;
  sourceCtx.setTransform(1, 0, 0, 1, 0, 0);
  sourceCtx.drawImage(canvas, 0, 0, w, h);
  const data = sourceCtx.getImageData(0, 0, w, h).data;
  const visited = new Uint8Array(w * h);
  const blobs = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const start = y * w + x;
      if (visited[start] || !passes(data, start)) continue;
      const blob = flood(start, w, h, data, visited);
      if (blob.area >= state.minArea / (scale * scale)) blobs.push(blob);
    }
  }
  blobs.sort((a, b) => b.area - a.area);
  return blobs.slice(0, state.singleMode ? 1 : state.maxBlobs).map((blob, index) => ({
    id: index + 1,
    x: blob.minX * scale,
    y: blob.minY * scale,
    w: (blob.maxX - blob.minX + 1) * scale,
    h: (blob.maxY - blob.minY + 1) * scale,
    cx: (blob.sumX / blob.area) * scale,
    cy: (blob.sumY / blob.area) * scale,
    area: blob.area * scale * scale,
    hue: (index * 47 + blob.area) % 360,
  }));
}

function passes(data, pixelIndex) {
  const i = pixelIndex * 4;
  if (isBackgroundPixel(data[i], data[i + 1], data[i + 2])) return false;
  const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  return state.invertMask ? gray < state.threshold : gray > state.threshold;
}

function isBackgroundPixel(r, g, b) {
  return Math.abs(r - 231) <= 4 && Math.abs(g - 231) <= 4 && Math.abs(b - 231) <= 4;
}

function flood(start, width, height, data, visited) {
  const stack = [start];
  visited[start] = 1;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let area = 0;
  let sumX = 0;
  let sumY = 0;
  while (stack.length) {
    const p = stack.pop();
    const x = p % width;
    const y = (p - x) / width;
    area++;
    sumX += x;
    sumY += y;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    const neighbors = [p - 1, p + 1, p - width, p + width];
    for (const n of neighbors) {
      if (n < 0 || n >= visited.length || visited[n] || !passes(data, n)) continue;
      visited[n] = 1;
      stack.push(n);
    }
  }
  return { minX, minY, maxX, maxY, area, sumX, sumY };
}

function drawTracking(targetCtx, width, height, blobs, time) {
  const color = normalizeColor(state.color);
  targetCtx.save();
  targetCtx.lineWidth = state.stroke;
  targetCtx.font = `${state.fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  targetCtx.textBaseline = "top";
  targetCtx.setLineDash(state.dashed ? [10, 8] : []);
  if (state.blink && Math.floor(time / 140) % 3 === 0) targetCtx.globalAlpha = 0.2;
  drawConnections(targetCtx, width, height, blobs, color, time, Boolean(state.hub));
  for (const blob of blobs) {
    const c = blobColor(blob, color);
    targetCtx.strokeStyle = c;
    targetCtx.fillStyle = c;
    targetCtx.shadowColor = state.style === "glow" ? c : "transparent";
    targetCtx.shadowBlur = state.style === "glow" ? 22 : 0;
    drawRegion(targetCtx, blob, time);
    if (state.showText) drawLabel(targetCtx, blob, c, width);
  }
  targetCtx.restore();
}

function drawConnections(targetCtx, width, height, blobs, color, time, useCenterHub) {
  if (state.linkRate <= 0 || blobs.length < 2) return;
  targetCtx.save();
  targetCtx.globalAlpha = 1;
  targetCtx.globalCompositeOperation = "source-over";
  targetCtx.shadowBlur = 0;
  targetCtx.setLineDash(state.dashed ? [10, 8] : []);
  const hub = { cx: width / 2, cy: height / 2 };
  for (let i = 0; i < blobs.length; i++) {
    const a = blobs[i];
    const targets = useCenterHub ? [hub] : blobs.slice(i + 1);
    for (const b of targets) {
      const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      if (d > Math.min(width, height) * state.linkRate) continue;
      targetCtx.strokeStyle = connectionColor(a, b, color);
      targetCtx.beginPath();
      targetCtx.moveTo(a.cx, a.cy);
      targetCtx.lineTo(b.cx, b.cy);
      targetCtx.stroke();
    }
  }
  targetCtx.restore();
}

function getConnectionSegments(blobs, width, height, useCenterHub) {
  if (state.linkRate <= 0 || blobs.length < 2) return [];
  const limit = Math.min(width, height) * state.linkRate;
  const hub = { cx: width / 2, cy: height / 2, id: "center" };
  const segments = [];
  for (let i = 0; i < blobs.length; i++) {
    const a = blobs[i];
    const targets = useCenterHub ? [hub] : blobs.slice(i + 1);
    for (const b of targets) {
      const distance = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      if (distance > limit) continue;
      segments.push({
        x1: a.cx,
        y1: a.cy,
        x2: b.cx,
        y2: b.cy,
        from: a.id,
        to: b.id,
        distance,
      });
    }
  }
  return segments;
}

function normalizeColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#ffffff";
}

function blobColor(blob, fallback) {
  return state.crazyColor && blob ? `hsl(${blob.hue}, 90%, 65%)` : fallback;
}

function connectionColor(a, b, fallback) {
  if (!state.crazyColor) return fallback;
  if (!a) return fallback;
  if (!b || b.id === "center") return blobColor(a, fallback);
  const hue = ((a.hue || 0) + (b.hue || 0)) / 2;
  return `hsl(${hue}, 90%, 65%)`;
}

function drawRegion(targetCtx, blob, time) {
  const x = blob.x;
  const y = blob.y;
  const w = blob.w;
  const h = blob.h;
  const cx = blob.cx;
  const cy = blob.cy;
  const tick = 12;
  if (state.style === "cross") {
    targetCtx.beginPath();
    targetCtx.moveTo(cx - w / 2, cy);
    targetCtx.lineTo(cx + w / 2, cy);
    targetCtx.moveTo(cx, cy - h / 2);
    targetCtx.lineTo(cx, cy + h / 2);
    targetCtx.stroke();
    targetCtx.strokeRect(cx - 4, cy - 4, 8, 8);
    return;
  }
  if (state.style === "scope") {
    const scopeTick = 8;
    targetCtx.beginPath();
    targetCtx.arc(cx, cy, Math.max(w, h) * 0.52, 0, Math.PI * 2);
    targetCtx.moveTo(cx - scopeTick, cy);
    targetCtx.lineTo(cx + scopeTick, cy);
    targetCtx.moveTo(cx, cy - scopeTick);
    targetCtx.lineTo(cx, cy + scopeTick);
    targetCtx.stroke();
    return;
  }
  if (state.style === "grid") {
    targetCtx.strokeRect(x, y, w, h);
    for (let gx = x + w / 3; gx < x + w; gx += w / 3) {
      targetCtx.beginPath();
      targetCtx.moveTo(gx, y);
      targetCtx.lineTo(gx, y + h);
      targetCtx.stroke();
    }
    for (let gy = y + h / 3; gy < y + h; gy += h / 3) {
      targetCtx.beginPath();
      targetCtx.moveTo(x, gy);
      targetCtx.lineTo(x + w, gy);
      targetCtx.stroke();
    }
    return;
  }
  if (state.style === "label") {
    targetCtx.strokeRect(x, y, w, h);
    targetCtx.fillRect(x, y - 16, Math.max(56, w * 0.5), 16);
    targetCtx.fillStyle = "#050505";
    targetCtx.fillText(`ID ${blob.id}`, x + 5, y - 14);
    return;
  }
  targetCtx.strokeRect(x, y, w, h);
  targetCtx.beginPath();
  targetCtx.moveTo(x, y + tick);
  targetCtx.lineTo(x, y);
  targetCtx.lineTo(x + tick, y);
  targetCtx.moveTo(x + w - tick, y);
  targetCtx.lineTo(x + w, y);
  targetCtx.lineTo(x + w, y + tick);
  targetCtx.moveTo(x + w, y + h - tick);
  targetCtx.lineTo(x + w, y + h);
  targetCtx.lineTo(x + w - tick, y + h);
  targetCtx.moveTo(x + tick, y + h);
  targetCtx.lineTo(x, y + h);
  targetCtx.lineTo(x, y + h - tick);
  targetCtx.stroke();
}

function drawLabel(targetCtx, blob, color, width) {
  const text = `${String(blob.id).padStart(2, "0")}  x:${Math.round(blob.cx)} y:${Math.round(blob.cy)}  ${Math.round(blob.area)}px`;
  const pad = 5;
  const metrics = targetCtx.measureText(text);
  const x = Math.max(4, Math.min(width - metrics.width - 12, blob.x));
  const y = Math.max(4, blob.y - state.fontSize - 10);
  targetCtx.save();
  targetCtx.setLineDash([]);
  targetCtx.shadowBlur = 0;
  targetCtx.fillStyle = "rgba(0, 0, 0, 0.76)";
  targetCtx.fillRect(x, y, metrics.width + pad * 2, state.fontSize + pad * 1.6);
  targetCtx.fillStyle = color;
  targetCtx.fillText(text, x + pad, y + pad * 0.8);
  targetCtx.restore();
}

function drawSelectionHandles(targetCtx) {
  const objects = selectedObjects();
  targetCtx.save();
  drawSnapGuides(targetCtx);
  if (state.interaction?.mode === "select") {
    const rect = normalizedRect(state.interaction.startX, state.interaction.startY, state.interaction.currentX, state.interaction.currentY);
    targetCtx.fillStyle = "rgba(113, 246, 199, 0.12)";
    targetCtx.strokeStyle = "#71f6c7";
    targetCtx.lineWidth = 1.5;
    targetCtx.setLineDash([5, 4]);
    targetCtx.fillRect(rect.x, rect.y, rect.w, rect.h);
    targetCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  }
  if (objects.length === 0) {
    targetCtx.restore();
    return;
  }
  const box = groupBox(objects);
  targetCtx.strokeStyle = "#71f6c7";
  targetCtx.fillStyle = "#07110e";
  targetCtx.lineWidth = 1.5;
  targetCtx.globalAlpha = 1;
  targetCtx.setLineDash([6, 5]);
  targetCtx.strokeRect(box.x, box.y, box.w, box.h);
  if (objects.length > 1) {
    targetCtx.globalAlpha = 0.5;
    for (const object of objects) {
      const itemBox = objectBox(object);
      targetCtx.strokeRect(itemBox.x, itemBox.y, itemBox.w, itemBox.h);
    }
    targetCtx.globalAlpha = 1;
  }
  targetCtx.setLineDash([]);
  targetCtx.fillRect(box.x + box.w - 8, box.y + box.h - 8, 16, 16);
  targetCtx.strokeRect(box.x + box.w - 8, box.y + box.h - 8, 16, 16);
  targetCtx.restore();
}

function drawSnapGuides(targetCtx) {
  if (!state.snapGuides) return;
  targetCtx.save();
  targetCtx.strokeStyle = "rgba(113, 246, 199, 0.72)";
  targetCtx.lineWidth = 1;
  targetCtx.setLineDash([12, 10]);
  if (state.snapGuides.vertical) {
    const x = state.renderWidth / 2;
    targetCtx.beginPath();
    targetCtx.moveTo(x, 0);
    targetCtx.lineTo(x, state.renderHeight);
    targetCtx.stroke();
  }
  if (state.snapGuides.horizontal) {
    const y = state.renderHeight / 2;
    targetCtx.beginPath();
    targetCtx.moveTo(0, y);
    targetCtx.lineTo(state.renderWidth, y);
    targetCtx.stroke();
  }
  targetCtx.restore();
}

function objectBox(object) {
  const w = object.width * object.scale;
  const h = object.height * object.scale;
  return { x: object.x - w / 2, y: object.y - h / 2, w, h };
}

function groupBox(objects) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const object of objects) {
    const box = objectBox(object);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const preset = currentCanvasPreset();
  const displayHeight = rect.width / (preset.width / preset.height) || rect.height;
  return {
    x: ((event.clientX - rect.left) / rect.width) * state.renderWidth,
    y: ((event.clientY - rect.top) / displayHeight) * state.renderHeight,
  };
}

function onPointerDown(event) {
  canvas.focus({ preventScroll: true });
  const point = canvasPoint(event);
  const selected = selectedObjects();
  const selectedBox = selected.length ? groupBox(selected) : null;
  if (selectedBox && isResizeHandle(point, selectedBox)) {
    canvas.setPointerCapture(event.pointerId);
    state.interaction = {
      mode: "resizeGroup",
      startX: point.x,
      startY: point.y,
      anchorX: selectedBox.x,
      anchorY: selectedBox.y,
      startDistance: Math.max(8, Math.hypot(point.x - selectedBox.x, point.y - selectedBox.y)),
      objects: selected.map((object) => ({
        id: object.id,
        x: object.x,
        y: object.y,
        scale: object.scale,
      })),
    };
    return;
  }
  const hit = hitTest(point);
  if (!hit.object) {
    canvas.setPointerCapture(event.pointerId);
    state.interaction = {
      mode: "select",
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    };
    selectObject(null);
    return;
  }
  if (!state.selectedIds.includes(hit.object.id)) {
    selectObject(hit.object.id);
  }
  canvas.setPointerCapture(event.pointerId);
  state.interaction = {
    mode: "dragGroup",
    startX: point.x,
    startY: point.y,
    objects: selectedObjects().map((object) => ({
      id: object.id,
      x: object.x,
      y: object.y,
      scale: object.scale,
    })),
  };
}

function onPointerMove(event) {
  if (!state.interaction) return;
  const point = canvasPoint(event);
  if (state.interaction.mode === "select") {
    state.interaction.currentX = point.x;
    state.interaction.currentY = point.y;
    state.snapGuides = null;
    return;
  }
  if (state.interaction.mode === "dragGroup") {
    const snap = centerSnapDelta(
      state.interaction.objects,
      point.x - state.interaction.startX,
      point.y - state.interaction.startY,
    );
    const dx = snap.dx;
    const dy = snap.dy;
    state.snapGuides = snap.guides;
    for (const snapshot of state.interaction.objects) {
      const object = state.mediaObjects.find((item) => item.id === snapshot.id);
      if (!object) continue;
      object.x = snapshot.x + dx;
      object.y = snapshot.y + dy;
    }
    return;
  }
  if (state.interaction.mode === "resizeGroup") {
    state.snapGuides = null;
    const distance = Math.max(8, Math.hypot(point.x - state.interaction.anchorX, point.y - state.interaction.anchorY));
    const factor = Math.max(0.05, distance / state.interaction.startDistance);
    for (const snapshot of state.interaction.objects) {
      const object = state.mediaObjects.find((item) => item.id === snapshot.id);
      if (!object) continue;
      object.x = state.interaction.anchorX + (snapshot.x - state.interaction.anchorX) * factor;
      object.y = state.interaction.anchorY + (snapshot.y - state.interaction.anchorY) * factor;
      object.scale = Math.max(0.05, snapshot.scale * factor);
    }
    updateMediaSizeOutput();
  }
}

function endInteraction(event) {
  if (state.interaction?.mode === "select") {
    const rect = normalizedRect(state.interaction.startX, state.interaction.startY, state.interaction.currentX, state.interaction.currentY);
    const ids = state.mediaObjects
      .filter((object) => rectsIntersect(rect, objectBox(object)))
      .map((object) => object.id);
    selectObjects(ids);
  }
  if (state.interaction) canvas.releasePointerCapture?.(event.pointerId);
  state.interaction = null;
  state.snapGuides = null;
}

function centerSnapDelta(snapshots, dx, dy) {
  const box = groupBoxFromSnapshots(snapshots, dx, dy);
  const groupCenterX = box.x + box.w / 2;
  const groupCenterY = box.y + box.h / 2;
  const canvasCenterX = state.renderWidth / 2;
  const canvasCenterY = state.renderHeight / 2;
  const threshold = centerSnapThreshold();
  let nextDx = dx;
  let nextDy = dy;
  const guides = { vertical: false, horizontal: false };
  if (Math.abs(groupCenterX - canvasCenterX) <= threshold) {
    nextDx += canvasCenterX - groupCenterX;
    guides.vertical = true;
  }
  if (Math.abs(groupCenterY - canvasCenterY) <= threshold) {
    nextDy += canvasCenterY - groupCenterY;
    guides.horizontal = true;
  }
  return {
    dx: nextDx,
    dy: nextDy,
    guides: guides.vertical || guides.horizontal ? guides : null,
  };
}

function centerSnapThreshold() {
  return Math.max(12, Math.min(CENTER_SNAP_THRESHOLD, Math.min(state.renderWidth, state.renderHeight) * 0.025));
}

function groupBoxFromSnapshots(snapshots, dx, dy) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const snapshot of snapshots) {
    const object = state.mediaObjects.find((item) => item.id === snapshot.id);
    if (!object) continue;
    const w = object.width * snapshot.scale;
    const h = object.height * snapshot.scale;
    const x = snapshot.x + dx;
    const y = snapshot.y + dy;
    minX = Math.min(minX, x - w / 2);
    minY = Math.min(minY, y - h / 2);
    maxX = Math.max(maxX, x + w / 2);
    maxY = Math.max(maxY, y + h / 2);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function hitTest(point) {
  for (let i = state.mediaObjects.length - 1; i >= 0; i--) {
    const object = state.mediaObjects[i];
    const box = objectBox(object);
    const inside = point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
    if (inside) return { object, handle: false };
  }
  return { object: null, handle: false };
}

function selectObject(id) {
  selectObjects(id ? [id] : []);
}

function selectObjects(ids) {
  state.selectedIds = ids;
  state.selectedId = ids.at(-1) || null;
  state.mediaObjects.forEach((object) => {
    object.selected = state.selectedIds.includes(object.id);
  });
  updateMediaSizeOutput();
}

function isResizeHandle(point, box) {
  return point.x >= box.x + box.w - 24 && point.x <= box.x + box.w + 16 && point.y >= box.y + box.h - 24 && point.y <= box.y + box.h + 16;
}

function normalizedRect(x1, y1, x2, y2) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return { x, y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

function rectsIntersect(a, b) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

function exportHighResolutionPng() {
  const multiplier = state.qualityMode === "quality" ? 3 : 2;
  const offscreen = document.createElement("canvas");
  offscreen.width = Math.round(state.renderWidth * multiplier);
  offscreen.height = Math.round(state.renderHeight * multiplier);
  const offCtx = offscreen.getContext("2d", { willReadFrequently: true });
  offCtx.setTransform(multiplier, 0, 0, multiplier, 0, 0);
  const time = performance.now();
  drawBaseScene(offCtx, state.renderWidth, state.renderHeight, time);
  applyFilterToCanvas(offCtx, offscreen);
  offCtx.setTransform(multiplier, 0, 0, multiplier, 0, 0);
  if (!state.hideTracking) drawTracking(offCtx, state.renderWidth, state.renderHeight, detectBlobs(), time);
  const link = document.createElement("a");
  link.download = `baby-track-${multiplier}x-${Date.now()}.png`;
  link.href = offscreen.toDataURL("image/png");
  link.click();
}

async function exportConnectionSvg() {
  const blobs = state.lastBlobs.length ? state.lastBlobs : detectBlobs();
  const width = state.renderWidth;
  const height = state.renderHeight;
  const color = normalizeColor(state.color);
  const segments = getConnectionSegments(blobs, width, height, Boolean(state.hub));
  const blobById = new Map(blobs.map((blob) => [blob.id, blob]));
  const dash = state.dashed ? "10 8" : "";
  const mediaImages = (await Promise.all(state.mediaObjects.map((object, index) => svgImageForMediaObject(object, index)))).join("\n");
  const connectionLines = segments.map((segment, index) => {
    const stroke = connectionColor(blobById.get(segment.from), blobById.get(segment.to) || { id: segment.to }, color);
    return [
      `  <line id="connection-${index + 1}"`,
      `    x1="${roundSvg(segment.x1)}" y1="${roundSvg(segment.y1)}" x2="${roundSvg(segment.x2)}" y2="${roundSvg(segment.y2)}"`,
      `    stroke="${escapeXml(stroke)}" stroke-width="${roundSvg(state.stroke)}" stroke-opacity="1" stroke-linecap="round" vector-effect="non-scaling-stroke"`,
      dash ? `    stroke-dasharray="${dash}"` : "",
      `    data-from="${escapeXml(String(segment.from))}" data-to="${escapeXml(String(segment.to))}" data-distance="${roundSvg(segment.distance)}" />`,
    ].filter(Boolean).join("\n");
  }).join("\n");
  const scopes = blobs.map((blob) => svgScopeForBlob(blob, blobColor(blob, color), dash)).join("\n");
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${roundSvg(width)}" height="${roundSvg(height)}" viewBox="0 0 ${roundSvg(width)} ${roundSvg(height)}"`,
    `  data-export-type="baby-track-connections" data-link-rate="${roundSvg(state.linkRate)}" data-center-hub="${Boolean(state.hub)}" data-dashed="${Boolean(state.dashed)}">`,
    `  <metadata>${escapeXml(JSON.stringify({
      editable: true,
      stroke: color,
      strokeWidth: state.stroke,
      strokeDasharray: dash,
      linkRate: state.linkRate,
      centerHub: Boolean(state.hub),
      canvasWidth: width,
      canvasHeight: height,
      mediaCount: state.mediaObjects.length,
      connectionCount: segments.length,
      scopeCount: blobs.length,
    }))}</metadata>`,
    `  <g id="media-layer" data-layer="media">`,
    mediaImages || `    <!-- No media objects in canvas. -->`,
    `  </g>`,
    `  <g id="connections" data-layer="connections">`,
    connectionLines || `    <!-- No connection lines generated with current settings. -->`,
    `  </g>`,
    `  <g id="scope-targets" data-layer="scope-targets">`,
    scopes || `    <!-- No scope targets generated with current settings. -->`,
    `  </g>`,
    `</svg>`,
  ].join("\n");
  downloadText(`baby-track-scene-${Date.now()}.svg`, svg, "image/svg+xml");
}

async function svgImageForMediaObject(object, index) {
  const href = mediaObjectToDataUrl(object);
  const drawWidth = object.width * object.scale;
  const drawHeight = object.height * object.scale;
  const rotation = object.rotation * 180 / Math.PI;
  const mirror = object.mirror ? " scale(-1 1)" : "";
  return [
    `    <image id="media-${index + 1}"`,
    `      href="${href}" x="${roundSvg(-drawWidth / 2)}" y="${roundSvg(-drawHeight / 2)}" width="${roundSvg(drawWidth)}" height="${roundSvg(drawHeight)}" opacity="${roundSvg(object.opacity)}"`,
    `      transform="translate(${roundSvg(object.x)} ${roundSvg(object.y)}) rotate(${roundSvg(rotation)})${mirror}"`,
    `      data-media-id="${object.id}" data-media-type="${escapeXml(object.type)}" data-x="${roundSvg(object.x)}" data-y="${roundSvg(object.y)}" data-width="${roundSvg(object.width)}" data-height="${roundSvg(object.height)}" data-scale="${roundSvg(object.scale)}" data-rotation="${roundSvg(object.rotation)}" data-opacity="${roundSvg(object.opacity)}" />`,
  ].join("\n");
}

function mediaObjectToDataUrl(object) {
  const width = Math.max(1, Math.round(object.element.videoWidth || object.element.naturalWidth || object.width));
  const height = Math.max(1, Math.round(object.element.videoHeight || object.element.naturalHeight || object.height));
  const mediaCanvas = document.createElement("canvas");
  mediaCanvas.width = width;
  mediaCanvas.height = height;
  const mediaCtx = mediaCanvas.getContext("2d");
  mediaCtx.drawImage(object.element, 0, 0, width, height);
  return mediaCanvas.toDataURL("image/png");
}

function svgScopeForBlob(blob, color, dash) {
  const radius = Math.max(blob.w, blob.h) * 0.52;
  const tick = 8;
  const common = `stroke="${escapeXml(color)}" stroke-width="${roundSvg(state.stroke)}" stroke-opacity="1" stroke-linecap="round" fill="none" vector-effect="non-scaling-stroke"`;
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : "";
  return [
    `    <g id="scope-${blob.id}" data-blob-id="${blob.id}" data-cx="${roundSvg(blob.cx)}" data-cy="${roundSvg(blob.cy)}" data-radius="${roundSvg(radius)}">`,
    `      <circle cx="${roundSvg(blob.cx)}" cy="${roundSvg(blob.cy)}" r="${roundSvg(radius)}" ${common}${dashAttr} />`,
    `      <line x1="${roundSvg(blob.cx - tick)}" y1="${roundSvg(blob.cy)}" x2="${roundSvg(blob.cx + tick)}" y2="${roundSvg(blob.cy)}" ${common}${dashAttr} />`,
    `      <line x1="${roundSvg(blob.cx)}" y1="${roundSvg(blob.cy - tick)}" x2="${roundSvg(blob.cx)}" y2="${roundSvg(blob.cy + tick)}" ${common}${dashAttr} />`,
    `    </g>`,
  ].join("\n");
}

function roundSvg(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/, "");
}

function escapeXml(value) {
  return value.replace(/[<>&"']/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
    "'": "&apos;",
  })[char]);
}

function downloadText(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function setStatus(message) {
  statusEl.textContent = message;
}

requestAnimationFrame(render);
