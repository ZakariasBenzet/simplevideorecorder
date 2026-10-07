const sourceVideo = document.querySelector("#source-video");
const preview = document.querySelector("#preview");
const startBtn = document.querySelector("#start");
const pauseBtn = document.querySelector("#pause");
const stopBtn = document.querySelector("#stop");
const cameraSelect = document.querySelector("#camera");
const micSelect = document.querySelector("#microphone");
const statusEl = document.querySelector("#status");
const downloadEl = document.querySelector("#download");
const mirrorInput = document.querySelector("#mirror");
const countdownInput = document.querySelector("#use-countdown");
const countdownSecondsInput = document.querySelector("#countdown-seconds");
const countdownEl = document.querySelector("#countdown");
const timerEl = document.querySelector("#recording-timer");
const sizeEl = document.querySelector("#recording-size");
const warningEl = document.querySelector("#mic-warning");
const meterEl = document.querySelector("#mic-level");
const meterTextEl = document.querySelector("#mic-level-text");
const effectsToggle = document.querySelector("#effects-toggle");
const effectsMenu = document.querySelector("#effects-menu");
const effectInputs = {
  backgroundBlur: document.querySelector("#background-blur"),
  brightnessContrast: document.querySelector("#brightness-contrast"),
  saturation: document.querySelector("#saturation"),
  sharpness: document.querySelector("#sharpness"),
  zoom: document.querySelector("#zoom")
};
const meterBars = [...meterEl.querySelectorAll("i")];

let stream = null;
let recordingStream = null;
let recorder = null;
let chunks = [];
let currentObjectUrl = null;
let recordedBytes = 0;
let recordingStartedAt = 0;
let elapsedBeforePause = 0;
let timerInterval = null;
let audioContext = null;
let analyser = null;
let audioFrame = null;
let silentSince = 0;
let previewFrame = null;

const MP4_MIME_TYPES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4"
];
const WEBM_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm"
];

function setStatus(message) {
  statusEl.textContent = message;
}

function supportedMime(types) {
  return types.find(type => MediaRecorder.isTypeSupported(type)) || "";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function currentElapsed() {
  return elapsedBeforePause + (recordingStartedAt ? (Date.now() - recordingStartedAt) / 1000 : 0);
}

function updateRecordingStats() {
  timerEl.textContent = formatTime(currentElapsed());
  sizeEl.textContent = formatBytes(recordedBytes);
}

function resetRecordingStats() {
  recordedBytes = 0;
  elapsedBeforePause = 0;
  recordingStartedAt = 0;
  updateRecordingStats();
}

async function populateDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const oldCamera = cameraSelect.value;
  const oldMic = micSelect.value;
  const cameras = devices.filter(device => device.kind === "videoinput");
  const mics = devices.filter(device => device.kind === "audioinput");

  cameraSelect.replaceChildren();
  micSelect.replaceChildren();
  cameras.forEach((device, index) => cameraSelect.add(new Option(device.label || `Camera ${index + 1}`, device.deviceId)));
  mics.forEach((device, index) => micSelect.add(new Option(device.label || `Microphone ${index + 1}`, device.deviceId)));

  if ([...cameraSelect.options].some(option => option.value === oldCamera)) cameraSelect.value = oldCamera;
  if ([...micSelect.options].some(option => option.value === oldMic)) micSelect.value = oldMic;
  cameraSelect.disabled = cameras.length === 0;
  micSelect.disabled = mics.length === 0;
}

async function getStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support camera/microphone capture.");
  }
  const videoId = cameraSelect.value || undefined;
  const audioId = micSelect.value || undefined;
  return navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: videoId ? { exact: videoId } : undefined,
      width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 60 }
    },
    audio: {
      deviceId: audioId ? { exact: audioId } : undefined,
      echoCancellation: true, noiseSuppression: true, autoGainControl: true
    }
  });
}

const effectValues = {
  backgroundBlur: document.getElementById("background-blur-value"),
  brightness: document.getElementById("brightness-value"),
  contrast: document.getElementById("contrast-value"),
  saturation: document.getElementById("saturation-value"),
  sharpness: document.getElementById("sharpness-value"),
  zoom: document.getElementById("zoom-value")
};

const effectValueInputs = {
  backgroundBlur: [effectValues.backgroundBlur],
  brightnessContrast: [effectValues.brightness, effectValues.contrast],
  saturation: [effectValues.saturation],
  sharpness: [effectValues.sharpness],
  zoom: [effectValues.zoom]
};

function numberValue(input, fallback) {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function currentEffects() {
  const filters = [];
  if (effectInputs.backgroundBlur.checked) {
    filters.push(`blur(${numberValue(effectValues.backgroundBlur, 0)}px)`);
  }
  if (effectInputs.brightnessContrast.checked) {
    filters.push(`brightness(${numberValue(effectValues.brightness, 1)})`);
    filters.push(`contrast(${numberValue(effectValues.contrast, 1)})`);
  }
  if (effectInputs.saturation.checked) {
    filters.push(`saturate(${numberValue(effectValues.saturation, 1)})`);
  }
  if (effectInputs.sharpness.checked) {
    // Canvas has no inexpensive sharpness filter; a small contrast boost is the lightweight fallback.
    filters.push(`contrast(${numberValue(effectValues.sharpness, 1)})`);
  }
  return {
    filter: filters.join(" ") || "none",
    mirrored: mirrorInput.checked,
    zoom: effectInputs.zoom.checked ? numberValue(effectValues.zoom, 1) : 1
  };
}

function drawPreviewFrame() {
  if (!stream || sourceVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    previewFrame = stream ? requestAnimationFrame(drawPreviewFrame) : null;
    return;
  }

  const context = preview.getContext("2d");
  const { filter, mirrored, zoom } = currentEffects();
  const { width, height } = preview;
  context.save();
  context.clearRect(0, 0, width, height);
  context.filter = filter;
  context.translate(width / 2, height / 2);
  context.scale(mirrored ? -zoom : zoom, zoom);
  context.translate(-width / 2, -height / 2);
  context.drawImage(sourceVideo, 0, 0, width, height);
  context.restore();
  previewFrame = requestAnimationFrame(drawPreviewFrame);
}

async function startPreview() {
  sourceVideo.srcObject = stream;
  await sourceVideo.play();
  if (!sourceVideo.videoWidth || !sourceVideo.videoHeight) {
    await new Promise(resolve => sourceVideo.addEventListener("loadedmetadata", resolve, { once: true }));
  }
  preview.width = sourceVideo.videoWidth || 1280;
  preview.height = sourceVideo.videoHeight || 720;
  cancelAnimationFrame(previewFrame);
  previewFrame = requestAnimationFrame(drawPreviewFrame);
}

function createRecordingStream() {
  if (!preview.captureStream) {
    throw new Error("This browser cannot record the processed video preview.");
  }
  const frameRate = stream.getVideoTracks()[0]?.getSettings().frameRate || 30;
  recordingStream = preview.captureStream(Math.min(frameRate, 60));
  stream.getAudioTracks().forEach(track => recordingStream.addTrack(track));
  return recordingStream;
}

function syncEffectControl(key) {
  const enabled = effectInputs[key].checked;
  effectValueInputs[key].forEach(input => {
    input.disabled = !enabled;
    input.parentElement.hidden = !enabled;
  });
}

function updateMeter(level) {
  meterBars.forEach((bar, index) => bar.classList.toggle("active", index < level));
  meterEl.setAttribute("aria-label", `Microphone level ${level} of 10`);
  meterTextEl.textContent = `${level}/10`;
}

function stopAudioMonitor() {
  cancelAnimationFrame(audioFrame);
  audioFrame = null;
  analyser?.disconnect();
  analyser = null;
  audioContext?.close().catch(() => {});
  audioContext = null;
  silentSince = 0;
  warningEl.hidden = true;
  updateMeter(0);
}

function startAudioMonitor() {
  stopAudioMonitor();
  const audioTrack = stream?.getAudioTracks()[0];
  if (!audioTrack || !window.AudioContext) return;

  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);

  const readLevel = () => {
    if (!analyser) return;
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += (sample - 128) ** 2;
    const rms = Math.sqrt(sum / samples.length) / 128;
    const level = Math.min(10, Math.round(rms * 42));
    updateMeter(level);

    if (level === 0) {
      silentSince ||= Date.now();
      warningEl.hidden = Date.now() - silentSince < 2200;
    } else {
      silentSince = 0;
      warningEl.hidden = true;
    }
    audioFrame = requestAnimationFrame(readLevel);
  };
  audioContext.resume().catch(() => {});
  readLevel();
}

async function runCountdown() {
  const startingAt = Math.min(99, Math.max(1, Number.parseInt(countdownSecondsInput.value, 10) || 3));
  countdownSecondsInput.value = startingAt;
  countdownEl.hidden = false;
  for (let second = startingAt; second > 0; second--) {
    countdownEl.textContent = second;
    setStatus(`Recording starts in ${second}…`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  countdownEl.hidden = true;
}

async function startRecording() {
  downloadEl.style.display = "none";
  downloadEl.removeAttribute("href");
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = null;
  startBtn.disabled = true;

  try {
    cleanupStream();
    stream = await getStream();
    await startPreview();
    await populateDevices();
    startAudioMonitor();

    if (countdownInput.checked) await runCountdown();
    const nativeMp4 = supportedMime(MP4_MIME_TYPES);
    const mime = nativeMp4 || supportedMime(WEBM_MIME_TYPES);
    if (!mime) throw new Error("This browser cannot create a supported recording format.");

    chunks = [];
    resetRecordingStats();
    recorder = new MediaRecorder(createRecordingStream(), { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 });
    recorder.ondataavailable = event => {
      if (!event.data?.size) return;
      chunks.push(event.data);
      recordedBytes += event.data.size;
      updateRecordingStats();
    };
    recorder.onerror = event => {
      console.error(event);
      setStatus("Recording error. Please try again.");
      cleanupStream();
      resetUI();
    };
    recorder.onstop = finishRecording;
    recorder.start(1000);
    recordingStartedAt = Date.now();
    timerInterval = window.setInterval(updateRecordingStats, 250);

    pauseBtn.disabled = false;
    stopBtn.disabled = false;
    cameraSelect.disabled = true;
    micSelect.disabled = true;
    setStatus(nativeMp4 ? "Recording…" : "Recording… Your browser will convert the recording to MP4 after you stop.");
  } catch (error) {
    console.error(error);
    countdownEl.hidden = true;
    cleanupStream();
    resetUI();
    setStatus(`Could not start recording: ${error.message || error}`);
  }
}

function togglePause() {
  if (!recorder) return;
  if (recorder.state === "recording") {
    elapsedBeforePause = currentElapsed();
    recordingStartedAt = 0;
    recorder.pause();
    pauseBtn.textContent = "Resume";
    setStatus("Paused.");
  } else if (recorder.state === "paused") {
    recordingStartedAt = Date.now();
    recorder.resume();
    pauseBtn.textContent = "Pause";
    setStatus("Recording…");
  }
  updateRecordingStats();
}

function stopRecording() {
  if (!recorder || recorder.state === "inactive") return;
  if (recordingStartedAt) elapsedBeforePause = currentElapsed();
  recordingStartedAt = 0;
  clearInterval(timerInterval);
  updateRecordingStats();
  stopBtn.disabled = true;
  pauseBtn.disabled = true;
  setStatus("Stopping and preparing your file…");
  recorder.stop();
}

async function finishRecording() {
  const nativeType = recorder?.mimeType || "";
  const blob = new Blob(chunks, { type: nativeType });
  const duration = elapsedBeforePause;
  if (!blob.size) {
    setStatus("No recording data was produced.");
    cleanupStream();
    resetUI();
    return;
  }

  cleanupStream();
  if (nativeType.startsWith("video/mp4")) {
    saveBlob(blob, ".mp4");
    setStatus(`Done — ${formatBytes(blob.size)} MP4, ${duration.toFixed(1)} seconds.`);
    resetUI();
    return;
  }
  try {
    setStatus(`Converting ${formatBytes(blob.size)} WebM to MP4… Keep this tab open.`);
    const mp4 = await convertToMp4(blob);
    saveBlob(mp4, ".mp4");
    setStatus(`Done — ${formatBytes(mp4.size)} MP4, ${duration.toFixed(1)} seconds.`);
  } catch (error) {
    console.error(error);
    saveBlob(blob, ".webm");
    setStatus("MP4 conversion failed in this browser. The original WebM recording was saved instead.");
  } finally {
    resetUI();
  }
}

function cleanupStream() {
  stopAudioMonitor();
  cancelAnimationFrame(previewFrame);
  previewFrame = null;
  if (recordingStream) {
    recordingStream.getVideoTracks().forEach(track => track.stop());
    recordingStream = null;
  }
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  sourceVideo.srcObject = null;
  preview.getContext("2d").clearRect(0, 0, preview.width, preview.height);
}

function resetUI() {
  clearInterval(timerInterval);
  recorder = null;
  chunks = [];
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  stopBtn.disabled = true;
  pauseBtn.textContent = "Pause";
  cameraSelect.disabled = false;
  micSelect.disabled = false;
}

function saveBlob(blob, extension) {
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadEl.href = currentObjectUrl;
  downloadEl.download = `recording-${stamp}${extension}`;
  downloadEl.textContent = `Download ${extension.slice(1).toUpperCase()} (${formatBytes(blob.size)})`;
  downloadEl.style.display = "inline-block";
  const download = document.createElement("a");
  download.href = currentObjectUrl;
  download.download = downloadEl.download;
  document.body.append(download);
  download.click();
  download.remove();
}

async function convertToMp4(webmBlob) {
  const { FFmpeg } = await import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js");
  const { fetchFile, toBlobURL } = await import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js");
  const ffmpeg = new FFmpeg();
  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm")
  });
  await ffmpeg.writeFile("input.webm", await fetchFile(webmBlob));
  await ffmpeg.exec(["-i", "input.webm", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "output.mp4"]);
  const data = await ffmpeg.readFile("output.mp4");
  await ffmpeg.deleteFile("input.webm").catch(() => {});
  await ffmpeg.deleteFile("output.mp4").catch(() => {});
  return new Blob([data.buffer], { type: "video/mp4" });
}

startBtn.addEventListener("click", startRecording);
pauseBtn.addEventListener("click", togglePause);
stopBtn.addEventListener("click", stopRecording);
countdownInput.addEventListener("change", () => { countdownSecondsInput.disabled = !countdownInput.checked; });
effectsToggle.addEventListener("click", () => {
  const opened = effectsMenu.hidden;
  effectsMenu.hidden = !opened;
  effectsToggle.setAttribute("aria-expanded", String(opened));
});
Object.keys(effectInputs).forEach(key => {
  effectInputs[key].addEventListener("change", () => {
    syncEffectControl(key);
  });
  syncEffectControl(key);
});
cameraSelect.addEventListener("change", () => setStatus("Camera changed. It will be used when you start the next recording."));
micSelect.addEventListener("change", () => setStatus("Microphone changed. It will be used when you start the next recording."));
navigator.mediaDevices?.addEventListener?.("devicechange", () => populateDevices().catch(() => {}));
populateDevices().catch(() => {});
