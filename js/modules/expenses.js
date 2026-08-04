'use strict';

const ExpensesModule = (() => {
  const CATEGORIES = ['صيانة', 'وقود', 'رواتب', 'إيجار', 'تأمين', 'تسويق', 'أدوات مكتبية', 'أخرى'];

  async function render(container) {
    const [expenses, vehicles, accounts, employees] = await Promise.all([
      DB.getAll('expenses'), DB.getAll('vehicles'), DB.getAll('accounts'), DB.getAll('employees')
    ]);
    expenses.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const vMap = Object.fromEntries(vehicles.map(v => [v.id, v]));
    const aMap = Object.fromEntries(accounts.map(a => [a.id, a]));
    const eMap = Object.fromEntries(employees.map(e => [e.id, e]));
    const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);

    const byCategory = {};
    expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount || 0); });
    const catRows = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

    container.innerHTML = `
      <div class="page-head">
        <div><h2>المصروفات</h2><p class="muted">إجمالي المصروفات: <strong>${Utils.fmtMoney(total)}</strong> — مرتبطة تلقائياً بأرصدة الخزينة والمحافظ</p></div>
        <button class="btn btn-primary" id="add-expense-btn">+ مصروف جديد</button>
      </div>

      ${catRows.length ? `
      <div class="panel" style="margin-bottom:18px">
        <h3>📊 توزيع المصروفات حسب الفئة</h3>
        <table class="table table-compact">
          <thead><tr><th>الفئة</th><th>الإجمالي</th><th>النسبة</th></tr></thead>
          <tbody>
            ${catRows.map(([cat, amt]) => `
              <tr><td>${Utils.esc(cat)}</td><td class="text-danger">${Utils.fmtMoney(amt)}</td><td>${total ? Math.round(amt / total * 100) : 0}%</td></tr>
            `).join('')}
          </tbody>
        </table>
      </div>` : ''}

      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>التاريخ</th><th>الفئة</th><th>مرتبط بسيارة</th><th>الحساب</th><th>الموظف</th><th>ملاحظة</th><th>المبلغ</th><th></th></tr></thead>
          <tbody id="exp-tbody"></tbody>
        </table>
        <div id="exp-empty" class="empty-state" style="display:none">لا توجد مصروفات مسجلة</div>
      </div>
    `;

    const tbody = container.querySelector('#exp-tbody');
    tbody.innerHTML = expenses.map(e => `
      <tr>
        <td>${Utils.fmtDate(e.date)}</td>
        <td>${Utils.esc(e.category)}</td>
        <td>${e.vehicleId ? Utils.esc(vMap[e.vehicleId]?.plate || '—') : '—'}</td>
        <td>${Utils.esc(aMap[e.accountId]?.name || '—')}</td>
        <td>${e.employeeId ? Utils.esc(eMap[e.employeeId]?.name || '—') : '—'}</td>
        <td>${Utils.esc(e.note || '—')}</td>
        <td class="text-danger">${Utils.fmtMoney(e.amount)}</td>
        <td class="row-actions">
          <button class="icon-btn edit-btn" data-id="${e.id}" title="تعديل">✎</button>
          <button class="icon-btn del-btn" data-id="${e.id}" title="حذف">🗑</button>
        </td>
      </tr>`).join('');
    container.querySelector('#exp-empty').style.display = expenses.length ? 'none' : 'block';
    tbody.querySelectorAll('.edit-btn').forEach(b => b.onclick = () => openForm(b.dataset.id));
    tbody.querySelectorAll('.del-btn').forEach(b => b.onclick = () => remove(b.dataset.id));

    container.querySelector('#add-expense-btn').onclick = () => openForm(null);
    if (!accounts.length) {
      Utils.toast('أضف خزينة أو محفظة إلكترونية أولاً من صفحة "الخزينة" لتسجيل المصروفات', 'info');
    }

    async function remove(id) {
      const ok = await Utils.confirmDialog('هل تريد حذف هذا المصروف؟ سيتم أيضاً حذف الحركة المالية المرتبطة به من الخزينة لضمان تطابق الأرصدة.');
      if (!ok) return;
      try {
        const txs = await DB.getAll('transactions');
        const linkedTx = txs.find(t => t.refType === 'expense' && t.refId === id);
        if (linkedTx) await DB.delete('transactions', linkedTx.id);
        await DB.delete('expenses', id);
        Utils.toast('تم حذف المصروف وتحديث رصيد الحساب', 'success');
        render(container);
      } catch (err) {
        console.error('Expense delete failed:', err);
        Utils.toast('حدث خطأ أثناء الحذف: ' + err.message, 'error');
      }
    }

    async function openForm(id) {
      const e = id ? await DB.get('expenses', id) : {};
      Utils.openModal(id ? 'تعديل المصروف' : 'تسجيل مصروف جديد', `
        <form id="expense-form" class="form-grid">
          <label>الفئة
            <select name="category" class="input">${CATEGORIES.map(c => `<option ${e.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
          </label>
          <label>المبلغ *<input required type="number" name="amount" class="input" value="${Utils.esc(e.amount || '')}"></label>
          <label>يُخصم من حساب *
            <select required name="accountId" class="input">
              <option value="">اختر الحساب</option>
              ${accounts.map(a => `<option value="${a.id}" ${e.accountId === a.id ? 'selected' : ''}>${Utils.esc(a.name)}</option>`).join('')}
            </select>
          </label>
          <label>مرتبط بسيارة (اختياري)
            <select name="vehicleId" id="exp-vehicle" class="input">
              <option value="">— بدون —</option>
              ${vehicles.map(v => `<option value="${v.id}" ${e.vehicleId === v.id ? 'selected' : ''}>${Utils.esc(v.plate)} — ${Utils.esc(v.brand)} ${Utils.esc(v.model)}</option>`).join('')}
            </select>
          </label>
          <label>مرتبط بموظف (رواتب/عمولات — اختياري)
            <select name="employeeId" id="exp-employee" class="input">
              <option value="">— بدون —</option>
              ${employees.map(emp => `<option value="${emp.id}" ${e.employeeId === emp.id ? 'selected' : ''}>${Utils.esc(emp.name)} — ${Utils.esc(emp.role || '')}</option>`).join('')}
            </select>
          </label>
          <label class="span-2">ملاحظة<input name="note" class="input" value="${Utils.esc(e.note || '')}"></label>
          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">${id ? 'حفظ التعديلات' : 'حفظ المصروف'}</button>
          </div>
        </form>`, { size: 'md' });
      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      Utils.enhanceSearchableSelect(document.getElementById('exp-vehicle'), 'اكتب رقم اللوحة أو الماركة...');
      Utils.enhanceSearchableSelect(document.getElementById('exp-employee'), 'اكتب اسم الموظف...');
      document.getElementById('expense-form').onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = Object.fromEntries(new FormData(ev.target).entries());
        try {
          if (id) {
            fd.id = id;
            fd.date = e.date || new Date().toISOString();
            await DB.add('expenses', fd);
            // Keep the linked treasury transaction in sync with the edited amount/account.
            const txs = await DB.getAll('transactions');
            const linkedTx = txs.find(t => t.refType === 'expense' && t.refId === id);
            if (linkedTx) await DB.delete('transactions', linkedTx.id);
            if (fd.accountId) {
              await createTransaction({ accountId: fd.accountId, direction: 'out', amount: fd.amount, category: 'مصروف: ' + fd.category, refType: 'expense', refId: id, note: fd.note });
            }
            Utils.toast('تم تحديث المصروف وتصحيح رصيد الحساب', 'success');
          } else {
            fd.date = new Date().toISOString();
            const saved = await DB.add('expenses', fd);
            if (fd.accountId) {
              await createTransaction({ accountId: fd.accountId, direction: 'out', amount: fd.amount, category: 'مصروف: ' + fd.category, refType: 'expense', refId: saved.id, note: fd.note });
            }
            Utils.toast('تم تسجيل المصروف', 'success');
          }
          Utils.closeModal();
          render(container);
        } catch (err) {
          console.error('Expense save failed:', err);
          Utils.toast('حدث خطأ أثناء الحفظ: ' + err.message, 'error');
        }
      };
    }
  }

  return { render, CATEGORIES };
})();

window.ExpensesModule = ExpensesModule;
