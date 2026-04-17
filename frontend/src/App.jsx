import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { apiFetch } from './lib/api'

const DAILY_TARGET = 500
const MONTHLY_TARGET = 12000
const EXPENSE_CATEGORIES = [
  'Alquiler',
  'Internet',
  'Alarma',
  'Agua y luz',
  'Empleado 1',
  'Empleado 2',
  'Seguridad Social',
  'Otros',
]

// ─── Logo SVG inline (fallback si no carga la imagen) ───────────────────────
// El logo se carga desde /logo-zapateria.png vía <img>

function BellIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0 1 18 14.158V11a6.002 6.002 0 0 0-4-5.659V4a2 2 0 1 0-4 0v1.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5" />
      <path d="M9 17a3 3 0 0 0 6 0" />
    </svg>
  )
}

function ChevronIcon({ direction = 'left', size = 14 }) {
  const rotation = { left: 0, right: 180, up: 90, down: 270 }[direction] || 0
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: `rotate(${rotation}deg)` }}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function money(n) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0))
}
function formatDate(dateString) {
  return new Date(`${dateString}T12:00:00`).toLocaleDateString('es-ES')
}
function formatDateTime(value) {
  return new Date(value).toLocaleString('es-ES')
}
function getTodayKey() {
  return new Date().toISOString().slice(0, 10)
}
function isFutureDate(dateStr) {
  return dateStr > getTodayKey()
}
function clampToToday(dateStr) {
  return isFutureDate(dateStr) ? getTodayKey() : dateStr
}
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function addMonths(monthKey, delta) {
  const [year, month] = monthKey.split('-').map(Number)
  const d = new Date(year, month - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function getMonthKey(dateStr) {
  return dateStr.slice(0, 7)
}
function getMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
}
function isSunday(dateStr) {
  return new Date(`${dateStr}T12:00:00`).getDay() === 0
}
function isSaturday(dateStr) {
  return new Date(`${dateStr}T12:00:00`).getDay() === 6
}
function isWorkingDay(dateStr, extendedSchedule) {
  return extendedSchedule ? true : !isSunday(dateStr)
}
function nextAllowedDate(dateStr, direction, extendedSchedule) {
  let candidate = dateStr
  do { candidate = addDays(candidate, direction) }
  while (!isWorkingDay(candidate, extendedSchedule))
  return candidate
}
function normalizeDate(dateStr, extendedSchedule) {
  if (isWorkingDay(dateStr, extendedSchedule)) return dateStr
  return nextAllowedDate(dateStr, -1, extendedSchedule)
}

function buildMonthSummary(monthKey, sales, expenses) {
  const salesTotal = sales
    .filter((s) => s.sale_date.startsWith(monthKey))
    .reduce((acc, item) => acc + item.total_sales, 0)
  const expensesTotal = expenses
    .filter((e) => e.month_key === monthKey)
    .reduce((acc, item) => acc + item.amount, 0)
  return {
    salesTotal,
    expensesTotal,
    balance: salesTotal - expensesTotal,
    progress: MONTHLY_TARGET ? Math.round((salesTotal / MONTHLY_TARGET) * 100) : 0,
  }
}

function buildMonthDailyRows(monthKey, sales, extendedSchedule) {
  const [year, month] = monthKey.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  const salesMap = new Map(sales.map((item) => [item.sale_date, item]))
  const rows = []
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (!isWorkingDay(dateStr, extendedSchedule)) continue
    const existing = salesMap.get(dateStr)
    rows.push(existing || {
      id: `empty-${dateStr}`,
      sale_date: dateStr,
      morning_cash: 0, morning_card: 0, morning_total: 0,
      afternoon_cash: 0, afternoon_card: 0, afternoon_total: 0,
      total_sales: 0,
    })
  }
  return rows.sort((a, b) => b.sale_date.localeCompare(a.sale_date))
}

// ─── Form normalization (new fields: cash/card split) ───────────────────────
function normalizeFormFromSale(sale) {
  if (!sale) return { morning_cash: '', morning_card: '', afternoon_cash: '', afternoon_card: '', customers: '' }
  return {
    morning_cash: sale.morning_cash ?? '',
    morning_card: sale.morning_card ?? '',
    afternoon_cash: sale.afternoon_cash ?? '',
    afternoon_card: sale.afternoon_card ?? '',
    customers: sale.customers ?? '',
  }
}

function formsEqual(a, b) {
  return (
    String(a.morning_cash ?? '') === String(b.morning_cash ?? '') &&
    String(a.morning_card ?? '') === String(b.morning_card ?? '') &&
    String(a.afternoon_cash ?? '') === String(b.afternoon_cash ?? '') &&
    String(a.afternoon_card ?? '') === String(b.afternoon_card ?? '') &&
    String(a.customers ?? '') === String(b.customers ?? '')
  )
}

// ─── Shared inline styles ────────────────────────────────────────────────────
const rowStyle = { display: 'flex', alignItems: 'center', gap: '12px', width: '100%', flexWrap: 'nowrap' }
const checkboxWrapStyle = { display: 'flex', alignItems: 'center', width: '100%', marginBottom: '16px' }
const checkboxLabelStyle = { display: 'inline-flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: '#dbe7ff', fontSize: '15px', lineHeight: 1.2, whiteSpace: 'nowrap' }
const checkboxInputStyle = { width: '18px', height: '18px', margin: 0, accentColor: '#22d3ee', flex: '0 0 auto' }
const navButtonStyle = { width: '48px', minWidth: '48px', height: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, flex: '0 0 auto' }
const dateInputStyle = { flex: '1 1 auto', minWidth: '220px', height: '44px' }
const monthInputStyle = { flex: '1 1 auto', minWidth: '220px', height: '44px' }
const todayButtonStyle = { minWidth: '90px', height: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', flex: '0 0 auto' }
const currentMonthButtonStyle = { minWidth: '120px', height: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', flex: '0 0 auto' }

// ─── Section label for cash/card groups ─────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{
      gridColumn: '1 / -1',
      fontSize: '11px',
      fontWeight: 700,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: 'var(--primary)',
      marginBottom: '-4px',
      marginTop: '4px',
    }}>
      {children}
    </div>
  )
}

// ─── Stat card ───────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }) {
  return (
    <div className="card" style={{ display: 'grid', gap: '6px' }}>
      <span className="muted" style={{ fontSize: '12px' }}>{label}</span>
      <strong style={{ fontSize: '26px', color: accent || 'var(--text)' }}>{value}</strong>
      {sub && <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{sub}</span>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const token = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      localStorage.setItem('zapateria_token', token.access_token)
      const me = await apiFetch('/api/auth/me')
      onLogin(me)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="shell center-screen">
      <div className="login-card">
        {/* Logo con glow en hover */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
          <img
            src="/logo-zapateria.png"
            alt="Punta Pie Calzado Infantil"
            className="logo-img"
          />
        </div>

        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '20px', marginBottom: '4px' }}>Control de ventas</h1>
        </div>

        <form onSubmit={submit} className="stack">
          <label>
            Usuario
            <select value={username} onChange={(e) => setUsername(e.target.value)}>
              <option value="">Selecciona un usuario</option>
              <option value="Ivan">Iván</option>
              <option value="Claudia">Claudia</option>
              <option value="Tienda">Tienda</option>
            </select>
          </label>
          <label>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error ? <div className="error-box">{error}</div> : null}
          <button type="submit" disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [user, setUser] = useState(null)
  const [dailySales, setDailySales] = useState([])
  const [monthlyExpenses, setMonthlyExpenses] = useState([])
  const [settings, setSettings] = useState({ extended_schedule_enabled: false })
  const [stats, setStats] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [changeLogs, setChangeLogs] = useState([])
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false)
  const [logsModalOpen, setLogsModalOpen] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState(null)
  const [showUnsavedModal, setShowUnsavedModal] = useState(false)
  const [selectedDate, setSelectedDate] = useState(getTodayKey())
  const [selectedMonth, setSelectedMonth] = useState(getMonthKey(getTodayKey()))
  const [activeTab, setActiveTab] = useState('daily')
  const [form, setForm] = useState({ morning_cash: '', morning_card: '', afternoon_cash: '', afternoon_card: '', customers: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isEditing, setIsEditing] = useState(true)
  const notificationPanelRef = useRef(null)
  const notificationButtonRef = useRef(null)

  const extendedSchedule = settings.extended_schedule_enabled

  const selectedSale = useMemo(
    () => dailySales.find((item) => item.sale_date === selectedDate),
    [dailySales, selectedDate]
  )

  const viewedMonth = useMemo(
    () => buildMonthSummary(selectedMonth, dailySales, monthlyExpenses),
    [selectedMonth, dailySales, monthlyExpenses]
  )

  const todayMonth = getMonthKey(getTodayKey())
  const currentMonthSummary = useMemo(
    () => buildMonthSummary(todayMonth, dailySales, monthlyExpenses),
    [todayMonth, dailySales, monthlyExpenses]
  )

  const visibleDailyRows = useMemo(
    () =>
      buildMonthDailyRows(getMonthKey(selectedDate), dailySales, extendedSchedule).filter(
        (item) => item.sale_date <= getTodayKey()
      ),
    [selectedDate, dailySales, extendedSchedule]
  )

  const unreadNotifications = notifications.filter((item) => !item.is_read)
  const initialForm = useMemo(() => normalizeFormFromSale(selectedSale), [selectedSale])
  const hasUnsavedChanges = isEditing && !formsEqual(form, initialForm)
  const isExistingSavedRecord = Boolean(selectedSale)
  const showSaveButton = !isExistingSavedRecord || isEditing
  const showEditButton = isExistingSavedRecord
  const editButtonLabel = isExistingSavedRecord && isEditing ? 'Cancelar' : 'Editar'

  const isSaturdayAfternoonDisabled = isSaturday(selectedDate) && !extendedSchedule

  // Live totals computed from form
  const morningTotal = Number(form.morning_cash || 0) + Number(form.morning_card || 0)
  const afternoonTotal = isSaturdayAfternoonDisabled
    ? 0
    : Number(form.afternoon_cash || 0) + Number(form.afternoon_card || 0)
  const totalSales = morningTotal + afternoonTotal

  // ── Effects ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('zapateria_token')
    if (!token) return
    loadSession()
  }, [])

  useEffect(() => {
    setSelectedDate((prev) => normalizeDate(prev, extendedSchedule))
  }, [extendedSchedule])

  useEffect(() => {
    setForm(initialForm)
    if (selectedSale) {
      setIsEditing(!selectedSale.is_locked)
    } else {
      setIsEditing(true)
    }
  }, [initialForm, selectedSale])

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!notificationPanelOpen) return
      if (notificationPanelRef.current?.contains(event.target)) return
      if (notificationButtonRef.current?.contains(event.target)) return
      setNotificationPanelOpen(false)
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [notificationPanelOpen])

  useEffect(() => {
    if (!message && !error) return
    const timer = setTimeout(() => { setMessage(''); setError('') }, 3000)
    return () => clearTimeout(timer)
  }, [message, error])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') { setLogsModalOpen(false); setShowUnsavedModal(false) }
    }
    if (logsModalOpen || showUnsavedModal) {
      document.addEventListener('keydown', onKeyDown)
      document.body.style.overflow = 'hidden'
    }
    return () => { document.removeEventListener('keydown', onKeyDown); document.body.style.overflow = '' }
  }, [logsModalOpen, showUnsavedModal])

  // ── Data loading ─────────────────────────────────────────────────────────────
  async function loadSession() {
    try {
      const me = await apiFetch('/api/auth/me')
      setUser(me)
      await loadBusinessData(me)
    } catch {
      localStorage.removeItem('zapateria_token')
      setUser(null)
    }
  }

  async function loadBusinessData(currentUser = user) {
    const [sales, expenses, appSettings, dashboardStats] = await Promise.all([
      apiFetch('/api/daily-sales'),
      apiFetch('/api/monthly-expenses'),
      apiFetch('/api/settings'),
      apiFetch('/api/stats/dashboard'),
    ])
    setDailySales(sales)
    setMonthlyExpenses(expenses)
    setSettings(appSettings)
    setStats(dashboardStats)

    if (currentUser?.role === 'admin') {
      const [adminNotifications, logs] = await Promise.all([
        apiFetch('/api/admin/notifications?limit=20'),
        apiFetch('/api/admin/change-logs?limit=100'),
      ])
      setNotifications(adminNotifications)
      setChangeLogs(logs)
    } else {
      setNotifications([])
      setChangeLogs([])
    }
  }

  // ── Save day (FIXED: uses morning_cash, morning_card, afternoon_cash, afternoon_card) ──
  async function saveDay(e) {
    if (e) e.preventDefault()
    setMessage('')
    setError('')

    if (isFutureDate(selectedDate)) {
      setSelectedDate(getTodayKey())
      setError('No se pueden registrar ventas para fechas futuras. Se ha cambiado la fecha al día de hoy.')
      return false
    }

    try {
      const payload = {
        sale_date: selectedDate,
        morning_cash: Number(form.morning_cash || 0),
        morning_card: Number(form.morning_card || 0),
        afternoon_cash: Number(isSaturdayAfternoonDisabled ? 0 : (form.afternoon_cash || 0)),
        afternoon_card: Number(isSaturdayAfternoonDisabled ? 0 : (form.afternoon_card || 0)),
        worked: !isSunday(selectedDate) || extendedSchedule,
        customers: form.customers === '' ? null : Number(form.customers),
        extended_schedule: extendedSchedule,
      }

      await apiFetch('/api/daily-sales', { method: 'PUT', body: JSON.stringify(payload) })
      await loadBusinessData(user)
      setIsEditing(false)
      setMessage(selectedSale ? 'Día actualizado correctamente.' : 'Día guardado correctamente.')
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }

  async function unlockForEdit() {
    setMessage(''); setError('')
    try {
      await apiFetch(`/api/daily-sales/${selectedDate}/unlock`, { method: 'POST' })
      await loadBusinessData(user)
      setIsEditing(true)
      setMessage('Modo edición activado.')
    } catch (err) { setError(err.message) }
  }

  function cancelEdit() {
    if (!selectedSale) return
    setForm(initialForm)
    setIsEditing(false)
    setMessage('Edición cancelada.')
    setError('')
  }

  async function saveExpense(category, amount) {
    setMessage(''); setError('')
    try {
      await apiFetch('/api/monthly-expenses', {
        method: 'PUT',
        body: JSON.stringify({ month_key: selectedMonth, category, amount: Number(amount || 0) }),
      })
      await loadBusinessData(user)
      setMessage('Gasto actualizado correctamente.')
    } catch (err) { setError(err.message) }
  }

  async function toggleExtendedSchedule(checked) {
    try {
      await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ extended_schedule_enabled: checked }) })
      await loadBusinessData(user)
    } catch (err) { setError(err.message) }
  }

  async function markNotificationAsRead(notificationId) {
    try {
      await apiFetch(`/api/admin/notifications/${notificationId}/read`, { method: 'POST' })
      await loadBusinessData(user)
    } catch (err) { setError(err.message) }
  }

  async function markAllNotificationsAsRead() {
    try {
      const unread = notifications.filter((item) => !item.is_read)
      await Promise.all(unread.map((item) => apiFetch(`/api/admin/notifications/${item.id}/read`, { method: 'POST' })))
      await loadBusinessData(user)
    } catch (err) { setError(err.message) }
  }

  function exportLogsToExcel() {
    const rows = changeLogs
      .filter((item) => item.action === 'create' || item.action === 'update')
      .map((item) => ({
        'Fecha y hora': formatDateTime(item.changed_at),
        Usuario: item.changed_by_display_name,
        Día: formatDate(item.sale_date),
        Acción: item.action === 'create' ? 'Create' : 'Update',
        'Efectivo mañana': Number(item.morning_cash || 0),
        'Tarjeta mañana': Number(item.morning_card || 0),
        'Total mañana': Number(item.morning_total || 0),
        'Efectivo tarde': Number(item.afternoon_cash || 0),
        'Tarjeta tarde': Number(item.afternoon_card || 0),
        'Total tarde': Number(item.afternoon_total || 0),
        'Gastos día': Number(item.daily_expenses_total || 0),
        'Balance día': Number(item.daily_balance || 0),
        Clientes: item.customers ?? '',
        'Total ventas': Number(item.total_sales || 0),
      }))

    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Logs')
    XLSX.writeFile(workbook, 'logs_zapateria.xlsx')
  }

  function executePendingNavigation() {
    if (!pendingNavigation) return
    pendingNavigation()
    setPendingNavigation(null)
    setShowUnsavedModal(false)
  }

  function requestNavigation(action) {
    if (hasUnsavedChanges) {
      setPendingNavigation(() => action)
      setShowUnsavedModal(true)
      return
    }
    action()
  }

  async function handleSaveAndNavigate() {
    const ok = await saveDay()
    if (ok) executePendingNavigation()
  }

  function logout() {
    localStorage.removeItem('zapateria_token')
    setUser(null)
  }

  // ── Render guard ──────────────────────────────────────────────────────────────
  if (!user) return <LoginScreen onLogin={setUser} />

  return (
    <>
      <div className="shell">
        {/* ── HEADER ── */}
        <header className="topbar">
          <div>
            <p className="eyebrow">Punta Pie Calzado Infantil</p>
            <h1>Control de ventas y gastos</h1>
            <p className="muted">
              {user.display_name} · {user.role === 'admin' ? 'Administrador' : 'Tienda'}
            </p>
          </div>

          <div className="topbar-actions">
            {user.role === 'admin' ? (
              <button
                ref={notificationButtonRef}
                type="button"
                className={`notification-trigger ${notificationPanelOpen ? 'active' : ''}`}
                onClick={() => setNotificationPanelOpen((prev) => !prev)}
                title="Notificaciones"
              >
                <BellIcon size={18} />
                {unreadNotifications.length > 0 ? (
                  <span className="notification-badge">{unreadNotifications.length}</span>
                ) : null}
              </button>
            ) : null}

            <button className="secondary" onClick={logout}>Salir</button>

            {user.role === 'admin' && notificationPanelOpen ? (
              <div ref={notificationPanelRef} className="notification-panel">
                <div className="notification-panel-header">
                  <div>
                    <div className="notification-panel-title">Notificaciones</div>
                    <div className="notification-panel-subtitle">{unreadNotifications.length} sin leer</div>
                  </div>
                  <div className="notification-panel-actions">
                    <button type="button" className="secondary small-button"
                      onClick={markAllNotificationsAsRead} disabled={unreadNotifications.length === 0}>
                      Marcar todas
                    </button>
                  </div>
                </div>
                <div className="notification-list">
                  {notifications.length === 0 ? (
                    <div className="notification-empty">No hay notificaciones.</div>
                  ) : (
                    notifications.map((item) => (
                      <div key={item.id} className={`notification-card ${item.is_read ? 'read' : 'unread'}`}>
                        <div className="notification-card-top">
                          <div className="notification-card-main">
                            <div className="notification-chip">
                              {item.type === 'daily_sale_edited' ? 'Edición' : item.type === 'daily_expense_added' ? 'Gasto' : 'Aviso'}
                            </div>
                            <div className="notification-card-title">{item.title}</div>
                          </div>
                          {!item.is_read ? (
                            <button type="button" className="secondary small-button"
                              onClick={() => markNotificationAsRead(item.id)}>
                              Marcar
                            </button>
                          ) : null}
                        </div>
                        <div className="notification-card-date">{formatDateTime(item.created_at)}</div>
                        <div className="notification-card-message">{item.message}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </header>

        {/* ── ALERTS ── */}
        {message ? (
          <div className="success-box dismissible-alert">
            <span>{message}</span>
            <button type="button" className="alert-close" onClick={() => setMessage('')}>×</button>
          </div>
        ) : null}
        {error ? (
          <div className="error-box dismissible-alert">
            <span>{error}</span>
            <button type="button" className="alert-close" onClick={() => setError('')}>×</button>
          </div>
        ) : null}

        {/* ── TOP STATS ── */}
        <section className="stats-grid">
          <StatCard label="Ventas día seleccionado" value={money(totalSales)} />
          <StatCard label="Ventas mes actual" value={money(currentMonthSummary.salesTotal)} accent="var(--primary)" />
          <StatCard label="Gastos mes actual" value={money(currentMonthSummary.expensesTotal)} accent="var(--danger)" />
          <StatCard
            label="Balance mes actual"
            value={money(currentMonthSummary.balance)}
            accent={currentMonthSummary.balance >= 0 ? 'var(--success)' : 'var(--danger)'}
          />
        </section>

        {/* ── TABS ── */}
        <nav className="tabs">
          <button className={activeTab === 'daily' ? 'active' : ''} onClick={() => requestNavigation(() => setActiveTab('daily'))}>
            Resumen diario
          </button>
          {user.role === 'admin' ? (
            <button className={activeTab === 'monthly' ? 'active' : ''} onClick={() => requestNavigation(() => setActiveTab('monthly'))}>
              Resumen mensual
            </button>
          ) : null}
          {user.role === 'admin' ? (
            <button className={activeTab === 'stats' ? 'active' : ''} onClick={() => requestNavigation(() => setActiveTab('stats'))}>
              Estadísticas
            </button>
          ) : null}
          {user.role === 'admin' ? (
            <button type="button" onClick={() => setLogsModalOpen(true)}>Logs</button>
          ) : null}
        </nav>

        {/* ════════════════════════════════════════
            TAB: DAILY
        ════════════════════════════════════════ */}
        {activeTab === 'daily' && (
          <section className="two-columns">
            <div className="card stack">
              <h2>Registro de ventas por día</h2>

              {user.role === 'admin' ? (
                <div style={checkboxWrapStyle}>
                  <label style={checkboxLabelStyle}>
                    <input type="checkbox" style={checkboxInputStyle}
                      checked={extendedSchedule}
                      onChange={(e) => toggleExtendedSchedule(e.target.checked)} />
                    <span>Habilitar horario extendido</span>
                  </label>
                </div>
              ) : null}

              {/* Date navigation */}
              <div style={{ ...rowStyle, marginBottom: '16px' }}>
                <button type="button" className="secondary" style={navButtonStyle}
                  onClick={() => requestNavigation(() => setSelectedDate((prev) => nextAllowedDate(prev, -1, extendedSchedule)))}>
                  <ChevronIcon direction="left" />
                </button>
                <input type="date" value={selectedDate} style={dateInputStyle} max={getTodayKey()}
                  onChange={(e) => requestNavigation(() => {
                    const rawDate = e.target.value
                    if (isFutureDate(rawDate)) { setError('No se pueden registrar ventas para fechas futuras.'); setSelectedDate(getTodayKey()); return }
                    setSelectedDate(normalizeDate(rawDate, extendedSchedule))
                  })} />
                <button type="button" className="secondary" style={navButtonStyle}
                  disabled={selectedDate >= getTodayKey()}
                  onClick={() => requestNavigation(() => setSelectedDate((prev) => clampToToday(nextAllowedDate(prev, 1, extendedSchedule))))}>
                  <ChevronIcon direction="right" />
                </button>
                <button type="button" className="secondary" style={todayButtonStyle}
                  onClick={() => requestNavigation(() => setSelectedDate(normalizeDate(getTodayKey(), extendedSchedule)))}>
                  Hoy
                </button>
              </div>

              {!extendedSchedule ? (
                <p className="muted" style={{ fontSize: '13px', marginTop: 0 }}>
                  Domingos cerrados · sábados sin tarde
                </p>
              ) : null}

              {/* ── FORM: 4 inputs (cash + card split) ── */}
              <form onSubmit={saveDay} className="grid-form">

                {/* MAÑANA */}
                <SectionLabel>☀️ Mañana</SectionLabel>
                <label>
                  Efectivo mañana
                  <input type="number" min="0" step="0.01" disabled={!isEditing}
                    value={form.morning_cash}
                    onChange={(e) => setForm((prev) => ({ ...prev, morning_cash: e.target.value }))} />
                </label>
                <label>
                  Tarjeta mañana
                  <input type="number" min="0" step="0.01" disabled={!isEditing}
                    value={form.morning_card}
                    onChange={(e) => setForm((prev) => ({ ...prev, morning_card: e.target.value }))} />
                </label>

                {/* TARDE */}
                <SectionLabel>🌆 Tarde</SectionLabel>
                <label>
                  Efectivo tarde
                  <input type="number" min="0" step="0.01"
                    disabled={!isEditing || isSaturdayAfternoonDisabled}
                    value={isSaturdayAfternoonDisabled ? '' : form.afternoon_cash}
                    onChange={(e) => setForm((prev) => ({ ...prev, afternoon_cash: e.target.value }))} />
                </label>
                <label>
                  Tarjeta tarde
                  <input type="number" min="0" step="0.01"
                    disabled={!isEditing || isSaturdayAfternoonDisabled}
                    value={isSaturdayAfternoonDisabled ? '' : form.afternoon_card}
                    onChange={(e) => setForm((prev) => ({ ...prev, afternoon_card: e.target.value }))} />
                </label>

                {/* TOTALES — read only */}
                <SectionLabel>📊 Totales</SectionLabel>
                <label>
                  Total mañana
                  <input type="text" readOnly value={money(morningTotal)}
                    style={{ color: 'var(--primary)', fontWeight: 600 }} />
                </label>
                <label>
                  Total tarde
                  <input type="text" readOnly value={isSaturdayAfternoonDisabled ? '—' : money(afternoonTotal)}
                    style={{ color: 'var(--primary)', fontWeight: 600 }} />
                </label>

                <label>
                  Clientes
                  <input type="number" min="0" disabled={!isEditing}
                    value={form.customers}
                    onChange={(e) => setForm((prev) => ({ ...prev, customers: e.target.value }))} />
                </label>
                <label>
                  Total ventas del día
                  <input type="text" readOnly value={money(totalSales)}
                    style={{ color: 'var(--success)', fontWeight: 700, fontSize: '16px' }} />
                </label>

                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {showSaveButton ? <button type="submit">Guardar</button> : null}
                  {showEditButton ? (
                    <button type="button" className="secondary"
                      onClick={() => { if (isEditing) cancelEdit(); else unlockForEdit() }}>
                      {editButtonLabel}
                    </button>
                  ) : null}
                </div>
              </form>
            </div>

            {/* Right panel */}
            <div className="card stack">
              <h2>Objetivo diario</h2>
              <p className="muted">{formatDate(selectedDate)} · Meta: {money(DAILY_TARGET)}</p>
              <div className="progress">
                <div className="progress-bar" style={{ width: `${Math.min((totalSales / DAILY_TARGET) * 100, 100)}%` }} />
              </div>
              <p>
                {totalSales >= DAILY_TARGET
                  ? '✅ Objetivo diario alcanzado'
                  : `Faltan ${money(Math.max(DAILY_TARGET - totalSales, 0))}`}
              </p>

              {/* Month table with cash/card columns */}
              <div className="history-table">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Mañana</th>
                      <th>Tarde</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDailyRows.map((item) => {
                      const missedTarget = item.total_sales > 0 && item.total_sales < DAILY_TARGET
                      return (
                        <tr key={item.id} style={missedTarget ? { background: 'rgba(202,138,4,0.16)', color: '#f8fafc' } : undefined}>
                          <td>{formatDate(item.sale_date)}</td>
                          <td>{money(item.morning_total)}</td>
                          <td>{money(item.afternoon_total)}</td>
                          <td><strong>{money(item.total_sales)}</strong></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* ════════════════════════════════════════
            TAB: MONTHLY
        ════════════════════════════════════════ */}
        {activeTab === 'monthly' && user.role === 'admin' && (
          <section className="two-columns">
            <div className="card stack">
              <div style={{ ...rowStyle, marginBottom: '16px' }}>
                <button type="button" className="secondary" style={navButtonStyle}
                  onClick={() => requestNavigation(() => setSelectedMonth((prev) => addMonths(prev, -1)))}>
                  <ChevronIcon direction="left" />
                </button>
                <input type="month" value={selectedMonth} style={monthInputStyle}
                  onChange={(e) => requestNavigation(() => setSelectedMonth(e.target.value))} />
                <button type="button" className="secondary" style={navButtonStyle}
                  onClick={() => requestNavigation(() => setSelectedMonth((prev) => addMonths(prev, 1)))}>
                  <ChevronIcon direction="right" />
                </button>
                <button type="button" className="secondary" style={currentMonthButtonStyle}
                  onClick={() => requestNavigation(() => setSelectedMonth(todayMonth))}>
                  Mes actual
                </button>
              </div>

              <h2>Gastos del mes</h2>
              {EXPENSE_CATEGORIES.map((category) => {
                const item = monthlyExpenses.find((e) => e.month_key === selectedMonth && e.category === category)
                return (
                  <div key={category} className="expense-row">
                    <span>{category}</span>
                    <input type="number" min="0" step="0.01"
                      defaultValue={item?.amount || ''}
                      onBlur={(e) => saveExpense(category, e.target.value)} />
                  </div>
                )
              })}
            </div>

            <div className="card stack">
              <h2>Resultado del mes</h2>
              <p style={{ margin: 0, color: 'var(--muted)' }}>
                {getMonthLabel(selectedMonth)}
              </p>
              <div style={{ marginTop: '12px', display: 'grid', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="muted">Facturación</span>
                  <strong style={{ color: 'var(--primary)' }}>{money(viewedMonth.salesTotal)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="muted">Gastos</span>
                  <strong style={{ color: 'var(--danger)' }}>{money(viewedMonth.expensesTotal)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                  <span className="muted">Balance</span>
                  <strong style={{ color: viewedMonth.balance >= 0 ? 'var(--success)' : 'var(--danger)', fontSize: '18px' }}>
                    {money(viewedMonth.balance)}
                  </strong>
                </div>
              </div>
              <div className="progress" style={{ marginTop: '8px' }}>
                <div className="progress-bar green" style={{ width: `${Math.min(viewedMonth.progress, 100)}%` }} />
              </div>
              <p className="muted" style={{ fontSize: '13px' }}>
                {viewedMonth.progress}% del objetivo mensual ({money(MONTHLY_TARGET)})
              </p>
            </div>
          </section>
        )}

        {/* ════════════════════════════════════════
            TAB: STATS
        ════════════════════════════════════════ */}
        {activeTab === 'stats' && user.role === 'admin' && stats && (
          <section className="card stack">
            <h2>Estadísticas</h2>
            <div className="stats-grid">
              <StatCard label="% días con objetivo" value={`${stats.daily_target_rate}%`} />
              <StatCard label="% meses con objetivo" value={`${stats.monthly_target_rate}%`} />
              <StatCard label="Día más fuerte" value={stats.best_weekday} accent="var(--success)" />
              <StatCard label="Día más flojo" value={stats.worst_weekday} accent="var(--danger)" />
            </div>

            <div className="history-table">
              <table>
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th>Ventas</th>
                    <th>Gastos</th>
                    <th>Balance</th>
                    <th>% objetivo</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.monthly_summaries.map((item) => (
                    <tr key={item.month_key}>
                      <td>{getMonthLabel(item.month_key)}</td>
                      <td>{money(item.sales_total)}</td>
                      <td>{money(item.expenses_total)}</td>
                      <td style={{ color: item.balance >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                        {money(item.balance)}
                      </td>
                      <td>
                        <span style={{ color: item.target_progress_pct >= 100 ? 'var(--success)' : 'var(--text)' }}>
                          {item.target_progress_pct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {/* ════════════════════════════════════════
          MODAL: LOGS
      ════════════════════════════════════════ */}
      {logsModalOpen ? (
        <div className="modal-backdrop" onClick={() => setLogsModalOpen(false)}>
          <div className="modal-panel logs-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ marginBottom: '4px' }}>Logs de actividad</h2>
                <p className="muted" style={{ margin: 0 }}>
                  Historial completo de cambios con desglose efectivo/tarjeta.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button type="button" className="secondary" onClick={exportLogsToExcel}>Exportar Excel</button>
                <button type="button" className="secondary" onClick={() => setLogsModalOpen(false)}>Cerrar</button>
              </div>
            </div>

            <div className="history-table logs-modal-table">
              <table>
                <thead>
                  <tr>
                    <th>Fecha y hora</th>
                    <th>Usuario</th>
                    <th>Día</th>
                    <th>Acción</th>
                    <th>Ef. Mañana</th>
                    <th>Tj. Mañana</th>
                    <th>Total Mañana</th>
                    <th>Ef. Tarde</th>
                    <th>Tj. Tarde</th>
                    <th>Total Tarde</th>
                    <th>Clientes</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {changeLogs.filter((item) => item.action === 'create' || item.action === 'update').length === 0 ? (
                    <tr>
                      <td colSpan="12" style={{ textAlign: 'center', padding: '18px' }}>No hay logs disponibles.</td>
                    </tr>
                  ) : (
                    changeLogs
                      .filter((item) => item.action === 'create' || item.action === 'update')
                      .map((item) => {
                        const actionClass = item.action === 'create' ? 'log-action-create' : 'log-action-update'
                        return (
                          <tr key={item.id}>
                            <td>{formatDateTime(item.changed_at)}</td>
                            <td>{item.changed_by_display_name}</td>
                            <td>{formatDate(item.sale_date)}</td>
                            <td><span className={actionClass}>{item.action === 'create' ? 'Create' : 'Update'}</span></td>
                            <td>{money(item.morning_cash)}</td>
                            <td>{money(item.morning_card)}</td>
                            <td><strong>{money(item.morning_total)}</strong></td>
                            <td>{money(item.afternoon_cash)}</td>
                            <td>{money(item.afternoon_card)}</td>
                            <td><strong>{money(item.afternoon_total)}</strong></td>
                            <td>{item.customers ?? '—'}</td>
                            <td><strong>{money(item.total_sales)}</strong></td>
                          </tr>
                        )
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {/* ════════════════════════════════════════
          MODAL: UNSAVED CHANGES
      ════════════════════════════════════════ */}
      {showUnsavedModal ? (
        <div className="modal-backdrop" onClick={() => setShowUnsavedModal(false)}>
          <div className="modal-panel" style={{ width: 'min(520px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ marginBottom: '4px' }}>¿Guardar los cambios?</h2>
                <p className="muted" style={{ margin: 0 }}>Tienes cambios sin guardar. ¿Qué quieres hacer?</p>
              </div>
            </div>
            <div style={{ padding: '0 22px 22px 22px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button type="button" className="secondary" onClick={() => { setPendingNavigation(null); setShowUnsavedModal(false) }}>
                Cancelar
              </button>
              <button type="button" onClick={handleSaveAndNavigate}>Guardar</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
