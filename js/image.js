/* ========================================
   SUGOMEMO - Image Module
   自由配置キャンバスエディタ
   スナップ、ペン(ペン/Gauss/Mosaic)、レイヤー順序
   ======================================== */

window.ImageModule = (() => {
  let initialized = false;
  let eventsbound = false;
  let objects = [];
  let selectedId = -1;
  let canvasW = 1920;
  let canvasH = 1080;
  let canvasBgColor = '#ffffff';
  let canvasBgImage = null;
  let zoom = 1;

  let dragState = null;

  // Pen state
  let penMode = false;
  let penDrawing = false;
  let penHasStrokes = false;
  let penCanvas, penCtx;
  let penCursorEl = null;
  let lastPenX = 0, lastPenY = 0;

  // Effect pen state
  let preEffectCanvas = null;
  let baseDisplayCache = null; // cached base render at display resolution
  let penMaskCanvas = null;
  let penMaskCtx = null;
  let currentPenEffectMode = null;

  // Current tool: null | 'pen' | 'gauss' | 'mosaic'
  let currentTool = null;

  const SNAP_THRESHOLD = 24;
  const SNAP_BREAK_MULT = 3.5;

  let dropZone, workspace, canvas, canvasCtx, objectsLayer;
  let propsBar, propX, propY, propRotation, propScale;

  function init() {
    if (initialized) return;
    initialized = true;

    dropZone = document.getElementById('imageDropZone');
    workspace = document.getElementById('imageWorkspace');
    canvas = document.getElementById('imageCanvas');
    canvasCtx = canvas.getContext('2d');
    objectsLayer = document.getElementById('imageObjectsLayer');
    penCanvas = document.getElementById('imagePenCanvas');
    penCtx = penCanvas.getContext('2d');
    propsBar = document.getElementById('imagePropsBar');
    propX = document.getElementById('propX');
    propY = document.getElementById('propY');
    propRotation = document.getElementById('propRotation');
    propScale = document.getElementById('propScale');

    if (!eventsbound) { bindEvents(); eventsbound = true; }

    if (objects.length > 0) {
      showWorkspace();
      updateCanvas();
    }
  }

  function destroy() {
    if (penMode) finishPen();
    removePenCursor();
    initialized = false;
  }

  function onThemeChange() { updateCanvas(); }
  function onDelete() { if (selectedId >= 0) deleteObject(selectedId); }

  /* --- Events --- */
  function bindEvents() {
    const fileInput = document.getElementById('imageFileInput');

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) { loadFiles(e.target.files); e.target.value = ''; }
    });

    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault(); dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
    });

    const canvasArea = document.getElementById('imageCanvasArea');
    canvasArea.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) e.preventDefault();
    });
    canvasArea.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length) { e.preventDefault(); loadFiles(e.dataTransfer.files); }
    });

    document.getElementById('imageAddBtn').addEventListener('click', () => {
      const fi = document.getElementById('imageFileInput'); fi.value = ''; fi.click();
    });
    document.getElementById('imageAddTextBtn').addEventListener('click', addText);
    document.getElementById('canvasSizePreset').addEventListener('change', applyPreset);
    document.getElementById('canvasOrientation').addEventListener('change', applyOrientation);
    document.getElementById('canvasSizeApply').addEventListener('click', applyCanvasSize);
    document.getElementById('canvasBgColor').addEventListener('input', (e) => {
      canvasBgColor = e.target.value; updateCanvas();
    });
    document.querySelectorAll('.canvas-bg-preset, .canvas-bg-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        canvasBgColor = btn.dataset.color;
        document.getElementById('canvasBgColor').value = canvasBgColor;
        updateCanvas();
      });
    });
    document.getElementById('imageExportBtn').addEventListener('click', exportImage);
    document.getElementById('imageResetBtn').addEventListener('click', reset);
    document.getElementById('propDeleteBtn').addEventListener('click', () => {
      if (selectedId >= 0) deleteObject(selectedId);
    });

    [propX, propY, propRotation, propScale].forEach(input => {
      input.addEventListener('change', applyProps);
    });

    document.getElementById('propBringFront').addEventListener('click', () => bringToFront(selectedId));
    document.getElementById('propSendBack').addEventListener('click', () => sendToBack(selectedId));

    // ツールボタン（ペン・ぼかし・モザイク）
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => activateTool(btn.dataset.tool));
    });

    // 各ツールのスライダー
    const penSizeSlider = document.getElementById('penSize');
    const penSizeValEl = document.getElementById('penSizeVal');
    penSizeSlider.addEventListener('input', () => {
      penSizeValEl.textContent = penSizeSlider.value;
      updatePenCursorSize();
    });

    const gaussBrushSlider = document.getElementById('gaussBrushSize');
    const gaussBrushValEl = document.getElementById('gaussBrushSizeVal');
    gaussBrushSlider.addEventListener('input', () => {
      gaussBrushValEl.textContent = gaussBrushSlider.value;
      updatePenCursorSize();
    });
    const gaussEffectSlider = document.getElementById('gaussEffectSize');
    const gaussEffectValEl = document.getElementById('gaussEffectSizeVal');
    gaussEffectSlider.addEventListener('input', () => { gaussEffectValEl.textContent = gaussEffectSlider.value; rebuildEffectLive(); });

    const mosaicBrushSlider = document.getElementById('mosaicBrushSize');
    const mosaicBrushValEl = document.getElementById('mosaicBrushSizeVal');
    mosaicBrushSlider.addEventListener('input', () => {
      mosaicBrushValEl.textContent = mosaicBrushSlider.value;
      updatePenCursorSize();
    });
    const mosaicEffectSlider = document.getElementById('mosaicEffectSize');
    const mosaicEffectValEl = document.getElementById('mosaicEffectSizeVal');
    mosaicEffectSlider.addEventListener('input', () => { mosaicEffectValEl.textContent = mosaicEffectSlider.value; rebuildEffectLive(); });

    penCanvas.addEventListener('mousedown', penStart);
    penCanvas.addEventListener('mousemove', penMove);
    penCanvas.addEventListener('mouseup', penEnd);
    penCanvas.addEventListener('mouseleave', () => { penEnd(); hidePenCursor(); });
    penCanvas.addEventListener('mouseenter', () => { if (penMode) showPenCursor(); });

    canvasArea.addEventListener('mousedown', (e) => {
      if (penMode) return;
      if (e.target === canvasArea || e.target === canvas || e.target === objectsLayer ||
          e.target.id === 'imageCanvasWrapper') {
        selectObject(-1);
      }
    });

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  /* --- Pen Cursor --- */
  function createPenCursor() {
    if (penCursorEl) return;
    penCursorEl = document.createElement('div');
    penCursorEl.className = 'pen-cursor';
    document.body.appendChild(penCursorEl);
    updatePenCursorSize();
  }

  function removePenCursor() {
    if (penCursorEl) { penCursorEl.remove(); penCursorEl = null; }
  }

  function showPenCursor() { if (penCursorEl) penCursorEl.style.display = 'block'; }
  function hidePenCursor() { if (penCursorEl) penCursorEl.style.display = 'none'; }

  function updatePenCursorSize() {
    if (!penCursorEl) return;
    const sz = Math.max(4, getBrushSize() * zoom);
    penCursorEl.style.width = sz + 'px';
    penCursorEl.style.height = sz + 'px';
  }

  function movePenCursor(e) {
    if (!penCursorEl) return;
    penCursorEl.style.left = e.clientX + 'px';
    penCursorEl.style.top = e.clientY + 'px';
  }

  /* --- File Loading --- */
  function loadFiles(files) {
    const promises = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      promises.push(loadImage(file));
    }
    Promise.all(promises).then((results) => {
      results.forEach(r => { if (r) addImageObject(r); });
      showWorkspace();
    });
  }

  function loadImage(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => resolve({ img, url, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function showWorkspace() {
    dropZone.hidden = true;
    workspace.hidden = false;
    document.getElementById('canvasWidthInput').value = canvasW;
    document.getElementById('canvasHeightInput').value = canvasH;
    document.getElementById('canvasBgColor').value = canvasBgColor;
    updateCanvas();
    renderObjects();
  }

  /* --- Canvas --- */
  const PRESETS = {
    'a4': [2480, 3508], 'a3': [3508, 4961], 'b5': [2150, 3035], 'b4': [3035, 4299],
    '1920x1080': [1920, 1080], '3840x2160': [3840, 2160],
    '1080x1080': [1080, 1080], '1080x1350': [1080, 1350],
    '1920x200': [1920, 200], '200x1080': [200, 1080],
  };

  function applyPreset() {
    const preset = document.getElementById('canvasSizePreset').value;
    const orientation = document.getElementById('canvasOrientation').value;
    if (preset === 'custom') return;
    const sizes = PRESETS[preset];
    if (!sizes) return;
    let [w, h] = sizes;
    if (orientation === 'landscape' && w < h) [w, h] = [h, w];
    if (orientation === 'portrait' && w > h) [w, h] = [h, w];
    document.getElementById('canvasWidthInput').value = w;
    document.getElementById('canvasHeightInput').value = h;
    applyCanvasSize();
  }

  function applyOrientation() {
    const preset = document.getElementById('canvasSizePreset').value;
    if (preset !== 'custom') { applyPreset(); return; }
    const wInput = document.getElementById('canvasWidthInput');
    const hInput = document.getElementById('canvasHeightInput');
    const w = parseInt(wInput.value) || 1920;
    const h = parseInt(hInput.value) || 1080;
    const orientation = document.getElementById('canvasOrientation').value;
    if ((orientation === 'portrait' && w > h) || (orientation === 'landscape' && h > w)) {
      wInput.value = h; hInput.value = w; applyCanvasSize();
    }
  }

  function applyCanvasSize() {
    canvasW = Math.max(100, Math.min(8000, parseInt(document.getElementById('canvasWidthInput').value) || 1920));
    canvasH = Math.max(100, Math.min(8000, parseInt(document.getElementById('canvasHeightInput').value) || 1080));
    updateCanvas();
    renderObjects();
  }

  function updateCanvas() {
    const area = document.getElementById('imageCanvasArea');
    const areaW = area.clientWidth - 40;
    const areaH = area.clientHeight - 40;
    zoom = Math.min(areaW / canvasW, areaH / canvasH, 1);

    const displayW = Math.round(canvasW * zoom);
    const displayH = Math.round(canvasH * zoom);

    canvas.width = displayW;
    canvas.height = displayH;
    canvas.style.width = displayW + 'px';
    canvas.style.height = displayH + 'px';

    const wrapper = document.getElementById('imageCanvasWrapper');
    wrapper.style.width = displayW + 'px';
    wrapper.style.height = displayH + 'px';

    canvasCtx.fillStyle = canvasBgColor;
    canvasCtx.fillRect(0, 0, displayW, displayH);
    if (canvasBgImage) {
      canvasCtx.drawImage(canvasBgImage, 0, 0, displayW, displayH);
    }
  }

  /* --- Objects --- */
  function addImageObject(data) {
    let sc = Math.min(canvasW * 0.5 / data.w, canvasH * 0.5 / data.h, 1);
    const w = Math.round(data.w * sc);
    const h = Math.round(data.h * sc);
    objects.push({
      type: 'image', img: data.img, url: data.url,
      x: Math.round((canvasW - w) / 2), y: Math.round((canvasH - h) / 2),
      w, h, rotation: 0, scale: 100
    });
    renderObjects();
    selectObject(objects.length - 1);
  }

  function addText() {
    showWorkspace();
    objects.push({
      type: 'text', text: 'テキスト',
      x: Math.round(canvasW / 2 - 50), y: Math.round(canvasH / 2 - 15),
      w: 100, h: 30, rotation: 0, scale: 100
    });
    renderObjects();
    selectObject(objects.length - 1);
  }

  function deleteObject(id) {
    if (id < 0 || id >= objects.length) return;
    if (objects[id].url) URL.revokeObjectURL(objects[id].url);
    objects.splice(id, 1);
    selectedId = -1;
    propsBar.hidden = true;
    renderObjects();
    if (objects.length === 0) reset();
  }

  function selectObject(id) {
    selectedId = id;
    objectsLayer.querySelectorAll('.canvas-object').forEach((el, i) => {
      el.classList.toggle('selected', i === id);
    });
    if (id >= 0 && objects[id]) {
      const obj = objects[id];
      propsBar.hidden = false;
      propX.value = obj.x; propY.value = obj.y;
      propRotation.value = obj.rotation; propScale.value = obj.scale;
    } else {
      propsBar.hidden = true;
    }
  }

  function applyProps() {
    if (selectedId < 0 || !objects[selectedId]) return;
    const obj = objects[selectedId];
    obj.x = parseInt(propX.value) || 0;
    obj.y = parseInt(propY.value) || 0;
    obj.rotation = parseInt(propRotation.value) || 0;
    const ns = parseInt(propScale.value) || 100;
    if (ns !== obj.scale) {
      const r = ns / obj.scale;
      obj.w = Math.round(obj.w * r); obj.h = Math.round(obj.h * r); obj.scale = ns;
    }
    renderObjects();
  }

  /* --- Layer --- */
  function bringToFront(id) {
    if (id < 0 || id >= objects.length) return;
    objects.push(objects.splice(id, 1)[0]);
    selectedId = objects.length - 1;
    renderObjects(); selectObject(selectedId);
  }

  function sendToBack(id) {
    if (id < 0 || id >= objects.length) return;
    objects.unshift(objects.splice(id, 1)[0]);
    selectedId = 0;
    renderObjects(); selectObject(selectedId);
  }

  /* --- Snap (sticky lock) --- */
  let snapLockX = null; // { target: snappedX, raw: originalRawX }
  let snapLockY = null;

  function snapPosition(obj, rawX, rawY) {
    let x = obj.x, y = obj.y;
    const guides = [];
    const dragId = dragState ? dragState.id : -1;

    // Canvas edge + center targets: [snapValue, guideType, guidePos, 'edge'|'center']
    const xTargets = [
      [0, 'v', 0, 'edge'],
      [canvasW - obj.w, 'v', canvasW, 'edge'],
      [Math.round(canvasW / 2 - obj.w / 2), 'v', canvasW / 2, 'center']
    ];
    const yTargets = [
      [0, 'h', 0, 'edge'],
      [canvasH - obj.h, 'h', canvasH, 'edge'],
      [Math.round(canvasH / 2 - obj.h / 2), 'h', canvasH / 2, 'center']
    ];

    // Object-to-object snap targets
    objects.forEach((other, i) => {
      if (i === dragId) return;
      xTargets.push([other.x, 'v', other.x, 'edge']);
      xTargets.push([other.x + other.w, 'v', other.x + other.w, 'edge']);
      xTargets.push([Math.round(other.x + other.w / 2 - obj.w / 2), 'v', Math.round(other.x + other.w / 2), 'center']);
      xTargets.push([other.x - obj.w, 'v', other.x, 'edge']);
      xTargets.push([other.x + other.w - obj.w, 'v', other.x + other.w, 'edge']);

      yTargets.push([other.y, 'h', other.y, 'edge']);
      yTargets.push([other.y + other.h, 'h', other.y + other.h, 'edge']);
      yTargets.push([Math.round(other.y + other.h / 2 - obj.h / 2), 'h', Math.round(other.y + other.h / 2), 'center']);
      yTargets.push([other.y - obj.h, 'h', other.y, 'edge']);
      yTargets.push([other.y + other.h - obj.h, 'h', other.y + other.h, 'edge']);
    });

    // X axis snap
    if (snapLockX !== null) {
      const breakDist = Math.abs(rawX - snapLockX.target);
      if (breakDist > SNAP_THRESHOLD * SNAP_BREAK_MULT) {
        snapLockX = null;
      } else {
        x = snapLockX.target;
        guides.push({ t: 'v', p: snapLockX.guide, locked: true, kind: snapLockX.kind });
      }
    }
    if (snapLockX === null) {
      let bestDist = SNAP_THRESHOLD;
      let bestSnap = null;
      for (const [target, gt, gp, kind] of xTargets) {
        const d = Math.abs(x - target);
        if (d < bestDist) {
          bestDist = d;
          bestSnap = { target, gt, gp, kind };
        }
      }
      if (bestSnap) {
        x = bestSnap.target;
        snapLockX = { target: bestSnap.target, guide: bestSnap.gp, kind: bestSnap.kind };
        guides.push({ t: bestSnap.gt, p: bestSnap.gp, locked: true, kind: bestSnap.kind });
      }
    }

    // Y axis snap
    if (snapLockY !== null) {
      const breakDist = Math.abs(rawY - snapLockY.target);
      if (breakDist > SNAP_THRESHOLD * SNAP_BREAK_MULT) {
        snapLockY = null;
      } else {
        y = snapLockY.target;
        guides.push({ t: 'h', p: snapLockY.guide, locked: true, kind: snapLockY.kind });
      }
    }
    if (snapLockY === null) {
      let bestDist = SNAP_THRESHOLD;
      let bestSnap = null;
      for (const [target, gt, gp, kind] of yTargets) {
        const d = Math.abs(y - target);
        if (d < bestDist) {
          bestDist = d;
          bestSnap = { target, gt, gp, kind };
        }
      }
      if (bestSnap) {
        y = bestSnap.target;
        snapLockY = { target: bestSnap.target, guide: bestSnap.gp, kind: bestSnap.kind };
        guides.push({ t: bestSnap.gt, p: bestSnap.gp, locked: true, kind: bestSnap.kind });
      }
    }

    obj.x = x; obj.y = y;
    return guides;
  }

  function showSnapGuides(guides) {
    clearSnapGuides();
    const wrapper = document.getElementById('imageCanvasWrapper');
    guides.forEach(g => {
      const el = document.createElement('div');
      el.className = 'snap-guide';
      if (g.locked) el.classList.add('snap-guide-locked');
      if (g.kind === 'center') el.classList.add('snap-guide-center');
      if (g.t === 'h') { el.classList.add('snap-guide-h'); el.style.top = (g.p * zoom) + 'px'; }
      else { el.classList.add('snap-guide-v'); el.style.left = (g.p * zoom) + 'px'; }
      wrapper.appendChild(el);
    });
  }

  function clearSnapGuides() {
    document.getElementById('imageCanvasWrapper').querySelectorAll('.snap-guide').forEach(el => el.remove());
  }

  /* --- Tool Activation --- */
  function activateTool(tool) {
    // If same tool clicked again → finish/deactivate
    if (penMode && currentTool === tool) {
      finishPen();
      return;
    }
    // If different tool while in pen mode → finish current, start new
    if (penMode) finishPen();

    currentTool = tool;
    startPenMode(tool);
  }

  function updateToolUI() {
    // Update button active states
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', penMode && btn.dataset.tool === currentTool);
      if (penMode && btn.dataset.tool === currentTool) {
        btn.textContent = '完了';
      } else {
        const labels = { pen: 'ペン', gauss: 'ぼかし', mosaic: 'モザイク' };
        btn.textContent = labels[btn.dataset.tool] || btn.dataset.tool;
      }
    });

    // Show/hide tool-specific options
    document.getElementById('penOptions').hidden = !(penMode && currentTool === 'pen');
    document.getElementById('gaussOptions').hidden = !(penMode && currentTool === 'gauss');
    document.getElementById('mosaicOptions').hidden = !(penMode && currentTool === 'mosaic');
  }

  /* --- Pen Tool --- */
  function startPenMode(tool) {
    penMode = true;
    penHasStrokes = false;
    selectObject(-1);

    const dw = Math.round(canvasW * zoom);
    const dh = Math.round(canvasH * zoom);
    penCanvas.width = dw;
    penCanvas.height = dh;
    penCanvas.style.width = dw + 'px';
    penCanvas.style.height = dh + 'px';
    penCanvas.classList.add('active');

    preEffectCanvas = null;
    baseDisplayCache = null;
    penMaskCanvas = null;
    penMaskCtx = null;
    currentPenEffectMode = null;

    createPenCursor();
    updatePenCursorSize();
    updateToolUI();
  }

  function getEffectSize() {
    if (currentTool === 'gauss') return parseInt(document.getElementById('gaussEffectSize').value) || 7;
    if (currentTool === 'mosaic') return parseInt(document.getElementById('mosaicEffectSize').value) || 7;
    return 10;
  }

  function getBrushSize() {
    if (currentTool === 'pen') return parseInt(document.getElementById('penSize').value) || 4;
    if (currentTool === 'gauss') return parseInt(document.getElementById('gaussBrushSize').value) || 30;
    if (currentTool === 'mosaic') return parseInt(document.getElementById('mosaicBrushSize').value) || 30;
    return 10;
  }

  function ensureBaseDisplayCache() {
    if (baseDisplayCache) return baseDisplayCache;
    const dw = penCanvas.width;
    const dh = penCanvas.height;
    const base = document.createElement('canvas');
    base.width = dw; base.height = dh;
    const bctx = base.getContext('2d');
    bctx.save();
    bctx.scale(zoom, zoom);
    bctx.fillStyle = canvasBgColor;
    bctx.fillRect(0, 0, canvasW, canvasH);
    if (canvasBgImage) {
      bctx.drawImage(canvasBgImage, 0, 0, canvasW, canvasH);
    }
    objects.forEach(obj => {
      bctx.save();
      bctx.translate(obj.x + obj.w / 2, obj.y + obj.h / 2);
      bctx.rotate(obj.rotation * Math.PI / 180);
      if (obj.type === 'image') bctx.drawImage(obj.img, -obj.w / 2, -obj.h / 2, obj.w, obj.h);
      else if (obj.type === 'text') {
        bctx.fillStyle = getTextColor();
        bctx.font = '16px ' + getComputedStyle(document.body).fontFamily;
        bctx.textBaseline = 'top';
        bctx.fillText(obj.text, -obj.w / 2, -obj.h / 2);
      }
      bctx.restore();
    });
    bctx.restore();
    baseDisplayCache = base;
    return base;
  }

  function applyEffectToBase(base, mode, effectSize) {
    const dw = base.width;
    const dh = base.height;
    const fx = document.createElement('canvas');
    fx.width = dw; fx.height = dh;
    const fctx = fx.getContext('2d');
    // effectSize をそのまま使用（表示解像度でのピクセル値）
    if (mode === 'gauss') {
      fctx.filter = 'blur(' + effectSize + 'px)';
      fctx.drawImage(base, 0, 0);
    } else {
      const factor = Math.max(2, effectSize);
      const sw = Math.max(1, Math.round(dw / factor));
      const sh = Math.max(1, Math.round(dh / factor));
      const small = document.createElement('canvas');
      small.width = sw; small.height = sh;
      small.getContext('2d').drawImage(base, 0, 0, sw, sh);
      fctx.imageSmoothingEnabled = false;
      fctx.drawImage(small, 0, 0, dw, dh);
    }
    return fx;
  }

  function buildPreEffect(mode) {
    const base = ensureBaseDisplayCache();
    return applyEffectToBase(base, mode, getEffectSize());
  }

  // Rebuild effect + redraw penCanvas with current mask (real-time slider update)
  let rebuildRAF = null;
  function rebuildEffectLive() {
    if (!penMode || !currentPenEffectMode || !penMaskCanvas) return;
    if (rebuildRAF) cancelAnimationFrame(rebuildRAF);
    rebuildRAF = requestAnimationFrame(() => {
      rebuildRAF = null;
      if (!penMode || !currentPenEffectMode || !penMaskCanvas) return;
      const base = ensureBaseDisplayCache();
      preEffectCanvas = applyEffectToBase(base, currentPenEffectMode, getEffectSize());
      // Redraw penCanvas: effect masked by strokes
      penCtx.save();
      penCtx.clearRect(0, 0, penCanvas.width, penCanvas.height);
      penCtx.drawImage(preEffectCanvas, 0, 0);
      penCtx.globalCompositeOperation = 'destination-in';
      penCtx.drawImage(penMaskCanvas, 0, 0);
      penCtx.restore();
      // Update stroke pattern so ongoing/future strokes use new effect
      const newPattern = penCtx.createPattern(preEffectCanvas, 'no-repeat');
      penCtx.strokeStyle = newPattern;
      penCtx.fillStyle = newPattern;
    });
  }

  function finishPen() {
    penMode = false;
    penCanvas.classList.remove('active');
    removePenCursor();

    // Save effect size before resetting tool
    const savedEffectSize = getEffectSize();

    currentTool = null;
    updateToolUI();

    if (!penHasStrokes) {
      cleanupPen();
      return;
    }

    if (!currentPenEffectMode) {
      // Normal pen → image object
      const full = document.createElement('canvas');
      full.width = canvasW; full.height = canvasH;
      full.getContext('2d').drawImage(penCanvas, 0, 0, canvasW, canvasH);
      flattenToBackground(full);
    } else {
      // Gauss / Mosaic → full-res effect masked by strokes
      // プレビューは表示解像度で effectSize をそのまま使用するため、
      // フル解像度では effectSize / zoom にスケールして見た目を一致させる
      const fullResEffect = savedEffectSize / zoom;
      const base = renderBase();

      const fx = document.createElement('canvas');
      fx.width = canvasW; fx.height = canvasH;
      const fctx = fx.getContext('2d');

      if (currentPenEffectMode === 'gauss') {
        fctx.filter = 'blur(' + fullResEffect + 'px)';
        fctx.drawImage(base, 0, 0);
        fctx.filter = 'none';
      } else {
        const factor = Math.max(2, fullResEffect);
        const sw = Math.max(1, Math.round(canvasW / factor));
        const sh = Math.max(1, Math.round(canvasH / factor));
        const small = document.createElement('canvas');
        small.width = sw; small.height = sh;
        small.getContext('2d').drawImage(base, 0, 0, sw, sh);
        fctx.imageSmoothingEnabled = false;
        fctx.drawImage(small, 0, 0, canvasW, canvasH);
      }

      // Scale up mask to full res
      const mask = document.createElement('canvas');
      mask.width = canvasW; mask.height = canvasH;
      mask.getContext('2d').drawImage(penMaskCanvas, 0, 0, canvasW, canvasH);

      // Composite: effect where strokes exist
      const result = document.createElement('canvas');
      result.width = canvasW; result.height = canvasH;
      const rctx = result.getContext('2d');
      rctx.drawImage(fx, 0, 0);
      rctx.globalCompositeOperation = 'destination-in';
      rctx.drawImage(mask, 0, 0);
      rctx.globalCompositeOperation = 'source-over';

      flattenToBackground(result);
    }

    cleanupPen();
  }

  function cleanupPen() {
    penHasStrokes = false;
    penCtx.clearRect(0, 0, penCanvas.width, penCanvas.height);
    preEffectCanvas = null;
    baseDisplayCache = null;
    penMaskCanvas = null;
    penMaskCtx = null;
    currentPenEffectMode = null;
  }

  function renderBase() {
    const c = document.createElement('canvas');
    c.width = canvasW; c.height = canvasH;
    const ctx = c.getContext('2d');
    ctx.fillStyle = canvasBgColor;
    ctx.fillRect(0, 0, canvasW, canvasH);
    if (canvasBgImage) {
      ctx.drawImage(canvasBgImage, 0, 0, canvasW, canvasH);
    }
    objects.forEach(obj => {
      ctx.save();
      ctx.translate(obj.x + obj.w / 2, obj.y + obj.h / 2);
      ctx.rotate(obj.rotation * Math.PI / 180);
      if (obj.type === 'image') ctx.drawImage(obj.img, -obj.w / 2, -obj.h / 2, obj.w, obj.h);
      else if (obj.type === 'text') {
        ctx.fillStyle = getTextColor();
        ctx.font = '16px ' + getComputedStyle(document.body).fontFamily;
        ctx.textBaseline = 'top';
        ctx.fillText(obj.text, -obj.w / 2, -obj.h / 2);
      }
      ctx.restore();
    });
    return c;
  }

  function createObjectFromCanvas(srcCanvas) {
    const dataUrl = srcCanvas.toDataURL('image/png');
    const img = new Image();
    img.onload = () => {
      objects.push({
        type: 'image', img, url: dataUrl,
        x: 0, y: 0, w: canvasW, h: canvasH, rotation: 0, scale: 100
      });
      renderObjects();
      selectObject(objects.length - 1);
    };
    img.src = dataUrl;
  }

  function flattenToBackground(penResultCanvas) {
    const flat = renderBase();
    const ctx = flat.getContext('2d');
    ctx.drawImage(penResultCanvas, 0, 0);

    const img = new Image();
    img.onload = () => {
      canvasBgImage = img;
      objects.forEach(o => { if (o.url) URL.revokeObjectURL(o.url); });
      objects = [];
      selectedId = -1;
      propsBar.hidden = true;
      updateCanvas();
      renderObjects();
    };
    img.src = flat.toDataURL('image/png');
  }

  function penStart(e) {
    if (!penMode) return;
    penDrawing = true;
    penHasStrokes = true;

    const rect = penCanvas.getBoundingClientRect();
    lastPenX = e.clientX - rect.left;
    lastPenY = e.clientY - rect.top;

    const brushSize = getBrushSize();
    const mode = currentTool;
    const lineW = brushSize * zoom;

    penCtx.lineCap = 'round';
    penCtx.lineJoin = 'round';
    penCtx.lineWidth = lineW;
    penCtx.globalCompositeOperation = 'source-over';

    if (mode === 'pen') {
      const color = document.getElementById('penColor').value;
      penCtx.strokeStyle = color;
      penCtx.fillStyle = color;
    } else {
      // Lazy init pre-effect + mask
      if (!preEffectCanvas) {
        currentPenEffectMode = mode;
        preEffectCanvas = buildPreEffect(mode);
        penMaskCanvas = document.createElement('canvas');
        penMaskCanvas.width = penCanvas.width;
        penMaskCanvas.height = penCanvas.height;
        penMaskCtx = penMaskCanvas.getContext('2d');
      }

      // Pattern from pre-effect → real-time visual
      const pattern = penCtx.createPattern(preEffectCanvas, 'no-repeat');
      penCtx.strokeStyle = pattern;
      penCtx.fillStyle = pattern;

      penMaskCtx.lineCap = 'round';
      penMaskCtx.lineJoin = 'round';
      penMaskCtx.lineWidth = lineW;
      penMaskCtx.strokeStyle = '#ffffff';
      penMaskCtx.fillStyle = '#ffffff';
    }

    // Dot at start
    penCtx.beginPath();
    penCtx.arc(lastPenX, lastPenY, lineW / 2, 0, Math.PI * 2);
    penCtx.fill();

    if (mode !== 'pen' && penMaskCtx) {
      penMaskCtx.beginPath();
      penMaskCtx.arc(lastPenX, lastPenY, lineW / 2, 0, Math.PI * 2);
      penMaskCtx.fill();
    }

    movePenCursor(e);
  }

  function penMove(e) {
    movePenCursor(e);
    if (!penDrawing) return;

    const rect = penCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Draw segment from last to current
    penCtx.beginPath();
    penCtx.moveTo(lastPenX, lastPenY);
    penCtx.lineTo(x, y);
    penCtx.stroke();

    if (currentTool !== 'pen' && penMaskCtx) {
      penMaskCtx.beginPath();
      penMaskCtx.moveTo(lastPenX, lastPenY);
      penMaskCtx.lineTo(x, y);
      penMaskCtx.stroke();
    }

    lastPenX = x;
    lastPenY = y;
  }

  function penEnd() { penDrawing = false; }

  /* --- Render --- */
  function renderObjects() {
    objectsLayer.innerHTML = '';

    objects.forEach((obj, i) => {
      const el = document.createElement('div');
      el.className = 'canvas-object' + (i === selectedId ? ' selected' : '');
      el.style.left = (obj.x * zoom) + 'px';
      el.style.top = (obj.y * zoom) + 'px';
      el.style.width = (obj.w * zoom) + 'px';
      el.style.height = (obj.h * zoom) + 'px';
      el.style.transform = 'rotate(' + obj.rotation + 'deg)';

      if (obj.type === 'image') {
        const img = document.createElement('img');
        img.src = obj.url || obj.img.src;
        el.appendChild(img);
      } else if (obj.type === 'text') {
        const textEl = document.createElement('div');
        textEl.className = 'canvas-object-text';
        textEl.textContent = obj.text;
        textEl.style.fontSize = (16 * zoom) + 'px';
        textEl.style.color = getTextColor();
        el.appendChild(textEl);
        el.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
          textEl.contentEditable = 'true';
          textEl.focus();
          const done = () => { textEl.contentEditable = 'false'; obj.text = textEl.textContent; textEl.removeEventListener('blur', done); };
          textEl.addEventListener('blur', done);
        });
      }

      if (!penMode) {
        ['br', 'bl', 'tr', 'tl'].forEach(corner => {
          const handle = document.createElement('div');
          handle.className = 'resize-handle resize-handle-' + corner;
          handle.addEventListener('mousedown', (ev) => {
            ev.stopPropagation(); ev.preventDefault();
            selectObject(i);
            dragState = {
              id: i, mode: 'resize', corner,
              startX: ev.clientX, startY: ev.clientY,
              origX: obj.x, origY: obj.y,
              origW: obj.w, origH: obj.h,
              aspect: obj.w / obj.h
            };
          });
          el.appendChild(handle);
        });
      }

      el.addEventListener('mousedown', (ev) => {
        if (penMode) return;
        if (ev.target.closest('.resize-handle')) return;
        if (ev.target.contentEditable === 'true') return;
        ev.preventDefault();
        selectObject(i);
        dragState = {
          id: i, mode: 'move',
          startX: ev.clientX, startY: ev.clientY,
          origX: obj.x, origY: obj.y
        };
      });

      objectsLayer.appendChild(el);
    });
  }

  /* --- Drag --- */
  function onMouseMove(e) {
    if (!dragState) return;
    const obj = objects[dragState.id];
    if (!obj) return;

    const dx = (e.clientX - dragState.startX) / zoom;
    const dy = (e.clientY - dragState.startY) / zoom;

    if (dragState.mode === 'move') {
      const rawX = Math.round(dragState.origX + dx);
      const rawY = Math.round(dragState.origY + dy);
      obj.x = rawX;
      obj.y = rawY;
      const guides = snapPosition(obj, rawX, rawY);
      showSnapGuides(guides);
    } else if (dragState.mode === 'resize') {
      const aspect = dragState.aspect || 1;
      const corner = dragState.corner || 'br';
      let delta;
      if (corner === 'br') delta = (dx + dy) / 2;
      else if (corner === 'bl') delta = (-dx + dy) / 2;
      else if (corner === 'tr') delta = (dx - dy) / 2;
      else delta = (-dx - dy) / 2;

      const nw = Math.max(20, Math.round(dragState.origW + delta));
      const nh = Math.max(20, Math.round(nw / aspect));
      const dw = nw - dragState.origW;
      const dh = nh - dragState.origH;
      obj.w = nw; obj.h = nh;
      if (corner === 'bl' || corner === 'tl') obj.x = Math.round(dragState.origX - dw);
      else obj.x = dragState.origX;
      if (corner === 'tl' || corner === 'tr') obj.y = Math.round(dragState.origY - dh);
      else obj.y = dragState.origY;
    }

    renderObjects();
    selectObject(dragState.id);
  }

  function onMouseUp() {
    if (dragState) { clearSnapGuides(); dragState = null; snapLockX = null; snapLockY = null; }
  }

  /* --- Export --- */
  function exportImage() {
    if (objects.length === 0) return;
    const exportCanvas = renderBase();
    const format = document.getElementById('imageFormat').value;
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    exportCanvas.toBlob((blob) => { App.downloadBlob(blob, 'canvas.' + ext); }, mime, 0.92);
  }

  function getTextColor() {
    const hex = canvasBgColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? '#000000' : '#ffffff';
  }

  function reset() {
    if (penMode) finishPen();
    objects.forEach(o => { if (o.url) URL.revokeObjectURL(o.url); });
    objects = [];
    selectedId = -1;
    canvasW = 1920; canvasH = 1080; canvasBgColor = '#ffffff'; canvasBgImage = null;
    dropZone.hidden = false;
    workspace.hidden = true;
    propsBar.hidden = true;
  }

  return { init, destroy, onThemeChange, onDelete };
})();
