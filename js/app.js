/* ========================================
   SUGOMEMO - App Core v3
   3 tabs: EDIT / IMAGE / MEMO
   ======================================== */

const App = (() => {
  let currentTab = 'memo';
  const modules = {};

  function init() {
    initTheme();
    initFontSize();
    initTabs();
    initKeyboard();
    initBackup();
    updateFontSizeVisibility();
    requestAnimationFrame(() => {
      if (window.MemoModule) modules.memo = window.MemoModule;
      if (window.EditModule) modules.edit = window.EditModule;
      if (window.ImageModule) modules.image = window.ImageModule;
      if (modules[currentTab]) modules[currentTab].init();
    });
  }

  function initTheme() {
    const saved = localStorage.getItem('sugomemo-theme') || 'day';
    document.documentElement.setAttribute('data-theme', saved);
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  }

  function toggleTheme() {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'day' ? 'night' : 'day';
    html.setAttribute('data-theme', next);
    localStorage.setItem('sugomemo-theme', next);
    if (modules[currentTab] && modules[currentTab].onThemeChange) {
      modules[currentTab].onThemeChange();
    }
  }

  /* --- Font Size --- */
  const FONT_SIZES = [
    { label: '1', px: 11 },
    { label: '2', px: 12.5 },
    { label: '3', px: 14 },
    { label: '4', px: 16 },
    { label: '5', px: 18 }
  ];
  let fontSizeIndex = 2; // default 3

  function initFontSize() {
    const saved = localStorage.getItem('sugomemo-fontsize');
    if (saved !== null) {
      const idx = FONT_SIZES.findIndex(f => f.label === saved);
      if (idx !== -1) fontSizeIndex = idx;
    }
    applyFontSize();

    // S / M / L direct buttons
    document.querySelectorAll('.font-size-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.size);
        if (idx >= 0 && idx < FONT_SIZES.length) {
          fontSizeIndex = idx;
          applyFontSize();
          saveFontSize();
        }
      });
    });
  }

  function applyFontSize() {
    const size = FONT_SIZES[fontSizeIndex];
    document.documentElement.style.setProperty('--base-font', size.px + 'px');
    // Update active state on buttons
    document.querySelectorAll('.font-size-opt').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.size) === fontSizeIndex);
    });
  }

  function saveFontSize() {
    localStorage.setItem('sugomemo-fontsize', FONT_SIZES[fontSizeIndex].label);
  }

  function getTheme() { return document.documentElement.getAttribute('data-theme') || 'day'; }
  function getFg() { return getTheme() === 'night' ? '#e0ddd8' : '#1a1a1a'; }
  function getBg() { return getTheme() === 'night' ? '#121212' : '#f2f0ed'; }
  function getMg() { return getTheme() === 'night' ? '#666' : '#8a8a8a'; }
  function getTrackBg() { return getTheme() === 'night' ? '#1a1a1a' : '#dddbd8'; }

  function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
  }

  function switchTab(name) {
    if (name === currentTab) return;
    if (modules[currentTab] && modules[currentTab].destroy) modules[currentTab].destroy();

    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(`section-${name}`).classList.add('active');

    currentTab = name;
    updateFontSizeVisibility();
    if (modules[currentTab] && modules[currentTab].init) modules[currentTab].init();
  }

  function updateFontSizeVisibility() {
    const el = document.querySelector('.font-size-group');
    if (el) el.style.display = currentTab === 'memo' ? '' : 'none';
  }

  function getCurrentTab() { return currentTab; }

  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      const tag = e.target.tagName;
      const editable = e.target.contentEditable === 'true';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (modules[currentTab] && modules[currentTab].onSpace) modules[currentTab].onSpace();
      }
      if (e.code === 'KeyJ' || e.code === 'ArrowLeft') {
        e.preventDefault();
        const delta = e.code === 'ArrowLeft' ? -1/30 : -5; // 1フレーム or 5秒
        if (modules[currentTab] && modules[currentTab].onSeek) modules[currentTab].onSeek(delta);
      }
      if (e.code === 'KeyL' || e.code === 'ArrowRight') {
        e.preventDefault();
        const delta = e.code === 'ArrowRight' ? 1/30 : 5;
        if (modules[currentTab] && modules[currentTab].onSeek) modules[currentTab].onSeek(delta);
      }
      if (e.code === 'KeyI') {
        if (modules[currentTab] && modules[currentTab].onMarkIn) modules[currentTab].onMarkIn();
      }
      if (e.code === 'KeyO') {
        if (modules[currentTab] && modules[currentTab].onMarkOut) modules[currentTab].onMarkOut();
      }
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (modules[currentTab] && modules[currentTab].onDelete) {
          e.preventDefault();
          modules[currentTab].onDelete();
        }
      }
      // Zoom: E/+/= zoom in, Q/-/zoom out, 0 fit
      if (e.code === 'KeyE' || e.code === 'Equal' || e.code === 'NumpadAdd') {
        e.preventDefault();
        if (modules[currentTab] && modules[currentTab].onZoomIn) modules[currentTab].onZoomIn();
      }
      if (e.code === 'KeyQ' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        if (modules[currentTab] && modules[currentTab].onZoomOut) modules[currentTab].onZoomOut();
      }
      if (e.code === 'Digit0' || e.code === 'Numpad0') {
        e.preventDefault();
        if (modules[currentTab] && modules[currentTab].onZoomFit) modules[currentTab].onZoomFit();
      }
    });
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* --- Backup / Restore --- */
  const BACKUP_KEYS = [
    'sugomemo-memo', 'sugomemo-theme', 'sugomemo-fontsize', 'sugomemo-sidebar-width'
  ];
  let backupDirHandle = null;

  function initBackup() {
    const gearBtn = document.getElementById('backupGearBtn');
    const exportBtn = document.getElementById('backupExportBtn');
    const importBtn = document.getElementById('backupImportBtn');
    const fileInput = document.getElementById('backupFileInput');

    if (gearBtn) gearBtn.addEventListener('click', pickBackupFolder);
    if (exportBtn) exportBtn.addEventListener('click', exportBackup);
    if (importBtn) importBtn.addEventListener('click', importBackup);
    if (fileInput) fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) { importBackupFromFile(e.target.files[0]); e.target.value = ''; }
    });
    restoreDirHandle();
  }

  function backupFileName() {
    const d = new Date();
    const dateStr = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const timeStr = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
    return 'sugomemo-backup-' + dateStr + '-' + timeStr + '.json';
  }

  function buildBackupJSON() {
    const backup = { version: '3.0', date: new Date().toISOString(), data: {} };
    BACKUP_KEYS.forEach(key => {
      const val = localStorage.getItem(key);
      if (val !== null) backup.data[key] = val;
    });
    return JSON.stringify(backup, null, 2);
  }

  // IndexedDB: フォルダハンドルの永続化
  function saveDirHandle(handle) {
    const req = indexedDB.open('sugomemo-backup', 1);
    req.onupgradeneeded = (e) => { e.target.result.createObjectStore('handles'); };
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'backupDir');
    };
  }

  function restoreDirHandle() {
    const req = indexedDB.open('sugomemo-backup', 1);
    req.onupgradeneeded = (e) => { e.target.result.createObjectStore('handles'); };
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('handles', 'readonly');
      const getReq = tx.objectStore('handles').get('backupDir');
      getReq.onsuccess = () => {
        if (getReq.result) {
          backupDirHandle = getReq.result;
          updateFolderDisplay();
        }
      };
    };
  }

  function updateFolderDisplay() {
    const pathEl = document.getElementById('backupFolderPath');
    if (!pathEl) return;
    pathEl.textContent = backupDirHandle ? backupDirHandle.name : '未設定';
  }

  // 歯車ボタン: フォルダ選択
  async function pickBackupFolder() {
    if (!('showDirectoryPicker' in window)) {
      alert('このブラウザはフォルダ選択に対応していません。\nChrome または Edge をご利用ください。');
      return;
    }
    try {
      backupDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      saveDirHandle(backupDirHandle);
      updateFolderDisplay();
    } catch (e) {
      if (e.name !== 'AbortError') alert('フォルダの選択に失敗しました。');
    }
  }

  // フォルダ書き込み権限を確保
  async function ensureDirPermission() {
    if (!backupDirHandle) return false;
    try {
      let perm = await backupDirHandle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') return true;
      perm = await backupDirHandle.requestPermission({ mode: 'readwrite' });
      return perm === 'granted';
    } catch (e) { return false; }
  }

  // バックアップ書き出し
  async function exportBackup() {
    // フォルダ設定済み + API対応: フォルダに自動保存
    if (backupDirHandle && 'showDirectoryPicker' in window) {
      try {
        if (!await ensureDirPermission()) {
          alert('フォルダへのアクセス権限がありません。\n歯車ボタンでフォルダを再設定してください。');
          return;
        }
        const fileName = backupFileName();
        const fileHandle = await backupDirHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(buildBackupJSON());
        await writable.close();

        // 完了フィードバック
        const btn = document.getElementById('backupExportBtn');
        if (btn) {
          const orig = btn.textContent;
          btn.textContent = '完了';
          setTimeout(() => { btn.textContent = orig; }, 1500);
        }
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    // フォルダ未設定 or 非対応: 従来のダウンロード
    const blob = new Blob([buildBackupJSON()], { type: 'application/json' });
    downloadBlob(blob, backupFileName());
  }

  // 復元
  async function importBackup() {
    // フォルダ設定済み: リストUIで選択
    if (backupDirHandle && 'showDirectoryPicker' in window) {
      try {
        if (!await ensureDirPermission()) {
          document.getElementById('backupFileInput').click();
          return;
        }
        const files = [];
        for await (const [name, handle] of backupDirHandle.entries()) {
          if (handle.kind === 'file' && name.startsWith('sugomemo-backup-') && name.endsWith('.json')) {
            files.push({ name, handle });
          }
        }
        if (files.length === 0) {
          alert('バックアップファイルが見つかりません。');
          return;
        }
        files.sort((a, b) => b.name.localeCompare(a.name));
        showBackupList(files);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    // フォルダ未設定: 従来のファイル選択
    document.getElementById('backupFileInput').click();
  }

  function showBackupList(files) {
    const overlay = document.getElementById('backupOverlay');
    const list = document.getElementById('backupModalList');
    const closeBtn = document.getElementById('backupModalClose');
    list.innerHTML = '';

    if (files.length === 0) {
      list.innerHTML = '<div class="backup-modal-empty">バックアップが見つかりません</div>';
    } else {
      files.forEach((f, i) => {
        const item = document.createElement('div');
        item.className = 'backup-modal-item';

        const num = document.createElement('span');
        num.className = 'backup-item-num';
        num.textContent = String(i + 1).padStart(2, '0');

        const dateEl = document.createElement('span');
        dateEl.className = 'backup-item-date';

        const timeEl = document.createElement('span');
        timeEl.className = 'backup-item-time';

        const match = f.name.match(/sugomemo-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
        if (match) {
          dateEl.textContent = match[1] + '.' + match[2] + '.' + match[3];
          timeEl.textContent = match[4] + ':' + match[5];
        } else {
          dateEl.textContent = f.name.replace('sugomemo-backup-', '').replace('.json', '');
        }

        item.appendChild(num);
        item.appendChild(dateEl);
        item.appendChild(timeEl);

        item.addEventListener('click', async () => {
          closeBackupList();
          try {
            const file = await f.handle.getFile();
            importBackupFromFile(file);
          } catch (e) {
            alert('ファイルの読み込みに失敗しました。');
          }
        });

        list.appendChild(item);
      });
    }

    overlay.hidden = false;

    function onClose() { closeBackupList(); }
    closeBtn.addEventListener('click', onClose, { once: true });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) onClose();
    }, { once: true });
  }

  function closeBackupList() {
    document.getElementById('backupOverlay').hidden = true;
  }

  function importBackupFromFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const backup = JSON.parse(e.target.result);
        if (!backup.data) throw new Error('Invalid format');
        const dateInfo = backup.date ? ' (' + backup.date.split('T')[0] + ')' : '';
        if (!confirm('バックアップを復元しますか？' + dateInfo + '\n現在のデータは上書きされます。')) return;
        Object.entries(backup.data).forEach(([key, value]) => {
          localStorage.setItem(key, value);
        });
        location.reload();
      } catch (err) {
        alert('バックアップファイルの読み込みに失敗しました。');
      }
    };
    reader.readAsText(file);
  }

  document.addEventListener('DOMContentLoaded', init);

  return { getTheme, getFg, getBg, getMg, getTrackBg, formatTime, downloadBlob, getCurrentTab };
})();
