'use strict';

const CustomersModule = (() => {
  let showArchived = false;

  async function render(container, query = {}) {
    const all = await DB.getAll('customers');
    all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const customers = all.filter(c => showArchived ? c._archived === '1' : c._archived !== '1');

    container.innerHTML = `
      <div class="page-head">
        <div>
          <h2>العملاء</h2>
          <p class="muted">بيانات العملاء، الرخص، وسجل التعاملات</p>
        </div>
        <div style="display:flex; gap:8px">
          <button class="btn btn-ghost" id="toggle-archived-btn">${showArchived ? '👥 عرض النشطين' : '📦 عرض الأرشيف'}</button>
          <button class="btn btn-primary" id="add-customer-btn">+ إضافة عميل</button>
        </div>
      </div>

      <div class="toolbar">
        <input type="text" id="customer-search" placeholder="بحث بالاسم، الهاتف، الرقم القومي..." class="input" />
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>الاسم</th><th>الهاتف</th><th>الرقم القومي / الجواز</th><th>رخصة القيادة</th><th>تنتهي في</th><th>التقييم</th><th></th></tr>
          </thead>
          <tbody id="customers-tbody"></tbody>
        </table>
        <div id="customers-empty" class="empty-state" style="display:none">لا يوجد عملاء بعد — أضف أول عميل</div>
        <div id="customers-pagination"></div>
      </div>
    `;

    const tbody = container.querySelector('#customers-tbody');
    const PAGE_SIZE = 25;
    let currentPage = 1;

    function licenseWarn(exp) {
      if (!exp) return '';
      const days = Math.ceil((new Date(exp) - new Date()) / 86400000);
      if (days < 0) return '<span class="badge badge-red">منتهية</span>';
      if (days <= 30) return '<span class="badge badge-orange">قريباً</span>';
      return '';
    }

    function draw(list) {
      const { items, page, totalPages, total } = Utils.paginate(list, currentPage, PAGE_SIZE);
      currentPage = page;
      tbody.innerHTML = items.map(c => `
        <tr>
          <td><strong>${Utils.esc(c.name)}</strong> ${c.blacklisted === '1' ? '<span class="badge badge-red">🚫 قائمة سوداء</span>' : ''}</td>
          <td>${Utils.esc(c.phone || '—')}</td>
          <td>${Utils.esc(c.nationalId || c.passportNo || '—')}</td>
          <td>${Utils.esc(c.licenseNo || '—')}</td>
          <td>${Utils.fmtDate(c.licenseExpiry)} ${licenseWarn(c.licenseExpiry)}</td>
          <td>${'★'.repeat(Number(c.rating || 0))}${'☆'.repeat(5 - Number(c.rating || 0))}</td>
          <td class="row-actions">
            <button class="icon-btn hist-btn" data-id="${c.id}" title="كشف الحساب">📄</button>
            ${!showArchived ? `<button class="icon-btn edit-btn" data-id="${c.id}" title="تعديل">✎</button>` : ''}
            ${showArchived
              ? `<button class="icon-btn restore-btn" data-id="${c.id}" title="استعادة">♻️</button>`
              : `<button class="icon-btn del-btn" data-id="${c.id}" title="حذف">🗑</button>`}
          </td>
        </tr>
      `).join('');
      container.querySelector('#customers-empty').style.display = list.length ? 'none' : 'block';
      Utils.renderPagination(container.querySelector('#customers-pagination'), { page, totalPages, total }, (p) => { currentPage = p; draw(list); });
      tbody.querySelectorAll('.edit-btn').forEach(b => b.onclick = () => openForm(b.dataset.id));
      tbody.querySelectorAll('.del-btn').forEach(b => b.onclick = () => remove(b.dataset.id));
      tbody.querySelectorAll('.restore-btn').forEach(b => b.onclick = async () => {
        await restoreRecord('customers', b.dataset.id);
        Utils.toast('تم استعادة العميل', 'success');
        render(container);
      });
      tbody.querySelectorAll('.hist-btn').forEach(b => b.onclick = () => showStatement(b.dataset.id));
    }

    function applyFilters() {
      currentPage = 1;
      const q = container.querySelector('#customer-search').value.trim().toLowerCase();
      const list = !q ? customers : customers.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q) ||
        (c.nationalId || '').includes(q)
      );
      draw(list);
    }
    container.querySelector('#customer-search').addEventListener('input', Utils.debounce(applyFilters, 150));

    container.querySelector('#add-customer-btn').onclick = () => openForm(null);
    container.querySelector('#toggle-archived-btn').onclick = () => { showArchived = !showArchived; render(container); };

    if (query.q) {
      container.querySelector('#customer-search').value = query.q;
      applyFilters();
    } else {
      draw(customers);
    }

    async function remove(id) {
      const blockReason = await customerDeleteBlockReason(id);
      if (blockReason) {
        const choice = await Utils.choiceDialog(`لا يمكن حذف العميل نهائيًا: ${blockReason}. يمكنك أرشفته بدلاً من ذلك.`, [
          { key: 'archive', label: '📦 أرشفة العميل', cls: 'btn-primary' },
          { key: 'cancel', label: 'إلغاء', cls: 'btn-ghost' },
        ]);
        if (choice === 'archive') { await archiveRecord('customers', id); Utils.toast('تم أرشفة العميل', 'success'); render(container); }
        return;
      }
      const choice = await Utils.choiceDialog('كيف تريد إزالة هذا العميل من القوائم النشطة؟', [
        { key: 'archive', label: '📦 أرشفة (يحتفظ بسجله ويمكن استعادته)', cls: 'btn-primary' },
        { key: 'delete', label: '🗑 حذف نهائي', cls: 'btn-danger' },
        { key: 'cancel', label: 'إلغاء', cls: 'btn-ghost' },
      ]);
      if (choice === 'archive') { await archiveRecord('customers', id); Utils.toast('تم أرشفة العميل', 'success'); render(container); }
      else if (choice === 'delete') { await DB.delete('customers', id); Utils.toast('تم حذف العميل نهائيًا', 'success'); render(container); }
    }

    async function buildStatementData(id) {
      const [contracts, bookings, incidents, transactions, settings] = await Promise.all([
        DB.getAll('contracts'), DB.getAll('bookings'), DB.getAll('incidents'), DB.getAll('transactions'), getSettings()
      ]);
      const customer = all.find(c => c.id === id) || await DB.get('customers', id);
      const cContracts = contracts.filter(c => c.customerId === id).sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
      const cBookings = bookings.filter(b => b.customerId === id);
      const cIncidents = incidents.filter(i => i.customerId === id);
      const contractIds = new Set(cContracts.map(c => c.id));
      const cPayments = transactions.filter(t => t.refType === 'contract' && contractIds.has(t.refId)).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const unpaidViolations = cIncidents.filter(i => i.type === 'violation' && i.status !== 'paid');
      const totalCharges = cContracts.reduce((s, c) => s + Number(c.totalAmount || 0), 0);
      const totalPaid = cContracts.reduce((s, c) => s + Number(c.paidAmount || 0), 0);
      const totalDue = cContracts.reduce((s, c) => s + Math.max(0, Number(c.totalAmount || 0) - Number(c.paidAmount || 0)), 0)
        + unpaidViolations.reduce((s, v) => s + Number(v.amount || 0), 0);
      return { customer, cContracts, cBookings, cIncidents, cPayments, unpaidViolations, totalCharges, totalPaid, totalDue, settings };
    }

    async function showStatement(id) {
      const { customer, cContracts, cBookings, cIncidents, cPayments, totalCharges, totalPaid, totalDue } = await buildStatementData(id);

      Utils.openModal(`كشف حساب — ${Utils.esc(customer?.name || '')}`, `
        <div class="stat-mini-row">
          <div class="stat-mini"><span>عدد الحجوزات</span><strong>${cBookings.length}</strong></div>
          <div class="stat-mini"><span>عدد العقود</span><strong>${cContracts.length}</strong></div>
          <div class="stat-mini"><span>إجمالي المستحق</span><strong>${Utils.fmtMoney(totalCharges)}</strong></div>
          <div class="stat-mini"><span>إجمالي المدفوع</span><strong>${Utils.fmtMoney(totalPaid)}</strong></div>
          <div class="stat-mini"><span>الرصيد الحالي (متبقي)</span><strong class="${totalDue > 0 ? 'text-danger' : ''}">${Utils.fmtMoney(totalDue)}</strong></div>
        </div>
        <div class="form-section-title">العقود والفواتير</div>
        <table class="table">
          <thead><tr><th>رقم العقد</th><th>من</th><th>إلى</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead>
          <tbody>
            ${cContracts.length ? cContracts.map(c => `
              <tr>
                <td>${Utils.esc(c.contractNo)}</td>
                <td>${Utils.fmtDate(c.startDate)}</td>
                <td>${Utils.fmtDate(c.endDate)}</td>
                <td>${Utils.fmtMoney(c.totalAmount)}</td>
                <td>${Utils.fmtMoney(c.paidAmount)}</td>
                <td class="${(Number(c.totalAmount||0)-Number(c.paidAmount||0))>0 ? 'text-danger' : ''}">${Utils.fmtMoney(Number(c.totalAmount||0)-Number(c.paidAmount||0))}</td>
                <td>${Utils.esc(ContractsModule.STATUS[c.status]?.label || c.status)}</td>
              </tr>`).join('') : '<tr><td colspan="7" class="muted">لا يوجد عقود بعد</td></tr>'}
          </tbody>
        </table>
        ${cPayments.length ? `
        <div class="form-section-title" style="margin-top:14px">حركات الدفع</div>
        <table class="table">
          <thead><tr><th>التاريخ</th><th>البيان</th><th>المبلغ</th></tr></thead>
          <tbody>
            ${cPayments.map(t => `<tr><td>${Utils.fmtDate(t.date)}</td><td>${Utils.esc(t.note || t.category)}</td><td>${Utils.fmtMoney(t.amount)}</td></tr>`).join('')}
          </tbody>
        </table>` : ''}
        ${cIncidents.length ? `
          <div class="form-section-title" style="margin-top:14px">الحوادث والمخالفات</div>
          <table class="table">
            <thead><tr><th>النوع</th><th>التاريخ</th><th>التفاصيل</th><th>المبلغ</th><th>الحالة</th></tr></thead>
            <tbody>
              ${cIncidents.map(i => `
                <tr>
                  <td>${i.type === 'accident' ? 'حادث' : 'مخالفة'}</td>
                  <td>${Utils.fmtDate(i.date)}</td>
                  <td>${Utils.esc(i.type === 'accident' ? (i.description || '—') : (i.violationType || '—'))}</td>
                  <td>${Utils.fmtMoney(i.type === 'accident' ? (Number(i.compensationAmount||0) - Number(i.deductibleAmount||0)) : i.amount)}</td>
                  <td>${Utils.esc((IncidentsModule.ACC_STATUS[i.status] || IncidentsModule.VIO_STATUS[i.status] || {}).label || i.status)}</td>
                </tr>`).join('')}
            </tbody>
          </table>` : ''}
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="stmt-wa-btn">💬 إرسال عبر واتساب</button>
          <button type="button" class="btn btn-primary" id="stmt-print-btn">🖨 طباعة / حفظ PDF</button>
        </div>
      `, { size: 'lg' });

      document.getElementById('stmt-print-btn').onclick = () => printStatement(id);
      document.getElementById('stmt-wa-btn').onclick = async () => {
        const msg = `مرحباً ${customer?.name || ''}، كشف حساب سريع معكم:\n- إجمالي المستحق: ${Utils.fmtMoney(totalCharges)}\n- إجمالي المدفوع: ${Utils.fmtMoney(totalPaid)}\n- المتبقي عليكم: ${Utils.fmtMoney(totalDue)}\nلمزيد من التفاصيل يمكننا إرسال كشف الحساب الكامل بصيغة PDF. شكراً لتعاملكم معنا.`;
        Utils.openWhatsApp(customer?.phone, msg);
      };
    }

    async function printStatement(id) {
      const { customer, cContracts, cPayments, cIncidents, totalCharges, totalPaid, totalDue, settings } = await buildStatementData(id);
      const win = window.open('', '_blank', 'width=900,height=1000');
      win.document.write(`
        <!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
        <title>كشف حساب — ${Utils.esc(customer?.name || '')}</title>
        <style>
          body { font-family: 'Tahoma', Arial, sans-serif; padding: 30px; color: #1a1a1a; }
          h1 { text-align:center; font-size: 20px; margin-bottom: 4px; }
          .sub { text-align:center; color:#555; margin-bottom: 20px; }
          table { width:100%; border-collapse: collapse; margin-bottom: 18px; }
          td, th { border: 1px solid #ccc; padding: 6px 10px; font-size: 13px; text-align: right; }
          th { background: #f2f2f2; }
          .totals { margin-top: 6px; width: 320px; margin-inline-start: auto; }
          .totals td { border: none; padding: 3px 10px; }
          .totals .grand { font-weight:bold; font-size: 15px; border-top: 2px solid #333; }
          .section-title { font-weight:bold; margin: 16px 0 8px; font-size: 14px; }
        </style></head><body>
        <h1>${Utils.esc(settings.companyName)}</h1>
        <div class="sub">${Utils.esc(settings.phone || '')} ${settings.address ? ' — ' + Utils.esc(settings.address) : ''}</div>
        <h1 style="font-size:16px; margin-top:14px">كشف حساب عميل</h1>
        <div class="sub">العميل: ${Utils.esc(customer?.name || '—')} — الهاتف: ${Utils.esc(customer?.phone || '—')} — تاريخ الكشف: ${Utils.fmtDate(new Date().toISOString())}</div>

        <div class="section-title">العقود والفواتير</div>
        <table>
          <tr><th>رقم العقد</th><th>من</th><th>إلى</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr>
          ${cContracts.map(c => `
            <tr>
              <td>${Utils.esc(c.contractNo)}</td><td>${Utils.fmtDate(c.startDate)}</td><td>${Utils.fmtDate(c.endDate)}</td>
              <td>${Utils.fmtMoney(c.totalAmount)}</td><td>${Utils.fmtMoney(c.paidAmount)}</td>
              <td>${Utils.fmtMoney(Number(c.totalAmount||0)-Number(c.paidAmount||0))}</td>
              <td>${Utils.esc(ContractsModule.STATUS[c.status]?.label || c.status)}</td>
            </tr>`).join('') || '<tr><td colspan="7">لا يوجد عقود</td></tr>'}
        </table>

        ${cPayments.length ? `
        <div class="section-title">حركات الدفع</div>
        <table>
          <tr><th>التاريخ</th><th>البيان</th><th>المبلغ</th></tr>
          ${cPayments.map(t => `<tr><td>${Utils.fmtDate(t.date)}</td><td>${Utils.esc(t.note || t.category)}</td><td>${Utils.fmtMoney(t.amount)}</td></tr>`).join('')}
        </table>` : ''}

        ${cIncidents.length ? `
        <div class="section-title">الحوادث والمخالفات</div>
        <table>
          <tr><th>النوع</th><th>التاريخ</th><th>التفاصيل</th><th>المبلغ</th><th>الحالة</th></tr>
          ${cIncidents.map(i => `
            <tr>
              <td>${i.type === 'accident' ? 'حادث' : 'مخالفة'}</td><td>${Utils.fmtDate(i.date)}</td>
              <td>${Utils.esc(i.type === 'accident' ? (i.description || '—') : (i.violationType || '—'))}</td>
              <td>${Utils.fmtMoney(i.type === 'accident' ? (Number(i.compensationAmount||0) - Number(i.deductibleAmount||0)) : i.amount)}</td>
              <td>${Utils.esc((IncidentsModule.ACC_STATUS[i.status] || IncidentsModule.VIO_STATUS[i.status] || {}).label || i.status)}</td>
            </tr>`).join('')}
        </table>` : ''}

        <table class="totals">
          <tr><td>إجمالي المستحق</td><td>${Utils.fmtMoney(totalCharges)}</td></tr>
          <tr><td>إجمالي المدفوع</td><td>${Utils.fmtMoney(totalPaid)}</td></tr>
          <tr class="grand"><td>الرصيد الحالي (متبقي على العميل)</td><td>${Utils.fmtMoney(totalDue)}</td></tr>
        </table>

        <script>window.onload = () => window.print();</script>
        </body></html>
      `);
      win.document.close();
    }

    async function openForm(id) {
      const c = id ? await DB.get('customers', id) : {};
      Utils.openModal(id ? 'تعديل بيانات العميل' : 'إضافة عميل جديد', `
        <form id="customer-form" class="form-grid">
          <label>الاسم بالكامل *<input required name="name" class="input" value="${Utils.esc(c.name || '')}"></label>
          <label>رقم الهاتف *<input required name="phone" class="input" value="${Utils.esc(c.phone || '')}"></label>
          <label>البريد الإلكتروني<input name="email" type="email" class="input" value="${Utils.esc(c.email || '')}"></label>
          <label>الرقم القومي<input name="nationalId" class="input" value="${Utils.esc(c.nationalId || '')}"></label>
          <label>رقم جواز السفر<input name="passportNo" class="input" value="${Utils.esc(c.passportNo || '')}"></label>
          <label>الجنسية<input name="nationality" class="input" value="${Utils.esc(c.nationality || '')}"></label>
          <label>رقم رخصة القيادة<input name="licenseNo" class="input" value="${Utils.esc(c.licenseNo || '')}"></label>
          <label>تاريخ انتهاء الرخصة<input name="licenseExpiry" type="date" class="input" value="${Utils.esc((c.licenseExpiry || '').slice(0,10))}"></label>
          <label>جهة العمل<input name="employer" class="input" value="${Utils.esc(c.employer || '')}"></label>
          <label>الضامن<input name="guarantor" class="input" value="${Utils.esc(c.guarantor || '')}"></label>
          <label class="span-2">العنوان<input name="address" class="input" value="${Utils.esc(c.address || '')}"></label>
          <label>التقييم
            <select name="rating" class="input">
              ${[5,4,3,2,1,0].map(n => `<option value="${n}" ${String(c.rating) === String(n) ? 'selected' : ''}>${n} نجوم</option>`).join('')}
            </select>
          </label>
          <label>الحالة
            <select name="blacklisted" class="input">
              <option value="0" ${c.blacklisted !== '1' ? 'selected' : ''}>عادي</option>
              <option value="1" ${c.blacklisted === '1' ? 'selected' : ''}>🚫 قائمة سوداء (لا يُنصح بالتعامل)</option>
            </select>
          </label>
          <label class="span-2">ملاحظات<textarea name="notes" class="input" rows="2">${Utils.esc(c.notes || '')}</textarea></label>

          <div class="form-section-title">صورة الهوية / الرخصة</div>
          <div class="span-2" id="customer-doc-uploader"></div>

          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">${id ? 'حفظ التعديلات' : 'إضافة العميل'}</button>
          </div>
        </form>
      `, { size: 'lg' });

      let docPhoto = c.docPhoto || null;
      Utils.renderPhotoUploader(
        document.getElementById('customer-doc-uploader'),
        'صورة الرقم القومي أو رخصة القيادة (اختياري)', docPhoto, (val) => { docPhoto = val; }
      );

      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      const form = document.getElementById('customer-form');
      form.onsubmit = async (e) => {
        e.preventDefault();
        const obj = Object.fromEntries(new FormData(form).entries());
        if (id) obj.id = id;
        obj.docPhoto = docPhoto;
        await DB.add('customers', obj);
        Utils.toast(id ? 'تم تحديث بيانات العميل' : 'تمت إضافة العميل بنجاح', 'success');
        Utils.closeModal();
        render(container);
      };
    }
  }

  return { render };
})();

window.CustomersModule = CustomersModule;
