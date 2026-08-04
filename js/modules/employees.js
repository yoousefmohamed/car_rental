'use strict';

const EmployeesModule = (() => {
  const ROLES = ['موظف استقبال', 'محاسب', 'سائق', 'فني صيانة', 'مدير فرع', 'أخرى'];

  let showArchived = false;

  async function render(container) {
    const all = await DB.getAll('employees');
    all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const employees = all.filter(e => showArchived ? e._archived === '1' : e._archived !== '1');
    const canDelete = await hasPermission('deleteRecords');

    container.innerHTML = `
      <div class="page-head">
        <div><h2>الموظفون</h2><p class="muted">بيانات الموظفين والسائقين والرواتب</p></div>
        <div style="display:flex; gap:8px">
          <button class="btn btn-ghost" id="toggle-archived-btn">${showArchived ? '👥 عرض النشطين' : '📦 عرض الأرشيف'}</button>
          <button class="btn btn-primary" id="add-emp-btn">+ إضافة موظف</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الاسم</th><th>الوظيفة</th><th>الهاتف</th><th>الراتب الشهري</th><th>تاريخ التعيين</th><th></th></tr></thead>
          <tbody id="emp-tbody"></tbody>
        </table>
        <div id="emp-empty" class="empty-state" style="display:none">${showArchived ? 'لا يوجد موظفون مؤرشفون' : 'لا يوجد موظفون بعد'}</div>
      </div>
    `;

    const tbody = container.querySelector('#emp-tbody');
    tbody.innerHTML = employees.map(e => `
      <tr>
        <td><strong>${Utils.esc(e.name)}</strong> ${e._archived === '1' ? '<span class="badge badge-gray">مؤرشف</span>' : ''}</td>
        <td>${Utils.esc(e.role)}</td>
        <td>${Utils.esc(e.phone || '—')}</td>
        <td>${Utils.fmtMoney(e.salary)}</td>
        <td>${Utils.fmtDate(e.hireDate)}</td>
        <td class="row-actions">
          ${!showArchived ? `<button class="icon-btn edit-btn" data-id="${e.id}" title="تعديل">✎</button>` : ''}
          ${showArchived
            ? `<button class="icon-btn restore-btn" data-id="${e.id}" title="استعادة">♻️</button>`
            : `<button class="icon-btn del-btn" data-id="${e.id}" title="حذف">🗑</button>`}
        </td>
      </tr>`).join('');
    container.querySelector('#emp-empty').style.display = employees.length ? 'none' : 'block';
    tbody.querySelectorAll('.edit-btn').forEach(b => b.onclick = () => openForm(b.dataset.id));
    tbody.querySelectorAll('.del-btn').forEach(b => b.onclick = () => remove(b.dataset.id));
    tbody.querySelectorAll('.restore-btn').forEach(b => b.onclick = async () => {
      await restoreRecord('employees', b.dataset.id);
      Utils.toast('تم استعادة الموظف', 'success');
      render(container);
    });

    container.querySelector('#add-emp-btn').onclick = () => openForm(null);
    container.querySelector('#toggle-archived-btn').onclick = () => { showArchived = !showArchived; render(container); };

    async function remove(id) {
      const blockReason = await employeeDeleteBlockReason(id);
      if (blockReason) {
        const choice = await Utils.choiceDialog(`${blockReason}. لا يمكن حذف هذا الموظف نهائيًا، لكن يمكنك أرشفته بدلاً من ذلك (يختفي من القوائم النشطة مع الاحتفاظ بسجله وبياناته المالية).`, [
          { key: 'archive', label: '📦 أرشفة الموظف', cls: 'btn-primary' },
          { key: 'cancel', label: 'إلغاء', cls: 'btn-ghost' },
        ]);
        if (choice === 'archive') { await archiveRecord('employees', id); Utils.toast('تم أرشفة الموظف', 'success'); render(container); }
        return;
      }
      if (!canDelete) {
        const choice = await Utils.choiceDialog('لا تملك صلاحية الحذف النهائي — يمكنك أرشفة الموظف بدلاً من ذلك.', [
          { key: 'archive', label: '📦 أرشفة الموظف', cls: 'btn-primary' },
          { key: 'cancel', label: 'إلغاء', cls: 'btn-ghost' },
        ]);
        if (choice === 'archive') { await archiveRecord('employees', id); Utils.toast('تم أرشفة الموظف', 'success'); render(container); }
        return;
      }
      const choice = await Utils.choiceDialog('كيف تريد إزالة هذا الموظف؟', [
        { key: 'archive', label: '📦 أرشفة (يمكن استعادته لاحقًا)', cls: 'btn-primary' },
        { key: 'delete', label: '🗑 حذف نهائي', cls: 'btn-danger' },
        { key: 'cancel', label: 'إلغاء', cls: 'btn-ghost' },
      ]);
      if (choice === 'archive') { await archiveRecord('employees', id); Utils.toast('تم أرشفة الموظف', 'success'); render(container); }
      else if (choice === 'delete') { await DB.delete('employees', id); Utils.toast('تم حذف الموظف نهائيًا', 'success'); render(container); }
    }

    async function openForm(id) {
      const e = id ? await DB.get('employees', id) : {};
      Utils.openModal(id ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد', `
        <form id="emp-form" class="form-grid">
          <label>الاسم *<input required name="name" class="input" value="${Utils.esc(e.name || '')}"></label>
          <label>الوظيفة
            <select name="role" class="input">${ROLES.map(r => `<option ${e.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
          </label>
          <label>الهاتف<input name="phone" class="input" value="${Utils.esc(e.phone || '')}"></label>
          <label>الراتب الشهري<input type="number" name="salary" class="input" value="${Utils.esc(e.salary || '')}"></label>
          <label>تاريخ التعيين<input type="date" name="hireDate" class="input" value="${Utils.esc((e.hireDate || '').slice(0,10))}"></label>
          <label>نسبة العمولة %<input type="number" name="commissionPercent" class="input" value="${Utils.esc(e.commissionPercent || 0)}"></label>
          <label class="span-2">ملاحظات<textarea name="notes" class="input" rows="2">${Utils.esc(e.notes || '')}</textarea></label>
          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">${id ? 'حفظ التعديلات' : 'إضافة'}</button>
          </div>
        </form>`, { size: 'md' });
      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      document.getElementById('emp-form').onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = Object.fromEntries(new FormData(ev.target).entries());
        if (id) fd.id = id;
        await DB.add('employees', fd);
        Utils.toast(id ? 'تم التحديث' : 'تمت الإضافة', 'success');
        Utils.closeModal();
        render(container);
      };
    }
  }

  return { render, ROLES };
})();

window.EmployeesModule = EmployeesModule;
