/* ========================================
   SUGOMEMO - Memo Module
   タグ管理 + テンプレートテキスト
   タグでグルーピング、ワンクリックコピー
   ======================================== */

window.MemoModule = (() => {
  const STORAGE_KEY = 'sugomemo-memo';
  let data = { tags: [], activeTag: null };
  let initialized = false;
  let eventsbound = false;

  function init() {
    if (initialized) return;
    initialized = true;
    load();
    if (!eventsbound) { bindEvents(); eventsbound = true; }
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

  /* --- Events --- */
  function bindEvents() {
    document.getElementById('memoTagAddBtn').addEventListener('click', addTag);
    document.getElementById('memoAddBtn').addEventListener('click', addItem);
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
    if (!confirm(`「${data.tags[index].name}」を削除しますか？`)) return;
    data.tags.splice(index, 1);
    if (data.activeTag === index) data.activeTag = null;
    else if (data.activeTag !== null && data.activeTag > index) data.activeTag--;
    save();
    renderTags();
    renderItems();
  }

  function selectTag(index) {
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
      el.innerHTML = `
        <span class="memo-tag-dot"></span>
        <span class="memo-tag-name">${esc(tag.name)}</span>
        <span class="memo-tag-actions">
          <button class="memo-tag-action-btn" data-action="rename" title="名前変更">R</button>
          <button class="memo-tag-action-btn" data-action="delete" title="削除">&times;</button>
        </span>
      `;
      el.addEventListener('click', (e) => {
        if (e.target.closest('.memo-tag-action-btn')) return;
        selectTag(i);
      });
      el.querySelector('[data-action="rename"]').addEventListener('click', () => renameTag(i));
      el.querySelector('[data-action="delete"]').addEventListener('click', () => deleteTag(i));
      list.appendChild(el);
    });
  }

  /* --- Items --- */
  function addItem() {
    if (data.activeTag === null) return;
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

    const bodyTextarea = document.createElement('textarea');
    bodyTextarea.className = 'memo-inline-textarea';
    bodyTextarea.value = item.body;
    bodyTextarea.placeholder = 'テキストを入力... (本文)';
    bodyEl.replaceWith(bodyTextarea);

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
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); bodyTextarea.focus(); }
    });
  }

  function renderItems() {
    const titleEl = document.getElementById('memoContentTitle');
    const addBtn = document.getElementById('memoAddBtn');
    const list = document.getElementById('memoItemList');

    if (data.activeTag === null || !data.tags[data.activeTag]) {
      titleEl.textContent = 'タグを選択';
      addBtn.hidden = true;
      list.innerHTML = '<div class="memo-empty-state">左のタグを選択するか、新しくタグを作成してください</div>';
      return;
    }

    const tag = data.tags[data.activeTag];
    titleEl.textContent = tag.name;
    addBtn.hidden = false;

    if (tag.items.length === 0) {
      list.innerHTML = '<div class="memo-empty-state">「+ 追加」でテンプレートを登録<br>登録したテキストはワンクリックでコピーできます</div>';
      return;
    }

    list.innerHTML = '';
    tag.items.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'memo-item';
      el.dataset.index = i;
      el.innerHTML = `
        <div class="memo-item-header">
          <span class="memo-item-title">${esc(item.title) || '<span style="color:var(--mg)">無題</span>'}</span>
          <span class="memo-copy-toast"></span>
          <span class="memo-item-actions">
            <button class="memo-item-action-btn" data-action="copy" title="コピー">C</button>
            <button class="memo-item-action-btn" data-action="edit" title="編集">E</button>
            <button class="memo-item-action-btn" data-action="delete" title="削除">&times;</button>
          </span>
        </div>
        <div class="memo-item-body">${esc(item.body) || '<span style="color:var(--mg)">(空)</span>'}</div>
      `;
      // ボディクリックで編集モード
      el.querySelector('.memo-item-body').addEventListener('click', () => startEdit(i));
      el.querySelector('[data-action="copy"]').addEventListener('click', () => copyItem(i));
      el.querySelector('[data-action="edit"]').addEventListener('click', () => startEdit(i));
      el.querySelector('[data-action="delete"]').addEventListener('click', () => deleteItem(i));
      list.appendChild(el);
    });
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  return { init, destroy, onThemeChange };
})();
