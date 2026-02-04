/* ========================================
   SUGOMEMO - Audio Module
   Web Audio API + Canvas Waveform + WAV Export
   Keyboard: Space=再生/停止, J/L=5秒, I/O=マーカー
   ======================================== */

window.AudioModule = (() => {
  let initialized = false;
  let audioCtx = null;
  let audioBuffer = null;
  let sourceNode = null;
  let isPlaying = false;
  let playStartTime = 0;
  let playOffset = 0;
  let animFrameId = null;
  let currentPlaybackTime = 0; // 現在の再生位置(秒)

  let markerStart = 0;
  let markerEnd = 1;
  let dragging = null;

  let dropZone, workspace, canvas, ctx;
  let markerStartEl, markerEndEl, selectionEl, playheadEl;
  let timeStartEl, timeDurationEl, timeEndEl;
  let infoEl;
  let eventsbound = false;

  function init() {
    if (initialized) return;
    initialized = true;

    dropZone = document.getElementById('audioDropZone');
    workspace = document.getElementById('audioWorkspace');
    canvas = document.getElementById('waveformCanvas');
    ctx = canvas.getContext('2d');
    markerStartEl = document.getElementById('markerStart');
    markerEndEl = document.getElementById('markerEnd');
    selectionEl = document.getElementById('selectionOverlay');
    playheadEl = document.getElementById('playhead');
    timeStartEl = document.getElementById('timeStart');
    timeDurationEl = document.getElementById('timeDuration');
    timeEndEl = document.getElementById('timeEnd');
    infoEl = document.getElementById('audioInfo');

    if (!eventsbound) { bindEvents(); eventsbound = true; }

    if (audioBuffer) {
      showWorkspace();
      drawWaveform();
      updateMarkerUI();
    }
  }

  function destroy() {
    stopPlayback();
    initialized = false;
  }

  function onThemeChange() {
    if (audioBuffer) drawWaveform();
  }

  /* --- Keyboard handlers (called from App) --- */
  function onSpace() { togglePlay(); }

  function onSeek(delta) {
    if (!audioBuffer) return;
    const dur = audioBuffer.duration;
    let pos = currentPlaybackTime + delta;
    pos = Math.max(0, Math.min(dur, pos));
    currentPlaybackTime = pos;
    // 再生中なら再開
    if (isPlaying) {
      stopPlayback();
      playFromTime(pos);
    } else {
      // プレイヘッドだけ更新
      updatePlayheadAt(pos);
    }
  }

  function onMarkIn() {
    if (!audioBuffer) return;
    const ratio = currentPlaybackTime / audioBuffer.duration;
    markerStart = Math.min(ratio, markerEnd - 0.005);
    updateMarkerUI();
  }

  function onMarkOut() {
    if (!audioBuffer) return;
    const ratio = currentPlaybackTime / audioBuffer.duration;
    markerEnd = Math.max(ratio, markerStart + 0.005);
    updateMarkerUI();
  }

  /* --- Events --- */
  function bindEvents() {
    const fileInput = document.getElementById('audioFileInput');

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) { loadFile(e.target.files[0]); e.target.value = ''; }
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault(); dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault(); dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });

    // マーカードラッグ
    markerStartEl.addEventListener('mousedown', (e) => { e.preventDefault(); dragging = 'start'; });
    markerEndEl.addEventListener('mousedown', (e) => { e.preventDefault(); dragging = 'end'; });
    markerStartEl.addEventListener('touchstart', (e) => { e.preventDefault(); dragging = 'start'; }, { passive: false });
    markerEndEl.addEventListener('touchstart', (e) => { e.preventDefault(); dragging = 'end'; }, { passive: false });

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);

    // 波形クリックで再生位置移動
    const waveformContainer = document.getElementById('waveformContainer');
    waveformContainer.addEventListener('click', (e) => {
      if (!audioBuffer || e.target.closest('.marker')) return;
      const rect = waveformContainer.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      currentPlaybackTime = ratio * audioBuffer.duration;
      if (isPlaying) {
        stopPlayback();
        playFromTime(currentPlaybackTime);
      } else {
        updatePlayheadAt(currentPlaybackTime);
      }
    });

    document.getElementById('audioPlayBtn').addEventListener('click', togglePlay);
    document.getElementById('audioStopBtn').addEventListener('click', () => {
      stopPlayback();
      currentPlaybackTime = markerStart * audioBuffer.duration;
      updatePlayheadAt(currentPlaybackTime);
    });
    document.getElementById('audioExportBtn').addEventListener('click', exportWav);
    document.getElementById('audioResetBtn').addEventListener('click', reset);

    window.addEventListener('resize', () => {
      if (audioBuffer && initialized) { drawWaveform(); updateMarkerUI(); }
    });
  }

  /* --- File Loading --- */
  function loadFile(file) {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const reader = new FileReader();
    reader.onload = (e) => {
      audioCtx.decodeAudioData(e.target.result).then((buffer) => {
        audioBuffer = buffer;
        markerStart = 0;
        markerEnd = 1;
        currentPlaybackTime = 0;
        showWorkspace();
        updateInfo(file.name);
        drawWaveform();
        updateMarkerUI();
      }).catch(() => {});
    };
    reader.readAsArrayBuffer(file);
  }

  function showWorkspace() {
    dropZone.hidden = true;
    workspace.hidden = false;
  }

  function updateInfo(name) {
    if (!audioBuffer) return;
    const dur = audioBuffer.duration;
    const ch = audioBuffer.numberOfChannels;
    const sr = audioBuffer.sampleRate;
    infoEl.textContent = `${name} | ${ch}ch | ${sr}Hz | ${App.formatTime(dur)}`;
  }

  /* --- Waveform --- */
  function drawWaveform() {
    if (!audioBuffer || !canvas) return;
    const container = canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(devicePixelRatio, devicePixelRatio);

    const fg = App.getFg();
    const mg = App.getMg();
    ctx.clearRect(0, 0, w, h);

    // 中心線
    ctx.strokeStyle = mg;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // 波形描画
    const channelData = audioBuffer.getChannelData(0);
    const samples = channelData.length;
    const step = Math.ceil(samples / w);
    ctx.fillStyle = fg;

    for (let i = 0; i < w; i++) {
      let min = 1.0, max = -1.0;
      const start = Math.floor(i * samples / w);
      const end = Math.min(start + step, samples);
      for (let j = start; j < end; j++) {
        const val = channelData[j];
        if (val < min) min = val;
        if (val > max) max = val;
      }
      const yMin = ((1 + min) / 2) * h;
      const yMax = ((1 + max) / 2) * h;
      ctx.fillRect(i, yMax, 1, Math.max(1, yMin - yMax));
    }
  }

  /* --- Marker Dragging --- */
  function onDragMove(e) {
    if (!dragging || !audioBuffer) return;
    e.preventDefault();
    const container = canvas.parentElement;
    const rect = container.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let ratio = (clientX - rect.left) / rect.width;
    ratio = Math.max(0, Math.min(1, ratio));

    if (dragging === 'start') markerStart = Math.min(ratio, markerEnd - 0.005);
    else markerEnd = Math.max(ratio, markerStart + 0.005);
    updateMarkerUI();
  }

  function onDragEnd() { dragging = null; }

  function updateMarkerUI() {
    if (!audioBuffer) return;
    const container = canvas.parentElement;
    const w = container.clientWidth;
    const dur = audioBuffer.duration;

    markerStartEl.style.left = (markerStart * w) + 'px';
    markerEndEl.style.left = (markerEnd * w) + 'px';
    selectionEl.style.left = (markerStart * w) + 'px';
    selectionEl.style.width = ((markerEnd - markerStart) * w) + 'px';

    timeStartEl.textContent = App.formatTime(markerStart * dur);
    timeEndEl.textContent = App.formatTime(markerEnd * dur);
    timeDurationEl.textContent = App.formatTime((markerEnd - markerStart) * dur);
  }

  /* --- Playback --- */
  function togglePlay() {
    if (isPlaying) stopPlayback();
    else startPlayback();
  }

  function startPlayback() {
    if (!audioBuffer || !audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const startSec = markerStart * audioBuffer.duration;
    const endSec = markerEnd * audioBuffer.duration;
    playFromTime(Math.max(currentPlaybackTime, startSec));
  }

  function playFromTime(time) {
    if (!audioBuffer || !audioCtx) return;
    stopSourceNode();

    const endSec = markerEnd * audioBuffer.duration;
    const remaining = endSec - time;
    if (remaining <= 0) return;

    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(audioCtx.destination);
    sourceNode.onended = () => { if (isPlaying) stopPlayback(); };

    playStartTime = audioCtx.currentTime;
    playOffset = time;
    sourceNode.start(0, time, remaining);
    isPlaying = true;
    updatePlayBtn(true);
    animatePlayhead();
  }

  function stopPlayback() {
    stopSourceNode();
    isPlaying = false;
    updatePlayBtn(false);
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
  }

  function stopSourceNode() {
    if (sourceNode) {
      try { sourceNode.stop(); } catch (e) {}
      sourceNode.disconnect();
      sourceNode = null;
    }
  }

  function updatePlayBtn(playing) {
    const btn = document.getElementById('audioPlayBtn');
    btn.querySelector('span').className = playing ? 'icon-pause' : 'icon-play';
  }

  function animatePlayhead() {
    if (!isPlaying || !audioCtx) return;
    const elapsed = audioCtx.currentTime - playStartTime;
    currentPlaybackTime = playOffset + elapsed;

    updatePlayheadAt(currentPlaybackTime);
    animFrameId = requestAnimationFrame(animatePlayhead);
  }

  function updatePlayheadAt(timeSec) {
    if (!audioBuffer) return;
    const ratio = timeSec / audioBuffer.duration;
    const container = canvas.parentElement;
    const w = container.clientWidth;
    playheadEl.style.display = 'block';
    playheadEl.style.left = (ratio * w) + 'px';
  }

  /* --- WAV Export --- */
  function exportWav() {
    if (!audioBuffer) return;
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(markerStart * audioBuffer.length);
    const endSample = Math.floor(markerEnd * audioBuffer.length);
    const numSamples = endSample - startSample;
    const numChannels = audioBuffer.numberOfChannels;

    const interleaved = new Float32Array(numSamples * numChannels);
    for (let ch = 0; ch < numChannels; ch++) {
      const cd = audioBuffer.getChannelData(ch);
      for (let i = 0; i < numSamples; i++) {
        interleaved[i * numChannels + ch] = cd[startSample + i];
      }
    }

    const pcm = new Int16Array(interleaved.length);
    for (let i = 0; i < interleaved.length; i++) {
      const s = Math.max(-1, Math.min(1, interleaved[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    const dataSize = pcm.length * 2;
    const buf = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buf);

    writeStr(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(view, 8, 'WAVE');
    writeStr(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeStr(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    new Uint8Array(buf, 44).set(new Uint8Array(pcm.buffer));

    App.downloadBlob(new Blob([buf], { type: 'audio/wav' }), 'trimmed.wav');
  }

  function writeStr(view, offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  function reset() {
    stopPlayback();
    audioBuffer = null;
    markerStart = 0;
    markerEnd = 1;
    currentPlaybackTime = 0;
    dropZone.hidden = false;
    workspace.hidden = true;
    playheadEl.style.display = 'none';
  }

  return { init, destroy, onThemeChange, onSpace, onSeek, onMarkIn, onMarkOut };
})();
