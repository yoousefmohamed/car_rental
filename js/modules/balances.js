'use strict';

const BalancesModule = (() => {
  async function render(container) {
    const [accounts, txs, contracts, expenses, partners, partnerTx, vehicles, customers, incidents] = await Promise.all([
      DB.getAll('accounts'), DB.getAll('transactions'), DB.getAll('contracts'), DB.getAll('expenses'),
      DB.getAll('partners'), DB.getAll('partnerTx'), DB.getAll('vehicles'), DB.getAll('customers'), DB.getAll('incidents'),
    ]);

    const vMap = Object.fromEntries(vehicles.map(v => [v.id, v]));
    const cMap = Object.fromEntries(customers.map(c => [c.id, c]));

    let treasuryTotal = 0;
    const activeTxs = txs.filter(t => t._archived !== '1');
    const accountRows = accounts.map(a => {
      const bal = activeTxs.filter(t => t.accountId === a.id).reduce((s, t) => s + (t.direction === 'in' ? Number(t.amount) : -Number(t.amount)), 0);
      treasuryTotal += bal;
      return { ...a, balance: bal };
    });

    const totalRevenueCollected = contracts.reduce((s, c) => s + Number(c.paidAmount || 0), 0);
    const totalReceivable = contracts.reduce((s, c) => s + Math.max(0, Number(c.totalAmount || 0) - Number(c.paidAmount || 0)), 0);
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const unpaidViolations = incidents.filter(i => i.type === 'violation' && i.status !== 'paid');
    const unpaidViolationsTotal = unpaidViolations.reduce((s, v) => s + Number(v.amount || 0), 0);
    const netProfit = totalRevenueCollected - totalExpenses;

    const debtors = contracts
      .filter(c => Number(c.totalAmount || 0) - Number(c.paidAmount || 0) > 0)
      .map(c => ({ c, remaining: Number(c.totalAmount || 0) - Number(c.paidAmount || 0) }))
      .sort((a, b) => b.remaining - a.remaining);

    const partnersCapital = partners.reduce((sum, p) => {
      const bal = partnerTx.filter(t => t.partnerId === p.id).reduce((s, t) => s + (t.type === 'contribution' ? Number(t.amount) : -Number(t.amount)), 0);
      return sum + bal;
    }, 0);

    const byCategory = {};
    expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount || 0); });
    const expenseRows = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

    const recentTx = [...activeTxs].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 10);
    const aMapAll = Object.fromEntries(accounts.map(a => [a.id, a]));

    container.innerHTML = `
      <div class="page-head">
        <div><h2>الأرصدة والحسابات</h2><p class="muted">الوضع المالي المجمّع للشركة</p></div>
        <button class="btn btn-ghost" id="balances-print-btn">🖨 طباعة تقرير</button>
      </div>

      <div class="stat-grid">
        <div class="stat-card stat-green"><div class="stat-icon">💰</div><div><div class="stat-value">${Utils.fmtMoney(treasuryTotal)}</div><div class="stat-label">إجمالي أرصدة الخزينة والمحافظ</div></div></div>
        <div class="stat-card stat-blue"><div class="stat-icon">📥</div><div><div class="stat-value">${Utils.fmtMoney(totalRevenueCollected)}</div><div class="stat-label">إجمالي الإيرادات المحصّلة</div></div></div>
        <div class="stat-card stat-red"><div class="stat-icon">📤</div><div><div class="stat-value">${Utils.fmtMoney(totalExpenses)}</div><div class="stat-label">إجمالي المصروفات</div></div></div>
        <div class="stat-card stat-${netProfit >= 0 ? 'green' : 'red'}"><div class="stat-icon">📈</div><div><div class="stat-value">${Utils.fmtMoney(netProfit)}</div><div class="stat-label">صافي الربح التقريبي</div></div></div>
        <div class="stat-card stat-orange"><div class="stat-icon">⚠️</div><div><div class="stat-value">${Utils.fmtMoney(totalReceivable)}</div><div class="stat-label">مستحقات لدى العملاء</div></div></div>
        <div class="stat-card stat-red"><div class="stat-icon">🚦</div><div><div class="stat-value">${Utils.fmtMoney(unpaidViolationsTotal)}</div><div class="stat-label">مخالفات مرورية مستحقة</div></div></div>
        <div class="stat-card stat-purple"><div class="stat-icon">🤝</div><div><div class="stat-value">${Utils.fmtMoney(partnersCapital)}</div><div class="stat-label">إجمالي رأس مال الشركاء</div></div></div>
      </div>

      <div class="dash-columns">
        <div class="panel">
          <h3>💵 أرصدة الحسابات</h3>
          <table class="table table-compact">
            <thead><tr><th>الحساب</th><th>الرصيد</th></tr></thead>
            <tbody>
              ${accountRows.length ? accountRows.map(a => `<tr><td>${Utils.esc(a.name)} ${a.active === '0' ? '<span class="badge badge-gray">متوقف</span>' : ''}</td><td class="${a.balance < 0 ? 'text-danger' : ''}">${Utils.fmtMoney(a.balance)}</td></tr>`).join('') : '<tr><td colspan="2" class="muted">لا توجد حسابات بعد</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="panel">
          <h3>🧾 أكبر المديونيات (عملاء)</h3>
          <table class="table table-compact">
            <thead><tr><th>العقد</th><th>العميل</th><th>المتبقي</th></tr></thead>
            <tbody>
              ${debtors.length ? debtors.slice(0, 8).map(({ c, remaining }) => `
                <tr><td>${Utils.esc(c.contractNo)}</td><td>${Utils.esc(cMap[c.customerId]?.name || '—')}</td><td class="text-danger">${Utils.fmtMoney(remaining)}</td></tr>`).join('')
                : '<tr><td colspan="3" class="muted">لا توجد مديونيات — كل العملاء سدّدوا بالكامل 🎉</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="panel">
          <h3>📊 توزيع المصروفات حسب الفئة</h3>
          <table class="table table-compact">
            <thead><tr><th>الفئة</th><th>الإجمالي</th><th>النسبة</th></tr></thead>
            <tbody>
              ${expenseRows.length ? expenseRows.map(([cat, amt]) => `
                <tr><td>${Utils.esc(cat)}</td><td class="text-danger">${Utils.fmtMoney(amt)}</td><td>${totalExpenses ? Math.round(amt / totalExpenses * 100) : 0}%</td></tr>`).join('')
                : '<tr><td colspan="3" class="muted">لا توجد مصروفات بعد</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="panel">
          <h3>🔄 آخر الحركات المالية</h3>
          <table class="table table-compact">
            <thead><tr><th>التاريخ</th><th>الحساب</th><th>البيان</th><th>المبلغ</th></tr></thead>
            <tbody>
              ${recentTx.length ? recentTx.map(t => `
                <tr>
                  <td>${Utils.fmtDate(t.date)}</td>
                  <td>${Utils.esc(aMapAll[t.accountId]?.name || '—')}</td>
                  <td>${Utils.esc(t.note || t.category)}</td>
                  <td class="${t.direction === 'in' ? '' : 'text-danger'}">${t.direction === 'in' ? '+' : '-'} ${Utils.fmtMoney(t.amount)}</td>
                </tr>`).join('')
                : '<tr><td colspan="4" class="muted">لا توجد حركات بعد</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    container.querySelector('#balances-print-btn').onclick = () => printReport();

    async function printReport() {
      const settings = await getSettings();
      const win = window.open('', '_blank', 'width=900,height=1000');
      win.document.write(`
        <!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>تقرير الأرصدة والحسابات</title>
        <style>
          body { font-family: 'Tahoma', Arial, sans-serif; padding: 30px; color: #1a1a1a; }
          h1 { text-align:center; font-size: 20px; margin-bottom: 4px; }
          .sub { text-align:center; color:#555; margin-bottom: 20px; }
          table { width:100%; border-collapse: collapse; margin-bottom: 18px; }
          td, th { border: 1px solid #ccc; padding: 6px 10px; font-size: 13px; text-align: right; }
          th { background: #f2f2f2; }
          .section-title { font-weight:bold; margin: 16px 0 8px; font-size: 14px; }
        </style></head><body>
        <h1>${Utils.esc(settings.companyName)}</h1>
        <div class="sub">تقرير الأرصدة والحسابات — ${Utils.fmtDate(new Date().toISOString())}</div>
        <div class="section-title">الملخص المالي</div>
        <table>
          <tr><td>إجمالي أرصدة الخزينة والمحافظ</td><td>${Utils.fmtMoney(treasuryTotal)}</td></tr>
          <tr><td>إجمالي الإيرادات المحصّلة</td><td>${Utils.fmtMoney(totalRevenueCollected)}</td></tr>
          <tr><td>إجمالي المصروفات</td><td>${Utils.fmtMoney(totalExpenses)}</td></tr>
          <tr><td>صافي الربح التقريبي</td><td>${Utils.fmtMoney(netProfit)}</td></tr>
          <tr><td>مستحقات لدى العملاء</td><td>${Utils.fmtMoney(totalReceivable)}</td></tr>
          <tr><td>مخالفات مرورية مستحقة</td><td>${Utils.fmtMoney(unpaidViolationsTotal)}</td></tr>
          <tr><td>إجمالي رأس مال الشركاء</td><td>${Utils.fmtMoney(partnersCapital)}</td></tr>
        </table>
        <div class="section-title">أرصدة الحسابات</div>
        <table>
          <tr><th>الحساب</th><th>الرصيد</th></tr>
          ${accountRows.map(a => `<tr><td>${Utils.esc(a.name)}</td><td>${Utils.fmtMoney(a.balance)}</td></tr>`).join('') || '<tr><td colspan="2">لا توجد حسابات</td></tr>'}
        </table>
        <div class="section-title">أكبر المديونيات</div>
        <table>
          <tr><th>العقد</th><th>العميل</th><th>المتبقي</th></tr>
          ${debtors.slice(0, 20).map(({ c, remaining }) => `<tr><td>${Utils.esc(c.contractNo)}</td><td>${Utils.esc(cMap[c.customerId]?.name || '—')}</td><td>${Utils.fmtMoney(remaining)}</td></tr>`).join('') || '<tr><td colspan="3">لا توجد مديونيات</td></tr>'}
        </table>
        <script>window.onload = () => window.print();</script>
        </body></html>
      `);
      win.document.close();
    }
  }

  return { render };
})();

window.BalancesModule = BalancesModule;
