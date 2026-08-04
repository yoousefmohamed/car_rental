'use strict';

const PartnersModule = (() => {
  async function balanceOf(partnerId, txs) {
    return txs.filter(t => t.partnerId === partnerId)
      .reduce((s, t) => s + (t.type === 'contribution' ? Number(t.amount) : -Number(t.amount)), 0);
  }

  async function render(container) {
    const [partners, txs] = await Promise.all([DB.getAll('partners'), DB.getAll('partnerTx')]);

    const rows = await Promise.all(partners.map(async p => ({ p, balance: await balanceOf(p.id, txs) })));

    container.innerHTML = `
      <div class="page-head">
        <div><h2>حسابات الشركاء</h2><p class="muted">رأس المال، الإيداعات، السحوبات، ونسب الأرباح</p></div>
        <div style="display:flex; gap:8px">
          <button class="btn btn-ghost" id="add-partner-btn">+ شريك جديد</button>
          <button class="btn btn-primary" id="add-ptx-btn">+ حركة إيداع/سحب</button>
        </div>
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>الشريك</th><th>نسبة الملكية</th><th>رصيد الحساب الحالي</th><th></th></tr></thead>
          <tbody id="partners-tbody"></tbody>
        </table>
        <div id="partners-empty" class="empty-state" style="display:none">لا يوجد شركاء بعد</div>
      </div>
    `;

    const tbody = container.querySelector('#partners-tbody');
    tbody.innerHTML = rows.map(({ p, balance }) => `
      <tr>
        <td><strong>${Utils.esc(p.name)}</strong></td>
        <td>${Utils.esc(p.sharePercent || 0)}%</td>
        <td class="${balance < 0 ? 'text-danger' : ''}">${Utils.fmtMoney(balance)}</td>
        <td class="row-actions">
          <button class="icon-btn hist-btn" data-id="${p.id}" title="سجل الحركات">📄</button>
          <button class="icon-btn edit-btn" data-id="${p.id}" title="تعديل">✎</button>
          <button class="icon-btn del-btn" data-id="${p.id}" title="حذف">🗑</button>
        </td>
      </tr>`).join('');
    container.querySelector('#partners-empty').style.display = rows.length ? 'none' : 'block';
    tbody.querySelectorAll('.del-btn').forEach(b => b.onclick = () => remove(b.dataset.id));
    tbody.querySelectorAll('.edit-btn').forEach(b => b.onclick = () => openPartnerForm(b.dataset.id));
    tbody.querySelectorAll('.hist-btn').forEach(b => b.onclick = () => showHistory(b.dataset.id));

    container.querySelector('#add-partner-btn').onclick = () => openPartnerForm();
    container.querySelector('#add-ptx-btn').onclick = () => openTxForm();

    async function remove(id) {
      const hasTx = txs.some(t => t.partnerId === id);
      const ok = await Utils.confirmDialog(hasTx
        ? 'يوجد حركات إيداع/سحب مسجّلة لهذا الشريك — حذفه سيُبقي حركاته المالية بدون شريك مرتبط بها. هل تريد المتابعة؟'
        : 'هل تريد حذف هذا الشريك؟');
      if (!ok) return;
      await DB.delete('partners', id);
      Utils.toast('تم الحذف', 'success');
      render(container);
    }

    async function showHistory(id) {
      const p = partners.find(x => x.id === id);
      const list = txs.filter(t => t.partnerId === id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      Utils.openModal(`سجل حركات: ${Utils.esc(p.name)}`, `
        <table class="table">
          <thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th></tr></thead>
          <tbody>
            ${list.length ? list.map(t => `
              <tr>
                <td>${Utils.fmtDate(t.date)}</td>
                <td>${t.type === 'contribution' ? '<span class="badge badge-green">إيداع</span>' : '<span class="badge badge-red">سحب</span>'}</td>
                <td>${Utils.fmtMoney(t.amount)}</td>
                <td>${Utils.esc(t.note || '—')}</td>
              </tr>`).join('') : '<tr><td colspan="4" class="muted">لا توجد حركات</td></tr>'}
          </tbody>
        </table>`, { size: 'md' });
    }

    function openPartnerForm(id) {
      const p = id ? partners.find(x => x.id === id) : {};
      Utils.openModal(id ? 'تعديل بيانات الشريك' : 'شريك جديد', `
        <form id="partner-form" class="form-grid">
          <label>الاسم *<input required name="name" class="input" value="${Utils.esc(p.name || '')}"></label>
          <label>نسبة الملكية %<input type="number" name="sharePercent" class="input" value="${Utils.esc(p.sharePercent || 0)}"></label>
          <label class="span-2">ملاحظات<textarea name="notes" class="input" rows="2">${Utils.esc(p.notes || '')}</textarea></label>
          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">${id ? 'حفظ التعديلات' : 'إضافة'}</button>
          </div>
        </form>`, { size: 'sm' });
      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      document.getElementById('partner-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target).entries());
        if (id) fd.id = id;
        await DB.add('partners', fd);
        Utils.toast(id ? 'تم تحديث بيانات الشريك' : 'تمت إضافة الشريك', 'success');
        Utils.closeModal();
        render(container);
      };
    }

    async function openTxForm() {
      const accounts = await DB.getAll('accounts');
      Utils.openModal('حركة إيداع / سحب شريك', `
        <form id="ptx-form" class="form-grid">
          <label>الشريك *
            <select required name="partnerId" class="input">
              <option value="">اختر الشريك</option>
              ${partners.map(p => `<option value="${p.id}">${Utils.esc(p.name)}</option>`).join('')}
            </select>
          </label>
          <label>النوع
            <select name="type" class="input">
              <option value="contribution">إيداع (زيادة رأس المال)</option>
              <option value="withdrawal">سحب</option>
            </select>
          </label>
          <label>المبلغ *<input required type="number" name="amount" class="input"></label>
          <label>حساب الخزينة المرتبط
            <select name="accountId" class="input">
              <option value="">— بدون ربط —</option>
              ${accounts.map(a => `<option value="${a.id}">${Utils.esc(a.name)}</option>`).join('')}
            </select>
          </label>
          <label class="span-2">ملاحظة<input name="note" class="input"></label>
          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">حفظ</button>
          </div>
        </form>`, { size: 'md' });
      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      document.getElementById('ptx-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target).entries());
        fd.date = new Date().toISOString();
        await DB.add('partnerTx', fd);
        if (fd.accountId) {
          await createTransaction({
            accountId: fd.accountId,
            direction: fd.type === 'contribution' ? 'in' : 'out',
            amount: fd.amount,
            category: fd.type === 'contribution' ? 'إيداع شريك' : 'سحب شريك',
            refType: 'partner', note: fd.note,
          });
        }
        Utils.toast('تم حفظ الحركة', 'success');
        Utils.closeModal();
        render(container);
      };
    }
  }

  return { render };
})();

window.PartnersModule = PartnersModule;
