'use strict';

const MaintenanceModule = (() => {
  const TYPE = { preventive: 'وقائية', periodic: 'دورية', emergency: 'طارئة' };
  const STATUS = {
    scheduled:   { label: 'مجدولة', cls: 'blue' },
    in_progress: { label: 'جارية',  cls: 'orange' },
    completed:   { label: 'مكتملة', cls: 'green' },
    cancelled:   { label: 'ملغاة',  cls: 'red' },
  };

  function computeDueInfo(order, vehicle) {
    if (!order.nextDueDate && !order.nextDueKm) return null;
    const today = new Date();
    let dayLeft = null, kmLeft = null;
    if (order.nextDueDate) dayLeft = Math.ceil((new Date(order.nextDueDate) - today) / 86400000);
    if (order.nextDueKm && vehicle) kmLeft = Number(order.nextDueKm) - Number(vehicle.odometer || 0);
    const overdue = (dayLeft !== null && dayLeft < 0) || (kmLeft !== null && kmLeft < 0);
    const soon = !overdue && ((dayLeft !== null && dayLeft <= 14) || (kmLeft !== null && kmLeft <= 500));
    return { dayLeft, kmLeft, overdue, soon };
  }

  async function getUpcomingAlerts() {
    const [orders, vehicles] = await Promise.all([DB.getAll('maintenance'), DB.getAll('vehicles')]);
    const vMap = Object.fromEntries(vehicles.map(v => [v.id, v]));
    // Only the latest completed/scheduled order per vehicle carries a meaningful "next due"
    const latestByVehicle = {};
    orders.filter(o => o.status !== 'cancelled').forEach(o => {
      if (!latestByVehicle[o.vehicleId] || (o.createdAt || '') > (latestByVehicle[o.vehicleId].createdAt || '')) {
        latestByVehicle[o.vehicleId] = o;
      }
    });
    return Object.values(latestByVehicle)
      .map(o => ({ order: o, vehicle: vMap[o.vehicleId], due: computeDueInfo(o, vMap[o.vehicleId]) }))
      .filter(x => x.due && (x.due.overdue || x.due.soon));
  }

  async function render(container) {
    const [orders, vehicles] = await Promise.all([DB.getAll('maintenance'), DB.getAll('vehicles')]);
    orders.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const vMap = Object.fromEntries(vehicles.map(v => [v.id, v]));

    const scheduled = orders.filter(o => o.status === 'scheduled').length;
    const inProgress = orders.filter(o => o.status === 'in_progress').length;
    const totalCost = orders.reduce((s, o) => s + Number(o.partsCost || 0) + Number(o.laborCost || 0), 0);
    const alerts = await getUpcomingAlerts();

    container.innerHTML = `
      <div class="page-head">
        <div><h2>الصيانة</h2><p class="muted">أوامر الصيانة الوقائية والدورية والطارئة، الورش، وقطع الغيار</p></div>
        <button class="btn btn-primary" id="add-order-btn">+ أمر صيانة جديد</button>
      </div>

      <div class="stat-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="stat-card stat-blue"><div class="stat-icon">🗓</div><div><div class="stat-value">${scheduled}</div><div class="stat-label">أوامر مجدولة</div></div></div>
        <div class="stat-card stat-orange"><div class="stat-icon">🛠</div><div><div class="stat-value">${inProgress}</div><div class="stat-label">جارية الآن</div></div></div>
        <div class="stat-card stat-red"><div class="stat-icon">⚠️</div><div><div class="stat-value">${alerts.length}</div><div class="stat-label">سيارات تحتاج صيانة قريباً</div></div></div>
        <div class="stat-card stat-green"><div class="stat-icon">💰</div><div><div class="stat-value">${Utils.fmtMoney(totalCost)}</div><div class="stat-label">إجمالي تكاليف الصيانة</div></div></div>
      </div>

      ${alerts.length ? `
        <div class="panel" style="margin-bottom:18px">
          <h3>🔔 تنبيهات صيانة ذكية</h3>
          <div class="alert-list">
            ${alerts.map(a => `
              <div class="alert-row alert-${a.due.overdue ? 'danger' : 'warn'}">
                ${Utils.esc(a.vehicle?.plate || '—')} — ${Utils.esc(a.vehicle?.brand || '')} ${Utils.esc(a.vehicle?.model || '')}:
                ${a.due.overdue ? 'الصيانة متأخرة' : 'الصيانة قريبة'}
                ${a.due.dayLeft !== null ? ` — ${a.due.dayLeft < 0 ? `متأخرة ${Math.abs(a.due.dayLeft)} يوم` : `باقي ${a.due.dayLeft} يوم`}` : ''}
                ${a.due.kmLeft !== null ? ` — ${a.due.kmLeft < 0 ? `تجاوزت بـ ${Math.abs(a.due.kmLeft)} كم` : `باقي ${a.due.kmLeft} كم`}` : ''}
              </div>`).join('')}
          </div>
        </div>` : ''}

      <div class="toolbar">
        <select id="status-filter" class="input">
          <option value="">كل الحالات</option>
          ${Object.entries(STATUS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}
        </select>
        <select id="type-filter" class="input">
          <option value="">كل الأنواع</option>
          ${Object.entries(TYPE).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
        </select>
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>السيارة</th><th>النوع</th><th>الورشة</th><th>الوصف</th><th>التكلفة</th><th>الحالة</th><th>الاستحقاق القادم</th><th></th></tr>
          </thead>
          <tbody id="orders-tbody"></tbody>
        </table>
        <div id="orders-empty" class="empty-state" style="display:none">لا توجد أوامر صيانة بعد</div>
      </div>
    `;

    const tbody = container.querySelector('#orders-tbody');

    function draw(list) {
      tbody.innerHTML = list.map(o => {
        const v = vMap[o.vehicleId];
        const due = computeDueInfo(o, v);
        const cost = Number(o.partsCost || 0) + Number(o.laborCost || 0);
        return `
        <tr>
          <td>${v ? Utils.esc(v.plate) : '<span class="muted">—</span>'}</td>
          <td>${Utils.esc(TYPE[o.type] || o.type)}</td>
          <td>${Utils.esc(o.workshop || '—')}</td>
          <td>${Utils.esc(o.description || '—')}</td>
          <td>${Utils.fmtMoney(cost)}</td>
          <td>${Utils.statusBadge(o.status, STATUS)}</td>
          <td>${due ? `${due.overdue ? '<span class="badge badge-red">متأخرة</span>' : due.soon ? '<span class="badge badge-orange">قريباً</span>' : '<span class="badge badge-gray">—</span>'}` : '—'}</td>
          <td class="row-actions">
            ${o.status === 'in_progress' ? `<button class="icon-btn complete-btn" data-id="${o.id}" title="إنهاء الصيانة">✅</button>` : ''}
            <button class="icon-btn edit-btn" data-id="${o.id}" title="تعديل">✎</button>
            <button class="icon-btn del-btn" data-id="${o.id}" title="حذف">🗑</button>
          </td>
        </tr>`;
      }).join('');
      container.querySelector('#orders-empty').style.display = list.length ? 'none' : 'block';
      tbody.querySelectorAll('.edit-btn').forEach(b => b.onclick = () => openForm(b.dataset.id));
      tbody.querySelectorAll('.del-btn').forEach(b => b.onclick = () => remove(b.dataset.id));
      tbody.querySelectorAll('.complete-btn').forEach(b => b.onclick = () => completeOrder(b.dataset.id));
    }

    function applyFilters() {
      const st = container.querySelector('#status-filter').value;
      const ty = container.querySelector('#type-filter').value;
      let list = orders;
      if (st) list = list.filter(o => o.status === st);
      if (ty) list = list.filter(o => o.type === ty);
      draw(list);
    }
    container.querySelector('#status-filter').addEventListener('change', applyFilters);
    container.querySelector('#type-filter').addEventListener('change', applyFilters);
    draw(orders);

    container.querySelector('#add-order-btn').onclick = () => openForm(null);

    async function remove(id) {
      if (!id) { Utils.toast('تعذّر تحديد أمر الصيانة', 'error'); return; }
      const ok = await Utils.confirmDialog('هل تريد حذف أمر الصيانة هذا؟');
      if (!ok) return;
      try {
        const o = await DB.get('maintenance', id);
        if (!o) { Utils.toast('أمر الصيانة غير موجود بالفعل (ربما تم حذفه مسبقًا)', 'error'); render(container); return; }
        await DB.delete('maintenance', id);
        if (o.status === 'in_progress') {
          const v = await DB.get('vehicles', o.vehicleId);
          if (v && v.status === 'maintenance') { v.status = 'available'; await DB.add('vehicles', v); }
        }
        Utils.toast('تم حذف أمر الصيانة', 'success');
        render(container);
      } catch (err) {
        console.error('Maintenance delete failed:', err);
        Utils.toast('حدث خطأ أثناء الحذف: ' + err.message, 'error');
      }
    }

    async function completeOrder(id) {
      const o = await DB.get('maintenance', id);
      const accounts = await DB.getAll('accounts');
      Utils.openModal('إنهاء الصيانة وتحرير السيارة', `
        <form id="complete-form" class="form-grid">
          <label>تكلفة القطع<input type="number" name="partsCost" class="input" value="${Utils.esc(o.partsCost || 0)}"></label>
          <label>تكلفة العمالة<input type="number" name="laborCost" class="input" value="${Utils.esc(o.laborCost || 0)}"></label>
          <label class="span-2">يُخصم من حساب (اختياري — لتسجيله كمصروف)
            <select name="accountId" class="input">
              <option value="">— بدون —</option>
              ${accounts.map(a => `<option value="${a.id}">${Utils.esc(a.name)}</option>`).join('')}
            </select>
          </label>
          <label>موعد الصيانة القادمة (تاريخ)<input type="date" name="nextDueDate" class="input" value="${Utils.esc((o.nextDueDate||'').slice(0,10))}"></label>
          <label>كيلومتر الصيانة القادمة<input type="number" name="nextDueKm" class="input" value="${Utils.esc(o.nextDueKm || '')}"></label>
          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">إنهاء وتحرير السيارة</button>
          </div>
        </form>`, { size: 'md' });
      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      document.getElementById('complete-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target).entries());
        o.partsCost = fd.partsCost; o.laborCost = fd.laborCost;
        o.nextDueDate = fd.nextDueDate; o.nextDueKm = fd.nextDueKm;
        o.status = 'completed';
        o.completedAt = new Date().toISOString();
        await DB.add('maintenance', o);

        const v = await DB.get('vehicles', o.vehicleId);
        if (v) { v.status = 'available'; await DB.add('vehicles', v); }

        const totalCost = Number(fd.partsCost || 0) + Number(fd.laborCost || 0);
        if (totalCost > 0) {
          const exp = await DB.add('expenses', {
            category: 'صيانة', amount: totalCost, vehicleId: o.vehicleId,
            accountId: fd.accountId || '', note: `أمر صيانة: ${o.description || ''}`, date: new Date().toISOString(),
          });
          if (fd.accountId) {
            await createTransaction({ accountId: fd.accountId, direction: 'out', amount: totalCost, category: 'مصروف: صيانة', refType: 'maintenance', refId: o.id, note: `صيانة سيارة ${v?.plate || ''}` });
          }
        }

        Utils.toast('تم إنهاء الصيانة وتحرير السيارة', 'success');
        Utils.closeModal();
        render(container);
      };
    }

    async function openForm(id) {
      const o = id ? await DB.get('maintenance', id) : {};
      Utils.openModal(id ? 'تعديل أمر الصيانة' : 'أمر صيانة جديد', `
        <form id="order-form" class="form-grid">
          <label>السيارة *
            <select required name="vehicleId" id="mnt-vehicle" class="input">
              <option value="">اختر السيارة</option>
              ${vehicles.map(v => `<option value="${v.id}" ${o.vehicleId === v.id ? 'selected' : ''}>${Utils.esc(v.plate)} — ${Utils.esc(v.brand)} ${Utils.esc(v.model)} (${v.odometer||0} كم)</option>`).join('')}
            </select>
          </label>
          <label>نوع الصيانة
            <select name="type" class="input">${Object.entries(TYPE).map(([k, l]) => `<option value="${k}" ${o.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          </label>
          <label>الورشة<input name="workshop" class="input" value="${Utils.esc(o.workshop || '')}"></label>
          <label>الحالة
            <select name="status" class="input">${Object.entries(STATUS).map(([k, s]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
          </label>
          <label class="span-2">وصف العطل / الإجراء<textarea name="description" class="input" rows="2">${Utils.esc(o.description || '')}</textarea></label>
          <label>تكلفة القطع المتوقعة<input type="number" name="partsCost" class="input" value="${Utils.esc(o.partsCost || 0)}"></label>
          <label>تكلفة العمالة المتوقعة<input type="number" name="laborCost" class="input" value="${Utils.esc(o.laborCost || 0)}"></label>
          <label>تاريخ الجدولة<input type="date" name="scheduledDate" class="input" value="${Utils.esc((o.scheduledDate||Utils.todayISO()).slice(0,10))}"></label>
          <label>موعد الصيانة القادمة (تاريخ)<input type="date" name="nextDueDate" class="input" value="${Utils.esc((o.nextDueDate||'').slice(0,10))}"></label>
          <label class="span-2">كيلومتر الصيانة القادمة<input type="number" name="nextDueKm" class="input" value="${Utils.esc(o.nextDueKm || '')}"></label>
          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">${id ? 'حفظ التعديلات' : 'إنشاء أمر الصيانة'}</button>
          </div>
        </form>`, { size: 'lg' });

      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      Utils.enhanceSearchableSelect(document.getElementById('mnt-vehicle'), 'اكتب رقم اللوحة أو الماركة...');
      document.getElementById('order-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target).entries());
        if (id) fd.id = id;
        if (!fd.status) fd.status = 'scheduled';
        const saved = await DB.add('maintenance', fd);

        if (fd.status === 'in_progress') {
          const v = await DB.get('vehicles', fd.vehicleId);
          if (v && v.status !== 'maintenance') { v.status = 'maintenance'; await DB.add('vehicles', v); }
        }

        Utils.toast(id ? 'تم تحديث أمر الصيانة' : 'تم إنشاء أمر الصيانة', 'success');
        Utils.closeModal();
        render(container);
      };
    }
  }

  return { render, STATUS, TYPE, getUpcomingAlerts };
})();

window.MaintenanceModule = MaintenanceModule;
