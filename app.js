const canvas = document.getElementById("output");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const sourceCanvas = document.getElementById("source");
const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
const statusEl = document.getElementById("status") || { textContent: "" };
const blobCountEl = document.getElementById("blobCount");

const state = {
  running: true,
  style: "frame",
  filter: "none",
  threshold: 128,
  sample: 3,
  minArea: 64,
  maxBlobs: 22,
  stroke: 1.5,
  linkRate: 0.45,
  fontSize: 12,
  color: "#ffffff",
  invertMask: false,
  singleMode: false,
  showText: true,
  crazyColor: false,
  blink: false,
  dashed: false,
  hub: false,
  showVideo: true,
  recording: false,
  recorder: null,
  chunks: [],
  facingMode: "environment",
  cameraActive: false,
  qualityMode: "quality",
  renderWidth: 1,
  renderHeight: 1,
  dpr: 1,
  mediaObjects: [],
  selectedId: null,
  nextMediaId: 1,
  interaction: null,
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

for (const id of ["invertMask", "singleMode", "showText", "crazyColor", "blink", "dashed", "hub", "showVideo"]) {
  document.getElementById(id).addEventListener("change", (event) => {
    state[id] = event.target.checked;
  });
}

document.getElementById("mainColor").addEventListener("input", (event) => {
  state.color = event.target.value;
});

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

document.getElementById("fileInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  stopCameraTracks();
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
    setStatus("Video imported");
  } else {
    const image = new Image();
    image.src = url;
    await image.decode();
    addMediaObject({ type: "image", element: image, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight });
    setStatus("Image imported");
  }
  event.target.value = "";
});

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
  const object = selectedObject();
  if (!object) return;
  object.scale = Number(event.target.value) / 100;
  updateMediaSizeOutput();
});

document.getElementById("fitCanvasBtn").addEventListener("click", () => fitSelectedMedia("contain"));
document.getElementById("fillCanvasBtn").addEventListener("click", () => fitSelectedMedia("cover"));
document.getElementById("deleteMediaBtn").addEventListener("click", deleteSelectedMedia);

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", endInteraction);
canvas.addEventListener("pointercancel", endInteraction);

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
  return state.mediaObjects.find((object) => object.id === state.selectedId) || null;
}

function updateMediaSizeOutput() {
  const object = selectedObject();
  const value = object ? Math.round(object.scale * 100) : 100;
  const input = document.getElementById("mediaSize");
  const output = document.getElementById("mediaSizeOut");
  input.value = String(Math.max(10, Math.min(300, value)));
  output.value = String(value);
}

function fitSelectedMedia(mode) {
  const object = selectedObject();
  if (!object) return;
  fitMediaObject(object, mode, 1);
  updateMediaSizeOutput();
}

function deleteSelectedMedia() {
  const object = selectedObject();
  if (!object) return;
  if (object.camera && object.element?.srcObject) {
    object.element.srcObject.getTracks().forEach((track) => track.stop());
    state.cameraActive = false;
    updateCameraButtons();
  }
  state.mediaObjects = state.mediaObjects.filter((item) => item.id !== object.id);
  const nextObject = state.mediaObjects[state.mediaObjects.length - 1];
  selectObject(nextObject ? nextObject.id : null);
}

function fitMediaObject(object, mode, paddingScale) {
  const scaleX = state.renderWidth / object.width;
  const scaleY = state.renderHeight / object.height;
  object.scale = (mode === "cover" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)) * paddingScale;
  object.x = state.renderWidth / 2;
  object.y = state.renderHeight / 2;
}

function resizeCanvasToDisplay() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, state.qualityMode === "quality" ? 3 : 2));
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const backingWidth = Math.round(width * dpr);
  const backingHeight = Math.round(height * dpr);
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  state.renderWidth = width;
  state.renderHeight = height;
  state.dpr = dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function render(time = 0) {
  if (!state.running) return;
  resizeCanvasToDisplay();
  drawBaseScene(ctx, state.renderWidth, state.renderHeight, time);
  applyFilterToCanvas(ctx, canvas);
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  const blobs = detectBlobs();
  drawTracking(ctx, state.renderWidth, state.renderHeight, blobs, time);
  drawSelectionHandles(ctx);
  if (blobCountEl) blobCountEl.textContent = `${blobs.length} blobs`;
  requestAnimationFrame(render);
}

function drawBaseScene(targetCtx, width, height, time) {
  targetCtx.clearRect(0, 0, width, height);
  if (!state.showVideo) {
    targetCtx.fillStyle = "#000";
    targetCtx.fillRect(0, 0, width, height);
    return;
  }
  if (state.mediaObjects.length === 0) {
    drawDemo(targetCtx, time, width, height);
    return;
  }
  targetCtx.fillStyle = "#000";
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
    } else if (state.filter === "thermal") {
      data[i] = Math.min(255, gray * 1.7);
      data[i + 1] = Math.min(255, 80 + Math.abs(gray - 130) * 1.2);
      data[i + 2] = Math.max(0, 255 - gray * 1.5);
    } else if (state.filter === "edge") {
      const v = gray > 148 ? 255 : 20;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    } else if (state.filter === "crt") {
      const y = Math.floor(i / 4 / targetCanvas.width);
      const scan = y % 4 < 2 ? 0.78 : 1;
      data[i] = r * scan;
      data[i + 1] = g * scan;
      data[i + 2] = b * scan;
    } else if (state.filter === "pixel") {
      data[i] = Math.round(r / 32) * 32;
      data[i + 1] = Math.round(g / 32) * 32;
      data[i + 2] = Math.round(b / 32) * 32;
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
  const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  return state.invertMask ? gray < state.threshold : gray > state.threshold;
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
  const color = state.color;
  targetCtx.save();
  targetCtx.lineWidth = state.stroke;
  targetCtx.font = `${state.fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  targetCtx.textBaseline = "top";
  targetCtx.setLineDash(state.dashed ? [10, 8] : []);
  if (state.blink && Math.floor(time / 140) % 3 === 0) targetCtx.globalAlpha = 0.2;
  drawConnections(targetCtx, width, height, blobs, color, time);
  for (const blob of blobs) {
    const c = state.crazyColor ? `hsl(${blob.hue}, 90%, 65%)` : color;
    targetCtx.strokeStyle = c;
    targetCtx.fillStyle = c;
    targetCtx.shadowColor = state.style === "glow" ? c : "transparent";
    targetCtx.shadowBlur = state.style === "glow" ? 22 : 0;
    drawRegion(targetCtx, blob, time);
    if (state.showText) drawLabel(targetCtx, blob, c, width);
  }
  targetCtx.restore();
}

function drawConnections(targetCtx, width, height, blobs, color, time) {
  if (state.linkRate <= 0 || blobs.length < 2) return;
  targetCtx.save();
  targetCtx.strokeStyle = color;
  targetCtx.globalAlpha = 0.65;
  const hub = { cx: width / 2, cy: height / 2 };
  for (let i = 0; i < blobs.length; i++) {
    const a = blobs[i];
    const targets = state.hub ? [hub] : blobs.slice(i + 1);
    for (const b of targets) {
      const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      if (d > Math.min(width, height) * state.linkRate) continue;
      targetCtx.beginPath();
      targetCtx.moveTo(a.cx, a.cy);
      if (state.style === "scope") {
        const mx = (a.cx + b.cx) / 2 + Math.sin(time * 0.004 + i) * 24;
        const my = (a.cy + b.cy) / 2 + Math.cos(time * 0.004 + i) * 24;
        targetCtx.quadraticCurveTo(mx, my, b.cx, b.cy);
      } else {
        targetCtx.lineTo(b.cx, b.cy);
      }
      targetCtx.stroke();
    }
  }
  targetCtx.restore();
}

function drawRegion(targetCtx, blob, time) {
  const x = blob.x;
  const y = blob.y;
  const w = blob.w;
  const h = blob.h;
  const cx = blob.cx;
  const cy = blob.cy;
  const tick = 12 + Math.sin(time * 0.006 + blob.id) * 4;
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
    targetCtx.beginPath();
    targetCtx.arc(cx, cy, Math.max(w, h) * 0.52, 0, Math.PI * 2);
    targetCtx.moveTo(cx - tick * 1.5, cy);
    targetCtx.lineTo(cx + tick * 1.5, cy);
    targetCtx.moveTo(cx, cy - tick * 1.5);
    targetCtx.lineTo(cx, cy + tick * 1.5);
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
  const object = selectedObject();
  if (!object) return;
  const box = objectBox(object);
  targetCtx.save();
  targetCtx.strokeStyle = "#71f6c7";
  targetCtx.fillStyle = "#07110e";
  targetCtx.lineWidth = 1.5;
  targetCtx.setLineDash([6, 5]);
  targetCtx.strokeRect(box.x, box.y, box.w, box.h);
  targetCtx.setLineDash([]);
  targetCtx.fillRect(box.x + box.w - 8, box.y + box.h - 8, 16, 16);
  targetCtx.strokeRect(box.x + box.w - 8, box.y + box.h - 8, 16, 16);
  targetCtx.restore();
}

function objectBox(object) {
  const w = object.width * object.scale;
  const h = object.height * object.scale;
  return { x: object.x - w / 2, y: object.y - h / 2, w, h };
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * state.renderWidth,
    y: ((event.clientY - rect.top) / rect.height) * state.renderHeight,
  };
}

function onPointerDown(event) {
  const point = canvasPoint(event);
  const hit = hitTest(point);
  if (!hit.object) {
    selectObject(null);
    return;
  }
  selectObject(hit.object.id);
  canvas.setPointerCapture(event.pointerId);
  const box = objectBox(hit.object);
  state.interaction = {
    mode: hit.handle ? "resize" : "drag",
    id: hit.object.id,
    startX: point.x,
    startY: point.y,
    objectX: hit.object.x,
    objectY: hit.object.y,
    startScale: hit.object.scale,
    startDistance: Math.max(8, Math.hypot(point.x - box.x, point.y - box.y)),
  };
}

function onPointerMove(event) {
  if (!state.interaction) return;
  const object = selectedObject();
  if (!object) return;
  const point = canvasPoint(event);
  if (state.interaction.mode === "drag") {
    object.x = state.interaction.objectX + point.x - state.interaction.startX;
    object.y = state.interaction.objectY + point.y - state.interaction.startY;
  } else {
    const box = objectBox({ ...object, scale: state.interaction.startScale });
    const distance = Math.max(8, Math.hypot(point.x - box.x, point.y - box.y));
    object.scale = Math.max(0.05, state.interaction.startScale * (distance / state.interaction.startDistance));
    updateMediaSizeOutput();
  }
}

function endInteraction(event) {
  if (state.interaction) canvas.releasePointerCapture?.(event.pointerId);
  state.interaction = null;
}

function hitTest(point) {
  for (let i = state.mediaObjects.length - 1; i >= 0; i--) {
    const object = state.mediaObjects[i];
    const box = objectBox(object);
    const onHandle = point.x >= box.x + box.w - 24 && point.x <= box.x + box.w + 16 && point.y >= box.y + box.h - 24 && point.y <= box.y + box.h + 16;
    const inside = point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
    if (onHandle || inside) return { object, handle: onHandle };
  }
  return { object: null, handle: false };
}

function selectObject(id) {
  state.selectedId = id;
  state.mediaObjects.forEach((object) => {
    object.selected = object.id === id;
  });
  updateMediaSizeOutput();
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
  drawTracking(offCtx, state.renderWidth, state.renderHeight, detectBlobs(), time);
  const link = document.createElement("a");
  link.download = `baby-track-${multiplier}x-${Date.now()}.png`;
  link.href = offscreen.toDataURL("image/png");
  link.click();
}

function setStatus(message) {
  statusEl.textContent = message;
}

requestAnimationFrame(render);
