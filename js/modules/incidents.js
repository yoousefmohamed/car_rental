'use strict';

const IncidentsModule = (() => {
  const TYPE = { accident: 'حادث', violation: 'مخالفة مرورية' };
  const ACC_STATUS = {
    open:         { label: 'مفتوح',           cls: 'orange' },
    claim_filed:  { label: 'مطالبة تحت الإجراء', cls: 'blue' },
    closed:       { label: 'مغلق',            cls: 'green' },
  };
  const VIO_STATUS = {
    unpaid: { label: 'غير مسددة', cls: 'red' },
    paid:   { label: 'مسددة',     cls: 'green' },
  };
  const VIOLATION_TYPES = ['تجاوز السرعة', 'وقوف خاطئ', 'إشارة حمراء', 'عدم ربط الحزام', 'استخدام الهاتف', 'أخرى'];

  function statusMapFor(type) { return type === 'accident' ? ACC_STATUS : VIO_STATUS; }

  async function render(container) {
    const [incidents, vehicles, customers, contracts] = await Promise.all([
      DB.getAll('incidents'), DB.getAll('vehicles'), DB.getAll('customers'), DB.getAll('contracts')
    ]);
    incidents.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const vMap = Object.fromEntries(vehicles.map(v => [v.id, v]));
    const cMap = Object.fromEntries(customers.map(c => [c.id, c]));

    const accidents = incidents.filter(i => i.type === 'accident');
    const violations = incidents.filter(i => i.type === 'violation');
    const unpaidViolations = violations.filter(v => v.status !== 'paid');
    const unpaidTotal = unpaidViolations.reduce((s, v) => s + Number(v.amount || 0), 0);
    const openAccidents = accidents.filter(a => a.status !== 'closed').length;

    container.innerHTML = `
      <div class="page-head">
        <div><h2>الحوادث والمخالفات</h2><p class="muted">تسجيل الحوادث ومتابعة مطالبات التأمين، والمخالفات المرورية وربطها بالعميل والعقد</p></div>
        <div style="display:flex; gap:8px">
          <button class="btn btn-ghost" id="add-violation-btn">+ مخالفة مرورية</button>
          <button class="btn btn-primary" id="add-accident-btn">+ تسجيل حادث</button>
        </div>
      </div>

      <div class="stat-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="stat-card stat-orange"><div class="stat-icon">🚨</div><div><div class="stat-value">${openAccidents}</div><div class="stat-label">حوادث مفتوحة</div></div></div>
        <div class="stat-card stat-blue"><div class="stat-icon">📋</div><div><div class="stat-value">${accidents.length}</div><div class="stat-label">إجمالي الحوادث المسجلة</div></div></div>
        <div class="stat-card stat-red"><div class="stat-icon">🚦</div><div><div class="stat-value">${unpaidViolations.length}</div><div class="stat-label">مخالفات غير مسددة</div></div></div>
        <div class="stat-card stat-red"><div class="stat-icon">💸</div><div><div class="stat-value">${Utils.fmtMoney(unpaidTotal)}</div><div class="stat-label">إجمالي المخالفات المستحقة</div></div></div>
      </div>

      <div class="toolbar">
        <select id="type-filter" class="input">
          <option value="">الكل (حوادث ومخالفات)</option>
          <option value="accident">الحوادث فقط</option>
          <option value="violation">المخالفات فقط</option>
        </select>
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>النوع</th><th>السيارة</th><th>العميل</th><th>التاريخ</th><th>التفاصيل</th><th>المبلغ</th><th>الحالة</th><th></th></tr></thead>
          <tbody id="inc-tbody"></tbody>
        </table>
        <div id="inc-empty" class="empty-state" style="display:none">لا توجد حوادث أو مخالفات مسجلة</div>
      </div>
    `;

    const tbody = container.querySelector('#inc-tbody');

    function draw(list) {
      tbody.innerHTML = list.map(i => {
        const st = statusMapFor(i.type);
        const amount = i.type === 'accident' ? (Number(i.compensationAmount || 0) - Number(i.deductibleAmount || 0)) : Number(i.amount || 0);
        return `
        <tr>
          <td>${i.type === 'accident' ? '<span class="badge badge-orange">حادث</span>' : '<span class="badge badge-purple">مخالفة</span>'}</td>
          <td>${Utils.esc(vMap[i.vehicleId]?.plate || '—')}</td>
          <td>${Utils.esc(cMap[i.customerId]?.name || '—')}</td>
          <td>${Utils.fmtDate(i.date)}</td>
          <td>${Utils.esc(i.type === 'accident' ? (i.description || i.policeReportNo || '—') : (i.violationType || '—'))}</td>
          <td>${Utils.fmtMoney(amount)}</td>
          <td>${Utils.statusBadge(i.status, st)}</td>
          <td class="row-actions">
            <button class="icon-btn view-btn" data-id="${i.id}" title="عرض">👁</button>
            <button class="icon-btn del-btn" data-id="${i.id}" title="حذف">🗑</button>
          </td>
        </tr>`;
      }).join('');
      container.querySelector('#inc-empty').style.display = list.length ? 'none' : 'block';
      tbody.querySelectorAll('.view-btn').forEach(b => b.onclick = () => openForm(b.dataset.id));
      tbody.querySelectorAll('.del-btn').forEach(b => b.onclick = () => remove(b.dataset.id));
    }

    container.querySelector('#type-filter').addEventListener('change', (e) => {
      const t = e.target.value;
      draw(t ? incidents.filter(i => i.type === t) : incidents);
    });
    draw(incidents);

    container.querySelector('#add-accident-btn').onclick = () => openForm(null, 'accident');
    container.querySelector('#add-violation-btn').onclick = () => openForm(null, 'violation');

    async function remove(id) {
      if (!id) { Utils.toast('تعذّر تحديد السجل', 'error'); return; }
      const ok = await Utils.confirmDialog('هل تريد حذف هذا السجل؟');
      if (!ok) return;
      try {
        const existing = await DB.get('incidents', id);
        if (!existing) { Utils.toast('السجل غير موجود بالفعل (ربما تم حذفه مسبقًا)', 'error'); render(container); return; }
        await DB.delete('incidents', id);
        Utils.toast('تم الحذف', 'success');
        render(container);
      } catch (err) {
        console.error('Incident delete failed:', err);
        Utils.toast('حدث خطأ أثناء الحذف: ' + err.message, 'error');
      }
    }

    async function openForm(id, forcedType) {
      const rec = id ? await DB.get('incidents', id) : { type: forcedType };
      const isAccident = rec.type === 'accident';

      const commonFields = `
        <label>السيارة *
          <select required name="vehicleId" id="inc-vehicle" class="input">
            <option value="">اختر السيارة</option>
            ${vehicles.map(v => `<option value="${v.id}" ${rec.vehicleId === v.id ? 'selected' : ''}>${Utils.esc(v.plate)} — ${Utils.esc(v.brand)} ${Utils.esc(v.model)}</option>`).join('')}
          </select>
        </label>
        <label>العميل (السائق وقت الواقعة)
          <select name="customerId" id="inc-customer" class="input">
            <option value="">— بدون —</option>
            ${customers.map(c => `<option value="${c.id}" ${rec.customerId === c.id ? 'selected' : ''}>${Utils.esc(c.name)}</option>`).join('')}
          </select>
        </label>
        <label>العقد المرتبط (اختياري)
          <select name="contractId" id="inc-contract" class="input">
            <option value="">— بدون —</option>
            ${contracts.map(c => `<option value="${c.id}" ${rec.contractId === c.id ? 'selected' : ''}>${Utils.esc(c.contractNo)}</option>`).join('')}
          </select>
        </label>
        <label>التاريخ<input type="date" name="date" class="input" value="${Utils.esc((rec.date || Utils.todayISO()).slice(0,10))}"></label>
      `;

      const accidentFields = `
        <div class="form-section-title">بيانات الحادث</div>
        <label class="span-2">وصف الحادث<textarea name="description" class="input" rows="2">${Utils.esc(rec.description || '')}</textarea></label>
        <label>بيانات الطرف الآخر<input name="otherParty" class="input" value="${Utils.esc(rec.otherParty || '')}"></label>
        <label>رقم المحضر<input name="policeReportNo" class="input" value="${Utils.esc(rec.policeReportNo || '')}"></label>
        <label>شركة التأمين<input name="insuranceCompany" class="input" value="${Utils.esc(rec.insuranceCompany || '')}"></label>
        <label>مبلغ التعويض<input type="number" name="compensationAmount" class="input" value="${Utils.esc(rec.compensationAmount || 0)}"></label>
        <label>نسبة/مبلغ التحمل<input type="number" name="deductibleAmount" class="input" value="${Utils.esc(rec.deductibleAmount || 0)}"></label>
        <label>حالة المطالبة
          <select name="status" class="input">${Object.entries(ACC_STATUS).map(([k, s]) => `<option value="${k}" ${rec.status === k ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
        </label>
        <label class="span-2">ملاحظات ومرفقات (وصف الصور/المستندات)<textarea name="notes" class="input" rows="2">${Utils.esc(rec.notes || '')}</textarea></label>
      `;

      const violationFields = `
        <div class="form-section-title">بيانات المخالفة</div>
        <label>نوع المخالفة
          <select name="violationType" class="input">${VIOLATION_TYPES.map(t => `<option ${rec.violationType === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </label>
        <label>قيمة المخالفة *<input required type="number" name="amount" class="input" value="${Utils.esc(rec.amount || 0)}"></label>
        <label>حالة السداد
          <select name="status" class="input">${Object.entries(VIO_STATUS).map(([k, s]) => `<option value="${k}" ${rec.status === k ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
        </label>
        <label class="span-2">ملاحظات<textarea name="notes" class="input" rows="2">${Utils.esc(rec.notes || '')}</textarea></label>
      `;

      Utils.openModal(id ? 'تعديل السجل' : (isAccident ? 'تسجيل حادث جديد' : 'تسجيل مخالفة مرورية'), `
        <form id="incident-form" class="form-grid">
          <input type="hidden" name="type" value="${isAccident ? 'accident' : 'violation'}">
          ${commonFields}
          ${isAccident ? accidentFields : violationFields}
          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">${id ? 'حفظ التعديلات' : 'حفظ'}</button>
          </div>
        </form>
      `, { size: 'lg' });

      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      Utils.enhanceSearchableSelect(document.getElementById('inc-vehicle'), 'اكتب رقم اللوحة أو الماركة...');
      Utils.enhanceSearchableSelect(document.getElementById('inc-customer'), 'اكتب اسم العميل...');
      Utils.enhanceSearchableSelect(document.getElementById('inc-contract'), 'اكتب رقم العقد...');
      document.getElementById('incident-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target).entries());
        if (id) fd.id = id;
        if (!fd.status) fd.status = isAccident ? 'open' : 'unpaid';
        await DB.add('incidents', fd);
        Utils.toast(id ? 'تم التحديث' : 'تم الحفظ بنجاح', 'success');
        Utils.closeModal();
        render(container);
      };
    }
  }

  return { render, TYPE, ACC_STATUS, VIO_STATUS };
})();

window.IncidentsModule = IncidentsModule;
