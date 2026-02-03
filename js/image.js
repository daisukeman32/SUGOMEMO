/* ========================================
   SUGOMEMO - Image Module
   自由配置キャンバスエディタ
   画像・テキストをドラッグ、回転、拡縮、削除
   ======================================== */

window.ImageModule = (() => {
  let initialized = false;
  let eventsbound = false;
  let objects = []; // { type:'image'|'text', el, x, y, w, h, rotation, scale, img?, text? }
  let selectedId = -1;
  let canvasW = 1920;
  let canvasH = 1080;
  let canvasBgColor = '#ffffff';
  let zoom = 1;

  // Drag state
  let dragState = null; // { id, mode:'move'|'resize', startX, startY, origX, origY, origW, origH }

  // DOM refs
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

  function destroy() { initialized = false; }
  function onThemeChange() { updateCanvas(); }

  function onDelete() {
    if (selectedId >= 0) deleteObject(selectedId);
  }

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

    // ワークスペースへのD&D
    const canvasArea = document.getElementById('imageCanvasArea');
    canvasArea.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) e.preventDefault();
    });
    canvasArea.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length) {
        e.preventDefault();
        loadFiles(e.dataTransfer.files);
      }
    });

    // ツールバー
    document.getElementById('imageAddBtn').addEventListener('click', () => {
      const fi = document.getElementById('imageFileInput');
      fi.value = '';
      fi.click();
    });
    document.getElementById('imageAddTextBtn').addEventListener('click', addText);
    document.getElementById('canvasSizePreset').addEventListener('change', applyPreset);
    document.getElementById('canvasOrientation').addEventListener('change', applyOrientation);
    document.getElementById('canvasSizeApply').addEventListener('click', applyCanvasSize);
    document.getElementById('canvasBgColor').addEventListener('input', (e) => {
      canvasBgColor = e.target.value;
      updateCanvas();
    });
    document.querySelectorAll('.canvas-bg-preset').forEach(btn => {
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

    // プロパティ入力
    [propX, propY, propRotation, propScale].forEach(input => {
      input.addEventListener('change', applyProps);
    });

    // キャンバス上のクリック(選択解除)
    canvasArea.addEventListener('mousedown', (e) => {
      if (e.target === canvasArea || e.target === canvas || e.target === objectsLayer ||
          e.target.id === 'imageCanvasWrapper') {
        selectObject(-1);
      }
    });

    // ドラッグ
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
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
    'a4': [2480, 3508],   // 210x297mm @300dpi
    'a3': [3508, 4961],   // 297x420mm @300dpi
    'b5': [2150, 3035],   // 182x257mm @300dpi
    'b4': [3035, 4299],   // 257x364mm @300dpi
    '1920x1080': [1920, 1080],
    '3840x2160': [3840, 2160],
    '1080x1080': [1080, 1080],
    '1080x1350': [1080, 1350],
  };

  function applyPreset() {
    const preset = document.getElementById('canvasSizePreset').value;
    const orientation = document.getElementById('canvasOrientation').value;
    if (preset === 'custom') return;

    const sizes = PRESETS[preset];
    if (!sizes) return;

    let [w, h] = sizes;
    if (orientation === 'landscape' && w < h) { [w, h] = [h, w]; }
    if (orientation === 'portrait' && w > h) { [w, h] = [h, w]; }

    document.getElementById('canvasWidthInput').value = w;
    document.getElementById('canvasHeightInput').value = h;
    applyCanvasSize();
  }

  function applyOrientation() {
    const preset = document.getElementById('canvasSizePreset').value;
    if (preset !== 'custom') {
      // プリセット選択中 → プリセット値で再計算
      applyPreset();
    } else {
      // カスタム → 現在のW/Hを入れ替え
      const wInput = document.getElementById('canvasWidthInput');
      const hInput = document.getElementById('canvasHeightInput');
      const w = parseInt(wInput.value) || 1920;
      const h = parseInt(hInput.value) || 1080;
      const orientation = document.getElementById('canvasOrientation').value;
      if (orientation === 'portrait' && w > h) {
        wInput.value = h; hInput.value = w;
        applyCanvasSize();
      } else if (orientation === 'landscape' && h > w) {
        wInput.value = h; hInput.value = w;
        applyCanvasSize();
      }
    }
  }

  function applyCanvasSize() {
    const w = parseInt(document.getElementById('canvasWidthInput').value) || 1920;
    const h = parseInt(document.getElementById('canvasHeightInput').value) || 1080;
    canvasW = Math.max(100, Math.min(8000, w));
    canvasH = Math.max(100, Math.min(8000, h));
    updateCanvas();
    renderObjects();
  }

  function updateCanvas() {
    // 表示用のズーム計算
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

    // 背景
    canvasCtx.fillStyle = canvasBgColor;
    canvasCtx.fillRect(0, 0, displayW, displayH);
  }

  /* --- Objects --- */
  function addImageObject(data) {
    // 初期サイズ: キャンバスに収まるように
    let scale = Math.min(canvasW * 0.5 / data.w, canvasH * 0.5 / data.h, 1);
    const w = Math.round(data.w * scale);
    const h = Math.round(data.h * scale);
    const x = Math.round((canvasW - w) / 2);
    const y = Math.round((canvasH - h) / 2);

    objects.push({
      type: 'image', img: data.img, url: data.url,
      x, y, w, h, rotation: 0, scale: 100
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
    const obj = objects[id];
    if (obj.url) URL.revokeObjectURL(obj.url);
    objects.splice(id, 1);
    selectedId = -1;
    propsBar.hidden = true;
    renderObjects();
    if (objects.length === 0) reset();
  }

  function selectObject(id) {
    selectedId = id;

    // UI更新
    objectsLayer.querySelectorAll('.canvas-object').forEach((el, i) => {
      el.classList.toggle('selected', i === id);
    });

    if (id >= 0 && objects[id]) {
      const obj = objects[id];
      propsBar.hidden = false;
      propX.value = obj.x;
      propY.value = obj.y;
      propRotation.value = obj.rotation;
      propScale.value = obj.scale;
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
    const newScale = parseInt(propScale.value) || 100;
    // スケール変更時にサイズも更新
    if (newScale !== obj.scale) {
      const ratio = newScale / obj.scale;
      obj.w = Math.round(obj.w * ratio);
      obj.h = Math.round(obj.h * ratio);
      obj.scale = newScale;
    }
    renderObjects();
  }

  function renderObjects() {
    objectsLayer.innerHTML = '';

    objects.forEach((obj, i) => {
      const el = document.createElement('div');
      el.className = 'canvas-object' + (i === selectedId ? ' selected' : '');
      el.style.left = (obj.x * zoom) + 'px';
      el.style.top = (obj.y * zoom) + 'px';
      el.style.width = (obj.w * zoom) + 'px';
      el.style.height = (obj.h * zoom) + 'px';
      el.style.transform = `rotate(${obj.rotation}deg)`;

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

        // ダブルクリックで編集
        el.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          textEl.contentEditable = 'true';
          textEl.focus();
          const handleBlur = () => {
            textEl.contentEditable = 'false';
            obj.text = textEl.textContent;
            textEl.removeEventListener('blur', handleBlur);
          };
          textEl.addEventListener('blur', handleBlur);
        });
      }

      // リサイズハンドル (4角)
      ['br', 'bl', 'tr', 'tl'].forEach(corner => {
        const handle = document.createElement('div');
        handle.className = 'resize-handle resize-handle-' + corner;
        handle.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          selectObject(i);
          dragState = {
            id: i, mode: 'resize', corner,
            startX: e.clientX, startY: e.clientY,
            origX: obj.x, origY: obj.y,
            origW: obj.w, origH: obj.h,
            aspect: obj.w / obj.h
          };
        });
        el.appendChild(handle);
      });

      // ドラッグ移動
      el.addEventListener('mousedown', (e) => {
        if (e.target.closest('.resize-handle')) return;
        if (e.target.contentEditable === 'true') return;
        e.preventDefault();
        selectObject(i);
        dragState = {
          id: i, mode: 'move',
          startX: e.clientX, startY: e.clientY,
          origX: obj.x, origY: obj.y
        };
      });

      objectsLayer.appendChild(el);
    });
  }

  /* --- Mouse Drag --- */
  function onMouseMove(e) {
    if (!dragState) return;
    const obj = objects[dragState.id];
    if (!obj) return;

    const dx = (e.clientX - dragState.startX) / zoom;
    const dy = (e.clientY - dragState.startY) / zoom;

    if (dragState.mode === 'move') {
      obj.x = Math.round(dragState.origX + dx);
      obj.y = Math.round(dragState.origY + dy);
    } else if (dragState.mode === 'resize') {
      const aspect = dragState.aspect || 1;
      const corner = dragState.corner || 'br';
      let delta;
      if (corner === 'br') delta = (dx + dy) / 2;
      else if (corner === 'bl') delta = (-dx + dy) / 2;
      else if (corner === 'tr') delta = (dx - dy) / 2;
      else delta = (-dx - dy) / 2; // tl

      const newW = Math.max(20, Math.round(dragState.origW + delta));
      const newH = Math.max(20, Math.round(newW / aspect));
      const dw = newW - dragState.origW;
      const dh = newH - dragState.origH;

      obj.w = newW;
      obj.h = newH;
      // Anchor the opposite corner
      if (corner === 'bl' || corner === 'tl') obj.x = Math.round(dragState.origX - dw);
      else obj.x = dragState.origX;
      if (corner === 'tl' || corner === 'tr') obj.y = Math.round(dragState.origY - dh);
      else obj.y = dragState.origY;
    }

    renderObjects();
    selectObject(dragState.id);
  }

  function onMouseUp() {
    dragState = null;
  }

  /* --- Export --- */
  function exportImage() {
    if (objects.length === 0) return;

    // フル解像度でレンダリング
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvasW;
    exportCanvas.height = canvasH;
    const ectx = exportCanvas.getContext('2d');

    ectx.fillStyle = canvasBgColor;
    ectx.fillRect(0, 0, canvasW, canvasH);

    objects.forEach(obj => {
      ectx.save();
      // 回転の中心をオブジェクトの中心に
      const cx = obj.x + obj.w / 2;
      const cy = obj.y + obj.h / 2;
      ectx.translate(cx, cy);
      ectx.rotate((obj.rotation * Math.PI) / 180);

      if (obj.type === 'image') {
        ectx.drawImage(obj.img, -obj.w / 2, -obj.h / 2, obj.w, obj.h);
      } else if (obj.type === 'text') {
        ectx.fillStyle = getTextColor();
        ectx.font = '16px ' + getComputedStyle(document.body).fontFamily;
        ectx.textBaseline = 'top';
        ectx.fillText(obj.text, -obj.w / 2, -obj.h / 2);
      }
      ectx.restore();
    });

    const format = document.getElementById('imageFormat').value;
    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const ext = format === 'jpeg' ? 'jpg' : 'png';

    exportCanvas.toBlob((blob) => {
      App.downloadBlob(blob, `canvas.${ext}`);
    }, mimeType, 0.92);
  }

  function getTextColor() {
    // 背景色の明るさで白か黒か判定
    const hex = canvasBgColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const lum = (r * 299 + g * 587 + b * 114) / 1000;
    return lum > 128 ? '#000000' : '#ffffff';
  }

  /* --- Reset --- */
  function reset() {
    objects.forEach(obj => { if (obj.url) URL.revokeObjectURL(obj.url); });
    objects = [];
    selectedId = -1;
    canvasW = 1920;
    canvasH = 1080;
    canvasBgColor = '#ffffff';
    dropZone.hidden = false;
    workspace.hidden = true;
    propsBar.hidden = true;
  }

  return { init, destroy, onThemeChange, onDelete };
})();
