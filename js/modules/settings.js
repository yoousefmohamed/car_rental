'use strict';

const SettingsModule = (() => {
  const PERM_LABELS = {
    deleteRecords: 'حذف نهائي للسجلات (عملاء، موظفين، ...)',
    manageClosedContracts: 'إدارة العقود بعد الإغلاق (تعديل / إعادة فتح / إلغاء / أرشفة)',
    resetActivityLog: 'تصفير سجل العمليات',
    permanentDelete: 'حذف نهائي للعقود المؤرشفة (لا رجعة فيه)',
  };
  const ROLE_LABELS = { accountant: 'محاسب', receptionist: 'موظف استقبال', viewer: 'مشاهدة فقط' };

  async function render(container) {
    const s = await getSettings();
    const role = await getCurrentUserRole();
    const isAdmin = role === 'admin';

    container.innerHTML = `
      <div class="page-head">
        <div><h2>الإعدادات</h2><p class="muted">بيانات المنشأة، العملة، الصلاحيات، الإشعارات، الطباعة، والنسخ الاحتياطي</p></div>
      </div>

      <form id="settings-form" class="form-grid" style="max-width:820px">
        <div class="form-section-title">بيانات المنشأة</div>
        <label>اسم المنشأة *<input required name="companyName" class="input" value="${Utils.esc(s.companyName)}"></label>
        <label>الشعار الفرعي (يظهر أسفل الاسم)<input name="tagline" class="input" value="${Utils.esc(s.tagline)}"></label>
        <label>رقم الهاتف<input name="phone" class="input" value="${Utils.esc(s.phone)}"></label>
        <label>العنوان<input name="address" class="input" value="${Utils.esc(s.address)}"></label>

        <div class="form-section-title">العملة والإعدادات الافتراضية للعقود</div>
        <label>رمز العملة<input name="currencySymbol" class="input" value="${Utils.esc(s.currencySymbol)}" placeholder="ج.م / ر.س / د.إ"></label>
        <label>الكيلومترات المجانية الافتراضية<input type="number" name="defaultFreeKm" class="input" value="${Utils.esc(s.defaultFreeKm)}"></label>
        <label>سعر الكيلومتر الزائد الافتراضي<input type="number" name="defaultExtraKmPrice" class="input" value="${Utils.esc(s.defaultExtraKmPrice)}"></label>
        <label>نسبة الضريبة الافتراضية %<input type="number" name="defaultTaxPercent" class="input" value="${Utils.esc(s.defaultTaxPercent)}"></label>

        <div class="form-section-title">إعدادات الصيانة الذكية</div>
        <label>الفاصل الافتراضي بالكيلومترات بين كل صيانة<input type="number" name="maintenanceKmInterval" class="input" value="${Utils.esc(s.maintenanceKmInterval)}"></label>
        <label>الفاصل الافتراضي بالأيام بين كل صيانة<input type="number" name="maintenanceDayInterval" class="input" value="${Utils.esc(s.maintenanceDayInterval)}"></label>

        <div class="form-section-title">طباعة العقود</div>
        <label class="span-2">ملاحظة تظهر أسفل كل عقد مطبوع (شروط وأحكام مختصرة)
          <textarea name="contractFooterNote" class="input" rows="2">${Utils.esc(s.contractFooterNote)}</textarea>
        </label>

        <div class="modal-actions span-2" style="justify-content:flex-start">
          <button type="submit" class="btn btn-primary">💾 حفظ الإعدادات</button>
        </div>
      </form>

      ${isAdmin ? `
      <div class="panel" style="max-width:820px; margin-top:22px">
        <h3>🔐 الصلاحيات</h3>
        <p class="muted" style="margin-bottom:12px">تحكّم فيما يمكن لكل دور (غير المدير العام) القيام به. المدير العام يملك كل الصلاحيات دائمًا.</p>
        <form id="permissions-form">
          <table class="table table-compact">
            <thead><tr><th>الصلاحية</th>${Object.entries(ROLE_LABELS).map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead>
            <tbody>
              ${Object.entries(PERM_LABELS).map(([permKey, permLabel]) => `
                <tr>
                  <td>${permLabel}</td>
                  ${Object.keys(ROLE_LABELS).map(roleKey => `
                    <td style="text-align:center">
                      <input type="checkbox" data-role="${roleKey}" data-perm="${permKey}" ${s.permissions[roleKey]?.[permKey] ? 'checked' : ''}>
                    </td>`).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
          <div class="modal-actions" style="justify-content:flex-start; margin-top:10px">
            <button type="submit" class="btn btn-primary">💾 حفظ الصلاحيات</button>
          </div>
        </form>
      </div>` : ''}

      <div class="panel" style="max-width:820px; margin-top:16px">
        <h3>🔔 الإشعارات</h3>
        <p class="muted" style="margin-bottom:12px">تحكّم في التنبيهات التي تظهر في جرس الإشعارات أعلى الصفحة.</p>
        <form id="notifications-form" class="form-grid">
          <label style="flex-direction:row; align-items:center; gap:8px"><input type="checkbox" name="contractsOverdue" ${s.notifications.contractsOverdue ? 'checked' : ''}> عقود متأخرة السداد</label>
          <label style="flex-direction:row; align-items:center; gap:8px"><input type="checkbox" name="contractsEndingSoon" ${s.notifications.contractsEndingSoon ? 'checked' : ''}> عقود قاربت على الانتهاء</label>
          <label style="flex-direction:row; align-items:center; gap:8px"><input type="checkbox" name="licenseExpiring" ${s.notifications.licenseExpiring ? 'checked' : ''}> رخص قيادة قاربت على الانتهاء</label>
          <label style="flex-direction:row; align-items:center; gap:8px"><input type="checkbox" name="maintenanceDue" ${s.notifications.maintenanceDue ? 'checked' : ''}> صيانة مستحقة</label>
          <label style="flex-direction:row; align-items:center; gap:8px"><input type="checkbox" name="unpaidViolations" ${s.notifications.unpaidViolations ? 'checked' : ''}> مخالفات غير مدفوعة</label>
          <label style="flex-direction:row; align-items:center; gap:8px"><input type="checkbox" name="vehicleDocs" ${s.notifications.vehicleDocs ? 'checked' : ''}> وثائق سيارات قاربت على الانتهاء (رخصة/تأمين/فحص)</label>
          <label style="flex-direction:row; align-items:center; gap:8px"><input type="checkbox" name="upcomingBookings" ${s.notifications.upcomingBookings ? 'checked' : ''}> حجوزات قادمة</label>
          <label>عدد أيام التنبيه المسبق<input type="number" name="daysAhead" class="input" value="${Utils.esc(s.notifications.daysAhead)}"></label>
          <div class="modal-actions span-2" style="justify-content:flex-start">
            <button type="submit" class="btn btn-primary">💾 حفظ إعدادات الإشعارات</button>
          </div>
        </form>
      </div>

      <div class="panel" style="max-width:820px; margin-top:16px">
        <h3>🖨 الطباعة</h3>
        <form id="print-form" class="form-grid">
          <label style="flex-direction:row; align-items:center; gap:8px"><input type="checkbox" name="showLogo" ${s.printOptions.showLogo ? 'checked' : ''}> إظهار اسم المنشأة في المستندات المطبوعة</label>
          <label style="flex-direction:row; align-items:center; gap:8px"><input type="checkbox" name="showSignatures" ${s.printOptions.showSignatures ? 'checked' : ''}> إظهار مكان التوقيعات في العقود</label>
          <label style="flex-direction:row; align-items:center; gap:8px"><input type="checkbox" name="showFooterNote" ${s.printOptions.showFooterNote ? 'checked' : ''}> إظهار ملاحظة الشروط والأحكام أسفل العقد</label>
          <label>مقاس الورق
            <select name="paperSize" class="input">
              <option value="A4" ${s.printOptions.paperSize === 'A4' ? 'selected' : ''}>A4</option>
              <option value="A5" ${s.printOptions.paperSize === 'A5' ? 'selected' : ''}>A5</option>
              <option value="Letter" ${s.printOptions.paperSize === 'Letter' ? 'selected' : ''}>Letter</option>
            </select>
          </label>
          <div class="modal-actions span-2" style="justify-content:flex-start">
            <button type="submit" class="btn btn-primary">💾 حفظ إعدادات الطباعة</button>
          </div>
        </form>
      </div>

      <div class="panel" style="max-width:820px; margin-top:16px">
        <h3>📦 النسخ الاحتياطي</h3>
        <p class="muted" style="margin-bottom:6px">تصدير كل بيانات النظام كملف JSON، أو استعادة نسخة سابقة. يُفضّل عمل نسخة احتياطية بشكل دوري.</p>
        <p class="muted" style="margin-bottom:12px">آخر نسخة احتياطية: <strong>${s.backup.lastBackupAt ? new Date(s.backup.lastBackupAt).toLocaleString('ar-EG') : 'لم يتم عمل نسخة بعد'}</strong></p>
        <div style="display:flex; gap:10px">
          <button class="btn btn-ghost" id="settings-backup-btn">⬇️ تصدير نسخة احتياطية</button>
          <label class="btn btn-ghost" for="settings-restore-input" style="cursor:pointer">⬆️ استعادة نسخة
            <input type="file" id="settings-restore-input" accept=".json" style="display:none">
          </label>
        </div>
      </div>

      <div class="panel" style="max-width:820px; margin-top:16px">
        <h3>🗄️ قاعدة البيانات</h3>
        <p class="muted" style="margin-bottom:12px">النظام الآن يعمل بقاعدة بيانات SQL حقيقية (SQLite) مخزّنة في ملف واحد على جهازك، بدلاً من تخزين المتصفح القديم — أسرع وأكثر ثباتاً مع أعداد كبيرة من العملاء والعقود.</p>
        <div id="db-info-box" class="stat-mini-row"><span class="muted">جارٍ تحميل معلومات قاعدة البيانات...</span></div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:14px">
          <button class="btn btn-ghost" id="db-backup-now-btn">💾 نسخة احتياطية فورية لملف القاعدة</button>
          <button class="btn btn-ghost" id="db-open-backups-btn">📂 فتح مجلد النسخ الاحتياطية</button>
          <button class="btn btn-ghost" id="db-open-folder-btn">📁 فتح مجلد قاعدة البيانات</button>
          <button class="btn btn-ghost" id="db-vacuum-btn">⚡ تحسين الأداء وتقليل الحجم (Vacuum)</button>
        </div>
      </div>

      <div class="panel" style="max-width:820px; margin-top:16px">
        <h3>🩺 فحص سلامة البيانات</h3>
        <p class="muted" style="margin-bottom:12px">فحص ذكي يبحث عن أي روابط مكسورة بين البيانات (مثل عقد يشير إلى سيارة محذوفة) قبل ما تسبب مشكلة في مكان تاني بالبرنامج.</p>
        <button class="btn btn-ghost" id="settings-integrity-btn">🩺 تشغيل الفحص الآن</button>
        <div id="integrity-result" style="margin-top:14px"></div>
      </div>

      <div class="panel" style="max-width:820px; margin-top:16px">
        <h3>🎨 المظهر</h3>
        <p class="muted" style="margin-bottom:12px">يمكنك أيضاً تبديل الوضع الداكن/الفاتح من الأيقونة أعلى الصفحة.</p>
        <div style="display:flex; gap:10px">
          <button class="btn btn-ghost" id="settings-theme-dark">🌙 داكن</button>
          <button class="btn btn-ghost" id="settings-theme-light">☀️ فاتح</button>
        </div>
      </div>
    `;

    document.getElementById('settings-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      await saveSettings(fd);
      Utils.setCurrency(fd.currencySymbol);
      applyBranding(fd);
      Utils.toast('تم حفظ الإعدادات بنجاح', 'success');
    };

    document.getElementById('permissions-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const permissions = { ...s.permissions };
      container.querySelectorAll('#permissions-form input[type="checkbox"]').forEach(cb => {
        const roleKey = cb.dataset.role, permKey = cb.dataset.perm;
        permissions[roleKey] = { ...permissions[roleKey], [permKey]: cb.checked };
      });
      await saveSettings({ permissions });
      Utils.toast('تم حفظ الصلاحيات', 'success');
    });

    document.getElementById('notifications-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const notifications = {
        contractsOverdue: fd.has('contractsOverdue'), contractsEndingSoon: fd.has('contractsEndingSoon'),
        licenseExpiring: fd.has('licenseExpiring'), maintenanceDue: fd.has('maintenanceDue'),
        unpaidViolations: fd.has('unpaidViolations'), upcomingBookings: fd.has('upcomingBookings'), vehicleDocs: fd.has('vehicleDocs'),
        daysAhead: Number(fd.get('daysAhead') || 7),
      };
      await saveSettings({ notifications });
      Utils.toast('تم حفظ إعدادات الإشعارات', 'success');
    };

    document.getElementById('print-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const printOptions = {
        showLogo: fd.has('showLogo'), showSignatures: fd.has('showSignatures'),
        showFooterNote: fd.has('showFooterNote'), paperSize: fd.get('paperSize') || 'A4',
      };
      await saveSettings({ printOptions });
      Utils.toast('تم حفظ إعدادات الطباعة', 'success');
    };

    document.getElementById('settings-backup-btn').onclick = async () => {
      const data = await exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `car-rental-backup-${Utils.todayISO()}.json`;
      a.click();
      await saveSettings({ backup: { ...s.backup, lastBackupAt: new Date().toISOString() } });
      Utils.toast('تم تصدير نسخة احتياطية', 'success');
    };

    document.getElementById('settings-restore-input').onchange = (e) => {
      const target = document.getElementById('restore-input');
      target.files = e.target.files;
      target.dispatchEvent(new Event('change'));
    };

    document.getElementById('settings-integrity-btn').onclick = async () => {
      const btn = document.getElementById('settings-integrity-btn');
      const resultBox = document.getElementById('integrity-result');
      btn.disabled = true; btn.textContent = '⏳ جاري الفحص...';
      try {
        const { issues, counts } = await runDataIntegrityCheck();
        const errCount = issues.filter(i => i.severity === 'error').length;
        const warnCount = issues.filter(i => i.severity === 'warn').length;
        resultBox.innerHTML = `
          <div class="stat-mini-row">
            <div class="stat-mini"><span>سيارات</span><strong>${counts.vehicles}</strong></div>
            <div class="stat-mini"><span>عملاء</span><strong>${counts.customers}</strong></div>
            <div class="stat-mini"><span>عقود</span><strong>${counts.contracts}</strong></div>
            <div class="stat-mini"><span>حركات مالية</span><strong>${counts.transactions}</strong></div>
          </div>
          ${issues.length === 0
            ? `<div style="color:var(--green); font-weight:700; margin-top:10px">✅ لم يتم العثور على أي مشاكل — البيانات سليمة</div>`
            : `<div style="margin-top:10px; font-weight:700; color:${errCount ? 'var(--red)' : 'var(--orange)'}">
                 ⚠️ تم العثور على ${issues.length} ملاحظة (${errCount} تحتاج انتباه، ${warnCount} تنبيه بسيط)
               </div>
               <table class="table table-compact" style="margin-top:10px">
                 <thead><tr><th>القسم</th><th>الملاحظة</th></tr></thead>
                 <tbody>
                   ${issues.map(i => `<tr><td>${Utils.esc(i.area)}</td><td style="color:${i.severity === 'error' ? 'var(--red)' : 'var(--orange)'}">${Utils.esc(i.message)}</td></tr>`).join('')}
                 </tbody>
               </table>`}
        `;
      } catch (err) {
        resultBox.innerHTML = `<div style="color:var(--red)">حدث خطأ أثناء الفحص: ${Utils.esc(err.message)}</div>`;
      } finally {
        btn.disabled = false; btn.textContent = '🩺 تشغيل الفحص الآن';
      }
    };

    document.getElementById('settings-theme-dark').onclick = () => window.applyTheme && window.applyTheme('dark');
    document.getElementById('settings-theme-light').onclick = () => window.applyTheme && window.applyTheme('light');

    loadDbInfo();
    document.getElementById('db-backup-now-btn').onclick = async () => {
      const btn = document.getElementById('db-backup-now-btn');
      btn.disabled = true; btn.textContent = '⏳ جارٍ عمل النسخة...';
      try {
        await window.backupDbNow();
        Utils.toast('تم عمل نسخة احتياطية من ملف قاعدة البيانات بنجاح', 'success');
        loadDbInfo();
      } catch (err) {
        Utils.toast('تعذّر عمل النسخة الاحتياطية: ' + err.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = '💾 نسخة احتياطية فورية لملف القاعدة';
      }
    };
    document.getElementById('db-open-backups-btn').onclick = () => window.openBackupsFolder();
    document.getElementById('db-open-folder-btn').onclick = () => window.openDbFolder();
    document.getElementById('db-vacuum-btn').onclick = async () => {
      const btn = document.getElementById('db-vacuum-btn');
      btn.disabled = true; btn.textContent = '⏳ جارٍ التحسين...';
      try {
        await window.vacuumDb();
        Utils.toast('تم تحسين قاعدة البيانات بنجاح', 'success');
        loadDbInfo();
      } catch (err) {
        Utils.toast('تعذّر التحسين: ' + err.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = '⚡ تحسين الأداء وتقليل الحجم (Vacuum)';
      }
    };
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 كيلوبايت';
    const units = ['بايت', 'كيلوبايت', 'ميجابايت', 'جيجابايت'];
    let i = 0, n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  async function loadDbInfo() {
    const box = document.getElementById('db-info-box');
    if (!box) return;
    try {
      const info = await window.getDbInfo();
      const totalRecords = Object.values(info.counts).reduce((a, b) => a + b, 0);
      box.innerHTML = `
        <div class="stat-mini"><span>حجم ملف القاعدة</span><strong>${formatBytes(info.sizeBytes)}</strong></div>
        <div class="stat-mini"><span>إجمالي السجلات</span><strong>${totalRecords.toLocaleString('ar-EG')}</strong></div>
        <div class="stat-mini"><span>العملاء</span><strong>${(info.counts.customers || 0).toLocaleString('ar-EG')}</strong></div>
        <div class="stat-mini"><span>العقود</span><strong>${(info.counts.contracts || 0).toLocaleString('ar-EG')}</strong></div>
      `;
    } catch (err) {
      box.innerHTML = `<span class="muted">تعذّر تحميل معلومات قاعدة البيانات</span>`;
    }
  }

  function applyBranding(s) {
    const brand = document.querySelector('#sidebar .brand');
    if (brand) {
      brand.innerHTML = `🚗 ${Utils.esc(s.companyName)}<small>${Utils.esc(s.tagline || '')}</small>`;
    }
    document.title = `${s.companyName} — نظام تأجير السيارات`;
  }

  return { render, applyBranding };
})();

window.SettingsModule = SettingsModule;
