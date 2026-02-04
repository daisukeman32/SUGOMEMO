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
    { label: 'S', px: 13 },
    { label: 'M', px: 15 },
    { label: 'L', px: 17 }
  ];
  let fontSizeIndex = 1; // default M

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
    if (modules[currentTab] && modules[currentTab].init) modules[currentTab].init();
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

  document.addEventListener('DOMContentLoaded', init);

  return { getTheme, getFg, getBg, getMg, getTrackBg, formatTime, downloadBlob, getCurrentTab };
})();
