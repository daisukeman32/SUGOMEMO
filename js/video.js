/* ========================================
   SUGOMEMO - Video Module
   FFmpeg.wasm + Timeline + Markers
   Keyboard: Space=再生/停止, J/L=5秒, I/O=マーカー
   ======================================== */

window.VideoModule = (() => {
  let initialized = false;
  let eventsbound = false;
  let ffmpeg = null;
  let ffmpegLoaded = false;
  let ffmpegLoading = false;
  let videoFile = null;
  let videoDuration = 0;

  let markerStart = 0;
  let markerEnd = 1;
  let dragging = null;
  let animFrameId = null;

  let dropZone, workspace, videoPlayer;
  let timelineCanvas, timelineCtx;
  let markerStartEl, markerEndEl, selectionEl, playheadEl;
  let timeStartEl, timeDurationEl, timeEndEl;
  let statusEl;

  function init() {
    if (initialized) return;
    initialized = true;

    dropZone = document.getElementById('videoDropZone');
    workspace = document.getElementById('videoWorkspace');
    videoPlayer = document.getElementById('videoPlayer');
    timelineCanvas = document.getElementById('timelineCanvas');
    timelineCtx = timelineCanvas.getContext('2d');
    markerStartEl = document.getElementById('videoMarkerStart');
    markerEndEl = document.getElementById('videoMarkerEnd');
    selectionEl = document.getElementById('videoSelectionOverlay');
    playheadEl = document.getElementById('videoPlayhead');
    timeStartEl = document.getElementById('videoTimeStart');
    timeDurationEl = document.getElementById('videoTimeDuration');
    timeEndEl = document.getElementById('videoTimeEnd');
    statusEl = document.getElementById('ffmpegStatus');

    if (!eventsbound) { bindEvents(); eventsbound = true; }

    if (videoFile) {
      showWorkspace();
      updateMarkerUI();
    }
  }

  function destroy() {
    stopPlayback();
    initialized = false;
  }

  function onThemeChange() {
    if (videoFile) generateThumbnails();
  }

  /* --- Keyboard handlers --- */
  function onSpace() {
    if (!videoFile) return;
    if (videoPlayer.paused) startPlayback();
    else { videoPlayer.pause(); updatePlayBtn(false); cancelAnim(); }
  }

  function onSeek(delta) {
    if (!videoFile) return;
    let t = videoPlayer.currentTime + delta;
    t = Math.max(0, Math.min(videoDuration, t));
    videoPlayer.currentTime = t;
    updatePlayheadAt(t);
  }

  function onMarkIn() {
    if (!videoFile) return;
    const ratio = videoPlayer.currentTime / videoDuration;
    markerStart = Math.min(ratio, markerEnd - 0.005);
    updateMarkerUI();
  }

  function onMarkOut() {
    if (!videoFile) return;
    const ratio = videoPlayer.currentTime / videoDuration;
    markerEnd = Math.max(ratio, markerStart + 0.005);
    updateMarkerUI();
  }

  /* --- Events --- */
  function bindEvents() {
    const fileInput = document.getElementById('videoFileInput');

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

    // マーカー
    markerStartEl.addEventListener('mousedown', (e) => { e.preventDefault(); dragging = 'start'; });
    markerEndEl.addEventListener('mousedown', (e) => { e.preventDefault(); dragging = 'end'; });
    markerStartEl.addEventListener('touchstart', (e) => { e.preventDefault(); dragging = 'start'; }, { passive: false });
    markerEndEl.addEventListener('touchstart', (e) => { e.preventDefault(); dragging = 'end'; }, { passive: false });

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);

    // タイムラインクリックでシーク
    const timelineContainer = document.getElementById('timelineContainer');
    timelineContainer.addEventListener('click', (e) => {
      if (!videoFile || e.target.closest('.marker')) return;
      const rect = timelineContainer.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      videoPlayer.currentTime = ratio * videoDuration;
      updatePlayheadAt(videoPlayer.currentTime);
    });

    document.getElementById('videoPlayBtn').addEventListener('click', () => onSpace());
    document.getElementById('videoStopBtn').addEventListener('click', stopPlayback);
    document.getElementById('videoExportBtn').addEventListener('click', exportVideo);
    document.getElementById('videoResetBtn').addEventListener('click', reset);

    videoPlayer.addEventListener('timeupdate', onTimeUpdate);
    videoPlayer.addEventListener('ended', () => { updatePlayBtn(false); cancelAnim(); });

    window.addEventListener('resize', () => {
      if (videoFile && initialized) {
        generateThumbnails();
        updateMarkerUI();
      }
    });
  }

  /* --- File Loading --- */
  function loadFile(file) {
    videoFile = file;
    const url = URL.createObjectURL(file);
    videoPlayer.src = url;

    videoPlayer.addEventListener('loadedmetadata', function onMeta() {
      videoPlayer.removeEventListener('loadedmetadata', onMeta);
      videoDuration = videoPlayer.duration;
      markerStart = 0;
      markerEnd = 1;
      showWorkspace();
      updateMarkerUI();
      generateThumbnails();
    });
  }

  function showWorkspace() {
    dropZone.hidden = true;
    workspace.hidden = false;
  }

  /* --- Timeline --- */
  function generateThumbnails() {
    const numThumbs = 15;
    const container = timelineCanvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    timelineCanvas.width = w * devicePixelRatio;
    timelineCanvas.height = h * devicePixelRatio;
    timelineCanvas.style.width = w + 'px';
    timelineCanvas.style.height = h + 'px';
    timelineCtx.scale(devicePixelRatio, devicePixelRatio);

    const bg = App.getBg();
    const mg = App.getMg();
    timelineCtx.fillStyle = bg;
    timelineCtx.fillRect(0, 0, w, h);

    // タイムコードマーカー
    timelineCtx.fillStyle = mg;
    timelineCtx.font = '9px monospace';
    timelineCtx.textBaseline = 'top';
    const interval = videoDuration / 10;
    for (let i = 0; i <= 10; i++) {
      const x = (i / 10) * w;
      timelineCtx.fillRect(x, 0, 0.5, h);
      if (i < 10) timelineCtx.fillText(App.formatTime(i * interval), x + 3, 3);
    }

    // サムネイル生成
    const tempVideo = document.createElement('video');
    tempVideo.src = videoPlayer.src;
    tempVideo.muted = true;
    tempVideo.preload = 'auto';

    const thumbW = w / numThumbs;
    let generated = 0;

    tempVideo.addEventListener('loadeddata', () => captureNext());

    function captureNext() {
      if (generated >= numThumbs) { tempVideo.src = ''; return; }
      tempVideo.currentTime = (generated + 0.5) * (videoDuration / numThumbs);
    }

    tempVideo.addEventListener('seeked', () => {
      const x = generated * thumbW;
      try {
        // 半透明でサムネイルを描画(タイムコードが見えるように)
        timelineCtx.globalAlpha = 0.3;
        timelineCtx.drawImage(tempVideo, x, 0, thumbW, h);
        timelineCtx.globalAlpha = 1.0;
      } catch (e) {}
      generated++;
      captureNext();
    });
  }

  /* --- Marker Dragging --- */
  function onDragMove(e) {
    if (!dragging || !videoFile) return;
    e.preventDefault();
    const container = timelineCanvas.parentElement;
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
    if (!videoFile) return;
    const container = timelineCanvas.parentElement;
    const w = container.clientWidth;

    markerStartEl.style.left = (markerStart * w) + 'px';
    markerEndEl.style.left = (markerEnd * w) + 'px';
    selectionEl.style.left = (markerStart * w) + 'px';
    selectionEl.style.width = ((markerEnd - markerStart) * w) + 'px';

    const tStart = markerStart * videoDuration;
    const tEnd = markerEnd * videoDuration;
    timeStartEl.textContent = App.formatTime(tStart);
    timeEndEl.textContent = App.formatTime(tEnd);
    timeDurationEl.textContent = App.formatTime(tEnd - tStart);
  }

  /* --- Playback --- */
  function startPlayback() {
    if (!videoFile) return;
    const startTime = markerStart * videoDuration;
    if (videoPlayer.currentTime < startTime || videoPlayer.currentTime >= markerEnd * videoDuration) {
      videoPlayer.currentTime = startTime;
    }
    videoPlayer.play();
    updatePlayBtn(true);
    animatePlayhead();
  }

  function stopPlayback() {
    videoPlayer.pause();
    if (videoFile) videoPlayer.currentTime = markerStart * videoDuration;
    updatePlayBtn(false);
    cancelAnim();
    if (videoFile) updatePlayheadAt(markerStart * videoDuration);
  }

  function onTimeUpdate() {
    if (!videoFile) return;
    if (videoPlayer.currentTime >= markerEnd * videoDuration) {
      videoPlayer.pause();
      updatePlayBtn(false);
      cancelAnim();
    }
  }

  function updatePlayBtn(playing) {
    const btn = document.getElementById('videoPlayBtn');
    btn.querySelector('span').className = playing ? 'icon-pause' : 'icon-play';
  }

  function animatePlayhead() {
    if (videoPlayer.paused) return;
    updatePlayheadAt(videoPlayer.currentTime);
    animFrameId = requestAnimationFrame(animatePlayhead);
  }

  function updatePlayheadAt(t) {
    if (!videoFile) return;
    const ratio = t / videoDuration;
    const container = timelineCanvas.parentElement;
    playheadEl.style.display = 'block';
    playheadEl.style.left = (ratio * container.clientWidth) + 'px';
  }

  function cancelAnim() {
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
  }

  /* --- FFmpeg --- */
  async function loadFFmpeg() {
    if (ffmpegLoaded) return true;
    if (ffmpegLoading) return false;
    ffmpegLoading = true;
    setStatus('FFmpeg読み込み中...');

    try {
      const { FFmpeg } = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js');
      const { toBlobURL } = await import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js');

      ffmpeg = new FFmpeg();
      ffmpeg.on('log', ({ message }) => setStatus(message));
      ffmpeg.on('progress', ({ progress }) => setStatus(`処理中: ${Math.round(progress * 100)}%`));

      const coreURL = await toBlobURL('https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js', 'text/javascript');
      const wasmURL = await toBlobURL('https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm', 'application/wasm');

      await ffmpeg.load({ coreURL, wasmURL });
      ffmpegLoaded = true;
      ffmpegLoading = false;
      setStatus('FFmpeg準備完了');
      return true;
    } catch (e) {
      ffmpegLoading = false;
      setStatus('FFmpeg読み込み失敗: ' + e.message);
      return false;
    }
  }

  async function exportVideo() {
    if (!videoFile) return;
    const loaded = await loadFFmpeg();
    if (!loaded) { setStatus('書き出し不可: FFmpegが利用できません'); return; }

    const startSec = markerStart * videoDuration;
    const durationSec = (markerEnd - markerStart) * videoDuration;
    setStatus('ファイル読み込み中...');

    try {
      const fileData = await videoFile.arrayBuffer();
      const ext = videoFile.name.split('.').pop() || 'mp4';
      const inputName = `input.${ext}`;
      const outputName = `output.${ext}`;

      await ffmpeg.writeFile(inputName, new Uint8Array(fileData));
      setStatus('トリミング中...');

      await ffmpeg.exec([
        '-ss', String(startSec), '-i', inputName,
        '-t', String(durationSec), '-c', 'copy',
        '-avoid_negative_ts', 'make_zero', outputName
      ]);

      const data = await ffmpeg.readFile(outputName);
      App.downloadBlob(new Blob([data.buffer], { type: videoFile.type || 'video/mp4' }), `trimmed.${ext}`);

      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
      setStatus('書き出し完了');
    } catch (e) {
      setStatus('書き出し失敗: ' + e.message);
    }
  }

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

  function reset() {
    stopPlayback();
    videoFile = null;
    videoDuration = 0;
    markerStart = 0;
    markerEnd = 1;
    videoPlayer.src = '';
    dropZone.hidden = false;
    workspace.hidden = true;
    playheadEl.style.display = 'none';
    setStatus('');
  }

  return { init, destroy, onThemeChange, onSpace, onSeek, onMarkIn, onMarkOut };
})();
