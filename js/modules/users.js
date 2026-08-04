'use strict';

const UsersModule = (() => {
  const ROLES = {
    admin:        { label: 'مدير عام (كل الصلاحيات)' },
    accountant:   { label: 'محاسب (المالية والتقارير)' },
    receptionist: { label: 'موظف استقبال (التشغيل اليومي)' },
    viewer:       { label: 'مشاهدة فقط' },
  };

  async function render(container) {
    const users = await DB.getAll('users');
    users.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const currentId = getCurrentUserId();

    container.innerHTML = `
      <div class="page-head">
        <div><h2>المستخدمون</h2><p class="muted">إدارة حسابات الدخول، كلمات المرور، والصلاحيات لكل مستخدم</p></div>
        <button class="btn btn-primary" id="add-user-btn">+ مستخدم جديد</button>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>اسم المستخدم</th><th>الاسم الكامل</th><th>الدور</th><th>الحالة</th><th></th></tr></thead>
          <tbody id="users-tbody"></tbody>
        </table>
        <div id="users-empty" class="empty-state" style="display:none">لا يوجد مستخدمون بعد — أضف أول مستخدم مدير</div>
      </div>
    `;

    const tbody = container.querySelector('#users-tbody');
    tbody.innerHTML = users.map(u => `
      <tr>
        <td><strong>${Utils.esc(u.username)}</strong> ${u.id === currentId ? '<span class="badge badge-blue">أنت</span>' : ''}</td>
        <td>${Utils.esc(u.fullName || '—')}</td>
        <td>${Utils.esc(ROLES[u.role]?.label || u.role)}</td>
        <td>${u.active === '0' ? '<span class="badge badge-red">موقوف</span>' : '<span class="badge badge-green">نشط</span>'}</td>
        <td class="row-actions">
          <button class="icon-btn pass-btn" data-id="${u.id}" title="تغيير كلمة المرور">🔑</button>
          <button class="icon-btn edit-btn" data-id="${u.id}" title="تعديل">✎</button>
          <button class="icon-btn del-btn" data-id="${u.id}" title="حذف">🗑</button>
        </td>
      </tr>`).join('');
    container.querySelector('#users-empty').style.display = users.length ? 'none' : 'block';
    tbody.querySelectorAll('.edit-btn').forEach(b => b.onclick = () => openForm(b.dataset.id));
    tbody.querySelectorAll('.del-btn').forEach(b => b.onclick = () => remove(b.dataset.id));
    tbody.querySelectorAll('.pass-btn').forEach(b => b.onclick = () => openPasswordForm(b.dataset.id));

    container.querySelector('#add-user-btn').onclick = () => openForm(null);

    async function remove(id) {
      if (id === currentId) { Utils.toast('لا يمكنك حذف حسابك الحالي', 'error'); return; }
      const ok = await Utils.confirmDialog('هل تريد حذف هذا المستخدم؟');
      if (!ok) return;
      await DB.delete('users', id);
      Utils.toast('تم الحذف', 'success');
      render(container);
    }

    function openPasswordForm(id) {
      Utils.openModal('تغيير كلمة المرور', `
        <form id="pass-form" class="form-grid">
          <label class="span-2">كلمة المرور الجديدة *${pwField('password')}</label>
          <label class="span-2">تأكيد كلمة المرور *${pwField('password2')}</label>
          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">حفظ كلمة المرور</button>
          </div>
        </form>`, { size: 'sm' });
      attachPasswordToggles(document.getElementById('modal-root'));
      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      document.getElementById('pass-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target).entries());
        if (fd.password !== fd.password2) { Utils.toast('كلمتا المرور غير متطابقتين', 'error'); return; }
        const u = await DB.get('users', id);
        u.salt = randomSalt();
        u.passwordHash = await hashPassword(fd.password, u.salt);
        await DB.add('users', u);
        Utils.toast('تم تحديث كلمة المرور', 'success');
        Utils.closeModal();
      };
    }

    async function openForm(id) {
      const u = id ? await DB.get('users', id) : {};
      Utils.openModal(id ? 'تعديل المستخدم' : 'مستخدم جديد', `
        <form id="user-form" class="form-grid">
          <label>اسم المستخدم *<input required name="username" class="input" value="${Utils.esc(u.username || '')}"></label>
          <label>الاسم الكامل<input name="fullName" class="input" value="${Utils.esc(u.fullName || '')}"></label>
          ${!id ? `
          <label>كلمة المرور *${pwField('password')}</label>
          <label>تأكيد كلمة المرور *${pwField('password2')}</label>
          ` : ''}
          <label>الدور
            <select name="role" class="input">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${r.label}</option>`).join('')}</select>
          </label>
          <label>الحالة
            <select name="active" class="input">
              <option value="1" ${u.active !== '0' ? 'selected' : ''}>نشط</option>
              <option value="0" ${u.active === '0' ? 'selected' : ''}>موقوف</option>
            </select>
          </label>
          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">${id ? 'حفظ' : 'إضافة'}</button>
          </div>
        </form>`, { size: 'sm' });
      attachPasswordToggles(document.getElementById('modal-root'));
      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      document.getElementById('user-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target).entries());

        const allUsers = await DB.getAll('users');
        const duplicate = allUsers.find(x => x.id !== id && (x.username || '').toLowerCase() === (fd.username || '').toLowerCase());
        if (duplicate) { Utils.toast('اسم المستخدم هذا مستخدم بالفعل', 'error'); return; }

        if (!id) {
          if (fd.password !== fd.password2) { Utils.toast('كلمتا المرور غير متطابقتين', 'error'); return; }
          fd.salt = randomSalt();
          fd.passwordHash = await hashPassword(fd.password, fd.salt);
          delete fd.password; delete fd.password2;
        } else {
          fd.id = id;
          fd.salt = u.salt; fd.passwordHash = u.passwordHash; // preserve existing password
        }

        const saved = await DB.add('users', fd);
        if (!getCurrentUserId()) setCurrentUserId(saved.id);
        Utils.toast(id ? 'تم التحديث' : 'تمت الإضافة', 'success');
        Utils.closeModal();
        render(container);
      };
    }
  }

  return { render, ROLES };
})();

window.UsersModule = UsersModule;
