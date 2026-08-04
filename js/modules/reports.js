'use strict';

const ReportsModule = (() => {
  const REPORTS = {
    vehicles_status: 'تقرير حالة العربيات',
    top_vehicles: 'السيارات الأكثر تأجيراً',
    top_customers: 'العملاء الأكثر تعاملاً',
    contracts_range: 'تقرير العقود',
    revenue_expense: 'تقرير الإيرادات والمصروفات',
    receivables: 'تقرير المديونيات',
    maintenance_cost: 'تقرير تكاليف الصيانة',
    incidents_report: 'تقرير الحوادث والمخالفات',
    vehicle_docs: 'تقرير وثائق السيارات (رخصة/تأمين/فحص)',
  };

  // Reports that respect the date-range filter (others are point-in-time snapshots)
  const DATE_FILTERED = new Set(['contracts_range', 'revenue_expense', 'maintenance_cost', 'incidents_report']);

  function inRange(dateStr, from, to) {
    if (!dateStr) return !from && !to;
    if (from && dateStr < from) return false;
    if (to && dateStr > to) return false;
    return true;
  }

  async function render(container) {
    container.innerHTML = `
      <div class="page-head">
        <div><h2>التقارير</h2><p class="muted">تقارير جاهزة للطباعة والتصدير، مع فلترة بالفترة الزمنية</p></div>
      </div>
      <div class="toolbar">
        <select id="report-select" class="input">
          ${Object.entries(REPORTS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
        </select>
        <label class="input" style="display:flex; align-items:center; gap:6px; width:auto">من <input type="date" id="report-from" style="border:none; background:none; color:inherit"></label>
        <label class="input" style="display:flex; align-items:center; gap:6px; width:auto">إلى <input type="date" id="report-to" style="border:none; background:none; color:inherit"></label>
        <button class="btn btn-ghost" id="export-csv-btn">⬇️ تصدير Excel (CSV)</button>
        <button class="btn btn-primary" id="print-report-btn">🖨 طباعة</button>
      </div>
      <div id="report-summary" class="stat-grid" style="grid-template-columns:repeat(3,1fr); margin-bottom:14px"></div>
      <div class="table-wrap" id="report-output"></div>
    `;

    let currentRows = [];
    let currentHeaders = [];
    let currentTitle = '';

    async function buildReport(key) {
      const from = container.querySelector('#report-from').value;
      const to = container.querySelector('#report-to').value;
      const dateFilterActive = DATE_FILTERED.has(key) && (from || to);

      const [vehicles, customers, contracts, expenses, maintenance, incidents] = await Promise.all([
        DB.getAll('vehicles'), DB.getAll('customers'), DB.getAll('contracts'), DB.getAll('expenses'),
        DB.getAll('maintenance'), DB.getAll('incidents'),
      ]);
      const vMap = Object.fromEntries(vehicles.map(v => [v.id, v]));
      const cMap = Object.fromEntries(customers.map(c => [c.id, c]));
      let summary = [];

      if (key === 'vehicles_status') {
        currentTitle = REPORTS[key];
        currentHeaders = ['اللوحة', 'الماركة/الموديل', 'الحالة', 'سعر يومي', 'كيلومترات'];
        currentRows = vehicles.map(v => [v.plate, `${v.brand} ${v.model}`, VehiclesModule.STATUS[v.status]?.label || v.status, v.dailyRate, v.odometer || 0]);
        summary = [['إجمالي السيارات', vehicles.length], ['متاحة', vehicles.filter(v => v.status === 'available').length], ['تحت الصيانة', vehicles.filter(v => v.status === 'maintenance').length]];
      }
      if (key === 'top_vehicles') {
        currentTitle = REPORTS[key];
        const counts = {};
        contracts.forEach(c => { counts[c.vehicleId] = (counts[c.vehicleId] || 0) + 1; });
        currentHeaders = ['اللوحة', 'الماركة/الموديل', 'عدد مرات التأجير'];
        currentRows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([id, n]) => [vMap[id]?.plate || '—', `${vMap[id]?.brand || ''} ${vMap[id]?.model || ''}`, n]);
      }
      if (key === 'top_customers') {
        currentTitle = REPORTS[key];
        const counts = {};
        contracts.forEach(c => { counts[c.customerId] = (counts[c.customerId] || 0) + 1; });
        currentHeaders = ['العميل', 'الهاتف', 'عدد العقود'];
        currentRows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([id, n]) => [cMap[id]?.name || '—', cMap[id]?.phone || '—', n]);
      }
      if (key === 'contracts_range') {
        currentTitle = REPORTS[key];
        const filtered = dateFilterActive ? contracts.filter(c => inRange((c.startDate || '').slice(0, 10), from, to)) : contracts;
        currentHeaders = ['رقم العقد', 'السيارة', 'العميل', 'من', 'إلى', 'الإجمالي', 'المدفوع', 'الحالة'];
        currentRows = filtered.map(c => [c.contractNo, vMap[c.vehicleId]?.plate || '—', cMap[c.customerId]?.name || '—', Utils.fmtDate(c.startDate), Utils.fmtDate(c.endDate), c.totalAmount, c.paidAmount, ContractsModule.STATUS[c.status]?.label || c.status]);
        summary = [['عدد العقود', filtered.length], ['إجمالي القيمة', Utils.fmtMoney(filtered.reduce((s, c) => s + Number(c.totalAmount || 0), 0))], ['إجمالي المحصّل', Utils.fmtMoney(filtered.reduce((s, c) => s + Number(c.paidAmount || 0), 0))]];
      }
      if (key === 'revenue_expense') {
        currentTitle = REPORTS[key];
        const filteredContracts = dateFilterActive ? contracts.filter(c => inRange((c.createdAt || '').slice(0, 10), from, to)) : contracts;
        const filteredExpenses = dateFilterActive ? expenses.filter(e => inRange((e.date || '').slice(0, 10), from, to)) : expenses;
        const totalRevenue = filteredContracts.reduce((s, c) => s + Number(c.paidAmount || 0), 0);
        const totalExpense = filteredExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
        currentHeaders = ['البند', 'المبلغ'];
        currentRows = [
          ['إجمالي الإيرادات المحصّلة', Utils.fmtMoney(totalRevenue)],
          ['إجمالي المصروفات', Utils.fmtMoney(totalExpense)],
          ['صافي الربح التقريبي', Utils.fmtMoney(totalRevenue - totalExpense)],
        ];
        summary = [['الإيرادات', Utils.fmtMoney(totalRevenue)], ['المصروفات', Utils.fmtMoney(totalExpense)], ['الصافي', Utils.fmtMoney(totalRevenue - totalExpense)]];
      }
      if (key === 'receivables') {
        currentTitle = REPORTS[key];
        currentHeaders = ['رقم العقد', 'العميل', 'الإجمالي', 'المدفوع', 'المتبقي'];
        const rows = contracts.filter(c => Number(c.totalAmount || 0) - Number(c.paidAmount || 0) > 0);
        currentRows = rows.map(c => [c.contractNo, cMap[c.customerId]?.name || '—', c.totalAmount, c.paidAmount, Number(c.totalAmount || 0) - Number(c.paidAmount || 0)]);
        summary = [['عدد العقود المدينة', rows.length], ['إجمالي المستحقات', Utils.fmtMoney(rows.reduce((s, c) => s + (Number(c.totalAmount||0)-Number(c.paidAmount||0)), 0))]];
      }
      if (key === 'maintenance_cost') {
        currentTitle = REPORTS[key];
        const filtered = dateFilterActive ? maintenance.filter(m => inRange((m.scheduledDate || m.createdAt || '').slice(0, 10), from, to)) : maintenance;
        currentHeaders = ['السيارة', 'النوع', 'الورشة', 'تكلفة القطع', 'تكلفة العمالة', 'الإجمالي', 'الحالة'];
        currentRows = filtered.map(m => [vMap[m.vehicleId]?.plate || '—', MaintenanceModule.TYPE[m.type] || m.type, m.workshop || '—', m.partsCost || 0, m.laborCost || 0, Number(m.partsCost||0)+Number(m.laborCost||0), MaintenanceModule.STATUS[m.status]?.label || m.status]);
        summary = [['عدد الأوامر', filtered.length], ['إجمالي التكلفة', Utils.fmtMoney(filtered.reduce((s, m) => s + Number(m.partsCost||0) + Number(m.laborCost||0), 0))]];
      }
      if (key === 'vehicle_docs') {
        currentTitle = REPORTS[key];
        currentHeaders = ['اللوحة', 'الماركة/الموديل', 'رخصة السيارة', 'التأمين', 'الفحص الدوري', 'الحالة'];
        currentRows = vehicles.filter(v => v._archived !== '1').map(v => {
          const status = VehiclesModule.docStatus(v);
          return [
            v.plate, `${v.brand} ${v.model}`,
            v.licenseExpiry ? Utils.fmtDate(v.licenseExpiry) : '—',
            v.insuranceExpiry ? Utils.fmtDate(v.insuranceExpiry) : '—',
            v.inspectionExpiry ? Utils.fmtDate(v.inspectionExpiry) : '—',
            status ? (status.level === 'expired' ? '⛔ منتهية' : '⚠️ قريبة الانتهاء') : '✓ سليمة',
          ];
        });
        const expiredCount = vehicles.filter(v => VehiclesModule.docStatus(v)?.level === 'expired').length;
        const soonCount = vehicles.filter(v => VehiclesModule.docStatus(v)?.level === 'soon').length;
        summary = [['سيارات بوثائق منتهية', expiredCount], ['سيارات قاربت على الانتهاء', soonCount]];
      }
      if (key === 'incidents_report') {
        currentTitle = REPORTS[key];
        const filtered = dateFilterActive ? incidents.filter(i => inRange((i.date || '').slice(0, 10), from, to)) : incidents;
        currentHeaders = ['النوع', 'السيارة', 'العميل', 'التاريخ', 'التفاصيل', 'المبلغ', 'الحالة'];
        currentRows = filtered.map(i => [
          i.type === 'accident' ? 'حادث' : 'مخالفة', vMap[i.vehicleId]?.plate || '—', cMap[i.customerId]?.name || '—',
          Utils.fmtDate(i.date), i.type === 'accident' ? (i.description || '—') : (i.violationType || '—'),
          i.type === 'accident' ? (Number(i.compensationAmount||0)-Number(i.deductibleAmount||0)) : i.amount,
          Utils.esc((IncidentsModule.ACC_STATUS[i.status] || IncidentsModule.VIO_STATUS[i.status] || {}).label || i.status),
        ]);
        const unpaidViolations = filtered.filter(i => i.type === 'violation' && i.status !== 'paid');
        summary = [['عدد الحوادث', filtered.filter(i => i.type === 'accident').length], ['عدد المخالفات', filtered.filter(i => i.type === 'violation').length], ['مخالفات مستحقة', Utils.fmtMoney(unpaidViolations.reduce((s,v) => s + Number(v.amount||0), 0))]];
      }

      const summaryBox = container.querySelector('#report-summary');
      summaryBox.innerHTML = summary.map(([label, val]) => `
        <div class="stat-card stat-blue"><div class="stat-icon">📊</div><div><div class="stat-value">${val}</div><div class="stat-label">${Utils.esc(label)}</div></div></div>
      `).join('');

      const out = container.querySelector('#report-output');
      out.innerHTML = `
        <table class="table">
          <thead><tr>${currentHeaders.map(h => `<th>${Utils.esc(h)}</th>`).join('')}</tr></thead>
          <tbody>
            ${currentRows.length ? currentRows.map(r => `<tr>${r.map(v => `<td>${Utils.esc(v)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${currentHeaders.length}" class="empty-state">لا توجد بيانات لهذا التقرير${dateFilterActive ? ' في الفترة المحددة' : ''}</td></tr>`}
          </tbody>
        </table>`;
    }

    container.querySelector('#report-select').addEventListener('change', (e) => buildReport(e.target.value));
    container.querySelector('#report-from').addEventListener('change', () => buildReport(container.querySelector('#report-select').value));
    container.querySelector('#report-to').addEventListener('change', () => buildReport(container.querySelector('#report-select').value));
    await buildReport('vehicles_status');

    container.querySelector('#export-csv-btn').onclick = () => {
      const csv = [currentHeaders.join(','), ...currentRows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${currentTitle}.csv`;
      a.click();
    };

    container.querySelector('#print-report-btn').onclick = () => {
      const win = window.open('', '_blank', 'width=900,height=1000');
      win.document.write(`
        <!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>${Utils.esc(currentTitle)}</title>
        <style>
          body { font-family: Tahoma, Arial, sans-serif; padding: 24px; }
          h1 { font-size: 18px; text-align:center; }
          table { width:100%; border-collapse: collapse; margin-top: 16px; }
          td, th { border: 1px solid #ccc; padding: 6px 10px; font-size: 12.5px; text-align:right; }
          th { background: #f2f2f2; }
        </style></head><body>
        <h1>${Utils.esc(currentTitle)}</h1>
        <table>
          <thead><tr>${currentHeaders.map(h => `<th>${Utils.esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${currentRows.map(r => `<tr>${r.map(v => `<td>${Utils.esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
        <script>window.onload = () => window.print();</script>
        </body></html>`);
      win.document.close();
    };
  }

  return { render };
})();

window.ReportsModule = ReportsModule;
