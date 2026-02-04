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

  // Trim (seconds) - V/A共通
  let trimIn = 0, trimOut = 0;
  let activeTrack = 'audio'; // ミュート/削除対象の選択用

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

  // Volume (0.0 ~ 2.0, default 1.0)
  let volumeLevel = 1.0;

  // Drag state
  let trimDrag = null;
  let isSeeking = false;
  let volumeDrag = false;

  // Audio gain nodes for volume control
  let gainNode = null;           // For audio-only (BufferSource) playback
  let mediaElementSource = null; // For video audio routing (created once)
  let videoGainNode = null;      // For video audio volume

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
  let videoDimLeft, videoDimRight;
  let audioDimLeft, audioDimRight;
  let trimHandleIn, trimHandleOut;
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
    audioDimLeft = document.getElementById('audioDimLeft');
    audioDimRight = document.getElementById('audioDimRight');
    trimHandleIn = document.getElementById('trimHandleIn');
    trimHandleOut = document.getElementById('trimHandleOut');
    videoTrackLabel = document.getElementById('videoTrackLabel');
    audioTrackLabel = document.getElementById('audioTrackLabel');

    // Volume line
    const volLine = document.getElementById('volumeLine');
    if (volLine) updateVolumeLine();

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
    trimIn = Math.min(currentTime, trimOut - 0.001);
    updateTrimUI(); updateTimeDisplay();
  }
  function onMarkOut() {
    if (!duration) return;
    trimOut = Math.max(currentTime, trimIn + 0.001);
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

    // Volume line drag
    document.getElementById('volumeLine').addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      volumeDrag = true;
    });

    // Trim handle drag + seek drag + volume drag
    document.addEventListener('mousemove', (e) => {
      if (volumeDrag) { onVolumeDrag(e); return; }
      if (trimDrag) { onTrimDrag(e); return; }
      if (isSeeking) { onSeekDrag(e); return; }
    });
    document.addEventListener('mouseup', () => {
      trimDrag = null;
      volumeDrag = false;
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

    // Bind unified trim handles
    bindTrimHandle('trimHandleIn', 'in');
    bindTrimHandle('trimHandleOut', 'out');

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

  function onVolumeDrag(e) {
    const content = audioTrackEl.querySelector('.track-content');
    const rect = content.getBoundingClientRect();
    // 上端=200%, 下端=0%
    let ratio = 1 - ((e.clientY - rect.top) / rect.height);
    ratio = Math.max(0, Math.min(2, ratio * 2));
    volumeLevel = Math.round(ratio * 100) / 100;
    updateVolumeLine();
    // リアルタイムで再生音量に反映
    if (videoGainNode && !audioMuted) {
      videoGainNode.gain.value = volumeLevel;
    }
    if (gainNode) {
      gainNode.gain.value = volumeLevel;
    }
    // 波形を音量に連動して再描画（NLEの標準挙動）
    if (audioBuffer) drawAudioTrack();
  }

  function updateVolumeLine() {
    const volLine = document.getElementById('volumeLine');
    if (!volLine) return;
    // 50% = 中央, 0% = 下端, 100% = 上端 (volumeLevel 1.0 = 50%)
    const pct = 100 - (volumeLevel / 2) * 100;
    volLine.style.top = pct + '%';
    volLine.dataset.vol = Math.round(volumeLevel * 100) + '%';
  }

  function bindTrimHandle(id, edge) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      trimDrag = { edge };
    });
  }

  function onTrimDrag(e) {
    if (!trimDrag || !duration) return;
    e.preventDefault();

    const rect = overlayEl.getBoundingClientRect();
    let ratio = (e.clientX - rect.left) / rect.width;
    ratio = Math.max(0, Math.min(1, ratio));
    const t = ratio * duration;

    if (trimDrag.edge === 'in') trimIn = Math.min(t, trimOut - 0.001);
    else trimOut = Math.max(t, trimIn + 0.001);

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
      // Vミュート時はプレビューも非表示
      videoPlayerEl.classList.toggle('loaded', !videoMuted && mediaType === 'video');
      // V消去時はAトラックをアクティブに
      if (videoMuted && activeTrack === 'video') selectTrack('audio');
    } else {
      audioMuted = !audioMuted;
      audioTrackEl.classList.toggle('muted', audioMuted);
      // A消去時はVトラックをアクティブに
      if (audioMuted && activeTrack === 'audio' && mediaType === 'video' && !videoMuted) selectTrack('video');
    }
    // Web Audio GainNode経由で音声ミュート制御
    if (videoGainNode) {
      videoGainNode.gain.value = audioMuted ? 0 : volumeLevel;
    }
    // 再生中なら停止
    if (isPlaying) stopPlayback();
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
    // 既存メディアのクリーンアップ
    stopPlayback();
    if (videoPlayerEl.src) {
      URL.revokeObjectURL(videoPlayerEl.src);
      videoPlayerEl.src = '';
    }
    videoPlayerEl.classList.remove('loaded');
    audioBuffer = null;
    duration = 0;
    thumbCache = []; thumbCacheReady = false;
    trimIn = 0; trimOut = 0;
    currentTime = 0;
    volumeLevel = 1.0;
    videoMuted = false; audioMuted = false;
    timelineZoom = 1;
    videoTrackEl.classList.remove('muted', 'empty');
    audioTrackEl.classList.remove('muted', 'empty');
    playheadEl.style.display = 'none';
    playheadRulerEl.style.display = 'none';
    setStatus('');

    mediaFile = file;
    const isVideo = file.type.startsWith('video/');
    mediaType = isVideo ? 'video' : 'audio';

    if (isVideo) {
      loadVideo(file);
    } else {
      videoTrackEl.classList.add('empty');
      loadAudio(file);
    }
  }

  // Video audio → Web Audio API routing (createMediaElementSource は1要素1回のみ)
  function ensureVideoAudioRouting() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (!mediaElementSource) {
      mediaElementSource = audioCtx.createMediaElementSource(videoPlayerEl);
      videoGainNode = audioCtx.createGain();
      mediaElementSource.connect(videoGainNode);
      videoGainNode.connect(audioCtx.destination);
    }
    videoGainNode.gain.value = volumeLevel;
  }

  function loadVideo(file) {
    const url = URL.createObjectURL(file);
    videoPlayerEl.src = url;
    videoPlayerEl.muted = false;

    videoPlayerEl.addEventListener('loadedmetadata', function onMeta() {
      videoPlayerEl.removeEventListener('loadedmetadata', onMeta);
      duration = videoPlayerEl.duration;
      trimIn = 0; trimOut = duration;
      currentTime = 0;
      videoMuted = false; audioMuted = false;

      // Web Audio API経由で音声ルーティング（音量200%対応）
      ensureVideoAudioRouting();

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
        trimIn = 0; trimOut = duration;
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
    updateVolumeLine();
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

    // Waveform (colored, volume-scaled like NLE)
    const channelData = audioBuffer.getChannelData(0);
    const samples = channelData.length;
    const step = Math.max(1, Math.ceil(samples / w));
    const isNight = App.getTheme() === 'night';
    const waveColor = isNight ? '#4fc3f7' : '#1565c0';
    const waveFill = isNight ? 'rgba(79,195,247,0.18)' : 'rgba(21,101,192,0.12)';
    const vol = volumeLevel; // 波形をボリュームでスケール

    // まずmin/maxを1回だけ計算してキャッシュ（2パス描画で使い回す）
    const peaks = new Float32Array(w * 2); // [min0, max0, min1, max1, ...]
    for (let i = 0; i < w; i++) {
      let min = 1.0, max = -1.0;
      const start = Math.floor(i * samples / w);
      const end = Math.min(start + step, samples);
      for (let j = start; j < end; j++) {
        const v = channelData[j];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      peaks[i * 2] = min;
      peaks[i * 2 + 1] = max;
    }

    // Fill area (ボリュームスケール適用)
    audioTrackCtx.fillStyle = waveFill;
    audioTrackCtx.beginPath();
    audioTrackCtx.moveTo(0, h / 2);
    for (let i = 0; i < w; i++) {
      const scaled = Math.min(1, peaks[i * 2 + 1] * vol);
      audioTrackCtx.lineTo(i, ((1 - scaled) / 2) * h);
    }
    for (let i = w - 1; i >= 0; i--) {
      const scaled = Math.max(-1, peaks[i * 2] * vol);
      audioTrackCtx.lineTo(i, ((1 - scaled) / 2) * h);
    }
    audioTrackCtx.closePath();
    audioTrackCtx.fill();

    // Outline bars (ボリュームスケール適用)
    audioTrackCtx.fillStyle = waveColor;
    for (let i = 0; i < w; i++) {
      const sMax = Math.min(1, peaks[i * 2 + 1] * vol);
      const sMin = Math.max(-1, peaks[i * 2] * vol);
      const yTop = ((1 - sMax) / 2) * h;
      const yBot = ((1 - sMin) / 2) * h;
      audioTrackCtx.fillRect(i, yTop, 1, Math.max(0.5, yBot - yTop));
    }
  }

  /* --- Trim UI --- */
  function updateTrimUI() {
    if (!duration) return;
    const inPct = (trimIn / duration) * 100;
    const outPct = (trimOut / duration) * 100;

    // 両トラックの暗転表示
    if (videoDimLeft) {
      videoDimLeft.style.width = inPct + '%';
      videoDimRight.style.width = (100 - outPct) + '%';
    }
    if (audioDimLeft) {
      audioDimLeft.style.width = inPct + '%';
      audioDimRight.style.width = (100 - outPct) + '%';
    }

    // 統一ハンドル位置（オーバーレイ上）
    if (trimHandleIn) trimHandleIn.style.left = inPct + '%';
    if (trimHandleOut) trimHandleOut.style.left = outPct + '%';
  }

  function updateTimeDisplay() {
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
      if (currentTime < trimIn || currentTime >= trimOut) currentTime = trimIn;
      playFromTime(currentTime);
    }
  }

  function playFromTime(time) {
    if (!duration) return;

    if (mediaType === 'video') {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      videoPlayerEl.currentTime = time;
      // 音量はWeb Audio GainNode経由で制御（200%まで対応）
      if (videoGainNode) videoGainNode.gain.value = audioMuted ? 0 : volumeLevel;
      videoPlayerEl.play();
    } else {
      if (!audioCtx || !audioBuffer) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      stopSourceNode();

      const remaining = trimOut - time;
      if (remaining <= 0) return;

      sourceNode = audioCtx.createBufferSource();
      sourceNode.buffer = audioBuffer;

      // GainNode for volume control
      gainNode = audioCtx.createGain();
      gainNode.gain.value = volumeLevel;
      sourceNode.connect(gainNode);
      gainNode.connect(audioCtx.destination);

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
    if (gainNode) {
      gainNode.disconnect();
      gainNode = null;
    }
  }

  function updatePlayBtn(playing) {
    const btn = document.getElementById('editPlayBtn');
    btn.querySelector('span').className = playing ? 'icon-pause' : 'icon-play';
  }

  function animatePlayhead() {
    if (!isPlaying) return;

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
  let ffmpegInstance = null;
  let ffmpegReady = false;

  async function initFFmpeg() {
    if (ffmpegReady) return true;
    setStatus('FFmpeg読み込み中...');
    try {
      const mod = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js');
      ffmpegInstance = new mod.FFmpeg();
      ffmpegInstance.on('progress', ({ progress }) => {
        if (progress >= 0) setStatus(`処理中... ${Math.round(progress * 100)}%`);
      });
      await ffmpegInstance.load({
        coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
        wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
      });
      ffmpegReady = true;
      return true;
    } catch (e) {
      console.error('FFmpeg init failed:', e);
      return false;
    }
  }

  async function exportMedia() {
    if (!mediaFile) return;
    if (videoMuted && audioMuted) return;

    if (mediaType === 'audio' || (videoMuted && !audioMuted)) {
      // 音声のみ → MP3 (FFmpeg) / WAV (フォールバック)
      await exportAudioFFmpeg();
    } else {
      // 映像含む → MP4 (FFmpeg) / MediaRecorder (フォールバック)
      await exportVideoFFmpeg();
    }
  }

  async function exportAudioFFmpeg() {
    if (!await initFFmpeg()) {
      // FFmpeg利用不可の場合はWAVフォールバック
      exportWav();
      return;
    }

    const srcExt = (mediaFile.name.match(/\.(\w+)$/) || [,'wav'])[1].toLowerCase();
    const inFile = 'input.' + srcExt;
    const outFile = 'output.mp3';

    setStatus('ファイル読み込み中...');
    const fileData = new Uint8Array(await mediaFile.arrayBuffer());
    await ffmpegInstance.writeFile(inFile, fileData);

    const args = ['-i', inFile, '-ss', String(trimIn), '-to', String(trimOut)];
    args.push('-c:a', 'libmp3lame', '-q:a', '2');
    args.push('-y', outFile);

    setStatus('MP3書き出し中...');
    await ffmpegInstance.exec(args);

    const data = await ffmpegInstance.readFile(outFile);
    const blob = new Blob([data.buffer], { type: 'audio/mpeg' });
    App.downloadBlob(blob, 'trimmed.mp3');

    try {
      await ffmpegInstance.deleteFile(inFile);
      await ffmpegInstance.deleteFile(outFile);
    } catch(e) {}

    setStatus('MP3書き出し完了');
  }

  async function exportVideoFFmpeg() {
    if (!await initFFmpeg()) {
      setStatus('FFmpeg利用不可。代替方式で書き出します...');
      exportVideoFallback();
      return;
    }

    const srcExt = (mediaFile.name.match(/\.(\w+)$/) || [,'mp4'])[1].toLowerCase();
    const inFile = 'input.' + srcExt;

    // 出力形式: 映像あり→MP4、映像なし(音声のみ)→MP3
    const hasVideo = !videoMuted;
    const outExt = hasVideo ? 'mp4' : 'mp3';
    const outFile = 'output.' + outExt;

    setStatus('ファイル読み込み中...');
    const fileData = new Uint8Array(await mediaFile.arrayBuffer());
    await ffmpegInstance.writeFile(inFile, fileData);

    const args = ['-i', inFile, '-ss', String(trimIn), '-to', String(trimOut)];
    if (audioMuted) {
      args.push('-an');
    }
    if (videoMuted) {
      args.push('-vn');
    }
    if (hasVideo) {
      // 映像: ストリームコピー（無劣化）
      args.push('-c:v', 'copy');
      if (!audioMuted) args.push('-c:a', 'aac'); // MP4互換のためAAC
    } else {
      // 音声のみ: MP3に変換
      args.push('-c:a', 'libmp3lame', '-q:a', '2');
    }
    args.push('-y', outFile);

    setStatus('トリミング中...');
    await ffmpegInstance.exec(args);

    const data = await ffmpegInstance.readFile(outFile);
    const mimeType = hasVideo ? 'video/mp4' : 'audio/mpeg';
    const blob = new Blob([data.buffer], { type: mimeType });
    App.downloadBlob(blob, 'trimmed.' + outExt);

    try {
      await ffmpegInstance.deleteFile(inFile);
      await ffmpegInstance.deleteFile(outFile);
    } catch(e) {}

    setStatus('書き出し完了');
  }

  function exportWav() {
    if (!audioBuffer) return;
    setStatus('WAV書き出し中...');
    const sr = audioBuffer.sampleRate;
    const startSample = Math.floor((trimIn / duration) * audioBuffer.length);
    const endSample = Math.floor((trimOut / duration) * audioBuffer.length);
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
    setStatus('WAV書き出し完了（MP3にはFFmpegが必要です）');
  }

  function exportVideoFallback() {
    // フォールバック: MediaRecorder（再エンコードあり、高ビットレート）
    setStatus('代替方式で書き出し中...');

    const exportDuration = trimOut - trimIn;

    // 録画用video（スピーカー出力は無音、captureStreamで音声取得）
    const recVideo = document.createElement('video');
    recVideo.src = videoPlayerEl.src;
    recVideo.volume = 0;
    recVideo.playsInline = true;

    recVideo.addEventListener('loadedmetadata', () => {
      recVideo.currentTime = trimIn;
    });

    recVideo.addEventListener('seeked', function onSeeked() {
      recVideo.removeEventListener('seeked', onSeeked);

      // captureStream で映像+音声ストリーム取得
      let stream;
      try {
        stream = recVideo.captureStream();
      } catch (e) {
        // captureStream未対応の場合
        try { stream = recVideo.mozCaptureStream(); } catch (e2) {
          setStatus('このブラウザでは動画書き出し非対応です。音声はWAVで書き出せます。');
          return;
        }
      }

      // 音声ミュート時はaudioトラックを除去
      if (audioMuted) {
        stream.getAudioTracks().forEach(t => stream.removeTrack(t));
      }

      // MP4優先、非対応ならWebM
      const mimeType = MediaRecorder.isTypeSupported('video/mp4')
        ? 'video/mp4'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
          ? 'video/webm;codecs=vp9,opus'
          : 'video/webm';

      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 20000000 });
      const chunks = [];

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: mimeType });
        App.downloadBlob(blob, `trimmed.${ext}`);
        recVideo.src = '';
        setStatus('書き出し完了（代替方式・再エンコード）');
      };

      setStatus(`代替方式で書き出し中... (${exportDuration.toFixed(1)}秒)`);
      recorder.start();
      recVideo.play();

      // 指定時間で停止
      const checkInterval = setInterval(() => {
        if (recVideo.currentTime >= trimOut || recVideo.ended) {
          clearInterval(checkInterval);
          recVideo.pause();
          recorder.stop();
        }
      }, 50);
    });
  }

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

  function reset() {
    stopPlayback();
    mediaFile = null; mediaType = null; audioBuffer = null;
    duration = 0;
    thumbCache = []; thumbCacheReady = false;
    trimIn = 0; trimOut = 0;
    currentTime = 0; activeTrack = 'audio';
    videoMuted = false; audioMuted = false;
    volumeLevel = 1.0;
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
    updateVolumeLine();
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
