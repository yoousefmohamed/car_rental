'use strict';

const BookingsModule = (() => {
  const STATUS = {
    pending:   { label: 'قيد الانتظار', cls: 'orange' },
    confirmed: { label: 'مؤكد',         cls: 'blue' },
    cancelled: { label: 'ملغي',         cls: 'red' },
    completed: { label: 'مكتمل',        cls: 'green' },
  };

  let currentView = 'list';
  let calMonth = new Date();

  async function render(container) {
    const [bookings, vehicles, customers, contracts] = await Promise.all([
      DB.getAll('bookings'), DB.getAll('vehicles'), DB.getAll('customers'), DB.getAll('contracts')
    ]);
    bookings.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const vMap = Object.fromEntries(vehicles.map(v => [v.id, v]));
    const cMap = Object.fromEntries(customers.map(c => [c.id, c]));

    container.innerHTML = `
      <div class="page-head">
        <div>
          <h2>الحجوزات</h2>
          <p class="muted">حجز مسبق للسيارات مع منع التعارض والحجز المزدوج</p>
        </div>
        <div style="display:flex; gap:8px">
          <div class="view-toggle">
            <button class="view-toggle-btn ${currentView === 'list' ? 'active' : ''}" id="view-list-btn">📋 قائمة</button>
            <button class="view-toggle-btn ${currentView === 'calendar' ? 'active' : ''}" id="view-cal-btn">🗓 تقويم</button>
          </div>
          <button class="btn btn-ghost" id="find-available-btn">🔎 بحث عن سيارة متاحة</button>
          <button class="btn btn-primary" id="add-booking-btn">+ حجز جديد</button>
        </div>
      </div>

      <div id="availability-finder-panel" style="display:none"></div>

      ${currentView === 'list' ? `
      <div class="toolbar">
        <select id="booking-status-filter" class="input">
          <option value="">كل الحالات</option>
          ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
        </select>
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>السيارة</th><th>العميل</th><th>من</th><th>إلى</th><th>المصدر</th><th>الحالة</th><th></th></tr>
          </thead>
          <tbody id="bookings-tbody"></tbody>
        </table>
        <div id="bookings-empty" class="empty-state" style="display:none">لا توجد حجوزات بعد</div>
      </div>
      ` : `<div id="calendar-wrap"></div>`}
    `;

    container.querySelector('#view-list-btn').onclick = () => { currentView = 'list'; render(container); };
    container.querySelector('#view-cal-btn').onclick = () => { currentView = 'calendar'; render(container); };
    container.querySelector('#find-available-btn').onclick = () => toggleFinder(container, vehicles, vMap);
    window.__bookingOpenFormRef = (id, prefill) => openForm(id, prefill);

    if (currentView === 'calendar') {
      renderCalendar(container, bookings, contracts, vehicles, vMap, cMap);
      container.querySelector('#add-booking-btn').onclick = () => openForm(null);
      return;
    }

    const tbody = container.querySelector('#bookings-tbody');

    function draw(list) {
      const SOURCE_LABEL = { phone: '📞 هاتف', walkin: '🚶 حضور شخصي', whatsapp: '💬 واتساب', online: '🌐 إنترنت' };
      tbody.innerHTML = list.map(b => {
        const v = vMap[b.vehicleId], c = cMap[b.customerId];
        return `
        <tr>
          <td>${v ? Utils.esc(v.plate + ' — ' + v.brand + ' ' + v.model) : '<span class="muted">سيارة محذوفة</span>'}</td>
          <td>${c ? Utils.esc(c.name) : '<span class="muted">عميل محذوف</span>'}</td>
          <td>${Utils.fmtDate(b.startDate)}</td>
          <td>${Utils.fmtDate(b.endDate)}</td>
          <td>${Utils.esc(SOURCE_LABEL[b.source] || '—')}</td>
          <td>${Utils.statusBadge(b.status, STATUS)}</td>
          <td class="row-actions">
            ${b.status === 'pending' ? `<button class="icon-btn confirm-btn" data-id="${b.id}" title="تأكيد الحجز">✅</button>` : ''}
            ${b.status === 'confirmed' ? `<button class="icon-btn wa-btn" data-id="${b.id}" title="إرسال تذكير واتساب">💬</button>` : ''}
            ${b.status === 'confirmed' ? `<button class="icon-btn contract-btn" data-id="${b.id}" title="تحويل إلى عقد">📝</button>` : ''}
            <button class="icon-btn edit-btn" data-id="${b.id}" title="تعديل">✎</button>
            <button class="icon-btn del-btn" data-id="${b.id}" title="حذف">🗑</button>
          </td>
        </tr>`;
      }).join('');
      container.querySelector('#bookings-empty').style.display = list.length ? 'none' : 'block';
      tbody.querySelectorAll('.edit-btn').forEach(b => b.onclick = () => openForm(b.dataset.id));
      tbody.querySelectorAll('.del-btn').forEach(b => b.onclick = () => remove(b.dataset.id));
      tbody.querySelectorAll('.contract-btn').forEach(b => b.onclick = () => {
        window.location.hash = '#/contracts?fromBooking=' + b.dataset.id;
      });
      tbody.querySelectorAll('.confirm-btn').forEach(b => b.onclick = () => quickConfirm(b.dataset.id));
      tbody.querySelectorAll('.wa-btn').forEach(b => b.onclick = () => {
        const bk = bookings.find(x => x.id === b.dataset.id);
        const v = vMap[bk.vehicleId], c = cMap[bk.customerId];
        const msg = `مرحباً ${c?.name || ''}، نود تذكيركم بحجز السيارة ${v?.plate || ''} (${v?.brand || ''} ${v?.model || ''}) بتاريخ ${Utils.fmtDate(bk.startDate)}. نتشرف بخدمتكم.`;
        Utils.openWhatsApp(c?.phone, msg);
      });
    }

    async function quickConfirm(id) {
      const b = await DB.get('bookings', id);
      b.status = 'confirmed';
      await DB.add('bookings', b);
      Utils.toast('تم تأكيد الحجز', 'success');
      render(container);
    }

    container.querySelector('#booking-status-filter').addEventListener('change', (e) => {
      const st = e.target.value;
      draw(st ? bookings.filter(b => b.status === st) : bookings);
    });
    container.querySelector('#add-booking-btn').onclick = () => openForm(null);
    draw(bookings);

    async function remove(id) {
      const ok = await Utils.confirmDialog('هل تريد حذف هذا الحجز؟');
      if (!ok) return;
      try {
        await DB.delete('bookings', id);
        Utils.toast('تم حذف الحجز', 'success');
        render(container);
      } catch (err) {
        console.error('Booking delete failed:', err);
        Utils.toast('حدث خطأ أثناء الحذف: ' + err.message, 'error');
      }
    }

    async function openForm(id, prefill = {}) {
      const b = id ? await DB.get('bookings', id) : prefill;
      const accounts = await DB.getAll('accounts');
      const availableVehicles = vehicles; // allow selecting any; availability re-checked on submit
      Utils.openModal(id ? 'تعديل الحجز' : 'حجز جديد', `
        <form id="booking-form" class="form-grid">
          <label>السيارة *
            <select required name="vehicleId" id="bk-vehicle" class="input">
              <option value="">اختر السيارة</option>
              ${availableVehicles.map(v => `<option value="${v.id}" ${b.vehicleId === v.id ? 'selected' : ''}>${Utils.esc(v.plate)} — ${Utils.esc(v.brand)} ${Utils.esc(v.model)}</option>`).join('')}
            </select>
          </label>
          <label>العميل *
            <select required name="customerId" id="bk-customer" class="input">
              <option value="">اختر العميل</option>
              ${customers.map(c => `<option value="${c.id}" ${b.customerId === c.id ? 'selected' : ''}>${Utils.esc(c.name)} — ${Utils.esc(c.phone || '')}</option>`).join('')}
            </select>
          </label>
          <label>تاريخ البداية *<input required type="date" name="startDate" class="input" value="${Utils.esc((b.startDate || Utils.todayISO()).slice(0,10))}"></label>
          <label>تاريخ النهاية *<input required type="date" name="endDate" class="input" value="${Utils.esc((b.endDate || '').slice(0,10))}"></label>
          <label>مصدر الحجز
            <select name="source" class="input">
              <option value="phone" ${b.source === 'phone' ? 'selected' : ''}>📞 هاتف</option>
              <option value="walkin" ${b.source === 'walkin' ? 'selected' : ''}>🚶 حضور شخصي</option>
              <option value="whatsapp" ${b.source === 'whatsapp' ? 'selected' : ''}>💬 واتساب</option>
              <option value="online" ${b.source === 'online' ? 'selected' : ''}>🌐 إنترنت</option>
            </select>
          </label>
          <label>الحالة
            <select name="status" class="input">
              ${Object.entries(STATUS).map(([k, s]) => `<option value="${k}" ${b.status === k ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select>
          </label>
          <label>عربون الحجز<input type="number" name="deposit" class="input" value="${Utils.esc(b.deposit || 0)}"></label>
          <label>يُضاف إلى حساب
            <select name="accountId" class="input">
              <option value="">— بدون —</option>
              ${accounts.map(a => `<option value="${a.id}" ${b.accountId === a.id ? 'selected' : ''}>${Utils.esc(a.name)}</option>`).join('')}
            </select>
          </label>
          <label class="span-2">ملاحظات<textarea name="notes" class="input" rows="2">${Utils.esc(b.notes || '')}</textarea></label>
          <div id="booking-conflict-msg" class="form-error span-2" style="display:none"></div>
          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">${id ? 'حفظ التعديلات' : 'تأكيد الحجز'}</button>
          </div>
        </form>
      `, { size: 'md' });

      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      Utils.enhanceSearchableSelect(document.getElementById('bk-vehicle'), 'اكتب رقم اللوحة أو الماركة...');
      Utils.enhanceSearchableSelect(document.getElementById('bk-customer'), 'اكتب اسم العميل أو الهاتف...');
      const form = document.getElementById('booking-form');
      form.onsubmit = async (e) => {
        e.preventDefault();
        const obj = Object.fromEntries(new FormData(form).entries());
        if (id) obj.id = id;
        if (!obj.status) obj.status = 'pending';

        if (new Date(obj.endDate) <= new Date(obj.startDate)) {
          const msg = document.getElementById('booking-conflict-msg');
          msg.textContent = 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية';
          msg.style.display = 'block';
          return;
        }

        const { available, conflict } = await checkVehicleAvailability(obj.vehicleId, obj.startDate, obj.endDate, id);
        if (!available) {
          const msg = document.getElementById('booking-conflict-msg');
          msg.textContent = `تعارض! السيارة محجوزة/مؤجرة بالفعل بين ${Utils.fmtDate(conflict.startDate)} و ${Utils.fmtDate(conflict.endDate)}`;
          msg.style.display = 'block';
          return;
        }

        if (!id) {
          const cust = customers.find(x => x.id === obj.customerId);
          if (cust && cust.blacklisted === '1') {
            const proceed = await Utils.confirmDialog(`تنبيه: العميل "${cust.name}" مدرج في القائمة السوداء. هل تريد المتابعة رغم ذلك؟`);
            if (!proceed) return;
          }
        }

        const saved = await DB.add('bookings', obj);
        if (!id && Number(obj.deposit) > 0 && obj.accountId) {
          await createTransaction({
            accountId: obj.accountId, direction: 'in', amount: obj.deposit,
            category: 'عربون حجز', refType: 'booking', refId: saved.id,
            note: `عربون حجز — ${vMap[obj.vehicleId]?.plate || ''}`,
          });
        }
        Utils.toast(id ? 'تم تحديث الحجز' : 'تم تأكيد الحجز بنجاح', 'success');
        Utils.closeModal();
        render(container);
      };
    }
  }

  async function toggleFinder(container, vehicles, vMap) {
    const panel = container.querySelector('#availability-finder-panel');
    const isOpen = panel.style.display !== 'none';
    if (isOpen) { panel.style.display = 'none'; panel.innerHTML = ''; return; }

    const categories = [...new Set(vehicles.map(v => v.category).filter(Boolean))];
    panel.style.display = 'block';
    panel.innerHTML = `
      <div class="panel" style="margin-bottom:16px">
        <h3>🔎 البحث عن سيارة متاحة</h3>
        <div class="form-grid">
          <label>من تاريخ<input type="date" id="find-start" class="input" value="${Utils.todayISO()}"></label>
          <label>إلى تاريخ<input type="date" id="find-end" class="input" value="${Utils.addDays(Utils.todayISO(), 1)}"></label>
          <label>الفئة (اختياري)
            <select id="find-category" class="input">
              <option value="">كل الفئات</option>
              ${categories.map(c => `<option value="${Utils.esc(c)}">${Utils.esc(c)}</option>`).join('')}
            </select>
          </label>
          <div class="modal-actions span-2" style="justify-content:flex-start">
            <button class="btn btn-primary" id="find-btn">بحث</button>
          </div>
        </div>
        <div id="find-results" style="margin-top:12px"></div>
      </div>
    `;

    panel.querySelector('#find-btn').onclick = async () => {
      const start = panel.querySelector('#find-start').value;
      const end = panel.querySelector('#find-end').value;
      const category = panel.querySelector('#find-category').value;
      const resultsBox = panel.querySelector('#find-results');

      if (!start || !end || new Date(end) <= new Date(start)) {
        resultsBox.innerHTML = '<div class="form-error">تأكد من صحة التواريخ</div>';
        return;
      }

      const candidates = category ? vehicles.filter(v => v.category === category) : vehicles;
      const availableList = [];
      for (const v of candidates) {
        if (v.status === 'out_of_service') continue;
        const { available } = await checkVehicleAvailability(v.id, start, end);
        if (available) availableList.push(v);
      }

      if (!availableList.length) {
        resultsBox.innerHTML = '<div class="empty-state">لا توجد سيارات متاحة في هذه الفترة</div>';
        return;
      }

      resultsBox.innerHTML = `
        <table class="table table-compact">
          <thead><tr><th>اللوحة</th><th>الماركة/الموديل</th><th>الفئة</th><th>السعر اليومي</th><th></th></tr></thead>
          <tbody>
            ${availableList.map(v => `
              <tr>
                <td>${Utils.esc(v.plate)}</td>
                <td>${Utils.esc(v.brand)} ${Utils.esc(v.model)}</td>
                <td>${Utils.esc(v.category || '—')}</td>
                <td>${Utils.fmtMoney(v.dailyRate)}</td>
                <td><button class="btn btn-primary book-this-btn" data-vehicle="${v.id}" style="padding:5px 12px; font-size:12px">احجز الآن</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      `;

      resultsBox.querySelectorAll('.book-this-btn').forEach(btn => {
        btn.onclick = () => {
          panel.style.display = 'none';
          window.__bookingOpenFormRef && window.__bookingOpenFormRef(null, { vehicleId: btn.dataset.vehicle, startDate: start, endDate: end });
        };
      });
    };
  }

  function renderCalendar(container, bookings, contracts, vehicles, vMap, cMap) {
    const wrap = container.querySelector('#calendar-wrap');
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay(); // 0=Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthName = firstDay.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });

    // Merge bookings + active/closed contracts into a single occupancy list
    const events = [
      ...bookings.filter(b => b.status !== 'cancelled').map(b => ({ ...b, kind: 'booking' })),
      ...contracts.filter(c => c.status === 'active').map(c => ({ ...c, kind: 'contract' })),
    ];

    function eventsOnDay(dateStr) {
      return events.filter(e => e.startDate <= dateStr && dateStr < e.endDate);
    }

    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push('<div class="cal-cell cal-empty"></div>');
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayEvents = eventsOnDay(dateStr);
      const isToday = dateStr === Utils.todayISO();
      cells.push(`
        <div class="cal-cell ${isToday ? 'cal-today' : ''}" data-date="${dateStr}">
          <div class="cal-daynum">${d}</div>
          ${dayEvents.slice(0, 3).map(e => `<div class="cal-event cal-event-${e.kind}">${Utils.esc(vMap[e.vehicleId]?.plate || '—')}</div>`).join('')}
          ${dayEvents.length > 3 ? `<div class="cal-more">+${dayEvents.length - 3} أخرى</div>` : ''}
        </div>`);
    }

    wrap.innerHTML = `
      <div class="cal-header">
        <button class="btn btn-ghost" id="cal-prev">◀ السابق</button>
        <strong>${monthName}</strong>
        <button class="btn btn-ghost" id="cal-next">التالي ▶</button>
      </div>
      <div class="cal-grid cal-grid-head">
        ${['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'].map(d => `<div class="cal-headcell">${d}</div>`).join('')}
      </div>
      <div class="cal-grid">${cells.join('')}</div>
    `;

    wrap.querySelector('#cal-prev').onclick = () => { calMonth = new Date(year, month - 1, 1); render(container); };
    wrap.querySelector('#cal-next').onclick = () => { calMonth = new Date(year, month + 1, 1); render(container); };

    wrap.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
      cell.addEventListener('click', () => {
        const dateStr = cell.dataset.date;
        const dayEvents = eventsOnDay(dateStr);
        if (!dayEvents.length) return;
        Utils.openModal(`حجوزات وعقود يوم ${Utils.fmtDate(dateStr)}`, `
          <table class="table">
            <thead><tr><th>النوع</th><th>السيارة</th><th>العميل</th><th>من</th><th>إلى</th><th>الحالة</th></tr></thead>
            <tbody>
              ${dayEvents.map(e => `
                <tr>
                  <td>${e.kind === 'booking' ? '<span class="badge badge-blue">حجز</span>' : '<span class="badge badge-purple">عقد</span>'}</td>
                  <td>${Utils.esc(vMap[e.vehicleId]?.plate || '—')}</td>
                  <td>${Utils.esc(cMap[e.customerId]?.name || '—')}</td>
                  <td>${Utils.fmtDate(e.startDate)}</td>
                  <td>${Utils.fmtDate(e.endDate)}</td>
                  <td>${e.kind === 'booking' ? Utils.esc(STATUS[e.status]?.label || e.status) : Utils.esc(ContractsModule.STATUS[e.status]?.label || e.status)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        `, { size: 'lg' });
      });
    });
  }

  return { render, STATUS };
})();

window.BookingsModule = BookingsModule;
