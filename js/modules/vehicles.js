'use strict';

const VehiclesModule = (() => {
  const STATUS = {
    available:      { label: 'متاحة',        cls: 'green' },
    rented:         { label: 'مؤجرة',        cls: 'blue' },
    reserved:       { label: 'محجوزة',       cls: 'purple' },
    maintenance:    { label: 'تحت الصيانة',  cls: 'orange' },
    out_of_service: { label: 'خارج الخدمة',  cls: 'red' },
  };

  let showArchived = false;

  /** Checks a vehicle's document expiry dates and returns the most urgent
   *  status: expired (red), expiring within 30 days (orange), or fine (null). */
  function docStatus(v) {
    const fields = [
      ['licenseExpiry', 'رخصة السيارة'],
      ['insuranceExpiry', 'التأمين'],
      ['inspectionExpiry', 'الفحص الدوري'],
    ];
    const today = new Date();
    const in30 = new Date(); in30.setDate(today.getDate() + 30);
    let worst = null;
    fields.forEach(([key, label]) => {
      if (!v[key]) return;
      const d = new Date(v[key]);
      if (d < today) worst = { level: 'expired', text: `${label} منتهي` };
      else if (d <= in30 && (!worst || worst.level !== 'expired')) worst = { level: 'soon', text: `${label} قريب الانتهاء` };
    });
    return worst;
  }

  async function render(container, query = {}) {
    const all = await DB.getAll('vehicles');
    all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const vehicles = all.filter(v => showArchived ? v._archived === '1' : v._archived !== '1');

    container.innerHTML = `
      <div class="page-head">
        <div>
          <h2>العربيات</h2>
          <p class="muted">إدارة السيارات: الإضافة، التعديل، الحالة، والأسعار</p>
        </div>
        <div style="display:flex; gap:8px">
          <button class="btn btn-ghost" id="toggle-archived-btn">${showArchived ? '🚗 عرض النشطة' : '📦 عرض الأرشيف'}</button>
          <button class="btn btn-primary" id="add-vehicle-btn">+ إضافة سيارة</button>
        </div>
      </div>

      <div class="toolbar">
        <input type="text" id="vehicle-search" placeholder="بحث برقم اللوحة، الماركة، الموديل..." class="input" />
        <select id="vehicle-status-filter" class="input">
          <option value="">كل الحالات</option>
          ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
        </select>
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th></th><th>اللوحة</th><th>الماركة / الموديل</th><th>الفئة</th>
              <th>الحالة</th><th>سعر يومي</th><th>الكيلومترات</th><th>الوثائق</th><th></th>
            </tr>
          </thead>
          <tbody id="vehicles-tbody"></tbody>
        </table>
        <div id="vehicles-empty" class="empty-state" style="display:none">لا توجد سيارات — ابدأ بإضافة أول سيارة</div>
        <div id="vehicles-pagination"></div>
      </div>
    `;

    const tbody = container.querySelector('#vehicles-tbody');
    const PAGE_SIZE = 25;
    let currentPage = 1;

    function draw(list) {
      const { items, page, totalPages, total } = Utils.paginate(list, currentPage, PAGE_SIZE);
      currentPage = page;
      tbody.innerHTML = items.map(v => `
        <tr>
          <td>${v.photo ? `<img src="${v.photo}" class="row-thumb" alt="">` : `<span class="row-thumb-empty">🚗</span>`}</td>
          <td><strong>${Utils.esc(v.plate)}</strong></td>
          <td>${Utils.esc(v.brand)} ${Utils.esc(v.model)}</td>
          <td>${Utils.esc(v.category || '—')}</td>
          <td>${Utils.statusBadge(v.status, STATUS)}</td>
          <td>${Utils.fmtMoney(v.dailyRate)}</td>
          <td>${(v.odometer || 0).toLocaleString('ar-EG')} كم</td>
          <td>${docStatus(v) ? `<span class="badge badge-${docStatus(v).level === 'expired' ? 'red' : 'orange'}" title="${Utils.esc(docStatus(v).text)}">${docStatus(v).level === 'expired' ? '⛔' : '⚠️'} ${Utils.esc(docStatus(v).text)}</span>` : '<span class="badge badge-green">سليمة ✓</span>'}</td>
          <td class="row-actions">
            <button class="icon-btn profile-btn" data-id="${v.id}" title="ملف السيارة">📁</button>
            ${!showArchived ? `<button class="icon-btn edit-btn" data-id="${v.id}" title="تعديل">✎</button>` : ''}
            ${showArchived
              ? `<button class="icon-btn restore-btn" data-id="${v.id}" title="استعادة">♻️</button>`
              : `<button class="icon-btn del-btn" data-id="${v.id}" title="حذف">🗑</button>`}
          </td>
        </tr>
      `).join('');
      container.querySelector('#vehicles-empty').style.display = list.length ? 'none' : 'block';
      Utils.renderPagination(container.querySelector('#vehicles-pagination'), { page, totalPages, total }, (p) => { currentPage = p; draw(list); });

      tbody.querySelectorAll('.edit-btn').forEach(b => b.onclick = () => openForm(b.dataset.id));
      tbody.querySelectorAll('.del-btn').forEach(b => b.onclick = () => remove(b.dataset.id));
      tbody.querySelectorAll('.restore-btn').forEach(b => b.onclick = async () => {
        await restoreRecord('vehicles', b.dataset.id);
        Utils.toast('تم استعادة السيارة', 'success');
        render(container);
      });
      tbody.querySelectorAll('.profile-btn').forEach(b => b.onclick = () => showVehicleProfile(b.dataset.id));
    }

    async function showVehicleProfile(vehicleId) {
      const v = await DB.get('vehicles', vehicleId);
      const [contracts, maintenance, expenses, incidents, customers] = await Promise.all([
        DB.getAll('contracts'), DB.getAll('maintenance'), DB.getAll('expenses'), DB.getAll('incidents'), DB.getAll('customers')
      ]);
      const cMap = Object.fromEntries(customers.map(c => [c.id, c]));
      const vContracts = contracts.filter(c => c.vehicleId === vehicleId).sort((a, b) => (b.createdAt||'').localeCompare(a.createdAt||''));
      const vMaintenance = maintenance.filter(m => m.vehicleId === vehicleId).sort((a, b) => (b.createdAt||'').localeCompare(a.createdAt||''));
      const vExpenses = expenses.filter(e => e.vehicleId === vehicleId).sort((a, b) => (b.date||'').localeCompare(a.date||''));
      const vIncidents = incidents.filter(i => i.vehicleId === vehicleId).sort((a, b) => (b.date||'').localeCompare(a.date||''));

      const totalRevenue = vContracts.reduce((s, c) => s + Number(c.paidAmount || 0), 0);
      const maintCost = vMaintenance.reduce((s, m) => s + Number(m.partsCost||0) + Number(m.laborCost||0), 0);
      const expCost = vExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);

      Utils.openModal(`📁 ملف السيارة: ${Utils.esc(v.plate)} — ${Utils.esc(v.brand)} ${Utils.esc(v.model)}`, `
        ${docStatus(v) ? `<div style="background:${docStatus(v).level === 'expired' ? 'var(--red)' : 'var(--orange)'}22; border:1px solid ${docStatus(v).level === 'expired' ? 'var(--red)' : 'var(--orange)'}; border-radius:8px; padding:8px 12px; margin-bottom:12px; font-size:13px">
          ${docStatus(v).level === 'expired' ? '⛔' : '⚠️'} ${Utils.esc(docStatus(v).text)} — راجع بيانات الوثائق من زر التعديل
        </div>` : ''}
        <div class="stat-mini-row">
          <div class="stat-mini"><span>عدد العقود</span><strong>${vContracts.length}</strong></div>
          <div class="stat-mini"><span>إجمالي الإيراد</span><strong>${Utils.fmtMoney(totalRevenue)}</strong></div>
          <div class="stat-mini"><span>تكلفة الصيانة</span><strong>${Utils.fmtMoney(maintCost)}</strong></div>
          <div class="stat-mini"><span>مصروفات أخرى</span><strong>${Utils.fmtMoney(expCost)}</strong></div>
        </div>

        <div class="form-section-title">سجل العقود</div>
        <table class="table table-compact">
          <thead><tr><th>رقم العقد</th><th>العميل</th><th>من</th><th>إلى</th><th>الحالة</th></tr></thead>
          <tbody>
            ${vContracts.length ? vContracts.map(c => `<tr><td>${Utils.esc(c.contractNo)}</td><td>${Utils.esc(cMap[c.customerId]?.name || '—')}</td><td>${Utils.fmtDate(c.startDate)}</td><td>${Utils.fmtDate(c.endDate)}</td><td>${Utils.esc(ContractsModule.STATUS[c.status]?.label || c.status)}</td></tr>`).join('') : '<tr><td colspan="5" class="muted">لا يوجد عقود</td></tr>'}
          </tbody>
        </table>

        <div class="form-section-title">سجل الصيانة</div>
        <table class="table table-compact">
          <thead><tr><th>النوع</th><th>الورشة</th><th>التكلفة</th><th>الحالة</th></tr></thead>
          <tbody>
            ${vMaintenance.length ? vMaintenance.map(o => `<tr><td>${Utils.esc(MaintenanceModule.TYPE[o.type] || o.type)}</td><td>${Utils.esc(o.workshop || '—')}</td><td>${Utils.fmtMoney(Number(o.partsCost||0)+Number(o.laborCost||0))}</td><td>${Utils.esc(MaintenanceModule.STATUS[o.status]?.label || o.status)}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">لا يوجد سجل صيانة</td></tr>'}
          </tbody>
        </table>

        <div class="form-section-title">الحوادث والمخالفات</div>
        <table class="table table-compact">
          <thead><tr><th>النوع</th><th>التاريخ</th><th>المبلغ</th><th>الحالة</th></tr></thead>
          <tbody>
            ${vIncidents.length ? vIncidents.map(i => `<tr><td>${i.type === 'accident' ? 'حادث' : 'مخالفة'}</td><td>${Utils.fmtDate(i.date)}</td><td>${Utils.fmtMoney(i.type==='accident' ? (Number(i.compensationAmount||0)-Number(i.deductibleAmount||0)) : i.amount)}</td><td>${Utils.esc((IncidentsModule.ACC_STATUS[i.status]||IncidentsModule.VIO_STATUS[i.status]||{}).label || i.status)}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">لا يوجد حوادث أو مخالفات</td></tr>'}
          </tbody>
        </table>

        <div class="form-section-title">المصروفات المرتبطة</div>
        <table class="table table-compact">
          <thead><tr><th>الفئة</th><th>التاريخ</th><th>المبلغ</th></tr></thead>
          <tbody>
            ${vExpenses.length ? vExpenses.map(e => `<tr><td>${Utils.esc(e.category)}</td><td>${Utils.fmtDate(e.date)}</td><td>${Utils.fmtMoney(e.amount)}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">لا يوجد مصروفات</td></tr>'}
          </tbody>
        </table>
      `, { size: 'lg' });
    }

    function applyFilters() {
      currentPage = 1;
      const q = container.querySelector('#vehicle-search').value.trim().toLowerCase();
      const st = container.querySelector('#vehicle-status-filter').value;
      let list = vehicles;
      if (q) list = list.filter(v =>
        (v.plate || '').toLowerCase().includes(q) ||
        (v.brand || '').toLowerCase().includes(q) ||
        (v.model || '').toLowerCase().includes(q) ||
        (v.chassis || '').toLowerCase().includes(q)
      );
      if (st) list = list.filter(v => v.status === st);
      draw(list);
    }

    container.querySelector('#vehicle-search').addEventListener('input', Utils.debounce(applyFilters, 150));
    container.querySelector('#vehicle-status-filter').addEventListener('change', applyFilters);
    container.querySelector('#add-vehicle-btn').onclick = () => openForm(null);
    container.querySelector('#toggle-archived-btn').onclick = () => { showArchived = !showArchived; render(container); };

    if (query.q) {
      container.querySelector('#vehicle-search').value = query.q;
      applyFilters();
    } else {
      draw(vehicles);
    }

    async function remove(id) {
      try {
        const blockReason = await vehicleDeleteBlockReason(id);
        if (blockReason) {
          const choice = await Utils.choiceDialog(`${blockReason}. لا يمكن حذف هذه السيارة الآن، لكن يمكنك أرشفتها بدلاً من ذلك (تختفي من القوائم النشطة مع الاحتفاظ بسجلها).`, [
            { key: 'archive', label: '📦 أرشفة السيارة', cls: 'btn-primary' },
            { key: 'cancel', label: 'إلغاء', cls: 'btn-ghost' },
          ]);
          if (choice === 'archive') { await archiveRecord('vehicles', id); Utils.toast('تم أرشفة السيارة', 'success'); render(container); }
          return;
        }
        const choice = await Utils.choiceDialog('كيف تريد إزالة هذه السيارة؟', [
          { key: 'archive', label: '📦 أرشفة (يمكن استعادتها لاحقًا)', cls: 'btn-primary' },
          { key: 'delete', label: '🗑 حذف نهائي', cls: 'btn-danger' },
          { key: 'cancel', label: 'إلغاء', cls: 'btn-ghost' },
        ]);
        if (choice === 'archive') { await archiveRecord('vehicles', id); Utils.toast('تم أرشفة السيارة', 'success'); render(container); }
        else if (choice === 'delete') { await DB.delete('vehicles', id); Utils.toast('تم حذف السيارة نهائيًا', 'success'); render(container); }
      } catch (err) {
        console.error('Vehicle delete/archive failed:', err);
        Utils.toast('حدث خطأ: ' + err.message, 'error');
      }
    }

    async function openForm(id) {
      const v = id ? await DB.get('vehicles', id) : {};
      Utils.openModal(id ? 'تعديل بيانات السيارة' : 'إضافة سيارة جديدة', `
        <form id="vehicle-form" class="form-grid">
          <div class="form-section-title">البيانات الأساسية</div>
          <label>رقم اللوحة *<input required name="plate" class="input" value="${Utils.esc(v.plate || '')}"></label>
          <label>الماركة *<input required name="brand" class="input" value="${Utils.esc(v.brand || '')}"></label>
          <label>الموديل *<input required name="model" class="input" value="${Utils.esc(v.model || '')}"></label>
          <label>الفئة<input name="category" class="input" value="${Utils.esc(v.category || '')}" placeholder="اقتصادية / فاخرة / SUV..."></label>
          <label>اللون<input name="color" class="input" value="${Utils.esc(v.color || '')}"></label>
          <label>رقم الشاسيه<input name="chassis" class="input" value="${Utils.esc(v.chassis || '')}"></label>
          <label>رقم الموتور<input name="engineNo" class="input" value="${Utils.esc(v.engineNo || '')}"></label>
          <label>نوع الوقود
            <select name="fuelType" class="input">
              ${['بنزين', 'ديزل', 'كهرباء', 'هايبرد'].map(f => `<option ${v.fuelType === f ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
          </label>
          <label>ناقل الحركة
            <select name="transmission" class="input">
              <option value="اوتوماتيك" ${v.transmission === 'اوتوماتيك' ? 'selected' : ''}>اوتوماتيك</option>
              <option value="مانيوال" ${v.transmission === 'مانيوال' ? 'selected' : ''}>مانيوال</option>
            </select>
          </label>
          <label>عدد المقاعد<input name="seats" type="number" class="input" value="${Utils.esc(v.seats || '')}"></label>
          <label>عداد الكيلومترات<input name="odometer" type="number" class="input" value="${Utils.esc(v.odometer || 0)}"></label>

          <div class="form-section-title">الأسعار والتأمين</div>
          <label>سعر الشراء<input name="purchasePrice" type="number" class="input" value="${Utils.esc(v.purchasePrice || '')}"></label>
          <label>القيمة الدفترية<input name="bookValue" type="number" class="input" value="${Utils.esc(v.bookValue || '')}"></label>
          <label>الإيجار اليومي *<input required name="dailyRate" type="number" class="input" value="${Utils.esc(v.dailyRate || '')}"></label>
          <label>الإيجار الأسبوعي<input name="weeklyRate" type="number" class="input" value="${Utils.esc(v.weeklyRate || '')}"></label>
          <label>الإيجار الشهري<input name="monthlyRate" type="number" class="input" value="${Utils.esc(v.monthlyRate || '')}"></label>
          <label>الحد الأدنى للتأجير (أيام)<input name="minRentalDays" type="number" class="input" value="${Utils.esc(v.minRentalDays || 1)}"></label>
          <label>مبلغ التأمين (تحت الطلب)<input name="depositAmount" type="number" class="input" value="${Utils.esc(v.depositAmount || '')}"></label>

          <div class="form-section-title">الوثائق والتراخيص</div>
          <label>تاريخ انتهاء رخصة السيارة<input name="licenseExpiry" type="date" class="input" value="${Utils.esc(v.licenseExpiry || '')}"></label>
          <label>تاريخ انتهاء التأمين<input name="insuranceExpiry" type="date" class="input" value="${Utils.esc(v.insuranceExpiry || '')}"></label>
          <label>تاريخ انتهاء الفحص الدوري<input name="inspectionExpiry" type="date" class="input" value="${Utils.esc(v.inspectionExpiry || '')}"></label>

          <div class="form-section-title">الحالة</div>
          <label>الحالة الحالية
            <select name="status" class="input">
              ${Object.entries(STATUS).map(([k, s]) => `<option value="${k}" ${v.status === k ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select>
          </label>
          <label class="span-2">ملاحظات<textarea name="notes" class="input" rows="2">${Utils.esc(v.notes || '')}</textarea></label>

          <div class="form-section-title">صورة السيارة</div>
          <div class="span-2" id="vehicle-photo-uploader"></div>

          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">${id ? 'حفظ التعديلات' : 'إضافة السيارة'}</button>
          </div>
        </form>
      `, { size: 'lg' });

      let photoValue = v.photo || null;
      Utils.renderPhotoUploader(
        container.ownerDocument.getElementById('vehicle-photo-uploader'),
        'صورة السيارة (اختياري)', photoValue, (val) => { photoValue = val; }
      );

      container.ownerDocument.getElementById('cancel-btn').onclick = Utils.closeModal;
      const form = container.ownerDocument.getElementById('vehicle-form');
      form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const obj = Object.fromEntries(fd.entries());
        if (id) obj.id = id;
        if (!obj.status) obj.status = 'available';
        obj.photo = photoValue;

        const duplicate = await isDuplicateValue('vehicles', 'plate', obj.plate, id);
        if (duplicate) { Utils.toast('رقم اللوحة هذا مستخدم بالفعل لسيارة أخرى', 'error'); return; }

        await DB.add('vehicles', obj);
        Utils.toast(id ? 'تم تحديث بيانات السيارة' : 'تمت إضافة السيارة بنجاح', 'success');
        Utils.closeModal();
        render(container);
      };
    }
  }

  return { render, STATUS, docStatus };
})();

window.VehiclesModule = VehiclesModule;
