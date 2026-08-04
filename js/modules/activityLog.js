'use strict';

const ActivityLogModule = (() => {
  const ACTION_LABEL = {
    create: { l: 'إضافة', cls: 'green' }, update: { l: 'تعديل', cls: 'blue' }, delete: { l: 'حذف', cls: 'red' },
    archive: { l: 'أرشفة', cls: 'gray' }, restore: { l: 'استعادة', cls: 'purple' },
  };

  async function render(container) {
    const [log, users] = await Promise.all([DB.getAll('activityLog'), DB.getAll('users')]);
    log.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const uMap = Object.fromEntries(users.map(u => [u.id, u]));
    const canReset = await hasPermission('resetActivityLog');

    container.innerHTML = `
      <div class="page-head">
        <div><h2>سجل العمليات</h2><p class="muted">كل عمليات الإضافة والتعديل والحذف والأرشفة في النظام</p></div>
        ${canReset ? `<button class="btn btn-ghost" id="reset-log-btn" style="color:var(--red)">🗑 تصفير سجل العمليات</button>` : ''}
      </div>
      <div class="toolbar">
        <select id="entity-filter" class="input">
          <option value="">كل الأقسام</option>
          ${[...new Set(log.map(l => l.entity))].map(e => `<option value="${e}">${Utils.esc(ENTITY_LABEL[e] || e)}</option>`).join('')}
        </select>
        <select id="action-filter" class="input">
          <option value="">كل العمليات</option>
          ${Object.entries(ACTION_LABEL).map(([k, v]) => `<option value="${k}">${v.l}</option>`).join('')}
        </select>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>التاريخ والوقت</th><th>القسم</th><th>العملية</th><th>العنصر</th><th>بواسطة</th></tr></thead>
          <tbody id="log-tbody"></tbody>
        </table>
        <div id="log-empty" class="empty-state" style="display:none">لا يوجد سجل عمليات بعد</div>
      </div>
    `;

    const tbody = container.querySelector('#log-tbody');
    function draw(list) {
      tbody.innerHTML = list.slice(0, 300).map(l => `
        <tr>
          <td>${new Date(l.createdAt).toLocaleString('ar-EG')}</td>
          <td>${Utils.esc(ENTITY_LABEL[l.entity] || l.entity)}</td>
          <td><span class="badge badge-${ACTION_LABEL[l.action]?.cls || 'gray'}">${ACTION_LABEL[l.action]?.l || l.action}</span></td>
          <td>${Utils.esc(l.summary || '—')}</td>
          <td>${Utils.esc(uMap[l.userId]?.fullName || uMap[l.userId]?.username || 'النظام')}</td>
        </tr>`).join('');
      container.querySelector('#log-empty').style.display = list.length ? 'none' : 'block';
    }

    function applyFilters() {
      const ent = container.querySelector('#entity-filter').value;
      const act = container.querySelector('#action-filter').value;
      let list = log;
      if (ent) list = list.filter(l => l.entity === ent);
      if (act) list = list.filter(l => l.action === act);
      draw(list);
    }
    container.querySelector('#entity-filter').addEventListener('change', applyFilters);
    container.querySelector('#action-filter').addEventListener('change', applyFilters);
    draw(log);

    container.querySelector('#reset-log-btn')?.addEventListener('click', async () => {
      if (!log.length) { Utils.toast('سجل العمليات فارغ بالفعل', 'info'); return; }
      const choice = await Utils.choiceDialog(
        `سيتم تصفير سجل العمليات بالكامل (${log.length} عملية). هذا الإجراء لا يؤثر على بيانات العقود أو العملاء أو أي بيانات أخرى — فقط سجل التتبع نفسه. ⚠️ تنبيه: هذا سيُفرغ "سلة المحذوفات" أيضًا نهائيًا (لن يمكن استعادة أي عنصر محذوف بعد ذلك)، لذا يُفضّل مراجعة السلة أولاً.`,
        [
          { key: 'backup', label: '⬇️ تصفير مع الاحتفاظ بنسخة احتياطية', cls: 'btn-primary' },
          { key: 'nobackup', label: 'تصفير بدون نسخة', cls: 'btn-danger' },
          { key: 'cancel', label: 'إلغاء', cls: 'btn-ghost' },
        ]
      );
      if (!choice || choice === 'cancel') return;
      if (choice === 'backup') {
        const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `activity-log-backup-${Utils.todayISO()}.json`;
        a.click();
      }
      await resetActivityLog();
      Utils.toast('تم تصفير سجل العمليات', 'success');
      render(container);
    });
  }

  return { render };
})();

window.ActivityLogModule = ActivityLogModule;
