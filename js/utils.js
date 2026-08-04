'use strict';

const Utils = {
  currencySymbol: 'ج.م',
  setCurrency(symbol) { Utils.currencySymbol = symbol || 'ج.م'; },
  fmtMoney(n) {
    const v = Number(n || 0);
    return v.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + Utils.currencySymbol;
  },
  fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
  },
  todayISO() {
    return new Date().toISOString().slice(0, 10);
  },
  daysBetween(start, end) {
    const ms = new Date(end) - new Date(start);
    return Math.max(1, Math.ceil(ms / 86400000));
  },
  addDays(dateStr, days) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + Number(days));
    return d.toISOString().slice(0, 10);
  },
  esc(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  },
  debounce(fn, ms = 250) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  },

  toast(message, type = 'info') {
    const wrap = document.getElementById('toast-wrap');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    wrap.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 3200);
  },

  openModal(title, bodyHTML, { size = 'md' } = {}) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-box modal-${size}" role="dialog" aria-modal="true">
          <div class="modal-head">
            <h3>${title}</h3>
            <button class="modal-close" id="modal-close-btn" aria-label="إغلاق">✕</button>
          </div>
          <div class="modal-body">${bodyHTML}</div>
        </div>
      </div>`;
    document.getElementById('modal-close-btn').onclick = Utils.closeModal;
    document.getElementById('modal-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') Utils.closeModal();
    });
  },

  closeModal() {
    document.getElementById('modal-root').innerHTML = '';
  },

  confirmDialog(message) {
    return new Promise((resolve) => {
      Utils.openModal('تأكيد', `
        <p class="confirm-text">${Utils.esc(message)}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="confirm-no">إلغاء</button>
          <button class="btn btn-danger" id="confirm-yes">تأكيد</button>
        </div>`, { size: 'sm' });
      document.getElementById('confirm-no').onclick = () => { Utils.closeModal(); resolve(false); };
      document.getElementById('confirm-yes').onclick = () => { Utils.closeModal(); resolve(true); };
    });
  },

  /**
   * Like confirmDialog, but with more than two possible outcomes — e.g.
   * "أرشفة" vs "حذف نهائي" vs "إلغاء". Resolves with the chosen `key`,
   * or null if the modal is dismissed without a choice.
   */
  choiceDialog(message, choices) {
    return new Promise((resolve) => {
      Utils.openModal('تأكيد', `
        <p class="confirm-text">${Utils.esc(message)}</p>
        <div class="modal-actions" style="flex-wrap:wrap">
          ${choices.map(c => `<button type="button" class="btn ${c.cls || 'btn-ghost'}" data-key="${Utils.esc(c.key)}">${Utils.esc(c.label)}</button>`).join('')}
        </div>`, { size: 'sm' });
      let resolved = false;
      document.querySelectorAll('#modal-root [data-key]').forEach(btn => {
        btn.onclick = () => { resolved = true; Utils.closeModal(); resolve(btn.dataset.key); };
      });
      document.getElementById('modal-backdrop').addEventListener('click', (e) => {
        if (e.target.id === 'modal-backdrop' && !resolved) resolve(null);
      });
      document.getElementById('modal-close-btn').addEventListener('click', () => { if (!resolved) resolve(null); });
    });
  },

  /** Prompts for a short line of text (used for cancel/archive reasons). */
  promptDialog(message, { placeholder = '', required = false } = {}) {
    return new Promise((resolve) => {
      Utils.openModal('تأكيد', `
        <form id="prompt-dialog-form">
          <p class="confirm-text">${Utils.esc(message)}</p>
          <textarea name="value" class="input" rows="2" placeholder="${Utils.esc(placeholder)}" ${required ? 'required' : ''}></textarea>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" id="prompt-cancel">إلغاء</button>
            <button type="submit" class="btn btn-primary">تأكيد</button>
          </div>
        </form>`, { size: 'sm' });
      document.getElementById('prompt-cancel').onclick = () => { Utils.closeModal(); resolve(null); };
      document.getElementById('prompt-dialog-form').onsubmit = (e) => {
        e.preventDefault();
        const val = new FormData(e.target).get('value');
        Utils.closeModal();
        resolve(val || '');
      };
    });
  },

  statusBadge(status, map) {
    const cfg = map[status] || { label: status, cls: 'gray' };
    return `<span class="badge badge-${cfg.cls}">${cfg.label}</span>`;
  },

  /**
   * Simple client-side pagination for large lists. Returns the page slice and
   * renders page-navigation controls into the given container.
   */
  paginate(list, page, pageSize) {
    const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    return { items: list.slice(start, start + pageSize), page: safePage, totalPages, total: list.length };
  },

  renderPagination(container, { page, totalPages, total }, onPageChange) {
    if (totalPages <= 1) { container.innerHTML = ''; return; }
    const pages = [];
    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) pages.push(p);
      else if (pages[pages.length - 1] !== '…') pages.push('…');
    }
    container.innerHTML = `
      <div class="pagination">
        <span class="pagination-info">${total} سجل — صفحة ${page} من ${totalPages}</span>
        <div class="pagination-btns">
          <button class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ السابق</button>
          ${pages.map(p => p === '…'
            ? `<span class="page-ellipsis">…</span>`
            : `<button class="page-btn ${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`).join('')}
          <button class="page-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>التالي ›</button>
        </div>
      </div>`;
    container.querySelectorAll('.page-btn:not(:disabled)').forEach(b => {
      b.onclick = () => onPageChange(Number(b.dataset.page));
    });
  },

  /** Opens WhatsApp (web or app) with a prefilled message to the given phone number. */
  openWhatsApp(phone, message) {
    const digits = (phone || '').replace(/\D/g, '');
    if (!digits) { Utils.toast('لا يوجد رقم هاتف مسجّل لهذا العميل', 'error'); return; }
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  },
  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  /**
   * Renders a small photo uploader + preview into `container`. Calls
   * onChange(base64OrNull) whenever the photo is added or removed.
   */
  renderPhotoUploader(container, label, initialValue, onChange) {
    container.innerHTML = `
      <div class="photo-uploader">
        <div class="photo-uploader-label">${Utils.esc(label)}</div>
        <div class="photo-preview-box" id="pu-preview">
          ${initialValue ? `<img src="${initialValue}" alt="">` : `<span class="photo-preview-empty">لا توجد صورة</span>`}
        </div>
        <div class="photo-uploader-actions">
          <label class="btn btn-ghost" style="cursor:pointer">📷 اختر صورة<input type="file" accept="image/*" id="pu-input" style="display:none"></label>
          ${initialValue ? `<button type="button" class="btn btn-ghost" id="pu-remove">🗑 إزالة</button>` : ''}
        </div>
      </div>`;
    container.querySelector('#pu-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const base64 = await Utils.fileToBase64(file);
      onChange(base64);
      Utils.renderPhotoUploader(container, label, base64, onChange);
    });
    container.querySelector('#pu-remove')?.addEventListener('click', () => {
      onChange(null);
      Utils.renderPhotoUploader(container, label, null, onChange);
    });
  },

  /**
   * Renders a canvas-based signature pad into `container`. Returns an
   * object with getDataURL() and clear().
   */
  createSignaturePad(container, initialValue) {
    container.innerHTML = `
      <div class="sig-pad-wrap">
        <canvas class="sig-pad-canvas" width="320" height="120"></canvas>
        <div class="sig-pad-actions">
          <button type="button" class="btn btn-ghost sig-clear-btn" style="padding:4px 10px; font-size:11px">مسح التوقيع</button>
        </div>
      </div>`;
    const canvas = container.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#1a1d29';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    let drawing = false, hasDrawing = false;

    if (initialValue) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = initialValue;
      hasDrawing = true;
    }

    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      const point = e.touches ? e.touches[0] : e;
      return { x: (point.clientX - rect.left) * (canvas.width / rect.width), y: (point.clientY - rect.top) * (canvas.height / rect.height) };
    }
    function start(e) { drawing = true; hasDrawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); }
    function move(e) { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); }
    function end() { drawing = false; }

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    container.querySelector('.sig-clear-btn').onclick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasDrawing = false;
    };

    return {
      getDataURL: () => hasDrawing ? canvas.toDataURL('image/png') : null,
    };
  },

  /**
   * Renders a simple top-down car outline that the user can click on to mark
   * damage points. Returns { getPoints() }.
   */
  createDamageDiagram(container, initialPoints) {
    const points = Array.isArray(initialPoints) ? [...initialPoints] : [];
    container.innerHTML = `
      <div class="damage-diagram-wrap">
        <svg viewBox="0 0 200 380" class="damage-diagram-svg" id="dd-svg">
          <rect x="30" y="20" width="140" height="340" rx="35" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5"/>
          <rect x="45" y="55" width="110" height="70" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"/>
          <rect x="45" y="255" width="110" height="70" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"/>
          <circle cx="45" cy="90" r="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"/>
          <circle cx="155" cy="90" r="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"/>
          <circle cx="45" cy="290" r="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"/>
          <circle cx="155" cy="290" r="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"/>
          <g id="dd-points"></g>
        </svg>
        <p class="muted" style="font-size:11.5px; margin-top:4px">اضغط على مكان الضرر على هيكل السيارة (نظرة علوية) — اضغط على أي علامة لحذفها</p>
      </div>`;
    const svg = container.querySelector('#dd-svg');
    const pointsGroup = container.querySelector('#dd-points');

    function redraw() {
      pointsGroup.innerHTML = points.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="6" fill="#ef4444" stroke="#fff" stroke-width="1.5" data-idx="${i}" class="dd-point"></circle>`).join('');
      pointsGroup.querySelectorAll('.dd-point').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          points.splice(Number(el.dataset.idx), 1);
          redraw();
        });
      });
    }
    redraw();

    svg.addEventListener('click', (e) => {
      const rect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      const x = ((e.clientX - rect.left) / rect.width) * viewBox.width;
      const y = ((e.clientY - rect.top) / rect.height) * viewBox.height;
      points.push({ x: Math.round(x), y: Math.round(y) });
      redraw();
    });

    return { getPoints: () => points };
  },

  /**
   * Upgrades a plain <select> into a type-to-filter searchable combobox.
   * The original <select> stays in the DOM (hidden) so existing code that
   * reads it via FormData or listens for its 'change' event keeps working
   * unmodified — only the visual picking mechanism changes.
   */
  enhanceSearchableSelect(select, placeholder) {
    if (!select || select.dataset.enhanced) return;
    select.dataset.enhanced = '1';

    const wrapper = document.createElement('div');
    wrapper.className = 'searchable-select';
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    select.classList.add('ss-hidden-select');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input';
    input.placeholder = placeholder || 'اكتب للبحث...';
    input.autocomplete = 'off';
    wrapper.insertBefore(input, select);

    const dropdown = document.createElement('div');
    dropdown.className = 'ss-dropdown';
    wrapper.appendChild(dropdown);

    function getOptions() {
      return Array.from(select.options).filter(o => o.value !== '').map(o => ({ value: o.value, label: o.textContent }));
    }

    function syncInputFromSelect() {
      const opt = select.options[select.selectedIndex];
      input.value = opt && opt.value ? opt.textContent : '';
    }
    syncInputFromSelect();

    function renderDropdown(filterText) {
      const q = filterText.trim().toLowerCase();
      const all = getOptions();
      const filtered = q ? all.filter(o => o.label.toLowerCase().includes(q)) : all;
      dropdown.innerHTML = filtered.length
        ? filtered.slice(0, 60).map(o => `<div class="ss-item" data-value="${Utils.esc(o.value)}">${Utils.esc(o.label)}</div>`).join('')
        : `<div class="ss-empty">لا توجد نتائج مطابقة</div>`;
      dropdown.querySelectorAll('.ss-item').forEach(el => {
        el.onmousedown = (e) => {
          e.preventDefault(); // keep focus so blur doesn't fire before click registers
          select.value = el.dataset.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          syncInputFromSelect();
          dropdown.classList.remove('show');
        };
      });
      dropdown.classList.add('show');
    }

    input.addEventListener('focus', () => renderDropdown(input.value === (select.options[select.selectedIndex]?.textContent || '') ? '' : input.value));
    input.addEventListener('input', () => renderDropdown(input.value));
    input.addEventListener('blur', () => {
      setTimeout(() => { dropdown.classList.remove('show'); syncInputFromSelect(); }, 120);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { dropdown.classList.remove('show'); input.blur(); }
    });
  },
};

window.Utils = Utils;
