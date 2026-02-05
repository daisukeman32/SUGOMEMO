/* ========================================
   SUGOMEMO - Memo Module
   タグ管理 + テンプレートテキスト
   タグでグルーピング、ワンクリックコピー
   サイドバーリサイズ、一括編集モード
   ======================================== */

window.MemoModule = (() => {
  const STORAGE_KEY = 'sugomemo-memo';
  const SIDEBAR_WIDTH_KEY = 'sugomemo-sidebar-width';
  let data = { tags: [], activeTag: null };
  let initialized = false;
  let eventsbound = false;
  let editMode = false;

  function init() {
    if (initialized) return;
    initialized = true;
    load();
    if (!eventsbound) { bindEvents(); eventsbound = true; }
    initResize();
    renderTags();
    if (data.activeTag !== null && data.tags[data.activeTag]) {
      selectTag(data.activeTag);
    } else {
      renderItems();
    }
  }

  function destroy() { initialized = false; }
  function onThemeChange() {}

  /* --- Persistence --- */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // 旧形式(categories)から移行
        if (parsed.categories && !parsed.tags) {
          parsed.tags = parsed.categories.map(c => ({
            name: c.name,
            items: (c.entries || []).map(e => ({ title: e.title, body: e.body }))
          }));
          parsed.activeTag = parsed.activeCategory;
          delete parsed.categories;
          delete parsed.activeCategory;
        }
        data = parsed;
      }
    } catch (e) {
      data = { tags: [], activeTag: null };
    }
    if (!data.tags) data.tags = [];
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  /* --- Sidebar Resize --- */
  function initResize() {
    const sidebar = document.getElementById('memoSidebar');
    const handle = document.getElementById('memoResizeHandle');
    if (!sidebar || !handle) return;

    // Restore saved width
    const savedWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (savedWidth) {
      sidebar.style.width = savedWidth + 'px';
    }

    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startWidth = sidebar.getBoundingClientRect().width;
      handle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const container = sidebar.parentElement;
      const maxWidth = container.getBoundingClientRect().width * 0.5;
      const newWidth = Math.max(120, Math.min(maxWidth, startWidth + dx));
      sidebar.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem(SIDEBAR_WIDTH_KEY, Math.round(sidebar.getBoundingClientRect().width));
    });
  }

  /* --- Events --- */
  function bindEvents() {
    document.getElementById('memoTagAddBtn').addEventListener('click', addTag);
    document.getElementById('memoAddBtn').addEventListener('click', addItem);
    document.getElementById('memoEditModeBtn').addEventListener('click', toggleEditMode);
  }

  /* --- Edit Mode --- */
  function toggleEditMode() {
    editMode = !editMode;
    renderItems();
    renderTags();
  }

  function exitEditMode() {
    editMode = false;
    renderItems();
    renderTags();
  }

  /* --- Tags --- */
  function addTag() {
    const name = prompt('タグ名:');
    if (!name || !name.trim()) return;
    data.tags.push({ name: name.trim(), items: [] });
    save();
    renderTags();
    selectTag(data.tags.length - 1);
  }

  function renameTag(index) {
    const tag = data.tags[index];
    const name = prompt('タグ名を変更:', tag.name);
    if (!name || !name.trim()) return;
    tag.name = name.trim();
    save();
    renderTags();
    if (data.activeTag === index) renderItems();
  }

  function deleteTag(index) {
    const tagName = data.tags[index].name;
    if (!confirm(`「${tagName}」を削除しますか？\n中のメモもすべて削除されます。`)) return;
    data.tags.splice(index, 1);
    if (data.activeTag === index) data.activeTag = null;
    else if (data.activeTag !== null && data.activeTag > index) data.activeTag--;
    save();
    renderTags();
    renderItems();
  }

  function selectTag(index) {
    if (editMode) exitEditMode();
    data.activeTag = index;
    save();
    renderTags();
    renderItems();
  }

  function renderTags() {
    const list = document.getElementById('memoTagList');
    list.innerHTML = '';

    if (data.tags.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'memo-empty-state';
      empty.textContent = '+ ボタンでタグを作成';
      list.appendChild(empty);
      return;
    }

    data.tags.forEach((tag, i) => {
      const el = document.createElement('div');
      el.className = 'memo-tag' + (data.activeTag === i ? ' active' : '');

      if (editMode) {
        el.innerHTML = `
          <input type="checkbox" class="memo-tag-checkbox" data-tag-index="${i}">
          <span class="memo-tag-name">${esc(tag.name)}</span>
        `;
        el.querySelector('.memo-tag-checkbox').addEventListener('click', (e) => {
          e.stopPropagation();
        });
        el.addEventListener('click', (e) => {
          if (e.target.classList.contains('memo-tag-checkbox')) return;
          selectTag(i);
        });
      } else {
        el.innerHTML = `
          <span class="memo-tag-dot"></span>
          <span class="memo-tag-name">${esc(tag.name)}</span>
          <span class="memo-tag-actions">
            <button class="memo-tag-action-btn" data-action="rename" title="名前変更"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>
            <button class="memo-tag-action-btn" data-action="delete" title="削除"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
          </span>
        `;
        el.addEventListener('click', (e) => {
          if (e.target.closest('.memo-tag-action-btn')) return;
          selectTag(i);
        });
        el.querySelector('[data-action="rename"]').addEventListener('click', () => renameTag(i));
        el.querySelector('[data-action="delete"]').addEventListener('click', () => deleteTag(i));
      }

      list.appendChild(el);
    });

    // Edit mode: add bulk delete bar for tags
    if (editMode) {
      const bar = document.createElement('div');
      bar.className = 'memo-edit-bar';
      bar.innerHTML = `<button class="btn" id="memoTagBulkDelete">選択を削除</button>`;
      bar.querySelector('#memoTagBulkDelete').addEventListener('click', () => {
        const checked = list.querySelectorAll('.memo-tag-checkbox:checked');
        if (checked.length === 0) return;
        if (!confirm(`選択した${checked.length}件のタグを削除しますか？\n中のメモもすべて削除されます。`)) return;
        const indices = Array.from(checked).map(cb => parseInt(cb.dataset.tagIndex)).sort((a, b) => b - a);
        indices.forEach(idx => {
          data.tags.splice(idx, 1);
          if (data.activeTag === idx) data.activeTag = null;
          else if (data.activeTag !== null && data.activeTag > idx) data.activeTag--;
        });
        save();
        exitEditMode();
      });
      list.appendChild(bar);
    }
  }

  /* --- Items --- */
  function addItem() {
    if (data.activeTag === null) return;
    if (editMode) exitEditMode();
    const tag = data.tags[data.activeTag];
    tag.items.push({ title: '', body: '' });
    save();
    renderItems();
    // 最後のアイテムを編集状態に
    const items = document.querySelectorAll('.memo-item');
    if (items.length) {
      const last = items[items.length - 1];
      const editBtn = last.querySelector('[data-action="edit"]');
      if (editBtn) editBtn.click();
    }
  }

  function deleteItem(itemIndex) {
    if (!confirm('このメモを削除しますか？')) return;
    const tag = data.tags[data.activeTag];
    tag.items.splice(itemIndex, 1);
    save();
    renderItems();
  }

  function copyItem(itemIndex) {
    const tag = data.tags[data.activeTag];
    const item = tag.items[itemIndex];
    const text = item.body || item.title;
    navigator.clipboard.writeText(text).then(() => {
      const toast = document.querySelector(`.memo-item[data-index="${itemIndex}"] .memo-copy-toast`);
      if (toast) {
        toast.textContent = 'コピー済';
        setTimeout(() => { toast.textContent = ''; }, 1200);
      }
    }).catch(() => {});
  }

  function startEdit(itemIndex) {
    const tag = data.tags[data.activeTag];
    const item = tag.items[itemIndex];
    const el = document.querySelector(`.memo-item[data-index="${itemIndex}"]`);
    if (!el) return;

    // 既に編集中なら何もしない
    if (el.querySelector('.memo-inline-input')) return;

    const titleEl = el.querySelector('.memo-item-title');
    const bodyEl = el.querySelector('.memo-item-body');

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'memo-inline-input';
    titleInput.value = item.title;
    titleInput.placeholder = 'タイトル';
    titleEl.replaceWith(titleInput);

    // ツールバー
    const toolbar = document.createElement('div');
    toolbar.className = 'memo-edit-toolbar';
    toolbar.innerHTML = `
      <button class="memo-tb-btn" data-tag="b" title="太字"><b>B</b></button>
      <button class="memo-tb-btn" data-tag="i" title="斜体"><i>I</i></button>
      <button class="memo-tb-btn" data-tag="u" title="下線"><u>U</u></button>
      <button class="memo-tb-btn" data-tag="s" title="取消線"><s>S</s></button>
      <span class="memo-tb-sep"></span>
      <select class="memo-tb-select" data-action="size" title="サイズ">
        <option value="">サイズ</option>
        <option value="12px">小</option>
        <option value="16px">中</option>
        <option value="20px">大</option>
        <option value="28px">特大</option>
      </select>
      <input type="color" class="memo-tb-color" data-action="color" value="#000000" title="文字色">
      <span class="memo-tb-sep"></span>
      <button class="memo-tb-btn" data-action="link" title="リンク">🔗</button>
      <button class="memo-tb-btn" data-action="code" title="コード">&lt;/&gt;</button>
      <span class="memo-tb-sep"></span>
      <button class="memo-tb-btn memo-tb-preview" data-action="preview" title="プレビュー切替">プレビュー</button>
    `;

    const bodyTextarea = document.createElement('textarea');
    bodyTextarea.className = 'memo-inline-textarea';
    bodyTextarea.value = item.body;
    bodyTextarea.placeholder = 'テキストを入力... (本文)';

    const previewDiv = document.createElement('div');
    previewDiv.className = 'memo-inline-preview';
    previewDiv.hidden = true;

    bodyEl.replaceWith(toolbar);
    toolbar.after(bodyTextarea);
    bodyTextarea.after(previewDiv);

    // ツールバー: タグ挿入
    function wrapSelection(openTag, closeTag) {
      const start = bodyTextarea.selectionStart;
      const end = bodyTextarea.selectionEnd;
      const val = bodyTextarea.value;
      const selected = val.substring(start, end);
      bodyTextarea.value = val.substring(0, start) + openTag + selected + closeTag + val.substring(end);
      bodyTextarea.focus();
      bodyTextarea.setSelectionRange(start + openTag.length, start + openTag.length + selected.length);
    }

    toolbar.querySelectorAll('.memo-tb-btn[data-tag]').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const tag = btn.dataset.tag;
        wrapSelection('<' + tag + '>', '</' + tag + '>');
      });
    });

    toolbar.querySelector('[data-action="size"]').addEventListener('change', (e) => {
      const size = e.target.value;
      if (size) {
        wrapSelection('<span style="font-size:' + size + '">', '</span>');
        e.target.value = '';
      }
    });

    toolbar.querySelector('[data-action="color"]').addEventListener('input', (e) => {
      const color = e.target.value;
      wrapSelection('<span style="color:' + color + '">', '</span>');
    });

    toolbar.querySelector('[data-action="link"]').addEventListener('mousedown', (e) => {
      e.preventDefault();
      const url = prompt('URL:');
      if (url) wrapSelection('<a href="' + url + '">', '</a>');
    });

    toolbar.querySelector('[data-action="code"]').addEventListener('mousedown', (e) => {
      e.preventDefault();
      wrapSelection('<code>', '</code>');
    });

    // プレビュー切替
    let previewing = false;
    toolbar.querySelector('[data-action="preview"]').addEventListener('mousedown', (e) => {
      e.preventDefault();
      previewing = !previewing;
      const btn = toolbar.querySelector('[data-action="preview"]');
      if (previewing) {
        previewDiv.innerHTML = sanitizeHTML(bodyTextarea.value) || '<span style="color:var(--mg)">(空)</span>';
        bodyTextarea.hidden = true;
        previewDiv.hidden = false;
        btn.textContent = 'ソース';
      } else {
        bodyTextarea.hidden = false;
        previewDiv.hidden = true;
        btn.textContent = 'プレビュー';
        bodyTextarea.focus();
      }
    });

    // 新規(タイトルが空)ならタイトルにフォーカス、既存ならボディにフォーカス
    if (!item.title) {
      titleInput.focus();
    } else {
      bodyTextarea.focus();
      bodyTextarea.setSelectionRange(bodyTextarea.value.length, bodyTextarea.value.length);
    }

    const saveEdit = () => {
      item.title = titleInput.value.trim() || '無題';
      item.body = bodyTextarea.value;
      save();
      renderItems();
    };

    let blurTimeout;
    const handleBlur = () => { blurTimeout = setTimeout(saveEdit, 200); };
    const handleFocus = () => { clearTimeout(blurTimeout); };

    titleInput.addEventListener('blur', handleBlur);
    titleInput.addEventListener('focus', handleFocus);
    bodyTextarea.addEventListener('blur', handleBlur);
    bodyTextarea.addEventListener('focus', handleFocus);
    toolbar.addEventListener('mousedown', () => { clearTimeout(blurTimeout); });
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); bodyTextarea.focus(); }
    });
  }

  function renderItems() {
    const titleEl = document.getElementById('memoContentTitle');
    const addBtn = document.getElementById('memoAddBtn');
    const editModeBtn = document.getElementById('memoEditModeBtn');
    const list = document.getElementById('memoItemList');

    if (data.activeTag === null || !data.tags[data.activeTag]) {
      titleEl.textContent = 'タグを選択';
      addBtn.hidden = true;
      editModeBtn.hidden = true;
      list.innerHTML = '<div class="memo-empty-state">左のタグを選択するか、新しくタグを作成してください</div>';
      return;
    }

    const tag = data.tags[data.activeTag];
    titleEl.textContent = tag.name;
    addBtn.hidden = false;
    editModeBtn.hidden = false;
    editModeBtn.textContent = editMode ? '完了' : '編集';

    if (tag.items.length === 0) {
      list.innerHTML = '<div class="memo-empty-state">「+ 追加」でテンプレートを登録<br>登録したテキストはワンクリックでコピーできます</div>';
      return;
    }

    list.innerHTML = '';
    tag.items.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'memo-item';
      el.dataset.index = i;

      if (editMode) {
        el.innerHTML = `
          <div class="memo-item-header">
            <input type="checkbox" class="memo-item-checkbox" data-item-index="${i}">
            <span class="memo-item-title">${esc(item.title) || '<span style="color:var(--mg)">無題</span>'}</span>
          </div>
          <div class="memo-item-body">${sanitizeHTML(item.body) || '<span style="color:var(--mg)">(空)</span>'}</div>
        `;
      } else {
        el.innerHTML = `
          <div class="memo-item-header">
            <span class="memo-item-title">${esc(item.title) || '<span style="color:var(--mg)">無題</span>'}</span>
            <span class="memo-copy-toast"></span>
            <span class="memo-item-actions">
              <button class="memo-item-action-btn" data-action="copy" title="コピー"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
              <button class="memo-item-action-btn" data-action="edit" title="編集"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>
              <button class="memo-item-action-btn" data-action="delete" title="削除"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
            </span>
          </div>
          <div class="memo-item-body">${sanitizeHTML(item.body) || '<span style="color:var(--mg)">(空)</span>'}</div>
        `;
        // ボディクリックで編集モード
        el.querySelector('.memo-item-body').addEventListener('click', () => startEdit(i));
        el.querySelector('[data-action="copy"]').addEventListener('click', () => copyItem(i));
        el.querySelector('[data-action="edit"]').addEventListener('click', () => startEdit(i));
        el.querySelector('[data-action="delete"]').addEventListener('click', () => deleteItem(i));
      }

      list.appendChild(el);
    });

    // Edit mode: add bulk delete bar
    if (editMode) {
      const bar = document.createElement('div');
      bar.className = 'memo-edit-bar';
      bar.innerHTML = `<button class="btn" id="memoItemBulkDelete">選択を削除</button>`;
      bar.querySelector('#memoItemBulkDelete').addEventListener('click', () => {
        const checked = list.querySelectorAll('.memo-item-checkbox:checked');
        if (checked.length === 0) return;
        if (!confirm(`選択した${checked.length}件のメモを削除しますか？`)) return;
        const indices = Array.from(checked).map(cb => parseInt(cb.dataset.itemIndex)).sort((a, b) => b - a);
        indices.forEach(idx => {
          tag.items.splice(idx, 1);
        });
        save();
        exitEditMode();
      });
      list.appendChild(bar);
    }
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  const ALLOWED_TAGS = new Set([
    'B','I','U','S','EM','STRONG','SMALL','SUB','SUP','BR','P','DIV','SPAN',
    'H1','H2','H3','H4','H5','H6','UL','OL','LI','DL','DT','DD',
    'TABLE','THEAD','TBODY','TR','TH','TD','CAPTION',
    'A','CODE','PRE','BLOCKQUOTE','HR','IMG','MARK','DETAILS','SUMMARY'
  ]);
  const ALLOWED_ATTRS = { 'A': ['href','target'], 'IMG': ['src','alt','width','height'], '*': ['class','style'] };

  function sanitizeHTML(str) {
    if (!str) return '';
    // HTMLタグが含まれなければそのままエスケープ
    if (!/[<&]/.test(str)) return esc(str);
    const doc = new DOMParser().parseFromString(str, 'text/html');
    function clean(node) {
      const frag = document.createDocumentFragment();
      node.childNodes.forEach(child => {
        if (child.nodeType === 3) {
          frag.appendChild(document.createTextNode(child.textContent));
        } else if (child.nodeType === 1) {
          if (!ALLOWED_TAGS.has(child.tagName)) {
            frag.appendChild(clean(child));
            return;
          }
          const el = document.createElement(child.tagName);
          const allowed = [...(ALLOWED_ATTRS[child.tagName] || []), ...(ALLOWED_ATTRS['*'] || [])];
          allowed.forEach(attr => {
            const val = child.getAttribute(attr);
            if (val !== null) {
              if (attr === 'href' && /^\s*javascript:/i.test(val)) return;
              el.setAttribute(attr, val);
            }
          });
          el.appendChild(clean(child));
          frag.appendChild(el);
        }
      });
      return frag;
    }
    const container = document.createElement('div');
    container.appendChild(clean(doc.body));
    return container.innerHTML;
  }

  return { init, destroy, onThemeChange };
})();
