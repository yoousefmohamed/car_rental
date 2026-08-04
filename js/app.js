'use strict';

const NAV_GROUPS = [
  {
    label: null, // top-level, no section header
    items: {
      '/dashboard': { label: 'لوحة التحكم', icon: '📊', module: () => DashboardModule },
      '/vehicles':  { label: 'العربيات',    icon: '🚗', module: () => VehiclesModule },
      '/customers': { label: 'العملاء',     icon: '👥', module: () => CustomersModule },
      '/bookings':  { label: 'الحجوزات',    icon: '📅', module: () => BookingsModule },
      '/contracts': { label: 'العقود',      icon: '📄', module: () => ContractsModule },
      '/returns':   { label: 'المرتجعات',   icon: '↩️', module: () => ReturnsModule },
      '/maintenance': { label: 'الصيانة',   icon: '🛠️', module: () => MaintenanceModule },
      '/incidents': { label: 'الحوادث والمخالفات', icon: '🚨', module: () => IncidentsModule },
    },
  },
  {
    label: 'المالية',
    items: {
      '/treasury':  { label: 'الخزينة والمحافظ الإلكترونية', icon: '💰', module: () => TreasuryModule },
      '/expenses':  { label: 'المصروفات',           icon: '📋', module: () => ExpensesModule },
      '/reports':   { label: 'التقارير',             icon: '📈', module: () => ReportsModule },
      '/partners':  { label: 'حسابات الشركاء',       icon: '🤝', module: () => PartnersModule },
      '/balances':  { label: 'الأرصدة والحسابات',     icon: '⚖️', module: () => BalancesModule },
    },
  },
  {
    label: 'إدارة',
    items: {
      '/users':     { label: 'المستخدمون', icon: '🛡️', module: () => UsersModule },
      '/employees': { label: 'الموظفون',   icon: '🪪', module: () => EmployeesModule },
      '/activity':  { label: 'سجل العمليات', icon: '🕒', module: () => ActivityLogModule },
      '/trash':     { label: 'سلة المحذوفات', icon: '🗑️', module: () => TrashModule },
      '/settings':  { label: 'الإعدادات',   icon: '⚙️', module: () => SettingsModule },
    },
  },
];

const ROUTES = Object.fromEntries(NAV_GROUPS.flatMap(g => Object.entries(g.items)));

// null = full access. Otherwise, only these paths are visible/allowed for the role.
const ROLE_ACCESS = {
  admin: null,
  viewer: null, // sees everything, but action buttons are hidden via CSS (role-viewer)
  accountant: ['/dashboard', '/treasury', '/expenses', '/reports', '/partners', '/balances', '/activity'],
  receptionist: ['/dashboard', '/vehicles', '/customers', '/bookings', '/contracts', '/returns', '/maintenance', '/incidents'],
};

function canAccessRoute(role, path) {
  const allowed = ROLE_ACCESS[role];
  return allowed === null || allowed === undefined ? true : allowed.includes(path);
}

function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/dashboard';
  const [path, qs] = raw.split('?');
  const query = {};
  if (qs) new URLSearchParams(qs).forEach((v, k) => { query[k] = v; });
  return { path: path || '/dashboard', query };
}

async function router() {
  const { path, query } = parseHash();
  const currentUser = await getCurrentUserRecord();
  const role = currentUser?.role || 'admin';

  if (ROUTES[path] && !canAccessRoute(role, path)) {
    Utils.toast('لا تملك صلاحية الوصول لهذه الصفحة', 'error');
    window.location.hash = '#/dashboard';
    return;
  }

  const route = ROUTES[path] || ROUTES['/dashboard'];
  const content = document.getElementById('app-content');

  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.dataset.path === path);
  });
  document.getElementById('page-title').textContent = route.label;

  content.innerHTML = '<div class="loading">جارٍ التحميل...</div>';
  try {
    await route.module().render(content, query);
  } catch (err) {
    console.error(err);
    content.innerHTML = `<div class="empty-state">حدث خطأ أثناء تحميل الصفحة: ${Utils.esc(err.message)}</div>`;
  }
}

async function buildSidebar() {
  const currentUser = await getCurrentUserRecord();
  const role = currentUser?.role || 'admin';

  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = NAV_GROUPS.map(group => {
    const visibleItems = Object.entries(group.items).filter(([path]) => canAccessRoute(role, path));
    if (!visibleItems.length) return '';
    return `
      ${group.label ? `<div class="nav-section-title">${group.label}</div>` : ''}
      ${visibleItems.map(([path, r]) => `
        <a href="#${path}" class="nav-link" data-path="${path}">
          <span class="nav-icon">${r.icon}</span><span>${r.label}</span>
        </a>
      `).join('')}
    `;
  }).join('');

  document.body.className = document.body.className.replace(/\brole-\S+/g, '').trim();
  document.body.classList.add('role-' + role);

  const badge = document.getElementById('current-user-badge');
  if (badge && currentUser) {
    badge.innerHTML = `👤 <strong>${Utils.esc(currentUser.fullName || currentUser.username)}</strong><br>${Utils.esc(UsersModule.ROLES[currentUser.role]?.label || currentUser.role)}`;
  }
}

async function getCurrentUserRecord() {
  const id = getCurrentUserId();
  if (!id) return null;
  try { return await DB.get('users', id); } catch { return null; }
}

async function setupNotificationBell() {
  const bell = document.getElementById('notif-bell-btn');
  const countEl = document.getElementById('notif-count');
  const dropdown = document.getElementById('notif-dropdown');

  async function collectAlerts() {
    const settings = await getSettings();
    const n = settings.notifications;
    const [contracts, customers, bookings] = await Promise.all([
      DB.getAll('contracts'), DB.getAll('customers'), DB.getAll('bookings')
    ]);
    const today = new Date();
    const inDays = new Date(); inDays.setDate(today.getDate() + Number(n.daysAhead || 7));
    const in30 = new Date(); in30.setDate(today.getDate() + 30);

    const alerts = [];
    if (n.contractsOverdue || n.contractsEndingSoon) {
      contracts.filter(c => c.status === 'active').forEach(c => {
        if (n.contractsOverdue && new Date(c.endDate) < today) alerts.push({ level: 'danger', text: `عقد ${c.contractNo} متأخر التسليم`, path: '/contracts' });
        else if (n.contractsEndingSoon && new Date(c.endDate) <= inDays) alerts.push({ level: 'warn', text: `عقد ${c.contractNo} ينتهي قريباً`, path: '/contracts' });
      });
    }
    if (n.licenseExpiring) {
      customers.forEach(c => {
        if (c.licenseExpiry && new Date(c.licenseExpiry) <= in30 && new Date(c.licenseExpiry) >= today) {
          alerts.push({ level: 'warn', text: `رخصة العميل ${c.name} تنتهي قريباً`, path: '/customers' });
        }
      });
    }
    if (n.upcomingBookings) {
      bookings.filter(b => b.status === 'confirmed' && new Date(b.startDate) >= today && new Date(b.startDate) <= inDays)
        .forEach(() => alerts.push({ level: 'info', text: `حجز قادم خلال ${n.daysAhead || 7} أيام`, path: '/bookings' }));
    }

    if (n.maintenanceDue) {
      const maintAlerts = await MaintenanceModule.getUpcomingAlerts();
      maintAlerts.forEach(a => alerts.push({
        level: a.due.overdue ? 'danger' : 'warn',
        text: `صيانة ${a.due.overdue ? 'متأخرة' : 'قريبة'}: ${a.vehicle?.plate || ''}`,
        path: '/maintenance',
      }));
    }

    if (n.vehicleDocs !== false) {
      const vehicles = await DB.getAll('vehicles');
      vehicles.filter(v => v._archived !== '1').forEach(v => {
        const status = VehiclesModule.docStatus(v);
        if (status) alerts.push({ level: status.level === 'expired' ? 'danger' : 'warn', text: `${v.plate}: ${status.text}`, path: '/vehicles' });
      });
    }

    if (n.unpaidViolations) {
      const incidents = await DB.getAll('incidents');
      incidents.filter(i => i.type === 'violation' && i.status !== 'paid').forEach(() => {
        alerts.push({ level: 'warn', text: `مخالفة غير مسددة`, path: '/incidents' });
      });
    }

    if (settings.backup.reminderEnabled) {
      const last = settings.backup.lastBackupAt ? new Date(settings.backup.lastBackupAt) : null;
      const daysSince = last ? Math.floor((today - last) / 86400000) : Infinity;
      if (daysSince >= Number(settings.backup.reminderDays || 7)) {
        alerts.push({ level: 'warn', text: last ? `لم يتم عمل نسخة احتياطية منذ ${daysSince} يوم` : 'لم يتم عمل نسخة احتياطية بعد', path: '/settings' });
      }
    }

    return alerts;
  }

  async function refresh() {
    const alerts = await collectAlerts();
    if (alerts.length) {
      countEl.textContent = alerts.length > 99 ? '99+' : alerts.length;
      countEl.style.display = 'inline-block';
    } else {
      countEl.style.display = 'none';
    }
    dropdown.innerHTML = alerts.length
      ? alerts.slice(0, 20).map(a => `<div class="notif-item notif-${a.level}" data-path="${a.path}">${Utils.esc(a.text)}</div>`).join('')
      : '<div class="notif-empty">لا توجد تنبيهات حالياً 🎉</div>';
    dropdown.querySelectorAll('.notif-item').forEach(el => {
      el.onclick = () => {
        window.location.hash = '#' + el.dataset.path;
        dropdown.classList.remove('show');
      };
    });
  }

  bell.onclick = async (e) => {
    e.stopPropagation();
    const willShow = !dropdown.classList.contains('show');
    if (willShow) await refresh();
    dropdown.classList.toggle('show', willShow);
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.notif-wrap')) dropdown.classList.remove('show');
  });

  await refresh();
  setInterval(refresh, 60000); // keep the badge count fresh while the app is open
}


async function initApp() {
  const settings = await getSettings();
  Utils.setCurrency(settings.currencySymbol);
  SettingsModule.applyBranding(settings);
  applyTheme(SafeStorage.get('cr_theme') || 'dark');

  await buildSidebar();
  window.addEventListener('hashchange', router);
  await router();

  document.getElementById('restore-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      await importAllData(data);
      Utils.toast('تم استيراد النسخة الاحتياطية بنجاح', 'success');
      router();
    } catch (err) {
      Utils.toast('ملف غير صالح', 'error');
    }
  };

  document.getElementById('theme-toggle-btn').onclick = () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  };

  await setupNotificationBell();

  document.getElementById('logout-btn').onclick = () => {
    setCurrentUserId(null);
    document.getElementById('app-shell').style.display = 'none';
    showAuthScreen();
  };

  setupGlobalSearch();
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  SafeStorage.set('cr_theme', theme);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.textContent = theme === 'dark' ? '🌙' : '☀️';
}
window.applyTheme = applyTheme;

/* ── Auth: first-run admin setup, or login for existing users ── */
async function showAuthScreen() {
  applyTheme(SafeStorage.get('cr_theme') || 'dark');
  try {
    const settings = await getSettings();
    document.getElementById('auth-company-name').textContent = settings.companyName;

    document.getElementById('auth-screen').style.display = 'flex';
    const users = await DB.getAll('users');

    if (!users.length) {
      renderFirstRunSetup();
    } else {
      renderLoginForm(users);
    }
  } catch (err) {
    console.error('Failed to start the app (database error):', err);
    showFatalError(err);
  }
}

function showFatalError(err) {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('auth-form-wrap').innerHTML = `
    <div style="text-align:center">
      <div style="font-size:34px; margin-bottom:10px">⚠️</div>
      <p style="font-weight:700; margin-bottom:8px">تعذّر تشغيل قاعدة البيانات المحلية</p>
      <p class="muted" style="margin-bottom:16px; font-size:13px; line-height:1.7">
        ${Utils?.esc ? Utils.esc(err?.message || 'خطأ غير معروف') : (err?.message || 'خطأ غير معروف')}<br><br>
        جرّب: الخروج من وضع التصفح الخاص (Incognito)، التأكد من إغلاق أي نافذة أخرى من البرنامج مفتوحة،
        أو تحرير مساحة تخزين على الجهاز، ثم أعد المحاولة.
      </p>
      <button class="btn btn-primary" id="fatal-retry-btn">إعادة المحاولة</button>
    </div>`;
  document.getElementById('fatal-retry-btn').onclick = () => window.location.reload();
}

function renderFirstRunSetup() {
  const wrap = document.getElementById('auth-form-wrap');
  wrap.innerHTML = `
    <p class="muted" style="text-align:center; margin-bottom:16px">مرحباً! لا يوجد مستخدمون بعد — أنشئ أول حساب مدير للبدء</p>
    <form id="setup-form" class="form-grid">
      <label>اسم المنشأة *<input required name="companyName" class="input" value="نظام تأجير السيارات" autofocus></label>
      <label>اسم المستخدم *<input required name="username" class="input"></label>
      <label>الاسم الكامل<input name="fullName" class="input"></label>
      <label>كلمة المرور *${pwField('password')}</label>
      <label>تأكيد كلمة المرور *${pwField('password2')}</label>
      <button type="submit" class="btn btn-primary">إنشاء حساب المدير والدخول</button>
      <div id="auth-error" class="auth-error" style="display:none"></div>
    </form>
  `;
  attachPasswordToggles(wrap);
  document.getElementById('setup-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const errBox = document.getElementById('auth-error');
    if (fd.password !== fd.password2) { errBox.textContent = 'كلمتا المرور غير متطابقتين'; errBox.style.display = 'block'; return; }
    if (fd.password.length < 4) { errBox.textContent = 'كلمة المرور يجب أن تكون 4 أحرف على الأقل'; errBox.style.display = 'block'; return; }
    await saveSettings({ companyName: fd.companyName || 'نظام تأجير السيارات' });
    const salt = randomSalt();
    const passwordHash = await hashPassword(fd.password, salt);
    const user = await DB.add('users', { username: fd.username, fullName: fd.fullName, role: 'admin', active: '1', salt, passwordHash });
    setCurrentUserId(user.id);
    await enterApp();
  };
}

/** Password `<input>` markup with a show/hide eye-toggle button. */
function pwField(name, extra = '') {
  return `<div class="pw-wrap">
    <input required type="password" name="${name}" class="input" minlength="4" ${extra}>
    <button type="button" class="pw-toggle" tabindex="-1" aria-label="إظهار/إخفاء كلمة المرور">👁</button>
  </div>`;
}

function attachPasswordToggles(scope) {
  scope.querySelectorAll('.pw-wrap').forEach(wrap => {
    const input = wrap.querySelector('input');
    const btn = wrap.querySelector('.pw-toggle');
    if (!input || !btn) return;
    btn.onclick = () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? '🙈' : '👁';
    };
  });
}

/* ── Basic brute-force protection for login (client-side, local app) ── */
const LOGIN_LOCK_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_SECONDS = 60;
function loginAttemptsKey(username) { return 'cr_login_attempts_' + (username || '').toLowerCase(); }
function getLoginLock(username) {
  try { return JSON.parse(SafeStorage.get(loginAttemptsKey(username)) || 'null'); } catch { return null; }
}
function registerFailedLogin(username) {
  const rec = getLoginLock(username) || { count: 0, lockUntil: 0 };
  rec.count += 1;
  if (rec.count >= LOGIN_LOCK_MAX_ATTEMPTS) { rec.lockUntil = Date.now() + LOGIN_LOCK_SECONDS * 1000; rec.count = 0; }
  SafeStorage.set(loginAttemptsKey(username), JSON.stringify(rec));
}
function clearLoginLock(username) { SafeStorage.remove(loginAttemptsKey(username)); }
function checkLoginLock(username) {
  const rec = getLoginLock(username);
  if (!rec || !rec.lockUntil) return 0;
  const remaining = Math.ceil((rec.lockUntil - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}

function renderLoginForm(users) {
  const activeUsers = users.filter(u => u.active !== '0');
  const wrap = document.getElementById('auth-form-wrap');

  wrap.innerHTML = `
    <div id="quick-login-view">
      <p class="muted" style="text-align:center; margin-bottom:14px">اختر اسمك للدخول السريع</p>
      <div class="quick-login-list">
        ${activeUsers.map(u => `
          <button type="button" class="quick-login-item" data-id="${u.id}">
            <span class="quick-login-avatar">${Utils.esc((u.fullName || u.username || '?')[0])}</span>
            <span>${Utils.esc(u.fullName || u.username)}</span>
          </button>
        `).join('')}
      </div>
      <div class="auth-switch"><a id="show-classic-login">تسجيل الدخول باسم مستخدم مختلف</a></div>
    </div>

    <div id="quick-pin-view" style="display:none">
      <p class="muted" style="text-align:center; margin-bottom:14px" id="quick-pin-name"></p>
      <form id="quick-pin-form" class="form-grid">
        <label>كلمة المرور *${pwField('password', 'autofocus')}</label>
        <button type="submit" class="btn btn-primary">دخول</button>
        <div id="quick-pin-error" class="auth-error" style="display:none"></div>
      </form>
      <div class="auth-switch"><a id="back-to-quick-login">رجوع</a></div>
    </div>

    <div id="classic-login-view" style="display:none">
      <form id="login-form" class="form-grid">
        <label>اسم المستخدم *<input required name="username" class="input"></label>
        <label>كلمة المرور *${pwField('password')}</label>
        <button type="submit" class="btn btn-primary">تسجيل الدخول</button>
        <div id="auth-error" class="auth-error" style="display:none"></div>
      </form>
      <div class="auth-switch"><a id="back-to-quick-login-2">رجوع للدخول السريع</a></div>
    </div>
  `;
  attachPasswordToggles(wrap);

  const quickView = document.getElementById('quick-login-view');
  const pinView = document.getElementById('quick-pin-view');
  const classicView = document.getElementById('classic-login-view');

  function showQuick() { quickView.style.display = 'block'; pinView.style.display = 'none'; classicView.style.display = 'none'; }
  function showPin(user) {
    quickView.style.display = 'none'; pinView.style.display = 'block'; classicView.style.display = 'none';
    document.getElementById('quick-pin-name').textContent = `مرحباً، ${user.fullName || user.username} — أدخل كلمة المرور`;
    document.getElementById('quick-pin-form').dataset.userId = user.id;
    document.getElementById('quick-pin-error').style.display = 'none';
  }
  function showClassic() { quickView.style.display = 'none'; pinView.style.display = 'none'; classicView.style.display = 'block'; }

  if (!activeUsers.length) showClassic();

  wrap.querySelectorAll('.quick-login-item').forEach(btn => {
    btn.onclick = () => showPin(activeUsers.find(u => u.id === btn.dataset.id));
  });
  document.getElementById('show-classic-login').onclick = showClassic;
  document.getElementById('back-to-quick-login')?.addEventListener('click', showQuick);
  document.getElementById('back-to-quick-login-2')?.addEventListener('click', showQuick);

  document.getElementById('quick-pin-form').onsubmit = async (e) => {
    e.preventDefault();
    const userId = e.target.dataset.userId;
    const user = activeUsers.find(u => u.id === userId);
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const errBox = document.getElementById('quick-pin-error');
    const locked = checkLoginLock(user.username);
    if (locked) { errBox.textContent = `تم إيقاف الدخول مؤقتًا بسبب محاولات خاطئة متكررة — حاول بعد ${locked} ثانية`; errBox.style.display = 'block'; return; }
    const ok = await verifyPassword(fd.password, user.salt, user.passwordHash);
    if (!ok) {
      registerFailedLogin(user.username);
      errBox.textContent = 'كلمة المرور غير صحيحة';
      errBox.style.display = 'block';
      return;
    }
    clearLoginLock(user.username);
    setCurrentUserId(user.id);
    await enterApp();
  };

  document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const errBox = document.getElementById('auth-error');
    const locked = checkLoginLock(fd.username);
    if (locked) { errBox.textContent = `تم إيقاف الدخول مؤقتًا بسبب محاولات خاطئة متكررة — حاول بعد ${locked} ثانية`; errBox.style.display = 'block'; return; }
    const user = users.find(u => (u.username || '').toLowerCase() === (fd.username || '').toLowerCase());
    if (!user || user.active === '0') { registerFailedLogin(fd.username); errBox.textContent = 'اسم المستخدم غير موجود أو الحساب موقوف'; errBox.style.display = 'block'; return; }
    const ok = await verifyPassword(fd.password, user.salt, user.passwordHash);
    if (!ok) {
      registerFailedLogin(fd.username);
      errBox.textContent = 'كلمة المرور غير صحيحة';
      errBox.style.display = 'block';
      return;
    }
    clearLoginLock(fd.username);
    setCurrentUserId(user.id);
    await enterApp();
  };
}

async function enterApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'flex';
  await initApp();
}

/* ── Global safety net: never fail silently ── */
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled error:', e.reason);
  if (typeof Utils !== 'undefined' && Utils.toast) {
    Utils.toast('حدث خطأ غير متوقع: ' + (e.reason?.message || e.reason || 'خطأ غير معروف'), 'error');
  }
});
window.addEventListener('error', (e) => {
  console.error('Runtime error:', e.error || e.message);
});

document.addEventListener('DOMContentLoaded', async () => {
  const wrap = document.getElementById('auth-form-wrap');
  if (wrap) wrap.innerHTML = '<p class="muted" style="text-align:center">جارٍ تجهيز قاعدة البيانات...</p>';
  try {
    await window.migrateFromIndexedDBIfNeeded();
  } catch (err) {
    console.warn('legacy migration check failed', err);
  }
  showAuthScreen();
});

// Fix: on laptops, scrolling with the trackpad over a focused number input
// silently increments/decrements its value. Blur any focused number input
// as soon as the wheel moves, so page-scrolling never touches form values.
document.addEventListener('wheel', () => {
  const el = document.activeElement;
  if (el && el.tagName === 'INPUT' && el.type === 'number') el.blur();
}, { passive: true });

// Fix: the ArrowUp/ArrowDown keys natively step a number input's value up
// or down. Combined with the spin buttons already hidden via CSS, this
// makes every number field fully manual-typing-only as requested.
document.addEventListener('keydown', (e) => {
  const el = document.activeElement;
  if (el && el.tagName === 'INPUT' && el.type === 'number' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
  }
});

function setupGlobalSearch() {
  const input = document.getElementById('global-search');
  const results = document.getElementById('global-search-results');

  const run = Utils.debounce(async () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { results.classList.remove('show'); results.innerHTML = ''; return; }

    const [vehicles, customers, contracts] = await Promise.all([
      DB.getAll('vehicles'), DB.getAll('customers'), DB.getAll('contracts')
    ]);

    const vMatches = vehicles.filter(v =>
      (v.plate || '').toLowerCase().includes(q) || (v.chassis || '').toLowerCase().includes(q) ||
      (v.brand || '').toLowerCase().includes(q) || (v.model || '').toLowerCase().includes(q)
    ).slice(0, 5);

    const cMatches = customers.filter(c =>
      (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.nationalId || '').includes(q)
    ).slice(0, 5);

    const ctMatches = contracts.filter(c => (c.contractNo || '').toLowerCase().includes(q)).slice(0, 5);

    const groups = [
      { title: 'السيارات', icon: '🚗', items: vMatches.map(v => ({ label: `${v.plate} — ${v.brand} ${v.model}`, sub: v.chassis || '', path: '/vehicles', q: v.plate })) },
      { title: 'العملاء', icon: '👤', items: cMatches.map(c => ({ label: c.name, sub: c.phone || '', path: '/customers', q: c.name })) },
      { title: 'العقود', icon: '📄', items: ctMatches.map(c => ({ label: c.contractNo, sub: '', path: '/contracts', q: '' })) },
    ].filter(g => g.items.length);

    if (!groups.length) {
      results.innerHTML = '<div class="gsr-empty">لا توجد نتائج مطابقة</div>';
    } else {
      results.innerHTML = groups.map(g => `
        <div class="gsr-group-title">${g.icon} ${g.title}</div>
        ${g.items.map(it => `<div class="gsr-item" data-path="${it.path}" data-q="${Utils.esc(it.q)}"><span>${Utils.esc(it.label)}</span><small>${Utils.esc(it.sub)}</small></div>`).join('')}
      `).join('');
      results.querySelectorAll('.gsr-item').forEach(el => {
        el.onclick = () => {
          const path = el.dataset.path;
          const q = el.dataset.q;
          window.location.hash = q ? `#${path}?q=${encodeURIComponent(q)}` : `#${path}`;
          results.classList.remove('show');
          input.value = '';
        };
      });
    }
    results.classList.add('show');
  }, 200);

  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (results.innerHTML) results.classList.add('show'); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.topbar-search-wrap')) results.classList.remove('show');
  });
}
