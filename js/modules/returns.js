'use strict';

const ReturnsModule = (() => {
  async function render(container) {
    const [returns, contracts, vehicles, customers, accounts] = await Promise.all([
      DB.getAll('returns'), DB.getAll('contracts'), DB.getAll('vehicles'), DB.getAll('customers'), DB.getAll('accounts')
    ]);
    returns.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const vMap = Object.fromEntries(vehicles.map(v => [v.id, v]));
    const cMap = Object.fromEntries(customers.map(c => [c.id, c]));
    const ctMap = Object.fromEntries(contracts.map(c => [c.id, c]));

    // Eligible for "receive car": any ACTIVE contract (early or on-time return), OR a
    // contract that was already closed (e.g. via the quick-close button) but has no
    // inspection/return record yet — so nothing falls through the cracks.
    const returnedContractIds = new Set(returns.map(r => r.contractId));
    const eligibleContracts = contracts.filter(c =>
      c.status === 'active' || (c.status === 'closed' && !returnedContractIds.has(c.id))
    );

    container.innerHTML = `
      <div class="page-head">
        <div>
          <h2>المرتجعات</h2>
          <p class="muted">استلام السيارة من العميل — سواء في نهاية المدة أو رجوع مبكر لعدم رغبته في الاستمرار</p>
        </div>
        <button class="btn btn-primary" id="receive-car-btn">🚗↩️ استلام سيارة</button>
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>رقم العقد</th><th>السيارة</th><th>العميل</th><th>تاريخ الاستلام</th><th>نوع الإرجاع</th><th>حالة السيارة</th><th></th></tr></thead>
          <tbody id="ret-tbody"></tbody>
        </table>
        <div id="ret-empty" class="empty-state" style="display:none">لا توجد سجلات استلام بعد</div>
      </div>
    `;

    const tbody = container.querySelector('#ret-tbody');
    tbody.innerHTML = returns.map(r => {
      const c = ctMap[r.contractId];
      const early = c && r.date < c.endDate;
      return `
      <tr>
        <td>${Utils.esc(c?.contractNo || '—')}</td>
        <td>${Utils.esc(vMap[c?.vehicleId]?.plate || '—')}</td>
        <td>${Utils.esc(cMap[c?.customerId]?.name || '—')}</td>
        <td>${Utils.fmtDate(r.date)}</td>
        <td>${early ? '<span class="badge badge-orange">إرجاع مبكر</span>' : '<span class="badge badge-blue">في الموعد</span>'}</td>
        <td>${r.hasDamage === '1' ? '<span class="badge badge-orange">بها أضرار</span>' : '<span class="badge badge-green">سليمة</span>'}</td>
        <td class="row-actions">
          <button class="icon-btn view-btn" data-id="${r.id}" title="عرض">👁</button>
          <button class="icon-btn edit-btn" data-id="${r.id}" title="تعديل">✎</button>
          <button class="icon-btn del-btn" data-id="${r.id}" title="حذف">🗑</button>
        </td>
      </tr>`;
    }).join('');
    container.querySelector('#ret-empty').style.display = returns.length ? 'none' : 'block';
    tbody.querySelectorAll('.view-btn').forEach(b => b.onclick = () => viewReturn(b.dataset.id));
    tbody.querySelectorAll('.edit-btn').forEach(b => b.onclick = () => openEditForm(b.dataset.id));
    tbody.querySelectorAll('.del-btn').forEach(b => b.onclick = () => removeReturn(b.dataset.id));

    container.querySelector('#receive-car-btn').onclick = () => openForm();

    async function removeReturn(id) {
      const ok = await Utils.confirmDialog('هل تريد حذف سجل الاستلام هذا؟ (هذا لا يعيد فتح العقد أو يغيّر حالة السيارة تلقائيًا)');
      if (!ok) return;
      await DB.delete('returns', id);
      Utils.toast('تم حذف سجل الاستلام', 'success');
      render(container);
    }

    function openEditForm(id) {
      const r = returns.find(x => x.id === id);
      const c = ctMap[r.contractId];
      let damagePoints = [];
      try { damagePoints = JSON.parse(r.damagePoints || '[]'); } catch { /* ignore malformed data */ }

      Utils.openModal(`تعديل سجل استلام — عقد ${Utils.esc(c?.contractNo || '')}`, `
        <form id="return-edit-form" class="form-grid">
          <label>سبب الإرجاع
            <select name="reason" class="input">
              ${['نهاية مدة العقد', 'العميل لا يرغب في الاستمرار', 'مشكلة في السيارة', 'أخرى'].map(o => `<option ${r.reason === o ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
          </label>
          <label>مستوى الوقود
            <select name="fuelLevel" class="input">${['ممتلئ','3/4','1/2','1/4','فارغ'].map(f => `<option ${r.fuelLevel === f ? 'selected' : ''}>${f}</option>`).join('')}</select>
          </label>
          <label>عداد الكيلومترات<input type="number" name="odometer" class="input" value="${Utils.esc(r.odometer || 0)}"></label>
          <label>هل يوجد أضرار؟
            <select name="hasDamage" class="input"><option value="0" ${r.hasDamage !== '1' ? 'selected' : ''}>لا</option><option value="1" ${r.hasDamage === '1' ? 'selected' : ''}>نعم</option></select>
          </label>
          <label class="span-2">وصف الأضرار<textarea name="damageNotes" class="input" rows="2">${Utils.esc(r.damageNotes || '')}</textarea></label>
          <label class="span-2">الإكسسوارات الموجودة<input name="accessories" class="input" value="${Utils.esc(r.accessories || '')}"></label>
          <label class="span-2">ملاحظات عامة<textarea name="notes" class="input" rows="2">${Utils.esc(r.notes || '')}</textarea></label>
          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">حفظ التعديلات</button>
          </div>
        </form>`, { size: 'md' });

      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      document.getElementById('return-edit-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target).entries());
        const updated = { ...r, ...fd, id: r.id, damagePoints: JSON.stringify(damagePoints) };
        await DB.add('returns', updated);
        Utils.toast('تم تحديث سجل الاستلام', 'success');
        Utils.closeModal();
        render(container);
      };
    }

    function viewReturn(id) {
      const r = returns.find(x => x.id === id);
      const c = ctMap[r.contractId];
      let damagePoints = [];
      try { damagePoints = JSON.parse(r.damagePoints || '[]'); } catch { /* ignore malformed data */ }
      Utils.openModal('تفاصيل الاستلام', `
        <div class="stat-mini-row">
          <div class="stat-mini"><span>العقد</span><strong>${Utils.esc(c?.contractNo || '—')}</strong></div>
          <div class="stat-mini"><span>مستوى الوقود</span><strong>${Utils.esc(r.fuelLevel || '—')}</strong></div>
          <div class="stat-mini"><span>عداد الاستلام</span><strong>${Utils.esc(r.odometer || 0)} كم</strong></div>
        </div>
        <p><strong>سبب الإرجاع:</strong> ${Utils.esc(r.reason || '—')}</p>
        <p><strong>ملاحظات الأضرار:</strong> ${Utils.esc(r.damageNotes || 'لا توجد')}</p>
        <p><strong>عدد نقاط الضرر المُحددة على الرسم:</strong> ${damagePoints.length}</p>
        <p><strong>الإكسسوارات الموجودة:</strong> ${Utils.esc(r.accessories || '—')}</p>
        <p><strong>ملاحظات عامة:</strong> ${Utils.esc(r.notes || '—')}</p>
        ${(r.customerSignature || r.employeeSignature) ? `
        <div class="form-section-title">التوقيعات</div>
        <div style="display:flex; gap:16px">
          ${r.customerSignature ? `<div><div class="muted" style="font-size:11.5px">توقيع العميل</div><img src="${r.customerSignature}" style="background:#fff;border-radius:6px;max-width:150px"></div>` : ''}
          ${r.employeeSignature ? `<div><div class="muted" style="font-size:11.5px">توقيع الموظف</div><img src="${r.employeeSignature}" style="background:#fff;border-radius:6px;max-width:150px"></div>` : ''}
        </div>` : ''}
      `, { size: 'md' });
    }

    function openForm() {
      if (!eligibleContracts.length) {
        Utils.openModal('استلام سيارة من العميل', `
          <div class="empty-state">لا يوجد حالياً أي عقد ساري أو عقد بحاجة لتسجيل استلام.<br>أنشئ عقد إيجار أولاً من صفحة "العقود".</div>
        `, { size: 'sm' });
        return;
      }
      Utils.openModal('استلام سيارة من العميل', `
        <form id="return-form" class="form-grid">
          <label class="span-2">العقد *
            <select required name="contractId" id="ret-contract" class="input">
              <option value="">اختر العقد</option>
              ${eligibleContracts.map(c => `<option value="${c.id}" data-remaining="${Number(c.totalAmount||0) - Number(c.paidAmount||0)}">${Utils.esc(c.contractNo)} — ${Utils.esc(vMap[c.vehicleId]?.plate || '')} — ${Utils.esc(cMap[c.customerId]?.name || '')}${c.status === 'closed' ? ' (مغلق بالفعل — تسجيل فحص فقط)' : ''}</option>`).join('')}
            </select>
          </label>
          <label class="span-2">سبب الإرجاع
            <select name="reason" class="input">
              <option value="نهاية مدة العقد">نهاية مدة العقد (استلام عادي)</option>
              <option value="العميل لا يرغب في الاستمرار">العميل لا يرغب في الاستمرار بالإيجار (إرجاع مبكر)</option>
              <option value="مشكلة في السيارة">مشكلة فنية في السيارة</option>
              <option value="أخرى">أخرى</option>
            </select>
          </label>
          <label>مستوى الوقود
            <select name="fuelLevel" class="input">${['ممتلئ','3/4','1/2','1/4','فارغ'].map(f => `<option>${f}</option>`).join('')}</select>
          </label>
          <label>عداد الكيلومترات<input type="number" name="odometer" class="input"></label>
          <label>هل يوجد أضرار؟
            <select name="hasDamage" class="input"><option value="0">لا</option><option value="1">نعم</option></select>
          </label>
          <label class="span-2">وصف الأضرار (خدوش/صدمات وأماكنها)<textarea name="damageNotes" class="input" rows="2"></textarea></label>
          <div class="form-section-title">تحديد أماكن الأضرار على السيارة</div>
          <div class="span-2" id="ret-damage-diagram"></div>

          <label class="span-2">الإكسسوارات الموجودة داخل السيارة<input name="accessories" class="input" placeholder="إطار احتياطي، شاحن، حقيبة أدوات..."></label>

          <div class="form-section-title">التسوية المالية</div>
          <div id="ret-remaining-box" class="total-box span-2"><span>المبلغ المتبقي على العميل</span><strong id="ret-remaining-val">0.00 ${Utils.currencySymbol}</strong></div>
          <label>تحصيل الآن<input type="number" name="paidNow" class="input" value="0"></label>
          <label>يُضاف إلى حساب
            <select name="accountId" class="input">
              <option value="">— بدون —</option>
              ${accounts.map(a => `<option value="${a.id}">${Utils.esc(a.name)}</option>`).join('')}
            </select>
          </label>

          <label class="span-2">ملاحظات عامة<textarea name="notes" class="input" rows="2"></textarea></label>

          <div class="form-section-title">التوقيع الإلكتروني</div>
          <div>
            <div class="muted" style="font-size:12px; margin-bottom:6px">توقيع العميل</div>
            <div id="ret-sig-customer"></div>
          </div>
          <div>
            <div class="muted" style="font-size:12px; margin-bottom:6px">توقيع الموظف</div>
            <div id="ret-sig-employee"></div>
          </div>

          <div class="modal-actions span-2">
            <button type="button" class="btn btn-ghost" id="cancel-btn">إلغاء</button>
            <button type="submit" class="btn btn-primary">تأكيد الاستلام وإغلاق العقد</button>
          </div>
        </form>`, { size: 'lg' });

      const sel = document.getElementById('ret-contract');
      const updateRemaining = () => {
        const opt = sel.options[sel.selectedIndex];
        const remaining = Number(opt?.dataset.remaining || 0);
        document.getElementById('ret-remaining-val').textContent = Utils.fmtMoney(remaining);
      };
      sel.addEventListener('change', updateRemaining);
      updateRemaining();
      Utils.enhanceSearchableSelect(sel, 'اكتب رقم العقد أو اسم العميل...');

      const damageDiagram = Utils.createDamageDiagram(document.getElementById('ret-damage-diagram'), []);
      const custSigPad = Utils.createSignaturePad(document.getElementById('ret-sig-customer'));
      const empSigPad = Utils.createSignaturePad(document.getElementById('ret-sig-employee'));

      document.getElementById('cancel-btn').onclick = Utils.closeModal;
      document.getElementById('return-form').onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        try {
          const fd = Object.fromEntries(new FormData(e.target).entries());
          if (!fd.contractId) { Utils.toast('اختر العقد أولاً', 'error'); submitBtn.disabled = false; return; }
          fd.date = new Date().toISOString();
          fd.damagePoints = JSON.stringify(damageDiagram.getPoints());
          fd.customerSignature = custSigPad.getDataURL();
          fd.employeeSignature = empSigPad.getDataURL();
          await DB.add('returns', fd);

          // Close the contract and free the vehicle if it isn't already closed —
          // this is what makes "استلام سيارة" work for early returns too.
          const c = await DB.get('contracts', fd.contractId);
          if (c && c.status === 'active') {
            c.odometerEnd = fd.odometer || c.odometerEnd;
            c.paidAmount = Number(c.paidAmount || 0) + Number(fd.paidNow || 0);
            c.status = 'closed';
            c.closedEarly = fd.reason === 'العميل لا يرغب في الاستمرار' || new Date() < new Date(c.endDate);
            await DB.add('contracts', c);

            const v = await DB.get('vehicles', c.vehicleId);
            if (v) { v.status = 'available'; v.odometer = fd.odometer || v.odometer; await DB.add('vehicles', v); }

            if (Number(fd.paidNow) > 0 && fd.accountId) {
              await createTransaction({
                accountId: fd.accountId, direction: 'in', amount: fd.paidNow,
                category: 'إيراد عقد', refType: 'contract', refId: c.id,
                note: `تحصيل عند استلام سيارة — عقد ${c.contractNo}`,
              });
            }
          } else if (c) {
            // Already closed (e.g. via quick-close) — just record the inspection,
            // and make sure the vehicle is actually marked available.
            const v = await DB.get('vehicles', c.vehicleId);
            if (v && v.status !== 'maintenance') { v.status = 'available'; await DB.add('vehicles', v); }
          }

          Utils.toast('تم استلام السيارة بنجاح', 'success');
          Utils.closeModal();
          render(container);
        } catch (err) {
          console.error('Return submission failed:', err);
          Utils.toast('حدث خطأ أثناء حفظ الاستلام: ' + err.message, 'error');
          submitBtn.disabled = false;
        }
      };
    }
  }

  return { render };
})();

window.ReturnsModule = ReturnsModule;
