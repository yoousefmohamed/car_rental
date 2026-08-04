'use strict';

const TreasuryModule = (() => {
  const TYPE = { cash: { label: 'خزينة نقدية', icon: '💵' }, wallet: { label: 'محفظة إلكترونية', icon: '📱' } };
  const CATEGORIES = ['إيراد عقد', 'مصروف', 'سلفة', 'إيداع شريك', 'سحب شريك', 'تحويل بين حسابات', 'أخرى'];

  async function render(container) {
    const [accounts, txs] = await Promise.all([DB.getAll('accounts'), DB.getAll('transactions')]);
    const balances = {};
    for (const a of accounts) balances[a.id] = await getAccountBalance(a.id);

    container.innerHTML = `
      <div class="page-head">
        <div><h2>الخزينة والمحافظ الإلكترونية</h2><p class="muted">إدارة الحسابات النقدية وسندات القبض والصرف</p></div>
        <div style="display:flex; gap:8px">
          <button class="btn btn-ghost" id="add-account-btn">+ حساب جديد</button>
          <button class="btn btn-primary" id="add-voucher-btn">+ سند قبض/صرف</button>
        </div>
      </div>

      <div class="stat-grid" id="accounts-grid" style="grid-template-columns:repeat(4,1fr)"></div>

      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>التاريخ</th><th>الحساب</th><th>النوع</th><th>الفئة</th><th>ملاحظة</th><th>المبلغ</th><th></th></tr></thead>
          <tbody id="tx-tbody"></tbody>
        </table>
        <div id="tx-empty" class="empty-state" style="display:none">لا توجد حركات مالية بعد</div>
      </div>
    `;

    const aMap = Object.fromEntries(accounts.map(a => [a.id, a]));
    const activeAccounts = accounts.filter(a => a.active !== '0');
    container.querySelector('#accounts-grid').innerHTML = accounts.length ? accounts.map(a => `
      <div class="stat-card stat-${a.active === '0' ? 'gray' : (balances[a.id] >= 0 ? 'green' : 'red')} account-card" data-id="${a.id}" style="cursor:pointer; position:relative">
        <div class="stat-icon">${TYPE[a.type]?.icon || '💰'}</div>
        <div>
          <div class="stat-value">${Utils.fmtMoney(balances[a.id])}</div>
          <div class="stat-label">${Utils.esc(a.name)} — ${TYPE[a.type]?.label || ''} ${a.active === '0' ? '(متوقف)' : ''}</div>
        </div>
        <div class="row-actions" style="position:absolute; top:8px; left:8px" onclick="event.stopPropagation()">
          <button class="icon-btn acc-edit-btn" data-id="${a.id}" title="تعديل">✎</button>
          <button class="icon-btn acc-del-btn" data-id="${a.id}" title="حذف/إيقاف">🗑</button>
        </div>
      </div>`).join('') : '<div class="empty-state">لا توجد حسابات — أضف خزينة أو محفظة إلكترونية أولاً</div>';

    container.querySelectorAll('.account-card').forEach(card => {
      card.addEventListener('click', () => openLedger(card.dataset.id));
    });
    container.querySelectorAll('.acc-edit-btn').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); openAccountForm(b.dataset.id); }));
    container.querySelectorAll('.acc-del-btn').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); removeAccount(b.dataset.id); }));

    const tbody = container.querySelector('#tx-tbody');
    const sorted = txs.filter(t => t._archived !== '1').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    tbody.innerHTML = sorted.map(t => `
      <tr>
        <td>${Utils.fmtDate(t.date)}</td>
        <td>${Utils.esc(aMap[t.accountId]?.name || '—')}</td>
        <td>${t.direction === 'in' ? '<span class="badge badge-green">قبض</span>' : '<span class="badge badge-red">صرف</span>'} ${t.refType && t.refType !== 'manual' ? `<span class="badge badge-gray" title="مرتبطة بسجل آخر">مرتبطة</span>` : ''}</td>
        <td>${Utils.esc(t.category)}</td>
        <td>${Utils.esc(t.note || '—')}</td>
        <td class="${t.direction === 'in' ? '' : 'text-danger'}">${t.direction === 'in' ? '+' : '-'} ${Utils.fmtMoney(t.amount)}</td>
        <td class="row-actions">
          <button class="icon-btn tx-edit-btn" data-id="${t.id}" title="تعديل">✎</button>
          <button class="icon-btn tx-archive-btn" data-id="${t.id}" title="أرشفة">🗄</button>
          <button class="icon-btn tx-del-btn" data-id="${t.id}" title="حذف">🗑</button>
        </td>
      </tr>`).join('');
    container.querySelector('#tx-empty').style.display = sorted.length ? 'none' : 'block';
    tbody.querySelectorAll('.tx-edit-btn').forEach(b => b.onclick = () => editTx(b.dataset.id));
    tbody.querySelectorAll('.tx-archive-btn').forEach(b => b.onclick = () => archiveTx(b.dataset.id));
    tbody.querySelectorAll('.tx-del-btn').forEach(b => b.onclick = () => deleteTx(b.dataset.id));

    container.querySelector('#add-account-btn').onclick = () => openAccountForm();
    container.querySelector('#add-voucher-btn').onclick = () => openVoucherForm(activeAccounts);

    async function openAccountForm(id) {
      const a = id ? await DB.get('accounts', id) : {};
      Utils.openModal(id ? 'تعديل الحساب' : 'حساب جديد (خزينة / محفظة)', `
        <form id="account-form" class="form-grid">
          <label>اسم الحساب *<input required name="name" class="input" placeholder="الخزينة الرئيسية / فودافون كاش" value="${Utils.esc(a.name || '')}"></label>
          <label>النوع
            <select name="type" class="input">
              <option value="cash" ${a.type !== 'wallet' ? 'selected' : ''}>خزينة نقدية</option>
              <option value="wallet" ${a.type === 'wallet' ? 'selected' : ''}>محفظة إلكترونية</option>
            </select>
          </label>
          ${!id ? `<label class="span-2">رصيد افتتاحي<input type="number" name="openingBalance" class="input" value="0"></label>` : `
          <label>الحالة
            <select name="active" class="input">
              <option value="1" ${a.active !== '0' ? 'selected' : ''}>نشط</option>
              <option value="0" ${a.active === '0' ? 'selected' : ''}>متوقف (لا يظهر عند إضافة سندات/عقود جديدة)</option>
            </select>
          </label>`}
          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">${id ? 'حفظ التعديلات' : 'إضافة'}</button>
          </div>
        </form>`, { size: 'sm' });
      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      document.getElementById('account-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target).entries());
        if (id) {
          fd.id = id;
          await DB.add('accounts', fd);
          Utils.toast('تم تحديث الحساب', 'success');
        } else {
          const acc = await DB.add('accounts', { name: fd.name, type: fd.type, active: '1' });
          if (Number(fd.openingBalance) > 0) {
            await createTransaction({ accountId: acc.id, direction: 'in', amount: fd.openingBalance, category: 'رصيد افتتاحي', refType: 'manual' });
          }
          Utils.toast('تم إضافة الحساب', 'success');
        }
        Utils.closeModal();
        render(container);
      };
    }

    async function removeAccount(id) {
      const blockReason = await accountDeleteBlockReason(id);
      const a = await DB.get('accounts', id);
      if (blockReason) {
        const choice = await Utils.choiceDialog(`${blockReason}.`, [
          { key: 'deactivate', label: '⏸ إيقاف الحساب', cls: 'btn-primary' },
          { key: 'cancel', label: 'إلغاء', cls: 'btn-ghost' },
        ]);
        if (choice === 'deactivate') { a.active = '0'; await DB.add('accounts', a); Utils.toast('تم إيقاف الحساب', 'success'); render(container); }
        return;
      }
      const ok = await Utils.confirmDialog(`لا توجد حركات على حساب "${a.name}" — هل تريد حذفه نهائيًا؟`);
      if (!ok) return;
      await DB.delete('accounts', id);
      Utils.toast('تم حذف الحساب', 'success');
      render(container);
    }

    async function editTx(txId, onDone) {
      const t = await DB.get('transactions', txId);
      if (t.refType && t.refType !== 'manual') {
        const ok = await Utils.confirmDialog('هذه الحركة مرتبطة بسجل آخر (مصروف/عقد/...) — تعديلها هنا لن يحدّث ذلك السجل تلقائيًا، وقد يسبب فرقًا بين البيانات. متابعة؟');
        if (!ok) return;
      }
      Utils.openModal('تعديل الحركة', `
        <form id="tx-edit-form" class="form-grid">
          <label>النوع
            <select name="direction" class="input">
              <option value="in" ${t.direction === 'in' ? 'selected' : ''}>سند قبض (وارد)</option>
              <option value="out" ${t.direction === 'out' ? 'selected' : ''}>سند صرف (منصرف)</option>
            </select>
          </label>
          <label>المبلغ *<input required type="number" name="amount" class="input" value="${Utils.esc(t.amount)}"></label>
          <label>الفئة<input name="category" class="input" value="${Utils.esc(t.category || '')}"></label>
          <label class="span-2">ملاحظة<input name="note" class="input" value="${Utils.esc(t.note || '')}"></label>
          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">حفظ التعديلات</button>
          </div>
        </form>`, { size: 'sm' });
      document.getElementById('cancel-btn').onclick = () => (onDone ? onDone() : Utils.closeModal());
      document.getElementById('tx-edit-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target).entries());
        await DB.add('transactions', { ...t, ...fd, id: txId, accountId: t.accountId });
        Utils.toast('تم تحديث الحركة', 'success');
        Utils.closeModal();
        if (onDone) onDone(); else render(container);
      };
    }

    async function archiveTx(txId, onDone) {
      const ok = await Utils.confirmDialog('أرشفة هذه الحركة؟ لن تُحتسب ضمن الرصيد الحالي بعد الأرشفة، وتبقى محفوظة في السجل ويمكن استعادتها.');
      if (!ok) return;
      await archiveRecord('transactions', txId);
      Utils.toast('تم أرشفة الحركة', 'success');
      if (onDone) onDone(); else render(container);
    }

    async function deleteTx(txId, onDone) {
      const t = await DB.get('transactions', txId);
      const msg = t.refType && t.refType !== 'manual'
        ? 'هذه الحركة مرتبطة بسجل آخر (مصروف/عقد/...) — حذفها من هنا لن يحذف أو يحدّث ذلك السجل، وقد يسبب فرقًا بين البيانات. يمكنك استعادتها لاحقًا من سلة المحذوفات. متابعة؟'
        : 'هل تريد حذف هذه الحركة؟ يمكن استعادتها لاحقًا من سلة المحذوفات.';
      const ok = await Utils.confirmDialog(msg);
      if (!ok) return;
      await DB.delete('transactions', txId);
      Utils.toast('تم حذف الحركة', 'success');
      if (onDone) onDone(); else render(container);
    }

    async function openLedger(accountId) {
      let showArchivedTx = false;

      async function draw() {
        const a = await DB.get('accounts', accountId);
        const balance = await getAccountBalance(accountId);
        const all = await DB.getAllByIndex('transactions', 'accountId', accountId);
        const list = all.filter(t => showArchivedTx ? t._archived === '1' : t._archived !== '1')
          .sort((x, y) => (x.date || '').localeCompare(y.date || ''));
        let running = 0;
        const rows = list.map(t => {
          if (t._archived !== '1') running += t.direction === 'in' ? Number(t.amount) : -Number(t.amount);
          return { ...t, running };
        }).reverse();

        Utils.openModal(`سجل حركات: ${Utils.esc(a?.name || '')}`, `
          <div class="stat-mini-row">
            <div class="stat-mini"><span>الرصيد الحالي</span><strong>${Utils.fmtMoney(balance)}</strong></div>
            <div class="stat-mini"><span>عدد الحركات</span><strong>${list.length}</strong></div>
          </div>
          <div class="toolbar" style="margin-bottom:10px">
            <button class="btn btn-ghost" id="ledger-toggle-archived">${showArchivedTx ? '🔄 عرض النشطة' : '📦 عرض الأرشيف'}</button>
          </div>
          <div class="table-wrap" style="max-height:380px; overflow:auto">
            <table class="table table-compact">
              <thead><tr><th>التاريخ</th><th>النوع</th><th>الفئة</th><th>ملاحظة</th><th>المبلغ</th>${!showArchivedTx ? '<th>الرصيد بعدها</th>' : ''}<th></th></tr></thead>
              <tbody id="ledger-tbody">
                ${rows.length ? rows.map(t => `
                  <tr>
                    <td>${Utils.fmtDate(t.date)}</td>
                    <td>${t.direction === 'in' ? '<span class="badge badge-green">قبض</span>' : '<span class="badge badge-red">صرف</span>'} ${t.refType && t.refType !== 'manual' ? `<span class="badge badge-gray" title="مرتبطة بسجل آخر">مرتبطة</span>` : ''}</td>
                    <td>${Utils.esc(t.category)}</td>
                    <td>${Utils.esc(t.note || '—')}</td>
                    <td class="${t.direction === 'in' ? '' : 'text-danger'}">${t.direction === 'in' ? '+' : '-'} ${Utils.fmtMoney(t.amount)}</td>
                    ${!showArchivedTx ? `<td>${Utils.fmtMoney(t.running)}</td>` : ''}
                    <td class="row-actions">
                      ${!showArchivedTx ? `
                        <button class="icon-btn ledger-edit-btn" data-id="${t.id}" title="تعديل">✎</button>
                        <button class="icon-btn ledger-archive-btn" data-id="${t.id}" title="أرشفة">🗄</button>
                        <button class="icon-btn ledger-del-btn" data-id="${t.id}" title="حذف">🗑</button>
                      ` : `<button class="icon-btn ledger-restore-btn" data-id="${t.id}" title="استعادة">♻️</button>`}
                    </td>
                  </tr>`).join('') : `<tr><td colspan="7" class="muted">${showArchivedTx ? 'لا توجد حركات مؤرشفة' : 'لا توجد حركات على هذا الحساب بعد'}</td></tr>`}
              </tbody>
            </table>
          </div>
          <div class="modal-actions"><button type="button" class="btn btn-ghost" id="ledger-print-btn">🖨 طباعة</button></div>
        `, { size: 'lg' });

        document.getElementById('ledger-print-btn').onclick = () => window.print();
        document.getElementById('ledger-toggle-archived').onclick = () => { showArchivedTx = !showArchivedTx; draw(); };
        const refresh = () => { draw(); render(container); };
        document.querySelectorAll('.ledger-edit-btn').forEach(b => b.onclick = () => editTx(b.dataset.id, refresh));
        document.querySelectorAll('.ledger-archive-btn').forEach(b => b.onclick = () => archiveTx(b.dataset.id, refresh));
        document.querySelectorAll('.ledger-del-btn').forEach(b => b.onclick = () => deleteTx(b.dataset.id, refresh));
        document.querySelectorAll('.ledger-restore-btn').forEach(b => b.onclick = async () => {
          await restoreRecord('transactions', b.dataset.id);
          Utils.toast('تم استعادة الحركة', 'success');
          refresh();
        });
      }

      draw();
    }

    function openVoucherForm(accountsList) {
      if (!accountsList.length) { Utils.toast('لا توجد حسابات نشطة — أضف حساباً أولاً', 'error'); return; }
      Utils.openModal('سند قبض / صرف', `
        <form id="voucher-form" class="form-grid">
          <label>النوع
            <select name="direction" class="input">
              <option value="in">سند قبض (وارد)</option>
              <option value="out">سند صرف (منصرف)</option>
            </select>
          </label>
          <label>الحساب *
            <select required name="accountId" class="input">
              ${accountsList.map(a => `<option value="${a.id}">${Utils.esc(a.name)}</option>`).join('')}
            </select>
          </label>
          <label>الفئة
            <select name="category" class="input">${CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select>
          </label>
          <label>المبلغ *<input required type="number" name="amount" class="input"></label>
          <label class="span-2">ملاحظة<input name="note" class="input"></label>
          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">حفظ السند</button>
          </div>
        </form>`, { size: 'sm' });
      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      document.getElementById('voucher-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target).entries());
        await createTransaction(fd);
        Utils.toast('تم حفظ السند', 'success');
        Utils.closeModal();
        render(container);
      };
    }
  }

  return { render, TYPE };
})();

window.TreasuryModule = TreasuryModule;
