const canvas = document.getElementById("output");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const sourceCanvas = document.getElementById("source");
const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
const video = document.getElementById("media");
const image = document.getElementById("imageSource");
const statusEl = document.getElementById("status") || { textContent: "" };
const blobCountEl = document.getElementById("blobCount");

const state = {
  running: true,
  sourceType: "demo",
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
  renderWidth: 1920,
  renderHeight: 1080,
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
    image.removeAttribute("src");
    video.src = url;
    video.playbackRate = 1;
    await video.play().catch(() => {});
    state.sourceType = "video";
    statusEl.textContent = "本地视频";
  } else {
    video.pause();
    video.removeAttribute("src");
    image.src = url;
    await image.decode();
    state.sourceType = "image";
    statusEl.textContent = "本地图片";
  }
});

document.getElementById("cameraBtn").addEventListener("click", async () => {
  await startCamera(state.facingMode);
});

document.getElementById("flipCameraBtn").addEventListener("click", flipCamera);

document.getElementById("playBtn").addEventListener("click", (event) => {
  state.running = !state.running;
  event.currentTarget.textContent = state.running ? "暂停" : "播放";
  if (state.running) requestAnimationFrame(render);
});

document.getElementById("snapshotBtn").addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = `baby-track-${Date.now()}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
});

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
    document.getElementById("recordBtn").textContent = "录制 WebM";
  };
  state.recorder.start();
  state.recording = true;
  document.getElementById("recordBtn").textContent = "停止录制";
});

document.getElementById("resetBtn").addEventListener("click", () => location.reload());

async function startCamera(facingMode) {
  if (!navigator.mediaDevices?.getUserMedia) {
    statusEl.textContent = "当前浏览器不支持摄像头";
    return;
  }
  const nextMode = facingMode || state.facingMode;
  try {
    stopCameraTracks(false);
    image.removeAttribute("src");
    video.removeAttribute("src");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: getCameraConstraints(nextMode),
    });
    video.srcObject = stream;
    await video.play();
    state.sourceType = "video";
    state.facingMode = nextMode;
    state.cameraActive = true;
    const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
    const cameraName = nextMode === "user" ? "前置摄像头" : "后置摄像头";
    statusEl.textContent = settings.width && settings.height
      ? `${cameraName} ${settings.width}×${settings.height}`
      : cameraName;
  } catch {
    state.cameraActive = false;
    statusEl.textContent = "摄像头不可用";
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
  const high = state.qualityMode === "quality";
  setCanvasResolution(high ? 1920 : 1280, high ? 1080 : 720);
  setRangeValue("sample", high ? 3 : 5);
  statusEl.textContent = high ? "高清模式 1080p" : "流畅模式 720p";
  if (state.cameraActive) await startCamera(state.facingMode);
}

function setCanvasResolution(width, height) {
  state.renderWidth = width;
  state.renderHeight = height;
  canvas.width = width;
  canvas.height = height;
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

function stopCameraTracks() {
  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
  state.cameraActive = false;
  updateCameraButtons();
}

function updateCameraButtons() {
  const label = state.facingMode === "user" ? "切后置" : "切前置";
  for (const id of ["flipCameraBtn"]) {
    const button = document.getElementById(id);
    button.disabled = !state.cameraActive;
    button.textContent = label;
  }
}

function render(time = 0) {
  if (!state.running) return;
  drawSource(time);
  applyFilter(time);
  const blobs = detectBlobs();
  drawTracking(blobs, time);
  if (blobCountEl) blobCountEl.textContent = `${blobs.length} blobs`;
  requestAnimationFrame(render);
}

function drawSource(time) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!state.showVideo) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
  } else if (state.sourceType === "video" && video.readyState >= 2) {
    drawCover(video, w, h, state.cameraActive && state.facingMode === "user");
  } else if (state.sourceType === "image" && image.complete) {
    drawCover(image, w, h);
  } else {
    drawDemo(time, w, h);
  }
}

function drawCover(media, w, h, mirror = false) {
  const mw = media.videoWidth || media.naturalWidth || w;
  const mh = media.videoHeight || media.naturalHeight || h;
  const scale = Math.max(w / mw, h / mh);
  const dw = mw * scale;
  const dh = mh * scale;
  if (mirror) {
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(media, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.restore();
    return;
  }
  ctx.drawImage(media, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function drawDemo(time, w, h) {
  const t = time * 0.001;
  const grd = ctx.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, "#08100d");
  grd.addColorStop(0.45, "#1b141f");
  grd.addColorStop(1, "#07161b");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 15; i++) {
    const x = w * (0.5 + 0.38 * Math.sin(t * (0.42 + i * 0.05) + i));
    const y = h * (0.5 + 0.36 * Math.cos(t * (0.33 + i * 0.04) + i * 1.7));
    const r = 32 + 42 * (0.5 + 0.5 * Math.sin(t + i));
    ctx.fillStyle = `hsla(${(i * 37 + t * 90) % 360}, 84%, 62%, 0.56)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

function applyFilter(time) {
  if (state.filter === "none") return;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = img.data;
  const t = time * 0.001;
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
      data[i] = Math.min(255, gray * 1.7 + Math.sin(t) * 40);
      data[i + 1] = Math.min(255, 80 + Math.abs(gray - 130) * 1.2);
      data[i + 2] = Math.max(0, 255 - gray * 1.5);
    } else if (state.filter === "edge") {
      const v = gray > 148 ? 255 : 20;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    } else if (state.filter === "crt") {
      const y = Math.floor(i / 4 / canvas.width);
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
  ctx.putImageData(img, 0, 0);
}

function detectBlobs() {
  const scale = state.sample;
  const w = Math.floor(canvas.width / scale);
  const h = Math.floor(canvas.height / scale);
  sourceCanvas.width = w;
  sourceCanvas.height = h;
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
  const limited = blobs.slice(0, state.singleMode ? 1 : state.maxBlobs);
  return limited.map((blob, index) => ({
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

function flood(start, w, h, data, visited) {
  const stack = [start];
  visited[start] = 1;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let area = 0;
  let sumX = 0;
  let sumY = 0;

  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    const y = (p - x) / w;
    area++;
    sumX += x;
    sumY += y;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;

    const neighbors = [p - 1, p + 1, p - w, p + w];
    for (const n of neighbors) {
      if (n < 0 || n >= visited.length || visited[n] || !passes(data, n)) continue;
      visited[n] = 1;
      stack.push(n);
    }
  }

  return { minX, minY, maxX, maxY, area, sumX, sumY };
}

function drawTracking(blobs, time) {
  const color = state.color;
  ctx.save();
  ctx.lineWidth = state.stroke;
  ctx.font = `${state.fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textBaseline = "top";
  ctx.setLineDash(state.dashed ? [10, 8] : []);
  if (state.blink && Math.floor(time / 140) % 3 === 0) {
    ctx.globalAlpha = 0.2;
  }

  drawConnections(blobs, color, time);

  for (const blob of blobs) {
    const c = state.crazyColor ? `hsl(${blob.hue}, 90%, 65%)` : color;
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.shadowColor = state.style === "glow" ? c : "transparent";
    ctx.shadowBlur = state.style === "glow" ? 22 : 0;
    drawRegion(blob, c, time);
    if (state.showText) drawLabel(blob, c);
  }
  ctx.restore();
}

function drawConnections(blobs, color, time) {
  if (state.linkRate <= 0 || blobs.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.65;
  const hub = { cx: canvas.width / 2, cy: canvas.height / 2 };
  for (let i = 0; i < blobs.length; i++) {
    const a = blobs[i];
    const targets = state.hub ? [hub] : blobs.slice(i + 1);
    for (const b of targets) {
      const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      if (d > Math.min(canvas.width, canvas.height) * state.linkRate) continue;
      ctx.beginPath();
      ctx.moveTo(a.cx, a.cy);
      if (state.style === "scope") {
        const mx = (a.cx + b.cx) / 2 + Math.sin(time * 0.004 + i) * 24;
        const my = (a.cy + b.cy) / 2 + Math.cos(time * 0.004 + i) * 24;
        ctx.quadraticCurveTo(mx, my, b.cx, b.cy);
      } else {
        ctx.lineTo(b.cx, b.cy);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawRegion(blob, color, time) {
  const x = blob.x;
  const y = blob.y;
  const w = blob.w;
  const h = blob.h;
  const cx = blob.cx;
  const cy = blob.cy;
  const tick = 12 + Math.sin(time * 0.006 + blob.id) * 4;

  if (state.style === "cross") {
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy);
    ctx.lineTo(cx + w / 2, cy);
    ctx.moveTo(cx, cy - h / 2);
    ctx.lineTo(cx, cy + h / 2);
    ctx.stroke();
    ctx.strokeRect(cx - 4, cy - 4, 8, 8);
    return;
  }

  if (state.style === "scope") {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(w, h) * 0.52, 0, Math.PI * 2);
    ctx.moveTo(cx - tick * 1.5, cy);
    ctx.lineTo(cx + tick * 1.5, cy);
    ctx.moveTo(cx, cy - tick * 1.5);
    ctx.lineTo(cx, cy + tick * 1.5);
    ctx.stroke();
    return;
  }

  if (state.style === "grid") {
    ctx.strokeRect(x, y, w, h);
    for (let gx = x + w / 3; gx < x + w; gx += w / 3) {
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, y + h);
      ctx.stroke();
    }
    for (let gy = y + h / 3; gy < y + h; gy += h / 3) {
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + w, gy);
      ctx.stroke();
    }
    return;
  }

  if (state.style === "label") {
    ctx.strokeRect(x, y, w, h);
    ctx.fillRect(x, y - 16, Math.max(56, w * 0.5), 16);
    ctx.fillStyle = "#050505";
    ctx.fillText(`ID ${blob.id}`, x + 5, y - 14);
    return;
  }

  ctx.strokeRect(x, y, w, h);
  ctx.beginPath();
  ctx.moveTo(x, y + tick);
  ctx.lineTo(x, y);
  ctx.lineTo(x + tick, y);
  ctx.moveTo(x + w - tick, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + tick);
  ctx.moveTo(x + w, y + h - tick);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - tick, y + h);
  ctx.moveTo(x + tick, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h - tick);
  ctx.stroke();
}

function drawLabel(blob, color) {
  const text = `${String(blob.id).padStart(2, "0")}  x:${Math.round(blob.cx)} y:${Math.round(blob.cy)}  ${Math.round(blob.area)}px`;
  const pad = 5;
  const metrics = ctx.measureText(text);
  const x = Math.max(4, Math.min(canvas.width - metrics.width - 12, blob.x));
  const y = Math.max(4, blob.y - state.fontSize - 10);
  ctx.save();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(0, 0, 0, 0.76)";
  ctx.fillRect(x, y, metrics.width + pad * 2, state.fontSize + pad * 1.6);
  ctx.fillStyle = color;
  ctx.fillText(text, x + pad, y + pad * 0.8);
  ctx.restore();
}

requestAnimationFrame(render);
