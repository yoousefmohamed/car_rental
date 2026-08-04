'use strict';

const DashboardModule = (() => {
  async function render(container) {
    const [vehicles, customers, bookings, contracts, incidents] = await Promise.all([
      DB.getAll('vehicles'), DB.getAll('customers'), DB.getAll('bookings'), DB.getAll('contracts'), DB.getAll('incidents')
    ]);

    const countByStatus = (arr, key) => arr.reduce((m, x) => { m[x[key]] = (m[x[key]] || 0) + 1; return m; }, {});
    const vStatus = countByStatus(vehicles, 'status');
    const activeContracts = contracts.filter(c => c.status === 'active');
    const closedContracts = contracts.filter(c => c.status === 'closed');

    const revenue = contracts.reduce((s, c) => s + Number(c.paidAmount || 0), 0);
    const outstanding = contracts.reduce((s, c) => s + (Number(c.totalAmount || 0) - Number(c.paidAmount || 0)), 0);

    const today = new Date();
    const in7 = new Date(); in7.setDate(today.getDate() + 7);
    const in30 = new Date(); in30.setDate(today.getDate() + 30);

    const endingSoon = activeContracts.filter(c => new Date(c.endDate) <= in7 && new Date(c.endDate) >= today);
    const overdue = activeContracts.filter(c => new Date(c.endDate) < today);
    const licenseExpiring = customers.filter(c => c.licenseExpiry && new Date(c.licenseExpiry) <= in30 && new Date(c.licenseExpiry) >= today);
    const upcomingBookings = bookings.filter(b => b.status === 'confirmed' && new Date(b.startDate) >= today && new Date(b.startDate) <= in7);
    const maintenanceAlerts = await MaintenanceModule.getUpcomingAlerts();
    const openAccidents = incidents.filter(i => i.type === 'accident' && i.status !== 'closed').length;
    const unpaidViolationsTotal = incidents.filter(i => i.type === 'violation' && i.status !== 'paid').reduce((s, v) => s + Number(v.amount || 0), 0);

    // Last 6 months revenue trend (based on contract payments recorded via createdAt of the contract)
    const expenses = await DB.getAll('expenses');
    const monthsBack = 6;
    const monthBuckets = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      monthBuckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('ar-EG', { month: 'short' }), revenue: 0, expense: 0 });
    }
    const bucketMap = Object.fromEntries(monthBuckets.map(b => [b.key, b]));
    contracts.forEach(c => {
      const key = (c.createdAt || '').slice(0, 7);
      if (bucketMap[key]) bucketMap[key].revenue += Number(c.paidAmount || 0);
    });
    expenses.forEach(e => {
      const key = (e.date || e.createdAt || '').slice(0, 7);
      if (bucketMap[key]) bucketMap[key].expense += Number(e.amount || 0);
    });
    const maxBucketVal = Math.max(1, ...monthBuckets.map(b => Math.max(b.revenue, b.expense)));

    const vMap = Object.fromEntries(vehicles.map(v => [v.id, v]));
    const cMap = Object.fromEntries(customers.map(c => [c.id, c]));

    // Smart insights: fleet utilization + top performers
    const utilizableFleet = vehicles.filter(v => v.status !== 'out_of_service' && v._archived !== '1').length;
    const utilizationRate = utilizableFleet ? Math.round(((vStatus.rented || 0) / utilizableFleet) * 100) : 0;

    const revenueByVehicle = {};
    const revenueByCustomer = {};
    contracts.forEach(c => {
      const paid = Number(c.paidAmount || 0);
      if (c.vehicleId) revenueByVehicle[c.vehicleId] = (revenueByVehicle[c.vehicleId] || 0) + paid;
      if (c.customerId) revenueByCustomer[c.customerId] = (revenueByCustomer[c.customerId] || 0) + paid;
    });
    const topVehicles = Object.entries(revenueByVehicle).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topCustomers = Object.entries(revenueByCustomer).sort((a, b) => b[1] - a[1]).slice(0, 5);

    container.innerHTML = `
      <div class="page-head">
        <div>
          <h2>لوحة التحكم</h2>
          <p class="muted">نظرة عامة سريعة على حالة الشركة</p>
        </div>
      </div>

      <div class="stat-grid">
        ${statCard('إجمالي السيارات', vehicles.length, '🚗', 'blue')}
        ${statCard('سيارات متاحة', vStatus.available || 0, '✅', 'green')}
        ${statCard('سيارات مؤجرة', vStatus.rented || 0, '🔑', 'purple')}
        ${statCard('سيارات محجوزة', vStatus.reserved || 0, '📅', 'orange')}
        ${statCard('تحت الصيانة', vStatus.maintenance || 0, '🛠', 'gray')}
        ${statCard('العملاء', customers.length, '👤', 'blue')}
        ${statCard('عقود سارية', activeContracts.length, '📄', 'blue')}
        ${statCard('عقود منتهية', closedContracts.length, '📁', 'gray')}
        ${statCard('الإيرادات المحصّلة', Utils.fmtMoney(revenue), '💰', 'green')}
        ${statCard('مستحقات لم تُحصَّل', Utils.fmtMoney(outstanding), '⚠️', 'red')}
        ${statCard('نسبة إشغال الأسطول', utilizationRate + '%', '📊', utilizationRate >= 60 ? 'green' : (utilizationRate >= 30 ? 'orange' : 'red'))}
        ${statCard('حوادث مفتوحة', openAccidents, '🚨', 'orange')}
        ${statCard('مخالفات مستحقة', Utils.fmtMoney(unpaidViolationsTotal), '🚦', 'red')}
      </div>

      <div class="panel" style="margin-bottom:18px">
        <h3>📈 اتجاه الإيرادات والمصروفات (آخر 6 أشهر)</h3>
        <div class="trend-chart">
          ${monthBuckets.map(b => `
            <div class="trend-col">
              <div class="trend-bars">
                <div class="trend-bar trend-bar-rev" style="height:${Math.round((b.revenue / maxBucketVal) * 100)}%" title="إيراد: ${Utils.fmtMoney(b.revenue)}"></div>
                <div class="trend-bar trend-bar-exp" style="height:${Math.round((b.expense / maxBucketVal) * 100)}%" title="مصروف: ${Utils.fmtMoney(b.expense)}"></div>
              </div>
              <div class="trend-label">${b.label}</div>
            </div>`).join('')}
        </div>
        <div class="trend-legend">
          <span><i class="dot dot-rev"></i> الإيرادات</span>
          <span><i class="dot dot-exp"></i> المصروفات</span>
        </div>
      </div>

      <div class="dash-columns">
        <div class="panel">
          <h3>🔔 تنبيهات فورية</h3>
          <div class="alert-list">
            ${overdue.length ? overdue.map(c => alertRow('danger', `عقد ${c.contractNo} — تأخر تسليم سيارة ${vMap[c.vehicleId]?.plate || ''} (${cMap[c.customerId]?.name || ''})`)).join('') : ''}
            ${endingSoon.length ? endingSoon.map(c => alertRow('warn', `عقد ${c.contractNo} ينتهي في ${Utils.fmtDate(c.endDate)}`)).join('') : ''}
            ${licenseExpiring.length ? licenseExpiring.map(c => alertRow('warn', `رخصة قيادة العميل ${c.name} تنتهي في ${Utils.fmtDate(c.licenseExpiry)}`)).join('') : ''}
            ${upcomingBookings.length ? upcomingBookings.map(b => alertRow('info', `حجز قادم: ${vMap[b.vehicleId]?.plate || ''} يبدأ في ${Utils.fmtDate(b.startDate)}`)).join('') : ''}
            ${maintenanceAlerts.length ? maintenanceAlerts.map(a => alertRow(a.due.overdue ? 'danger' : 'warn', `صيانة ${a.due.overdue ? 'متأخرة' : 'قريبة'}: ${a.vehicle?.plate || ''} — ${a.vehicle?.brand || ''} ${a.vehicle?.model || ''}`)).join('') : ''}
            ${(!overdue.length && !endingSoon.length && !licenseExpiring.length && !upcomingBookings.length && !maintenanceAlerts.length) ? '<div class="muted">لا توجد تنبيهات حالياً 🎉</div>' : ''}
          </div>
        </div>

        <div class="panel">
          <h3>📋 آخر العقود</h3>
          <table class="table table-compact">
            <thead><tr><th>رقم العقد</th><th>السيارة</th><th>العميل</th><th>الحالة</th></tr></thead>
            <tbody>
              ${contracts.slice(0, 6).map(c => `
                <tr>
                  <td>${Utils.esc(c.contractNo)}</td>
                  <td>${Utils.esc(vMap[c.vehicleId]?.plate || '—')}</td>
                  <td>${Utils.esc(cMap[c.customerId]?.name || '—')}</td>
                  <td>${Utils.statusBadge(c.status, ContractsModule.STATUS)}</td>
                </tr>`).join('') || '<tr><td colspan="4" class="muted">لا يوجد عقود بعد</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="dash-columns">
        <div class="panel">
          <h3>🏆 أفضل السيارات ربحية</h3>
          <table class="table table-compact">
            <thead><tr><th>السيارة</th><th>إجمالي الإيراد</th></tr></thead>
            <tbody>
              ${topVehicles.length ? topVehicles.map(([vid, rev]) => `
                <tr><td>${Utils.esc(vMap[vid]?.plate || '—')} — ${Utils.esc(vMap[vid]?.brand || '')} ${Utils.esc(vMap[vid]?.model || '')}</td><td>${Utils.fmtMoney(rev)}</td></tr>`).join('')
                : '<tr><td colspan="2" class="muted">لا توجد بيانات كافية بعد</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="panel">
          <h3>⭐ أفضل العملاء</h3>
          <table class="table table-compact">
            <thead><tr><th>العميل</th><th>إجمالي الإنفاق</th></tr></thead>
            <tbody>
              ${topCustomers.length ? topCustomers.map(([cid, rev]) => `
                <tr><td>${Utils.esc(cMap[cid]?.name || '—')}</td><td>${Utils.fmtMoney(rev)}</td></tr>`).join('')
                : '<tr><td colspan="2" class="muted">لا توجد بيانات كافية بعد</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    function statCard(label, value, icon, cls) {
      return `<div class="stat-card stat-${cls}"><div class="stat-icon">${icon}</div><div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div></div>`;
    }
    function alertRow(level, text) {
      return `<div class="alert-row alert-${level}">${Utils.esc(text)}</div>`;
    }
  }

  return { render };
})();

window.DashboardModule = DashboardModule;
