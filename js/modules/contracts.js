'use strict';

const ContractsModule = (() => {
  const STATUS = {
    active:    { label: 'ساري',   cls: 'blue' },
    closed:    { label: 'مغلق',   cls: 'green' },
    cancelled: { label: 'ملغي',   cls: 'red' },
    archived:  { label: 'مؤرشف', cls: 'gray' },
  };

  const TYPE_LABEL = { daily: 'يومي', weekly: 'أسبوعي', monthly: 'شهري', yearly: 'سنوي' };

  function computeQuantity(type, days) {
    if (type === 'weekly') return Math.ceil(days / 7);
    if (type === 'monthly') return Math.ceil(days / 30);
    if (type === 'yearly') return Math.ceil(days / 365);
    return days; // daily
  }

  function unitRateFor(vehicle, type) {
    if (type === 'weekly') return Number(vehicle.weeklyRate || vehicle.dailyRate * 7 || 0);
    if (type === 'monthly') return Number(vehicle.monthlyRate || vehicle.dailyRate * 30 || 0);
    if (type === 'yearly') return Number((vehicle.monthlyRate || vehicle.dailyRate * 30 || 0) * 12);
    return Number(vehicle.dailyRate || 0);
  }

  async function render(container, query = {}) {
    const [contracts, vehicles, customers, bookings] = await Promise.all([
      DB.getAll('contracts'), DB.getAll('vehicles'), DB.getAll('customers'), DB.getAll('bookings')
    ]);
    contracts.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const vMap = Object.fromEntries(vehicles.map(v => [v.id, v]));
    const cMap = Object.fromEntries(customers.map(c => [c.id, c]));

    const canManage = await hasPermission('manageClosedContracts');
    const canPermanentDelete = await hasPermission('permanentDelete');

    container.innerHTML = `
      <div class="page-head">
        <div>
          <h2>العقود</h2>
          <p class="muted">إنشاء وإدارة عقود التأجير مع الطباعة — العقود لا تُحذف نهائيًا، بل تُغلق أو تُلغى أو تُؤرشف مع الاحتفاظ بكامل بياناتها المحاسبية</p>
        </div>
        <button class="btn btn-primary" id="add-contract-btn">+ عقد جديد</button>
      </div>

      <div class="toolbar">
        <select id="status-filter" class="input">
          <option value="">كل الحالات (عدا المؤرشفة)</option>
          <option value="active">سارية</option>
          <option value="closed">مغلقة</option>
          <option value="cancelled">ملغاة</option>
          <option value="archived">مؤرشفة فقط</option>
          <option value="__all">الكل بما فيها المؤرشفة</option>
        </select>
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>رقم العقد</th><th>السيارة</th><th>العميل</th><th>الفترة</th><th>الإجمالي</th><th>المتبقي</th><th>الحالة</th><th></th></tr>
          </thead>
          <tbody id="contracts-tbody"></tbody>
        </table>
        <div id="contracts-empty" class="empty-state" style="display:none">لا توجد عقود بعد</div>
        <div id="contracts-pagination"></div>
      </div>
    `;

    const tbody = container.querySelector('#contracts-tbody');
    const PAGE_SIZE = 25;
    let currentPage = 1;

    function draw(list) {
      const { items, page, totalPages, total } = Utils.paginate(list, currentPage, PAGE_SIZE);
      currentPage = page;
      tbody.innerHTML = items.map(c => {
        const v = vMap[c.vehicleId], cu = cMap[c.customerId];
        const remaining = Number(c.totalAmount || 0) - Number(c.paidAmount || 0);
        const isActive = c.status === 'active';
        const isClosedOrCancelled = c.status === 'closed' || c.status === 'cancelled';
        const isArchived = c.status === 'archived';
        return `
        <tr>
          <td><strong>${Utils.esc(c.contractNo)}</strong></td>
          <td>${v ? Utils.esc(v.plate) : '—'}</td>
          <td>${cu ? Utils.esc(cu.name) : '—'}</td>
          <td>${Utils.fmtDate(c.startDate)} → ${Utils.fmtDate(c.endDate)}</td>
          <td>${Utils.fmtMoney(c.totalAmount)}</td>
          <td class="${remaining > 0 ? 'text-danger' : ''}">${Utils.fmtMoney(remaining)}</td>
          <td>${Utils.statusBadge(c.status, STATUS)}</td>
          <td class="row-actions">
            <button class="icon-btn print-btn" data-id="${c.id}" title="طباعة PDF">🖨</button>
            ${isActive ? `<button class="icon-btn wa-btn" data-id="${c.id}" title="إرسال تذكير واتساب">💬</button>` : ''}
            ${isActive ? `<button class="icon-btn renew-btn" data-id="${c.id}" title="تجديد العقد">🔁</button>` : ''}
            ${(isActive || (isClosedOrCancelled && canManage)) ? `<button class="icon-btn edit-btn" data-id="${c.id}" title="تعديل العقد">✎</button>` : ''}
            ${isActive ? `<button class="icon-btn close-btn" data-id="${c.id}" title="إغلاق/تسليم">✅</button>` : ''}
            ${isActive && canManage ? `<button class="icon-btn cancel-btn" data-id="${c.id}" title="إلغاء العقد">🚫</button>` : ''}
            ${isClosedOrCancelled && canManage ? `<button class="icon-btn reopen-btn" data-id="${c.id}" title="إعادة فتح العقد">🔓</button>` : ''}
            ${isClosedOrCancelled && canManage ? `<button class="icon-btn archive-btn" data-id="${c.id}" title="أرشفة العقد">🗄</button>` : ''}
            ${isArchived && canManage ? `<button class="icon-btn restore-btn" data-id="${c.id}" title="استعادة من الأرشيف">♻️</button>` : ''}
            ${isArchived && canPermanentDelete ? `<button class="icon-btn del-btn" data-id="${c.id}" title="حذف نهائي (لا رجعة فيه)">🗑</button>` : ''}
          </td>
        </tr>`;
      }).join('');
      container.querySelector('#contracts-empty').style.display = list.length ? 'none' : 'block';
      Utils.renderPagination(container.querySelector('#contracts-pagination'), { page, totalPages, total }, (p) => { currentPage = p; draw(list); });
      tbody.querySelectorAll('.print-btn').forEach(b => b.onclick = () => printContract(b.dataset.id));
      tbody.querySelectorAll('.edit-btn').forEach(b => b.onclick = () => openForm(null, b.dataset.id));
      tbody.querySelectorAll('.close-btn').forEach(b => b.onclick = () => closeContract(b.dataset.id));
      tbody.querySelectorAll('.cancel-btn').forEach(b => b.onclick = () => cancelContract(b.dataset.id));
      tbody.querySelectorAll('.reopen-btn').forEach(b => b.onclick = () => reopenContract(b.dataset.id));
      tbody.querySelectorAll('.archive-btn').forEach(b => b.onclick = () => archiveContract(b.dataset.id));
      tbody.querySelectorAll('.restore-btn').forEach(b => b.onclick = () => restoreContract(b.dataset.id));
      tbody.querySelectorAll('.del-btn').forEach(b => b.onclick = () => permanentDelete(b.dataset.id));
      tbody.querySelectorAll('.renew-btn').forEach(b => b.onclick = () => openRenewForm(b.dataset.id));
      tbody.querySelectorAll('.wa-btn').forEach(b => b.onclick = async () => {
        const c = await DB.get('contracts', b.dataset.id);
        const v = vMap[c.vehicleId], cu = cMap[c.customerId];
        const remaining = Number(c.totalAmount || 0) - Number(c.paidAmount || 0);
        const msg = `مرحباً ${cu?.name || ''}، تذكير بعقد الإيجار رقم ${c.contractNo} للسيارة ${v?.plate || ''} — تاريخ الانتهاء ${Utils.fmtDate(c.endDate)}${remaining > 0 ? `، المتبقي: ${Utils.fmtMoney(remaining)}` : ''}. شكراً لتعاملكم معنا.`;
        Utils.openWhatsApp(cu?.phone, msg);
      });
    }

    function applyStatusFilter() {
      currentPage = 1;
      const st = container.querySelector('#status-filter').value;
      let list;
      if (st === '__all') list = contracts;
      else if (st === 'archived') list = contracts.filter(c => c.status === 'archived');
      else if (st) list = contracts.filter(c => c.status === st && c.status !== 'archived');
      else list = contracts.filter(c => c.status !== 'archived');
      draw(list);
    }
    container.querySelector('#status-filter').addEventListener('change', applyStatusFilter);

    container.querySelector('#add-contract-btn').onclick = () => openForm(query.fromBooking);
    applyStatusFilter();

    if (query.fromBooking) openForm(query.fromBooking);

    async function cancelContract(id) {
      const c = await DB.get('contracts', id);
      const reason = await Utils.promptDialog(`سيتم إلغاء العقد ${c.contractNo} وتحرير السيارة، دون التأثير على أي مدفوعات أو حركات مالية مسجّلة بالفعل. سبب الإلغاء (اختياري):`);
      if (reason === null) return;
      c.status = 'cancelled';
      c.cancelReason = reason || '';
      c.cancelledAt = new Date().toISOString();
      await DB.add('contracts', c);
      const v = await DB.get('vehicles', c.vehicleId);
      if (v && v.status === 'rented') { v.status = 'available'; await DB.add('vehicles', v); }
      Utils.toast('تم إلغاء العقد وتحرير السيارة', 'success');
      render(container);
    }

    async function reopenContract(id) {
      const c = await DB.get('contracts', id);
      const { available, conflict } = await checkVehicleAvailability(c.vehicleId, c.startDate, c.endDate, c.id);
      if (!available) {
        Utils.toast(`تعذّرت إعادة الفتح: السيارة مرتبطة بعقد/حجز آخر بين ${Utils.fmtDate(conflict.startDate)} و ${Utils.fmtDate(conflict.endDate)}`, 'error');
        return;
      }
      const ok = await Utils.confirmDialog(`إعادة فتح العقد ${c.contractNo} وتحويله إلى "ساري" مرة أخرى؟ لن يتم التأثير على أي مدفوعات مسجّلة بالفعل.`);
      if (!ok) return;
      c.status = 'active';
      delete c.cancelReason; delete c.cancelledAt;
      await DB.add('contracts', c);
      const v = await DB.get('vehicles', c.vehicleId);
      if (v) { v.status = 'rented'; await DB.add('vehicles', v); }
      Utils.toast('تم إعادة فتح العقد', 'success');
      render(container);
    }

    async function archiveContract(id) {
      const c = await DB.get('contracts', id);
      const reason = await Utils.promptDialog(`سيتم نقل العقد ${c.contractNo} إلى الأرشيف — يختفي من القائمة الرئيسية لكن تبقى بياناته وحركاته المحاسبية محفوظة بالكامل ويمكن استعادته لاحقًا. ملاحظة أرشفة (اختياري):`);
      if (reason === null) return;
      await archiveRecord('contracts', id, { newStatus: 'archived', reason });
      Utils.toast('تم أرشفة العقد', 'success');
      render(container);
    }

    async function restoreContract(id) {
      const ok = await Utils.confirmDialog('استعادة هذا العقد من الأرشيف إلى حالته السابقة؟');
      if (!ok) return;
      await restoreRecord('contracts', id);
      Utils.toast('تم استعادة العقد', 'success');
      render(container);
    }

    async function permanentDelete(id) {
      const c = await DB.get('contracts', id);
      const typed = await Utils.promptDialog(`حذف نهائي — لا يمكن التراجع عنه، وسيُفقد كل تاريخ هذا العقد المحاسبي. اكتب رقم العقد "${c.contractNo}" بالضبط للتأكيد:`, { placeholder: c.contractNo, required: true });
      if (!typed) return;
      if (typed.trim() !== c.contractNo) { Utils.toast('رقم العقد غير مطابق — تم إلغاء الحذف', 'error'); return; }
      await DB.delete('contracts', id);
      Utils.toast('تم حذف العقد نهائيًا', 'success');
      render(container);
    }

    async function openRenewForm(id) {
      const c = await DB.get('contracts', id);
      const v = vMap[c.vehicleId] || await DB.get('vehicles', c.vehicleId);

      Utils.openModal(`تجديد العقد ${Utils.esc(c.contractNo)}`, `
        <form id="renew-form" class="form-grid">
          <p class="muted span-2">تاريخ الانتهاء الحالي: <strong>${Utils.fmtDate(c.endDate)}</strong></p>
          <label>تاريخ الانتهاء الجديد *<input required type="date" name="newEndDate" class="input" value="${Utils.addDays(c.endDate, 1)}"></label>
          <label>سعر اليوم الإضافي<input type="number" name="extraDailyRate" class="input" value="${Utils.esc(v?.dailyRate || c.unitRate || 0)}"></label>
          <div class="total-box span-2"><span>عدد الأيام الإضافية</span><strong id="renew-days-display">0</strong></div>
          <div class="total-box span-2"><span>المبلغ الإضافي</span><strong id="renew-total-display">0.00 ${Utils.currencySymbol}</strong></div>
          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">تأكيد التجديد</button>
          </div>
        </form>
      `, { size: 'sm' });

      const form = document.getElementById('renew-form');
      function recalcRenew() {
        const newEnd = form.querySelector('[name="newEndDate"]').value;
        const rate = Number(form.querySelector('[name="extraDailyRate"]').value || 0);
        const days = newEnd ? Math.max(0, Utils.daysBetween(c.endDate, newEnd)) : 0;
        form.querySelector('#renew-days-display').textContent = days;
        form.querySelector('#renew-total-display').textContent = Utils.fmtMoney(days * rate);
        form.dataset.extraAmount = days * rate;
        form.dataset.days = days;
      }
      form.querySelector('[name="newEndDate"]').addEventListener('change', recalcRenew);
      form.querySelector('[name="extraDailyRate"]').addEventListener('input', recalcRenew);
      recalcRenew();

      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      form.onsubmit = async (e) => {
        e.preventDefault();
        const newEndDate = form.querySelector('[name="newEndDate"]').value;
        if (new Date(newEndDate) <= new Date(c.endDate)) {
          Utils.toast('تاريخ الانتهاء الجديد يجب أن يكون بعد التاريخ الحالي', 'error');
          return;
        }
        const { available, conflict } = await checkVehicleAvailability(c.vehicleId, c.endDate, newEndDate, c.id);
        if (!available) {
          Utils.toast(`لا يمكن التجديد: السيارة محجوزة بالفعل بين ${Utils.fmtDate(conflict.startDate)} و ${Utils.fmtDate(conflict.endDate)}`, 'error');
          return;
        }
        const extraAmount = Number(form.dataset.extraAmount || 0);
        c.endDate = newEndDate;
        c.totalAmount = Number(c.totalAmount || 0) + extraAmount;
        c.quantity = Number(c.quantity || 0) + Number(form.dataset.days || 0);
        await DB.add('contracts', c);
        Utils.toast('تم تجديد العقد بنجاح', 'success');
        Utils.closeModal();
        render(container);
      };
    }

    async function closeContract(id) {
      const c = await DB.get('contracts', id);
      const accounts = await DB.getAll('accounts');
      Utils.openModal('إغلاق العقد / تسليم السيارة', `
        <form id="close-form" class="form-grid">
          <label>قراءة العداد عند الاستلام<input name="odometerEnd" type="number" class="input" value="${Utils.esc(c.odometerStart || 0)}"></label>
          <label>المبلغ المدفوع الآن<input name="paidNow" type="number" class="input" value="0"></label>
          <label class="span-2">يُضاف إلى حساب
            <select name="accountId" class="input">
              <option value="">— بدون ربط بالخزينة —</option>
              ${accounts.map(a => `<option value="${a.id}">${Utils.esc(a.name)}</option>`).join('')}
            </select>
          </label>
          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">تأكيد الإغلاق</button>
          </div>
        </form>
      `, { size: 'sm' });
      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      document.getElementById('close-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target).entries());
        c.odometerEnd = fd.odometerEnd;
        c.paidAmount = Number(c.paidAmount || 0) + Number(fd.paidNow || 0);
        c.status = 'closed';
        await DB.add('contracts', c);
        const v = await DB.get('vehicles', c.vehicleId);
        if (v) { v.status = 'available'; v.odometer = fd.odometerEnd || v.odometer; await DB.add('vehicles', v); }
        if (Number(fd.paidNow) > 0 && fd.accountId) {
          await createTransaction({
            accountId: fd.accountId, direction: 'in', amount: fd.paidNow,
            category: 'إيراد عقد', refType: 'contract', refId: c.id,
            note: `تحصيل نهائي عقد ${c.contractNo}`,
          });
        }
        Utils.toast('تم إغلاق العقد وتحرير السيارة', 'success');
        Utils.closeModal();
        render(container);
      };
    }

    async function openForm(fromBookingId, editId) {
      const settings = await getSettings();
      let prefill = {};
      let isEdit = false;
      if (editId) {
        const existing = await DB.get('contracts', editId);
        if (existing) { prefill = { ...existing }; isEdit = true; }
      } else if (fromBookingId) {
        const bk = bookings.find(b => b.id === fromBookingId);
        if (bk) prefill = { vehicleId: bk.vehicleId, customerId: bk.customerId, startDate: bk.startDate, endDate: bk.endDate, _bookingId: bk.id };
      }

      Utils.openModal(isEdit ? `تعديل العقد ${Utils.esc(prefill.contractNo)}` : 'عقد تأجير جديد', `
        <form id="contract-form" class="form-grid">
          <label>السيارة *
            <select required name="vehicleId" id="c-vehicle" class="input" ${isEdit ? 'style="pointer-events:none;opacity:.65"' : ''}>
              <option value="">اختر السيارة</option>
              ${vehicles.map(v => `<option value="${v.id}" ${prefill.vehicleId === v.id ? 'selected' : ''}>${Utils.esc(v.plate)} — ${Utils.esc(v.brand)} ${Utils.esc(v.model)}</option>`).join('')}
            </select>
          </label>
          <label>العميل *
            <select required name="customerId" id="c-customer" class="input" ${isEdit ? 'style="pointer-events:none;opacity:.65"' : ''}>
              <option value="">اختر العميل</option>
              ${customers.map(c => `<option value="${c.id}" ${prefill.customerId === c.id ? 'selected' : ''}>${Utils.esc(c.name)} — ${Utils.esc(c.phone || '')}</option>`).join('')}
            </select>
          </label>
          <label>نوع الإيجار
            <select name="type" id="c-type" class="input">
              ${Object.entries(TYPE_LABEL).map(([k, l]) => `<option value="${k}" ${prefill.type === k ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>
          <label>تاريخ البداية *<input required type="date" id="c-start" name="startDate" class="input" value="${Utils.esc((prefill.startDate || Utils.todayISO()).slice(0,10))}"></label>
          <label>تاريخ النهاية *<input required type="date" id="c-end" name="endDate" class="input" value="${Utils.esc((prefill.endDate || '').slice(0,10))}"></label>
          <label>عدد الأيام<input readonly id="c-days" class="input" value="0"></label>

          <div class="form-section-title">التسعير</div>
          <label>سعر الوحدة<input type="number" id="c-rate" name="unitRate" class="input" value="${Utils.esc(prefill.unitRate || 0)}" ${isEdit ? 'data-touched="1"' : ''}></label>
          <label>الكمية<input readonly id="c-qty" name="quantity" class="input" value="0"></label>
          <label>خصم (مبلغ)<input type="number" id="c-discount" name="discount" class="input" value="${Utils.esc(prefill.discount || 0)}"></label>
          <label>ضريبة %<input type="number" id="c-tax" name="taxPercent" class="input" value="${Utils.esc(prefill.taxPercent ?? settings.defaultTaxPercent ?? 0)}"></label>
          <label>التأمين (تحت الطلب)<input type="number" id="c-deposit" name="deposit" class="input" value="${Utils.esc(prefill.deposit || 0)}"></label>
          <label>رسوم إضافية<input type="number" id="c-extra" name="extraFees" class="input" value="${Utils.esc(prefill.extraFees || 0)}"></label>
          <label>رسوم السائق<input type="number" id="c-driver" name="driverFee" class="input" value="${Utils.esc(prefill.driverFee || 0)}"></label>
          <label>رسوم التوصيل<input type="number" id="c-delivery" name="deliveryFee" class="input" value="${Utils.esc(prefill.deliveryFee || 0)}"></label>
          <label>رسوم الاستلام<input type="number" id="c-pickup" name="pickupFee" class="input" value="${Utils.esc(prefill.pickupFee || 0)}"></label>
          <label>الكيلومترات المجانية<input type="number" name="freeKm" class="input" value="${Utils.esc(prefill.freeKm ?? settings.defaultFreeKm ?? 200)}"></label>
          <label>سعر الكيلومتر الزائد<input type="number" name="extraKmPrice" class="input" value="${Utils.esc(prefill.extraKmPrice ?? settings.defaultExtraKmPrice ?? 0)}"></label>

          <div class="form-section-title">حالة السيارة عند التسليم</div>
          <label>مستوى الوقود
            <select name="fuelLevel" class="input">
              ${['ممتلئ','3/4','1/2','1/4','فارغ'].map(f => `<option ${prefill.fuelLevel === f ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
          </label>
          <label>عداد الكيلومترات<input type="number" name="odometerStart" id="c-odo" class="input" value="${Utils.esc(prefill.odometerStart || 0)}" ${isEdit ? 'data-touched="1"' : ''}></label>

          <div class="form-section-title">الإجمالي</div>
          <div class="total-box span-2">
            <span>الإجمالي المستحق</span>
            <strong id="c-total-display">0.00 ${Utils.currencySymbol}</strong>
          </div>
          ${!isEdit ? `
          <label>المبلغ المدفوع مقدماً<input type="number" id="c-paid" name="paidAmount" class="input" value="0"></label>
          <label>يُضاف إلى حساب (خزينة/محفظة)
            <select name="accountId" class="input" id="c-account">
              <option value="">— بدون ربط بالخزينة —</option>
              ${(await DB.getAll('accounts')).map(a => `<option value="${a.id}">${Utils.esc(a.name)}</option>`).join('')}
            </select>
          </label>
          ` : `<p class="muted span-2">لإدارة المدفوعات، استخدم "استلام سيارة" أو "إغلاق/تسليم" من صفحة العقود.</p>`}

          ${!isEdit ? `
          <div class="form-section-title">التوقيع الإلكتروني</div>
          <div>
            <div class="muted" style="font-size:12px; margin-bottom:6px">توقيع العميل</div>
            <div id="c-sig-customer"></div>
          </div>
          <div>
            <div class="muted" style="font-size:12px; margin-bottom:6px">توقيع الموظف</div>
            <div id="c-sig-employee"></div>
          </div>
          ` : ''}

          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'حفظ التعديلات' : 'إنشاء العقد'}</button>
          </div>
        </form>
      `, { size: 'lg' });

      const form = document.getElementById('contract-form');
      const vehicleSelect = document.getElementById('c-vehicle');
      let custSigPad = null, empSigPad = null;
      if (!isEdit) {
        Utils.enhanceSearchableSelect(vehicleSelect, 'اكتب رقم اللوحة أو الماركة...');
        Utils.enhanceSearchableSelect(document.getElementById('c-customer'), 'اكتب اسم العميل أو الهاتف...');
        custSigPad = Utils.createSignaturePad(document.getElementById('c-sig-customer'));
        empSigPad = Utils.createSignaturePad(document.getElementById('c-sig-employee'));
      }

      function recalc() {
        const v = vMap[vehicleSelect.value];
        const type = document.getElementById('c-type').value;
        const start = document.getElementById('c-start').value;
        const end = document.getElementById('c-end').value;
        const days = (start && end && new Date(end) > new Date(start)) ? Utils.daysBetween(start, end) : 0;
        document.getElementById('c-days').value = days;

        if (v && !document.getElementById('c-rate').dataset.touched) {
          document.getElementById('c-rate').value = unitRateFor(v, type);
        }
        if (v && !document.getElementById('c-odo').dataset.touched) document.getElementById('c-odo').value = v.odometer || 0;

        const qty = computeQuantity(type, days);
        document.getElementById('c-qty').value = qty;

        const rate = Number(document.getElementById('c-rate').value || 0);
        const discount = Number(document.getElementById('c-discount').value || 0);
        const taxPercent = Number(document.getElementById('c-tax').value || 0);
        const deposit = Number(document.getElementById('c-deposit').value || 0);
        const extra = Number(document.getElementById('c-extra').value || 0);
        const driver = Number(document.getElementById('c-driver').value || 0);
        const delivery = Number(document.getElementById('c-delivery').value || 0);
        const pickup = Number(document.getElementById('c-pickup').value || 0);

        const subtotal = rate * qty;
        const taxAmount = subtotal * (taxPercent / 100);
        const total = subtotal - discount + taxAmount + deposit + extra + driver + delivery + pickup;
        document.getElementById('c-total-display').textContent = Utils.fmtMoney(Math.max(0, total));
        form.dataset.computedTotal = Math.max(0, total);
      }

      ['c-vehicle', 'c-type', 'c-start', 'c-end', 'c-discount', 'c-tax', 'c-deposit', 'c-extra', 'c-driver', 'c-delivery', 'c-pickup'].forEach(id => {
        document.getElementById(id).addEventListener('input', recalc);
        document.getElementById(id).addEventListener('change', recalc);
      });
      document.getElementById('c-rate').addEventListener('input', (e) => { e.target.dataset.touched = '1'; recalc(); });
      document.getElementById('c-odo').addEventListener('input', (e) => { e.target.dataset.touched = '1'; });
      recalc();

      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      form.onsubmit = async (e) => {
        e.preventDefault();
        const vehicleId = vehicleSelect.value;
        const startDate = document.getElementById('c-start').value;
        const endDate = document.getElementById('c-end').value;

        const { available, conflict } = await checkVehicleAvailability(vehicleId, startDate, endDate, isEdit ? editId : null);
        if (!available) {
          Utils.toast(`تعارض: السيارة محجوزة بالفعل بين ${Utils.fmtDate(conflict.startDate)} و ${Utils.fmtDate(conflict.endDate)}`, 'error');
          return;
        }

        if (!isEdit) {
          const custId = document.getElementById('c-customer').value;
          const cust = customers.find(x => x.id === custId);
          if (cust && cust.blacklisted === '1') {
            const proceed = await Utils.confirmDialog(`تنبيه: العميل "${cust.name}" مدرج في القائمة السوداء. هل تريد المتابعة رغم ذلك؟`);
            if (!proceed) return;
          }
        }

        if (isEdit) {
          const fd = Object.fromEntries(new FormData(form).entries());
          const updated = { ...prefill, ...fd, id: editId };
          updated.totalAmount = Number(form.dataset.computedTotal || 0);
          // vehicleId/customerId are locked in the UI, but restore them explicitly
          // in case the disabled-looking select still submitted an empty value.
          updated.vehicleId = prefill.vehicleId;
          updated.customerId = prefill.customerId;
          updated.contractNo = prefill.contractNo;
          updated.status = prefill.status;
          updated.paidAmount = prefill.paidAmount;
          await DB.add('contracts', updated);
          Utils.toast('تم تحديث العقد بنجاح', 'success');
          Utils.closeModal();
          render(container);
          return;
        }

        const fd = Object.fromEntries(new FormData(form).entries());
        fd.totalAmount = Number(form.dataset.computedTotal || 0);
        fd.status = 'active';
        fd.contractNo = await nextContractNo();
        fd.customerSignature = custSigPad ? custSigPad.getDataURL() : null;
        fd.employeeSignature = empSigPad ? empSigPad.getDataURL() : null;
        const saved = await DB.add('contracts', fd);

        const v = await DB.get('vehicles', vehicleId);
        if (v) { v.status = 'rented'; await DB.add('vehicles', v); }

        if (prefill._bookingId) {
          const bk = await DB.get('bookings', prefill._bookingId);
          if (bk) { bk.status = 'completed'; await DB.add('bookings', bk); }
        }

        if (Number(fd.paidAmount) > 0 && fd.accountId) {
          await createTransaction({
            accountId: fd.accountId, direction: 'in', amount: fd.paidAmount,
            category: 'إيراد عقد', refType: 'contract', refId: saved.id,
            note: `دفعة عقد ${saved.contractNo}`,
          });
        }

        Utils.toast('تم إنشاء العقد بنجاح', 'success');
        Utils.closeModal();
        render(container);
        printContract(saved.id);
      };
    }

    async function printContract(id) {
      const c = await DB.get('contracts', id);
      const v = vMap[c.vehicleId] || await DB.get('vehicles', c.vehicleId);
      const cu = cMap[c.customerId] || await DB.get('customers', c.customerId);
      const settings = await getSettings();

      const win = window.open('', '_blank', 'width=900,height=1000');
      win.document.write(`
        <!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
        <title>عقد ${Utils.esc(c.contractNo)}</title>
        <style>
          body { font-family: 'Tahoma', Arial, sans-serif; padding: 30px; color: #1a1a1a; }
          h1 { text-align:center; font-size: 20px; margin-bottom: 4px; }
          .sub { text-align:center; color:#555; margin-bottom: 20px; }
          table { width:100%; border-collapse: collapse; margin-bottom: 16px; }
          td, th { border: 1px solid #ccc; padding: 6px 10px; font-size: 13px; text-align: right; }
          th { background: #f2f2f2; }
          .totals { margin-top: 10px; width: 300px; margin-inline-start: auto; }
          .totals td { border: none; padding: 3px 10px; }
          .totals .grand { font-weight:bold; font-size: 15px; border-top: 2px solid #333; }
          .sign { display:flex; justify-content:space-between; margin-top: 60px; }
          .sign div { width: 40%; text-align:center; border-top: 1px solid #333; padding-top: 6px; }
        </style></head><body>
        <h1>${Utils.esc(settings.companyName)}</h1>
        <div class="sub">${Utils.esc(settings.phone || '')} ${settings.address ? ' — ' + Utils.esc(settings.address) : ''}</div>
        <h1 style="font-size:16px; margin-top:14px">عقد إيجار سيارة</h1>
        <div class="sub">رقم العقد: ${Utils.esc(c.contractNo)} — تاريخ الإصدار: ${Utils.fmtDate(c.createdAt)}</div>

        <table>
          <tr><th>بيانات العميل</th><th>بيانات السيارة</th></tr>
          <tr>
            <td>
              الاسم: ${Utils.esc(cu?.name || '—')}<br>
              الهاتف: ${Utils.esc(cu?.phone || '—')}<br>
              الرقم القومي: ${Utils.esc(cu?.nationalId || cu?.passportNo || '—')}<br>
              رخصة القيادة: ${Utils.esc(cu?.licenseNo || '—')}
            </td>
            <td>
              اللوحة: ${Utils.esc(v?.plate || '—')}<br>
              الماركة/الموديل: ${Utils.esc((v?.brand||'') + ' ' + (v?.model||''))}<br>
              اللون: ${Utils.esc(v?.color || '—')}<br>
              رقم الشاسيه: ${Utils.esc(v?.chassis || '—')}
            </td>
          </tr>
        </table>

        <table>
          <tr><th>نوع الإيجار</th><th>من</th><th>إلى</th><th>عدد الأيام</th><th>مستوى الوقود</th><th>عداد البداية</th></tr>
          <tr>
            <td>${TYPE_LABEL[c.type] || c.type}</td>
            <td>${Utils.fmtDate(c.startDate)}</td>
            <td>${Utils.fmtDate(c.endDate)}</td>
            <td>${Utils.esc(c.quantity)}</td>
            <td>${Utils.esc(c.fuelLevel || '—')}</td>
            <td>${Utils.esc(c.odometerStart || 0)} كم</td>
          </tr>
        </table>

        <table class="totals">
          <tr><td>سعر الوحدة × الكمية</td><td>${Utils.fmtMoney(Number(c.unitRate) * Number(c.quantity))}</td></tr>
          <tr><td>خصم</td><td>- ${Utils.fmtMoney(c.discount)}</td></tr>
          <tr><td>ضريبة</td><td>${Utils.esc(c.taxPercent || 0)}%</td></tr>
          <tr><td>تأمين</td><td>${Utils.fmtMoney(c.deposit)}</td></tr>
          <tr><td>رسوم إضافية/سائق/توصيل/استلام</td><td>${Utils.fmtMoney(Number(c.extraFees||0)+Number(c.driverFee||0)+Number(c.deliveryFee||0)+Number(c.pickupFee||0))}</td></tr>
          <tr class="grand"><td>الإجمالي المستحق</td><td>${Utils.fmtMoney(c.totalAmount)}</td></tr>
          <tr><td>المدفوع</td><td>${Utils.fmtMoney(c.paidAmount)}</td></tr>
          <tr><td>المتبقي</td><td>${Utils.fmtMoney(Number(c.totalAmount) - Number(c.paidAmount||0))}</td></tr>
        </table>

        <p>الكيلومترات المجانية: ${Utils.esc(c.freeKm || 0)} كم — سعر الكيلومتر الزائد: ${Utils.fmtMoney(c.extraKmPrice)}</p>
        ${settings.contractFooterNote ? `<p style="font-size:11.5px; color:#555; border-top:1px solid #ddd; padding-top:8px">${Utils.esc(settings.contractFooterNote)}</p>` : ''}

        <div class="sign">
          <div>${c.customerSignature ? `<img src="${c.customerSignature}" style="max-height:60px; margin-bottom:4px"><br>` : ''}توقيع العميل</div>
          <div>${c.employeeSignature ? `<img src="${c.employeeSignature}" style="max-height:60px; margin-bottom:4px"><br>` : ''}توقيع الموظف المسؤول</div>
        </div>

        <script>window.onload = () => window.print();</script>
        </body></html>
      `);
      win.document.close();
    }
  }

  return { render, STATUS };
})();

window.ContractsModule = ContractsModule;
