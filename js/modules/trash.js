'use strict';

const TrashModule = (() => {
  async function render(container) {
    const [log, users] = await Promise.all([DB.getAll('activityLog'), DB.getAll('users')]);
    const uMap = Object.fromEntries(users.map(u => [u.id, u]));
    const deletions = log
      .filter(l => l.action === 'delete')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const canPurge = await hasPermission('permanentDelete');
    const purgeableCount = deletions.filter(l => l.snapshot && !l.restoredAt).length;

    container.innerHTML = `
      <div class="page-head">
        <div><h2>سلة المحذوفات</h2><p class="muted">كل العناصر التي تم حذفها من النظام — يمكن استعادة أي منها أو حذفها نهائيًا بلا رجعة</p></div>
        ${canPurge && purgeableCount ? `<button class="btn btn-ghost" id="empty-trash-btn" style="color:var(--red)">🗑 إفراغ السلة نهائيًا</button>` : ''}
      </div>

      <div class="toolbar">
        <input type="text" id="trash-search" placeholder="بحث بنوع العنصر أو تفاصيله..." class="input" />
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>النوع</th><th>التفاصيل</th><th>تاريخ الحذف</th><th>بواسطة</th><th>الحالة</th><th></th></tr></thead>
          <tbody id="trash-tbody"></tbody>
        </table>
        <div id="trash-empty" class="empty-state" style="display:none">سلة المحذوفات فارغة</div>
      </div>
    `;

    const tbody = container.querySelector('#trash-tbody');

    function statusBadge(l) {
      if (l.restoredAt) return '<span class="badge badge-green">تم الاستعادة</span>';
      if (l.purgedAt || !l.snapshot) return '<span class="badge badge-gray">محذوف نهائيًا</span>';
      return '<span class="badge badge-red">في السلة</span>';
    }

    function draw(list) {
      tbody.innerHTML = list.map(l => `
        <tr>
          <td>${Utils.esc(l.label)}</td>
          <td>${Utils.esc(l.summary || '—')}</td>
          <td>${Utils.fmtDate(l.createdAt)}</td>
          <td>${Utils.esc(uMap[l.userId]?.username || '—')}</td>
          <td>${statusBadge(l)}</td>
          <td class="row-actions">
            ${!l.restoredAt && l.snapshot ? `<button class="icon-btn restore-btn" data-id="${l.id}" title="استعادة">♻️</button>` : ''}
            ${!l.restoredAt && l.snapshot && canPurge ? `<button class="icon-btn purge-btn" data-id="${l.id}" title="حذف نهائي — لا رجعة فيه">🗑</button>` : ''}
          </td>
        </tr>`).join('');
      container.querySelector('#trash-empty').style.display = list.length ? 'none' : 'block';
      tbody.querySelectorAll('.restore-btn').forEach(b => b.onclick = () => restore(b.dataset.id));
      tbody.querySelectorAll('.purge-btn').forEach(b => b.onclick = () => purgeOne(b.dataset.id));
    }

    draw(deletions);

    container.querySelector('#trash-search').addEventListener('input', Utils.debounce(() => {
      const q = container.querySelector('#trash-search').value.trim().toLowerCase();
      draw(!q ? deletions : deletions.filter(l => (l.label + ' ' + (l.summary || '')).toLowerCase().includes(q)));
    }, 150));

    container.querySelector('#empty-trash-btn')?.addEventListener('click', async () => {
      const choice = await Utils.choiceDialog(
        `سيتم حذف ${purgeableCount} عنصر نهائيًا من سلة المحذوفات — هذا الإجراء لا رجعة فيه إطلاقًا ولن تتمكن من استعادة أي منها بعد ذلك.`,
        [
          { key: 'purge', label: '🗑 إفراغ السلة نهائيًا', cls: 'btn-danger' },
          { key: 'cancel', label: 'إلغاء', cls: 'btn-ghost' },
        ]
      );
      if (choice !== 'purge') return;
      const n = await purgeAllTrash();
      Utils.toast(`تم حذف ${n} عنصر نهائيًا`, 'success');
      render(container);
    });

    async function restore(logId) {
      const ok = await Utils.confirmDialog('هل تريد استعادة هذا العنصر إلى مكانه الأصلي؟');
      if (!ok) return;
      try {
        const restored = await restoreFromTrash(logId);
        if (!restored) { Utils.toast('تعذّرت الاستعادة — قد يكون العنصر مستعادًا أو محذوفًا نهائيًا بالفعل', 'error'); return; }
        Utils.toast('تم استعادة العنصر بنجاح', 'success');
        render(container);
      } catch (err) {
        console.error('Restore from trash failed:', err);
        Utils.toast('حدث خطأ أثناء الاستعادة: ' + err.message, 'error');
      }
    }

    async function purgeOne(logId) {
      const choice = await Utils.choiceDialog('حذف هذا العنصر نهائيًا من سلة المحذوفات؟ لن تتمكن من استعادته بعد ذلك أبدًا.', [
        { key: 'purge', label: '🗑 حذف نهائي', cls: 'btn-danger' },
        { key: 'cancel', label: 'إلغاء', cls: 'btn-ghost' },
      ]);
      if (choice !== 'purge') return;
      await permanentlyPurgeTrashItem(logId);
      Utils.toast('تم الحذف النهائي', 'success');
      render(container);
    }
  }

  return { render };
})();

window.TrashModule = TrashModule;
