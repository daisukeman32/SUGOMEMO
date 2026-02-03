/* ========================================
   SUGOMEMO - Edit Module
   各トラック独立トリム + ズーム + ミュート
   ======================================== */

window.EditModule = (() => {
  let initialized = false;
  let eventsbound = false;

  // Media state
  let mediaType = null; // 'audio' | 'video'
  let audioCtx = null;
  let audioBuffer = null;
  let sourceNode = null;
  let mediaFile = null;
  let duration = 0;

  // Per-track trim (seconds)
  let videoTrimIn = 0, videoTrimOut = 0;
  let audioTrimIn = 0, audioTrimOut = 0;
  let activeTrack = 'audio';

  // Track mute
  let videoMuted = false;
  let audioMuted = false;

  // Timeline zoom
  let timelineZoom = 1;

  // Playback
  let isPlaying = false;
  let playStartTime = 0;
  let playOffset = 0;
  let currentTime = 0;
  let animFrameId = null;

  // Drag state
  let trimDrag = null;
  let isSeeking = false;

  // Video thumbnail cache
  let thumbCache = []; // [{time, canvas}]
  let thumbCacheReady = false;

  // DOM
  let dropZone;
  let previewEl, videoPlayerEl;
  let timelineArea, timelineScroll;
  let rulerCanvas, rulerCtx;
  let videoTrackEl, videoTrackCanvas, videoTrackCtx;
  let audioTrackEl, audioTrackCanvas, audioTrackCtx;
  let overlayEl, playheadEl, playheadRulerEl;
  let timeInEl, timeDurEl, timeOutEl, trackBadgeEl;
  let statusEl, zoomLevelEl;

  // Trim DOM
  let videoDimLeft, videoDimRight, videoHandleIn, videoHandleOut;
  let audioDimLeft, audioDimRight, audioHandleIn, audioHandleOut;
  let videoTrackLabel, audioTrackLabel;

  function init() {
    if (initialized) return;
    initialized = true;

    dropZone = document.getElementById('editDropZone');
    previewEl = document.getElementById('editPreview');
    videoPlayerEl = document.getElementById('editVideo');
    timelineArea = document.getElementById('editTimelineArea');
    timelineScroll = document.getElementById('editTimelineScroll');
    rulerCanvas = document.getElementById('rulerCanvas');
    rulerCtx = rulerCanvas.getContext('2d');
    videoTrackEl = document.getElementById('editVideoTrack');
    videoTrackCanvas = document.getElementById('videoTrackCanvas');
    videoTrackCtx = videoTrackCanvas.getContext('2d');
    audioTrackEl = document.getElementById('editAudioTrack');
    audioTrackCanvas = document.getElementById('audioTrackCanvas');
    audioTrackCtx = audioTrackCanvas.getContext('2d');
    overlayEl = document.getElementById('editTimelineOverlay');
    playheadEl = document.getElementById('editPlayhead');
    playheadRulerEl = document.getElementById('editPlayheadRuler');
    timeInEl = document.getElementById('editTimeIn');
    timeDurEl = document.getElementById('editTimeDur');
    timeOutEl = document.getElementById('editTimeOut');
    trackBadgeEl = document.getElementById('editTrackBadge');
    statusEl = document.getElementById('editStatus');
    zoomLevelEl = document.getElementById('editZoomLevel');

    videoDimLeft = document.getElementById('videoDimLeft');
    videoDimRight = document.getElementById('videoDimRight');
    videoHandleIn = document.getElementById('videoHandleIn');
    videoHandleOut = document.getElementById('videoHandleOut');
    audioDimLeft = document.getElementById('audioDimLeft');
    audioDimRight = document.getElementById('audioDimRight');
    audioHandleIn = document.getElementById('audioHandleIn');
    audioHandleOut = document.getElementById('audioHandleOut');
    videoTrackLabel = document.getElementById('videoTrackLabel');
    audioTrackLabel = document.getElementById('audioTrackLabel');

    if (!eventsbound) { bindEvents(); eventsbound = true; }

    // Mark tracks as empty initially
    if (!mediaFile) {
      videoTrackEl.classList.add('empty');
      audioTrackEl.classList.add('empty');
    } else {
      showWorkspace();
      drawAll();
    }
  }

  function destroy() { stopPlayback(); initialized = false; }
  function onThemeChange() { if (mediaFile) drawAll(); }

  // Keyboard
  function onSpace() { togglePlay(); }
  function onSeek(delta) {
    if (!duration) return;
    currentTime = Math.max(0, Math.min(duration, currentTime + delta));
    if (mediaType === 'video') videoPlayerEl.currentTime = currentTime;
    if (isPlaying) { stopPlayback(); playFromTime(currentTime); }
    else updatePlayheadPos();
  }
  function onMarkIn() {
    if (!duration) return;
    const trimOut = activeTrack === 'video' ? videoTrimOut : audioTrimOut;
    const val = Math.min(currentTime, trimOut - 0.001);
    if (activeTrack === 'video') videoTrimIn = val;
    else audioTrimIn = val;
    updateTrimUI(); updateTimeDisplay();
  }
  function onMarkOut() {
    if (!duration) return;
    const trimIn = activeTrack === 'video' ? videoTrimIn : audioTrimIn;
    const val = Math.max(currentTime, trimIn + 0.001);
    if (activeTrack === 'video') videoTrimOut = val;
    else audioTrimOut = val;
    updateTrimUI(); updateTimeDisplay();
  }

  /* --- Events --- */
  function bindEvents() {
    const fileInput = document.getElementById('editFileInput');
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) { loadFile(e.target.files[0]); e.target.value = ''; }
    });

    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault(); dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });

    // Trim handle drag + seek drag
    document.addEventListener('mousemove', (e) => {
      if (trimDrag) { onTrimDrag(e); return; }
      if (isSeeking) { onSeekDrag(e); return; }
    });
    document.addEventListener('mouseup', () => {
      trimDrag = null;
      if (isSeeking) {
        isSeeking = false;
        document.body.classList.remove('seeking');
        if (mediaType === 'video') videoPlayerEl.currentTime = currentTime;
      }
    });

    // Track label click = select track
    document.addEventListener('click', (e) => {
      const label = e.target.closest('.track-label[data-track]');
      if (label && !e.target.closest('.track-mute-btn')) {
        selectTrack(label.dataset.track);
      }
    });

    // Track content / ruler click = seek + drag to scrub
    document.addEventListener('mousedown', (e) => {
      // Ruler click → seek
      if (e.target.closest('.edit-ruler') && !e.target.closest('.playhead')) {
        e.preventDefault();
        seekFromMouseEvent(e);
        isSeeking = true;
        document.body.classList.add('seeking');
        return;
      }
      // Track content click → seek + select
      const content = e.target.closest('.track-content[data-track]');
      if (content && !e.target.closest('.trim-handle')) {
        e.preventDefault();
        selectTrack(content.dataset.track);
        seekFromMouseEvent(e);
        isSeeking = true;
        document.body.classList.add('seeking');
      }
    });

    // Bind trim handles
    bindTrimHandle('videoHandleIn', 'video', 'in');
    bindTrimHandle('videoHandleOut', 'video', 'out');
    bindTrimHandle('audioHandleIn', 'audio', 'in');
    bindTrimHandle('audioHandleOut', 'audio', 'out');

    // Mute buttons
    document.getElementById('videoMuteBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMute('video');
    });
    document.getElementById('audioMuteBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMute('audio');
    });

    // Zoom buttons
    document.getElementById('editZoomIn').addEventListener('click', () => setZoom(timelineZoom * 2));
    document.getElementById('editZoomOut').addEventListener('click', () => setZoom(timelineZoom / 2));
    document.getElementById('editZoomFit').addEventListener('click', () => setZoom(1));

    // Mouse wheel zoom on timeline area
    timelineArea.addEventListener('wheel', (e) => {
      if (!duration) return;
      e.preventDefault();
      if (e.deltaY < 0) setZoom(timelineZoom * 1.5);
      else setZoom(timelineZoom / 1.5);
    }, { passive: false });

    // Transport buttons
    document.getElementById('editPlayBtn').addEventListener('click', togglePlay);
    document.getElementById('editPrevFrame').addEventListener('click', () => onSeek(-1/30));
    document.getElementById('editNextFrame').addEventListener('click', () => onSeek(1/30));
    document.getElementById('editMarkIn').addEventListener('click', onMarkIn);
    document.getElementById('editMarkOut').addEventListener('click', onMarkOut);
    document.getElementById('editExportBtn').addEventListener('click', exportMedia);
    document.getElementById('editResetBtn').addEventListener('click', reset);

    // Video timeupdate
    videoPlayerEl.addEventListener('timeupdate', () => {
      if (mediaType === 'video' && isPlaying) {
        currentTime = videoPlayerEl.currentTime;
        const trimOut = activeTrack === 'video' ? videoTrimOut : audioTrimOut;
        if (currentTime >= trimOut) { stopPlayback(); }
      }
    });

    window.addEventListener('resize', () => { if (mediaFile && initialized) drawAll(); });
  }

  /* --- Seek drag --- */
  function seekFromMouseEvent(e) {
    if (!duration) return;
    // Use the audio track content (always visible) as reference
    const refTrack = mediaType === 'video' ? videoTrackEl : audioTrackEl;
    const content = refTrack.querySelector('.track-content');
    const rect = content.getBoundingClientRect();
    let ratio = (e.clientX - rect.left) / rect.width;
    ratio = Math.max(0, Math.min(1, ratio));
    currentTime = ratio * duration;
    if (isPlaying) stopPlayback();
    if (mediaType === 'video') videoPlayerEl.currentTime = currentTime;
    updatePlayheadPos();
    updateTimeDisplay();
  }

  function onSeekDrag(e) {
    if (!duration) return;
    e.preventDefault();
    const refTrack = mediaType === 'video' ? videoTrackEl : audioTrackEl;
    const content = refTrack.querySelector('.track-content');
    const rect = content.getBoundingClientRect();
    let ratio = (e.clientX - rect.left) / rect.width;
    ratio = Math.max(0, Math.min(1, ratio));
    currentTime = ratio * duration;
    if (mediaType === 'video') videoPlayerEl.currentTime = currentTime;
    updatePlayheadPos();
    updateTimeDisplay();
  }

  function bindTrimHandle(id, track, edge) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectTrack(track);
      trimDrag = { track, edge };
    });
  }

  function onTrimDrag(e) {
    if (!trimDrag || !duration) return;
    e.preventDefault();

    const trackEl = trimDrag.track === 'video' ? videoTrackEl : audioTrackEl;
    const content = trackEl.querySelector('.track-content');
    const rect = content.getBoundingClientRect();
    let ratio = (e.clientX - rect.left) / rect.width;
    ratio = Math.max(0, Math.min(1, ratio));
    const t = ratio * duration;

    if (trimDrag.track === 'video') {
      if (trimDrag.edge === 'in') videoTrimIn = Math.min(t, videoTrimOut - 0.001);
      else videoTrimOut = Math.max(t, videoTrimIn + 0.001);
    } else {
      if (trimDrag.edge === 'in') audioTrimIn = Math.min(t, audioTrimOut - 0.001);
      else audioTrimOut = Math.max(t, audioTrimIn + 0.001);
    }

    updateTrimUI();
    updateTimeDisplay();
  }

  function selectTrack(track) {
    if (mediaType === 'audio' && track === 'video') return;
    activeTrack = track;
    if (videoTrackLabel) videoTrackLabel.classList.toggle('active', track === 'video');
    if (audioTrackLabel) audioTrackLabel.classList.toggle('active', track === 'audio');
    if (trackBadgeEl) trackBadgeEl.textContent = track === 'video' ? 'V' : 'A';
    updateTimeDisplay();
  }

  function toggleMute(track) {
    if (track === 'video') {
      videoMuted = !videoMuted;
      videoTrackEl.classList.toggle('muted', videoMuted);
    } else {
      audioMuted = !audioMuted;
      audioTrackEl.classList.toggle('muted', audioMuted);
    }
    updateExportLabel();
  }

  function updateExportLabel() {
    const btn = document.getElementById('editExportBtn');
    if (mediaType === 'video') {
      if (videoMuted && audioMuted) {
        btn.textContent = '書き出し (無効)';
        btn.disabled = true;
      } else if (videoMuted) {
        btn.textContent = '音声のみ書き出し';
        btn.disabled = false;
      } else if (audioMuted) {
        btn.textContent = '映像のみ書き出し';
        btn.disabled = false;
      } else {
        btn.textContent = '書き出し';
        btn.disabled = false;
      }
    } else {
      btn.textContent = '書き出し';
      btn.disabled = audioMuted;
    }
  }

  /* --- Zoom --- */
  function setZoom(z) {
    timelineZoom = Math.max(1, Math.min(32, z));
    // 表示用: 整数ならそのまま、小数なら2桁まで
    const zoomLabel = Number.isInteger(timelineZoom) ? timelineZoom : timelineZoom.toFixed(2).replace(/0+$/, '');
    if (zoomLevelEl) zoomLevelEl.textContent = '×' + zoomLabel;
    timelineScroll.style.width = (100 * timelineZoom) + '%';
    drawAll();

    // Scroll to keep playhead visible
    if (duration > 0) {
      const ratio = currentTime / duration;
      const scrollTarget = timelineScroll.clientWidth * ratio - timelineArea.clientWidth / 2;
      timelineArea.scrollLeft = Math.max(0, scrollTarget);
    }
  }

  /* --- Load --- */
  function loadFile(file) {
    mediaFile = file;
    const isVideo = file.type.startsWith('video/');
    mediaType = isVideo ? 'video' : 'audio';

    if (isVideo) {
      loadVideo(file);
    } else {
      loadAudio(file);
    }
  }

  function loadVideo(file) {
    const url = URL.createObjectURL(file);
    videoPlayerEl.src = url;
    videoPlayerEl.muted = false;

    videoPlayerEl.addEventListener('loadedmetadata', function onMeta() {
      videoPlayerEl.removeEventListener('loadedmetadata', onMeta);
      duration = videoPlayerEl.duration;
      videoTrimIn = 0; videoTrimOut = duration;
      audioTrimIn = 0; audioTrimOut = duration;
      currentTime = 0;
      videoMuted = false; audioMuted = false;

      generateThumbCache();

      const reader = new FileReader();
      reader.onload = (e) => {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtx.decodeAudioData(e.target.result).then(buf => {
          audioBuffer = buf;
          showWorkspace();
          drawAll();
        }).catch(() => {
          showWorkspace();
          drawAll();
        });
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function loadAudio(file) {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const reader = new FileReader();
    reader.onload = (e) => {
      audioCtx.decodeAudioData(e.target.result).then(buf => {
        audioBuffer = buf;
        duration = buf.duration;
        audioTrimIn = 0; audioTrimOut = duration;
        currentTime = 0;
        activeTrack = 'audio';
        audioMuted = false;
        showWorkspace();
        drawAll();
      }).catch(() => setStatus('音声デコード失敗'));
    };
    reader.readAsArrayBuffer(file);
  }

  function showWorkspace() {
    // Drop zone becomes compact bar
    dropZone.classList.add('has-media');

    // Show video element if video
    if (mediaType === 'video') {
      videoPlayerEl.classList.add('loaded');
      videoTrackEl.classList.remove('empty');
    }
    audioTrackEl.classList.remove('empty');
    videoTrackEl.classList.remove('muted');
    audioTrackEl.classList.remove('muted');

    if (mediaType === 'video') {
      selectTrack('video');
    } else {
      selectTrack('audio');
    }
    updateExportLabel();
    updateTimeDisplay();
    setZoom(1);
  }

  /* --- Drawing --- */
  function drawAll() {
    drawRuler();
    drawVideoTrack();
    drawAudioTrack();
    if (duration > 0) {
      updateTrimUI();
      updatePlayheadPos();
    }
  }

  function getContentWidth() {
    const content = audioTrackEl.querySelector('.track-content');
    return content ? content.clientWidth : 400;
  }

  function drawRuler() {
    const el = rulerCanvas.parentElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    rulerCanvas.width = w * devicePixelRatio;
    rulerCanvas.height = h * devicePixelRatio;
    rulerCanvas.style.width = w + 'px';
    rulerCanvas.style.height = h + 'px';
    rulerCtx.scale(devicePixelRatio, devicePixelRatio);

    const fg = App.getFg();
    const mg = App.getMg();
    const bg = App.getBg();

    rulerCtx.fillStyle = bg;
    rulerCtx.fillRect(0, 0, w, h);

    if (!duration) return;

    rulerCtx.fillStyle = mg;
    rulerCtx.font = '10px monospace';
    rulerCtx.textBaseline = 'bottom';

    // Adaptive tick interval based on zoom
    const pxPerSec = w / duration;
    let tickSec;
    if (pxPerSec > 100) tickSec = 0.1;
    else if (pxPerSec > 30) tickSec = 0.5;
    else if (pxPerSec > 10) tickSec = 1;
    else if (pxPerSec > 3) tickSec = 5;
    else tickSec = 10;

    const numTicks = Math.floor(duration / tickSec);

    for (let i = 0; i <= numTicks; i++) {
      const t = i * tickSec;
      const x = (t / duration) * w;

      let isMajor;
      if (tickSec >= 5) isMajor = (i % 2 === 0);
      else if (tickSec >= 1) isMajor = (i % 5 === 0);
      else if (tickSec >= 0.5) isMajor = (i % 2 === 0);
      else isMajor = (i % 10 === 0);

      rulerCtx.fillStyle = mg;
      rulerCtx.fillRect(x, isMajor ? 0 : h * 0.5, 0.5, h);

      if (isMajor) {
        rulerCtx.fillText(App.formatTime(t), x + 2, h - 2);
      }
    }

    rulerCtx.strokeStyle = mg;
    rulerCtx.lineWidth = 0.5;
    rulerCtx.beginPath();
    rulerCtx.moveTo(0, h - 0.5);
    rulerCtx.lineTo(w, h - 0.5);
    rulerCtx.stroke();
  }

  function generateThumbCache() {
    if (!videoPlayerEl.src || !duration) return;
    thumbCache = [];
    thumbCacheReady = false;

    const THUMB_COUNT = Math.min(40, Math.max(10, Math.ceil(duration)));
    const thumbH = 80;
    const thumbW = Math.round(thumbH * (videoPlayerEl.videoWidth / videoPlayerEl.videoHeight)) || 120;

    const tempVideo = document.createElement('video');
    tempVideo.src = videoPlayerEl.src;
    tempVideo.muted = true;
    tempVideo.preload = 'auto';

    let gen = 0;

    tempVideo.addEventListener('loadeddata', () => captureNext());

    function captureNext() {
      if (gen >= THUMB_COUNT) {
        tempVideo.src = '';
        thumbCacheReady = true;
        drawAll();
        return;
      }
      tempVideo.currentTime = (gen + 0.5) * (duration / THUMB_COUNT);
    }

    tempVideo.addEventListener('seeked', () => {
      try {
        const c = document.createElement('canvas');
        c.width = thumbW; c.height = thumbH;
        const ctx = c.getContext('2d');
        ctx.drawImage(tempVideo, 0, 0, thumbW, thumbH);
        thumbCache.push({ time: (gen + 0.5) * (duration / THUMB_COUNT), canvas: c });
      } catch (e) {}
      gen++;
      captureNext();
    });
  }

  function drawVideoTrack() {
    const content = videoTrackEl.querySelector('.track-content');
    const w = content.clientWidth;
    const h = content.clientHeight;
    videoTrackCanvas.width = w * devicePixelRatio;
    videoTrackCanvas.height = h * devicePixelRatio;
    videoTrackCanvas.style.width = w + 'px';
    videoTrackCanvas.style.height = h + 'px';
    videoTrackCtx.scale(devicePixelRatio, devicePixelRatio);

    videoTrackCtx.fillStyle = App.getTrackBg();
    videoTrackCtx.fillRect(0, 0, w, h);

    if (mediaType !== 'video' || !videoPlayerEl.src) return;

    if (thumbCacheReady) {
      drawVideoTrackFromCache();
    }
  }

  function drawVideoTrackFromCache() {
    if (!thumbCache.length || !duration) return;
    const content = videoTrackEl.querySelector('.track-content');
    const w = content.clientWidth;
    const h = content.clientHeight;

    // サムネイルのアスペクト比を維持してタイル状に並べる
    const thumbAspect = thumbCache[0].canvas.width / thumbCache[0].canvas.height;
    const tileW = h * thumbAspect; // 1枚のサムネイル表示幅（アスペクト比維持）
    const totalTiles = Math.ceil(w / tileW);

    for (let t = 0; t < totalTiles; t++) {
      const x = t * tileW;
      // この位置に対応する時間からキャッシュのインデックスを決定
      const timeRatio = (x + tileW / 2) / w;
      const cacheIdx = Math.min(thumbCache.length - 1, Math.max(0, Math.floor(timeRatio * thumbCache.length)));
      try {
        videoTrackCtx.drawImage(thumbCache[cacheIdx].canvas, x, 0, tileW, h);
      } catch (e) {}
    }
  }

  function drawAudioTrack() {
    const content = audioTrackEl.querySelector('.track-content');
    const w = content.clientWidth;
    const h = content.clientHeight;
    audioTrackCanvas.width = w * devicePixelRatio;
    audioTrackCanvas.height = h * devicePixelRatio;
    audioTrackCanvas.style.width = w + 'px';
    audioTrackCanvas.style.height = h + 'px';
    audioTrackCtx.scale(devicePixelRatio, devicePixelRatio);

    const fg = App.getFg();
    const mg = App.getMg();
    const trackBg = App.getTrackBg();

    audioTrackCtx.fillStyle = trackBg;
    audioTrackCtx.fillRect(0, 0, w, h);

    // Center line
    audioTrackCtx.strokeStyle = mg;
    audioTrackCtx.lineWidth = 0.5;
    audioTrackCtx.beginPath();
    audioTrackCtx.moveTo(0, h / 2);
    audioTrackCtx.lineTo(w, h / 2);
    audioTrackCtx.stroke();

    if (!audioBuffer) return;

    // Waveform
    const channelData = audioBuffer.getChannelData(0);
    const samples = channelData.length;
    const step = Math.max(1, Math.ceil(samples / w));
    audioTrackCtx.fillStyle = fg;

    for (let i = 0; i < w; i++) {
      let min = 1.0, max = -1.0;
      const start = Math.floor(i * samples / w);
      const end = Math.min(start + step, samples);
      for (let j = start; j < end; j++) {
        const v = channelData[j];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const yTop = ((1 - max) / 2) * h;
      const yBot = ((1 - min) / 2) * h;
      audioTrackCtx.fillRect(i, yTop, 1, Math.max(0.5, yBot - yTop));
    }
  }

  /* --- Trim UI --- */
  function updateTrimUI() {
    if (!duration) return;

    if (mediaType === 'video' && videoDimLeft) {
      const vInPct = (videoTrimIn / duration) * 100;
      const vOutPct = (videoTrimOut / duration) * 100;
      videoDimLeft.style.width = vInPct + '%';
      videoDimRight.style.width = (100 - vOutPct) + '%';
      videoHandleIn.style.left = vInPct + '%';
      videoHandleOut.style.right = (100 - vOutPct) + '%';
    }

    if (audioDimLeft) {
      const aInPct = (audioTrimIn / duration) * 100;
      const aOutPct = (audioTrimOut / duration) * 100;
      audioDimLeft.style.width = aInPct + '%';
      audioDimRight.style.width = (100 - aOutPct) + '%';
      audioHandleIn.style.left = aInPct + '%';
      audioHandleOut.style.right = (100 - aOutPct) + '%';
    }
  }

  function updateTimeDisplay() {
    const trimIn = activeTrack === 'video' ? videoTrimIn : audioTrimIn;
    const trimOut = activeTrack === 'video' ? videoTrimOut : audioTrimOut;
    timeInEl.textContent = App.formatTime(trimIn);
    timeOutEl.textContent = App.formatTime(trimOut);
    timeDurEl.textContent = App.formatTime(trimOut - trimIn);
  }

  function updatePlayheadPos() {
    if (!duration) return;
    const w = overlayEl.clientWidth;
    const px = (currentTime / duration) * w;
    playheadEl.style.display = 'block';
    playheadEl.style.left = px + 'px';
    playheadRulerEl.style.display = 'block';
    playheadRulerEl.style.left = px + 'px';
  }

  /* --- Playback --- */
  function togglePlay() {
    if (isPlaying) stopPlayback();
    else {
      const trimIn = activeTrack === 'video' ? videoTrimIn : audioTrimIn;
      const trimOut = activeTrack === 'video' ? videoTrimOut : audioTrimOut;
      if (currentTime < trimIn || currentTime >= trimOut) currentTime = trimIn;
      playFromTime(currentTime);
    }
  }

  function playFromTime(time) {
    if (!duration) return;
    const trimOut = activeTrack === 'video' ? videoTrimOut : audioTrimOut;

    if (mediaType === 'video') {
      videoPlayerEl.currentTime = time;
      videoPlayerEl.muted = audioMuted;
      videoPlayerEl.play();
    } else {
      if (!audioCtx || !audioBuffer) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      stopSourceNode();

      const remaining = trimOut - time;
      if (remaining <= 0) return;

      sourceNode = audioCtx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(audioCtx.destination);
      sourceNode.onended = () => { if (isPlaying) stopPlayback(); };

      playStartTime = audioCtx.currentTime;
      playOffset = time;
      sourceNode.start(0, time, remaining);
    }

    isPlaying = true;
    updatePlayBtn(true);
    animatePlayhead();
  }

  function stopPlayback() {
    if (mediaType === 'video') {
      videoPlayerEl.pause();
    } else {
      stopSourceNode();
    }
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
    const btn = document.getElementById('editPlayBtn');
    btn.querySelector('span').className = playing ? 'icon-pause' : 'icon-play';
  }

  function animatePlayhead() {
    if (!isPlaying) return;
    const trimOut = activeTrack === 'video' ? videoTrimOut : audioTrimOut;

    if (mediaType === 'video') {
      currentTime = videoPlayerEl.currentTime;
    } else if (audioCtx) {
      currentTime = playOffset + (audioCtx.currentTime - playStartTime);
    }

    if (currentTime >= trimOut) { stopPlayback(); return; }
    updatePlayheadPos();

    // Auto-scroll to keep playhead visible
    if (timelineZoom > 1 && timelineArea && timelineScroll) {
      const ratio = currentTime / duration;
      const playheadPx = timelineScroll.clientWidth * ratio;
      const viewLeft = timelineArea.scrollLeft;
      const viewRight = viewLeft + timelineArea.clientWidth;
      if (playheadPx < viewLeft + 50 || playheadPx > viewRight - 50) {
        timelineArea.scrollLeft = playheadPx - timelineArea.clientWidth / 2;
      }
    }

    animFrameId = requestAnimationFrame(animatePlayhead);
  }

  /* --- Export --- */
  async function exportMedia() {
    if (!mediaFile) return;

    if (mediaType === 'audio') {
      // 音声ファイル → WAV書き出し
      exportWav();
    } else if (videoMuted && !audioMuted) {
      // 動画ファイルでV無効 → 音声のみWAV書き出し（FFmpeg不要）
      exportWav();
    } else if (audioMuted && !videoMuted) {
      // 映像のみ → FFmpeg必要
      await exportVideoFFmpeg();
    } else {
      // 通常 → FFmpeg
      await exportVideoFFmpeg();
    }
  }

  function exportWav() {
    if (!audioBuffer) return;
    setStatus('WAV書き出し中...');
    const sr = audioBuffer.sampleRate;
    const startSample = Math.floor((audioTrimIn / duration) * audioBuffer.length);
    const endSample = Math.floor((audioTrimOut / duration) * audioBuffer.length);
    const numSamples = endSample - startSample;
    const numCh = audioBuffer.numberOfChannels;

    const interleaved = new Float32Array(numSamples * numCh);
    for (let ch = 0; ch < numCh; ch++) {
      const cd = audioBuffer.getChannelData(ch);
      for (let i = 0; i < numSamples; i++) interleaved[i * numCh + ch] = cd[startSample + i];
    }

    const pcm = new Int16Array(interleaved.length);
    for (let i = 0; i < interleaved.length; i++) {
      const s = Math.max(-1, Math.min(1, interleaved[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    const dataSize = pcm.length * 2;
    const buf = new ArrayBuffer(44 + dataSize);
    const v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };

    ws(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE');
    ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, numCh, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * numCh * 2, true); v.setUint16(32, numCh * 2, true);
    v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, dataSize, true);
    new Uint8Array(buf, 44).set(new Uint8Array(pcm.buffer));

    App.downloadBlob(new Blob([buf], { type: 'audio/wav' }), 'trimmed.wav');
    setStatus('WAV書き出し完了');
  }

  let ffmpeg = null, ffmpegLoaded = false, ffmpegLoading = false;

  async function exportVideoFFmpeg() {
    if (!ffmpegLoaded && !ffmpegLoading) {
      ffmpegLoading = true;
      setStatus('FFmpeg読み込み中...');
      try {
        const { FFmpeg } = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js');
        const { toBlobURL } = await import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js');
        ffmpeg = new FFmpeg();
        ffmpeg.on('progress', ({ progress }) => setStatus(`処理中: ${Math.round(progress * 100)}%`));
        const coreURL = await toBlobURL('https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js', 'text/javascript');
        const wasmURL = await toBlobURL('https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm', 'application/wasm');
        await ffmpeg.load({ coreURL, wasmURL });
        ffmpegLoaded = true; ffmpegLoading = false;
        setStatus('FFmpeg準備完了');
      } catch (e) {
        ffmpegLoading = false;
        setStatus('FFmpeg読み込み失敗: ' + e.message);
        return;
      }
    }
    if (!ffmpegLoaded) return;

    setStatus('トリミング中...');
    try {
      const fileData = await mediaFile.arrayBuffer();
      const ext = mediaFile.name.split('.').pop() || 'mp4';
      await ffmpeg.writeFile(`in.${ext}`, new Uint8Array(fileData));

      if (videoMuted && !audioMuted) {
        // 音声のみ書き出し
        await ffmpeg.exec(['-ss', String(audioTrimIn), '-i', `in.${ext}`,
          '-t', String(audioTrimOut - audioTrimIn),
          '-vn', '-c:a', 'copy', 'out.aac']);
        const data = await ffmpeg.readFile('out.aac');
        App.downloadBlob(new Blob([data.buffer], { type: 'audio/aac' }), 'trimmed.aac');
        await ffmpeg.deleteFile('out.aac');
      } else if (audioMuted && !videoMuted) {
        // 映像のみ書き出し
        await ffmpeg.exec(['-ss', String(videoTrimIn), '-i', `in.${ext}`,
          '-t', String(videoTrimOut - videoTrimIn),
          '-an', '-c:v', 'copy', `out.${ext}`]);
        const data = await ffmpeg.readFile(`out.${ext}`);
        App.downloadBlob(new Blob([data.buffer], { type: mediaFile.type || 'video/mp4' }), `trimmed.${ext}`);
        await ffmpeg.deleteFile(`out.${ext}`);
      } else if (Math.abs(videoTrimIn - audioTrimIn) < 0.01 && Math.abs(videoTrimOut - audioTrimOut) < 0.01) {
        // 同じ範囲 → 単純カット
        await ffmpeg.exec(['-ss', String(videoTrimIn), '-i', `in.${ext}`,
          '-t', String(videoTrimOut - videoTrimIn), '-c', 'copy',
          '-avoid_negative_ts', 'make_zero', `out.${ext}`]);
        const data = await ffmpeg.readFile(`out.${ext}`);
        App.downloadBlob(new Blob([data.buffer], { type: mediaFile.type || 'video/mp4' }), `trimmed.${ext}`);
        await ffmpeg.deleteFile(`out.${ext}`);
      } else {
        // 異なる範囲 → V/A別に抽出して結合
        await ffmpeg.exec(['-ss', String(videoTrimIn), '-i', `in.${ext}`,
          '-t', String(videoTrimOut - videoTrimIn),
          '-an', '-c:v', 'copy', 'temp_v.mp4']);
        await ffmpeg.exec(['-ss', String(audioTrimIn), '-i', `in.${ext}`,
          '-t', String(audioTrimOut - audioTrimIn),
          '-vn', '-c:a', 'copy', 'temp_a.aac']);
        await ffmpeg.exec(['-i', 'temp_v.mp4', '-i', 'temp_a.aac',
          '-c', 'copy', '-shortest', `out.${ext}`]);
        const data = await ffmpeg.readFile(`out.${ext}`);
        App.downloadBlob(new Blob([data.buffer], { type: mediaFile.type || 'video/mp4' }), `trimmed.${ext}`);
        try { await ffmpeg.deleteFile('temp_v.mp4'); } catch(e) {}
        try { await ffmpeg.deleteFile('temp_a.aac'); } catch(e) {}
        await ffmpeg.deleteFile(`out.${ext}`);
      }

      await ffmpeg.deleteFile(`in.${ext}`);
      setStatus('書き出し完了');
    } catch (e) {
      setStatus('書き出し失敗: ' + e.message);
    }
  }

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

  function reset() {
    stopPlayback();
    mediaFile = null; mediaType = null; audioBuffer = null;
    duration = 0;
    thumbCache = []; thumbCacheReady = false;
    videoTrimIn = 0; videoTrimOut = 0;
    audioTrimIn = 0; audioTrimOut = 0;
    currentTime = 0; activeTrack = 'audio';
    videoMuted = false; audioMuted = false;
    timelineZoom = 1;
    videoPlayerEl.src = '';
    videoPlayerEl.classList.remove('loaded');
    dropZone.classList.remove('has-media');
    videoTrackEl.classList.add('empty');
    audioTrackEl.classList.add('empty');
    playheadEl.style.display = 'none';
    playheadRulerEl.style.display = 'none';
    videoTrackEl.classList.remove('muted');
    audioTrackEl.classList.remove('muted');
    // Clear track canvases
    drawAll();
    setStatus('');
  }

  function onZoomIn() { setZoom(timelineZoom * 2); }
  function onZoomOut() { setZoom(timelineZoom / 2); }
  function onZoomFit() { setZoom(1); }
  function onDelete() { toggleMute(activeTrack); }

  return { init, destroy, onThemeChange, onSpace, onSeek, onMarkIn, onMarkOut, onZoomIn, onZoomOut, onZoomFit, onDelete };
})();
