import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { apiFetch } from './lib/api'

const DAILY_TARGET = 500
const MONTHLY_TARGET = 12000
const STORE_OPEN_DATE = '2026-04-16'
const EXPENSE_CATEGORIES = [
  'Alquiler', 'Internet', 'Alarma', 'Agua y luz',
  'Empleado 1', 'Empleado 2', 'Seguridad Social', 'Otros',
]

// ─── Icons ───────────────────────────────────────────────────────────────────
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
function money(n) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0))
}
function formatDate(d) { return new Date(`${d}T12:00:00`).toLocaleDateString('es-ES') }
function formatDateTime(v) { return new Date(v).toLocaleString('es-ES') }
function getTodayKey() { return new Date().toISOString().slice(0, 10) }
function isFutureDate(d) { return d > getTodayKey() }
function isBeforeOpenDate(d) { return d < STORE_OPEN_DATE }
function clampToToday(d) { return isFutureDate(d) ? getTodayKey() : d }
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function addMonths(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function getMonthKey(d) { return d.slice(0, 7) }
function getMonthLabel(mk) {
  const [y, m] = mk.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
}
function isSunday(d) { return new Date(`${d}T12:00:00`).getDay() === 0 }
function isSaturday(d) { return new Date(`${d}T12:00:00`).getDay() === 6 }
function isWorkingDay(d, ext) { return ext ? true : !isSunday(d) }
function nextAllowedDate(dateStr, direction, ext) {
  let c = dateStr
  do { c = addDays(c, direction) }
  while (!isWorkingDay(c, ext) || (direction < 0 && isBeforeOpenDate(c)))
  if (isBeforeOpenDate(c)) return STORE_OPEN_DATE
  return c
}
function normalizeDate(d, ext) {
  if (isWorkingDay(d, ext)) return d
  return nextAllowedDate(d, -1, ext)
}

// ─── Business logic ──────────────────────────────────────────────────────────
function buildMonthSummary(monthKey, sales, expenses) {
  const salesTotal = sales.filter(s => s.sale_date.startsWith(monthKey)).reduce((a, s) => a + s.total_sales, 0)
  const expensesTotal = expenses.filter(e => e.month_key === monthKey).reduce((a, e) => a + e.amount, 0)
  return { salesTotal, expensesTotal, balance: salesTotal - expensesTotal, progress: MONTHLY_TARGET ? Math.round((salesTotal / MONTHLY_TARGET) * 100) : 0 }
}

function buildMonthDailyRows(monthKey, sales, ext) {
  const [y, m] = monthKey.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const map = new Map(sales.map(s => [s.sale_date, s]))
  const rows = []
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (!isWorkingDay(dateStr, ext)) continue
    rows.push(map.get(dateStr) || {
      id: `empty-${dateStr}`, sale_date: dateStr,
      morning_cash: 0, morning_card: 0, morning_bizum: 0, morning_bonos: 0, morning_total: 0,
      afternoon_cash: 0, afternoon_card: 0, afternoon_bizum: 0, afternoon_bonos: 0, afternoon_total: 0,
      total_sales: 0, daily_expenses_total: 0, daily_balance: 0,
    })
  }
  return rows.sort((a, b) => b.sale_date.localeCompare(a.sale_date))
}

// ─── Form helpers ─────────────────────────────────────────────────────────────
const EMPTY_FORM = {
  morning_cash: '', morning_card: '', morning_bizum: '', morning_bonos: '',
  afternoon_cash: '', afternoon_card: '', afternoon_bizum: '', afternoon_bonos: '',
  customers: '',
}
function normalizeFormFromSale(sale) {
  if (!sale) return EMPTY_FORM
  return {
    morning_cash: sale.morning_cash ?? '',
    morning_card: sale.morning_card ?? '',
    morning_bizum: sale.morning_bizum ?? '',
    morning_bonos: sale.morning_bonos ?? '',
    afternoon_cash: sale.afternoon_cash ?? '',
    afternoon_card: sale.afternoon_card ?? '',
    afternoon_bizum: sale.afternoon_bizum ?? '',
    afternoon_bonos: sale.afternoon_bonos ?? '',
    customers: sale.customers ?? '',
  }
}
const FORM_FIELDS = ['morning_cash','morning_card','morning_bizum','morning_bonos','afternoon_cash','afternoon_card','afternoon_bizum','afternoon_bonos','customers']
function formsEqual(a, b) {
  return FORM_FIELDS.every(k => String(a[k] ?? '') === String(b[k] ?? ''))
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const rowStyle = { display: 'flex', alignItems: 'center', gap: '12px', width: '100%', flexWrap: 'nowrap' }
const checkboxWrapStyle = { display: 'flex', alignItems: 'center', width: '100%', marginBottom: '16px' }
const checkboxLabelStyle = { display: 'inline-flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: '#dbe7ff', fontSize: '15px', lineHeight: 1.2, whiteSpace: 'nowrap' }
const checkboxInputStyle = { width: '18px', height: '18px', margin: 0, accentColor: '#22d3ee', flex: '0 0 auto' }
const navButtonStyle = { width: '48px', minWidth: '48px', height: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, flex: '0 0 auto' }
const dateInputStyle = { flex: '1 1 auto', minWidth: '220px', height: '44px' }
const monthInputStyle = { flex: '1 1 auto', minWidth: '220px', height: '44px' }
const todayButtonStyle = { minWidth: '90px', height: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', flex: '0 0 auto' }
const currentMonthButtonStyle = { minWidth: '120px', height: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', flex: '0 0 auto' }

// ─── Sub-components ───────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{
      gridColumn: '1 / -1', fontSize: '11px', fontWeight: 700,
      letterSpacing: '0.12em', textTransform: 'uppercase',
      color: 'var(--primary)', marginBottom: '-4px', marginTop: '8px',
    }}>
      {children}
    </div>
  )
}

function AmountInput({ label, field, form, setForm, disabled }) {
  return (
    <label>
      {label}
      <input type="number" min="0" step="0.01" disabled={disabled}
        value={form[field]}
        onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))} />
    </label>
  )
}

function TotalReadout({ label, value, accent = 'var(--primary)', span = false }) {
  return (
    <label style={span ? { gridColumn: '1 / -1' } : {}}>
      {label}
      <input type="text" readOnly value={value} style={{ color: accent, fontWeight: 700 }} />
    </label>
  )
}

function StatCard({ label, value, accent }) {
  return (
    <div className="card" style={{ display: 'grid', gap: '6px' }}>
      <span className="muted" style={{ fontSize: '12px' }}>{label}</span>
      <strong style={{ fontSize: '26px', color: accent || 'var(--text)' }}>{value}</strong>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════════════════════
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const token = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
      localStorage.setItem('zapateria_token', token.access_token)
      const me = await apiFetch('/api/auth/me')
      onLogin(me)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="shell center-screen">
      <div className="login-card">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
          <img src="/logo-zapateria.png" alt="Punta Pie Calzado Infantil" className="logo-img" />
        </div>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '20px', marginBottom: '4px' }}>Control de ventas</h1>
        </div>
        <form onSubmit={submit} className="stack">
          <label>
            Usuario
            <select value={username} onChange={e => setUsername(e.target.value)}>
              <option value="">Selecciona un usuario</option>
              <option value="Ivan">Iván</option>
              <option value="Claudia">Claudia</option>
              <option value="Tienda">Tienda</option>
            </select>
          </label>
          <label>
            Contraseña
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {error ? <div className="error-box">{error}</div> : null}
          <button type="submit" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button>
        </form>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [user, setUser] = useState(null)
  const [dailySales, setDailySales] = useState([])
  const [dailyExpenses, setDailyExpenses] = useState([])
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
  const [form, setForm] = useState(EMPTY_FORM)
  const [imprevistoForm, setImprevistoForm] = useState({ concept: '', amount: '' })
  const [showImprevistoForm, setShowImprevistoForm] = useState(false)
  const [savingImprevisto, setSavingImprevisto] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isEditing, setIsEditing] = useState(true)
  const notificationPanelRef = useRef(null)
  const notificationButtonRef = useRef(null)

  const ext = settings.extended_schedule_enabled
  const isSatAfternoonOff = isSaturday(selectedDate) && !ext

  const selectedSale = useMemo(() => dailySales.find(s => s.sale_date === selectedDate), [dailySales, selectedDate])
  const viewedMonth = useMemo(() => buildMonthSummary(selectedMonth, dailySales, monthlyExpenses), [selectedMonth, dailySales, monthlyExpenses])
  const todayMonth = getMonthKey(getTodayKey())
  const currentMonthSummary = useMemo(() => buildMonthSummary(todayMonth, dailySales, monthlyExpenses), [todayMonth, dailySales, monthlyExpenses])
  const visibleDailyRows = useMemo(
    () => buildMonthDailyRows(getMonthKey(selectedDate), dailySales, ext)
      .filter(r => r.sale_date <= getTodayKey() && r.sale_date >= STORE_OPEN_DATE),
    [selectedDate, dailySales, ext]
  )

  const unreadNotifications = notifications.filter(n => !n.is_read)
  const initialForm = useMemo(() => normalizeFormFromSale(selectedSale), [selectedSale])
  const hasUnsavedChanges = isEditing && !formsEqual(form, initialForm)
  const isExistingSavedRecord = Boolean(selectedSale)
  const showSaveButton = !isExistingSavedRecord || isEditing
  const showEditButton = isExistingSavedRecord
  const editButtonLabel = isExistingSavedRecord && isEditing ? 'Cancelar' : 'Editar'

  // Live totals
  const morningTotal =
    Number(form.morning_cash || 0) + Number(form.morning_card || 0) +
    Number(form.morning_bizum || 0) + Number(form.morning_bonos || 0)
  const afternoonTotal = isSatAfternoonOff ? 0 :
    Number(form.afternoon_cash || 0) + Number(form.afternoon_card || 0) +
    Number(form.afternoon_bizum || 0) + Number(form.afternoon_bonos || 0)
  const totalSales = morningTotal + afternoonTotal

  // ── Effects ──────────────────────────────────────────────────────────────────
  useEffect(() => { if (localStorage.getItem('zapateria_token')) loadSession() }, [])
  useEffect(() => { setSelectedDate(prev => normalizeDate(prev, ext)) }, [ext])
  useEffect(() => {
    setForm(initialForm)
    setIsEditing(selectedSale ? !selectedSale.is_locked : true)
  }, [initialForm, selectedSale])
  useEffect(() => {
    function handleOutsideClick(e) {
      if (!notificationPanelOpen) return
      if (notificationPanelRef.current?.contains(e.target)) return
      if (notificationButtonRef.current?.contains(e.target)) return
      setNotificationPanelOpen(false)
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [notificationPanelOpen])
  useEffect(() => {
    if (!message && !error) return
    const t = setTimeout(() => { setMessage(''); setError('') }, 3500)
    return () => clearTimeout(t)
  }, [message, error])
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') { setLogsModalOpen(false); setShowUnsavedModal(false) } }
    if (logsModalOpen || showUnsavedModal) {
      document.addEventListener('keydown', onKey)
      document.body.style.overflow = 'hidden'
    }
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [logsModalOpen, showUnsavedModal])

  // ── Data ──────────────────────────────────────────────────────────────────────
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
    const [sales, mExpenses, appSettings, dashStats, dailyExp] = await Promise.all([
      apiFetch('/api/daily-sales'),
      apiFetch('/api/monthly-expenses'),
      apiFetch('/api/settings'),
      apiFetch('/api/stats/dashboard'),
      apiFetch('/api/daily-expenses'),
    ])
    setDailySales(sales)
    setDailyExpenses(dailyExp)
    setMonthlyExpenses(mExpenses)
    setSettings(appSettings)
    setStats(dashStats)
    if (currentUser?.role === 'admin') {
      const [notifs, logs] = await Promise.all([
        apiFetch('/api/admin/notifications?limit=20'),
        apiFetch('/api/admin/change-logs?limit=100'),
      ])
      setNotifications(notifs)
      setChangeLogs(logs)
    } else {
      setNotifications([]); setChangeLogs([])
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────────
  async function saveDay(e) {
    if (e) e.preventDefault()
    setMessage(''); setError('')
    if (isFutureDate(selectedDate)) {
      setSelectedDate(getTodayKey())
      setError('No se pueden registrar ventas para fechas futuras.')
      return false
    }
    if (isBeforeOpenDate(selectedDate)) {
      setSelectedDate(STORE_OPEN_DATE)
      setError('No hay datos antes de la apertura (16/04/2026).')
      return false
    }
    try {
      const af = isSatAfternoonOff
      const payload = {
        sale_date: selectedDate,
        morning_cash:    Number(form.morning_cash || 0),
        morning_card:    Number(form.morning_card || 0),
        morning_bizum:   Number(form.morning_bizum || 0),
        morning_bonos:   Number(form.morning_bonos || 0),
        afternoon_cash:  af ? 0 : Number(form.afternoon_cash || 0),
        afternoon_card:  af ? 0 : Number(form.afternoon_card || 0),
        afternoon_bizum: af ? 0 : Number(form.afternoon_bizum || 0),
        afternoon_bonos: af ? 0 : Number(form.afternoon_bonos || 0),
        worked: !isSunday(selectedDate) || ext,
        customers: form.customers === '' ? null : Number(form.customers),
        extended_schedule: ext,
      }
      await apiFetch('/api/daily-sales', { method: 'PUT', body: JSON.stringify(payload) })
      await loadBusinessData(user)
      setIsEditing(false)
      setMessage(selectedSale ? 'Día actualizado correctamente.' : 'Día guardado correctamente.')
      return true
    } catch (err) { setError(err.message); return false }
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

  async function saveImprevisto(e) {
    e.preventDefault()
    if (!imprevistoForm.concept.trim() || !imprevistoForm.amount) return
    setSavingImprevisto(true); setMessage(''); setError('')
    try {
      await apiFetch('/api/daily-expenses', {
        method: 'POST',
        body: JSON.stringify({ sale_date: selectedDate, concept: imprevistoForm.concept.trim(), amount: Number(imprevistoForm.amount) }),
      })
      setImprevistoForm({ concept: '', amount: '' })
      setShowImprevistoForm(false)
      await loadBusinessData(user)
      setMessage('Gasto imprevisto añadido.')
    } catch (err) { setError(err.message) }
    finally { setSavingImprevisto(false) }
  }

  async function saveExpense(category, amount) {
    setMessage(''); setError('')
    try {
      await apiFetch('/api/monthly-expenses', { method: 'PUT', body: JSON.stringify({ month_key: selectedMonth, category, amount: Number(amount || 0) }) })
      await loadBusinessData(user)
      setMessage('Gasto actualizado.')
    } catch (err) { setError(err.message) }
  }

  async function toggleExtendedSchedule(checked) {
    try {
      await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ extended_schedule_enabled: checked }) })
      await loadBusinessData(user)
    } catch (err) { setError(err.message) }
  }

  async function markNotificationAsRead(id) {
    try { await apiFetch(`/api/admin/notifications/${id}/read`, { method: 'POST' }); await loadBusinessData(user) }
    catch (err) { setError(err.message) }
  }

  async function markAllNotificationsAsRead() {
    try {
      await Promise.all(notifications.filter(n => !n.is_read).map(n => apiFetch(`/api/admin/notifications/${n.id}/read`, { method: 'POST' })))
      await loadBusinessData(user)
    } catch (err) { setError(err.message) }
  }

  function exportLogsToExcel() {
    const rows = changeLogs
      .filter(l => l.action === 'create' || l.action === 'update')
      .map(l => ({
        'Fecha y hora': formatDateTime(l.changed_at),
        Usuario: l.changed_by_display_name,
        Día: formatDate(l.sale_date),
        Acción: l.action === 'create' ? 'Create' : 'Update',
        'Efectivo mañana':  Number(l.morning_cash || 0),
        'Tarjeta mañana':   Number(l.morning_card || 0),
        'Bizum mañana':     Number(l.morning_bizum || 0),
        'Bonos mañana':     Number(l.morning_bonos || 0),
        'Total mañana':     Number(l.morning_total || 0),
        'Efectivo tarde':   Number(l.afternoon_cash || 0),
        'Tarjeta tarde':    Number(l.afternoon_card || 0),
        'Bizum tarde':      Number(l.afternoon_bizum || 0),
        'Bonos tarde':      Number(l.afternoon_bonos || 0),
        'Total tarde':      Number(l.afternoon_total || 0),
        'Gastos día':       Number(l.daily_expenses_total || 0),
        'Balance día':      Number(l.daily_balance || 0),
        Clientes: l.customers ?? '',
        'Total ventas':     Number(l.total_sales || 0),
      }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Logs')
    XLSX.writeFile(wb, 'logs_zapateria.xlsx')
  }

  function executePendingNavigation() {
    if (!pendingNavigation) return
    pendingNavigation(); setPendingNavigation(null); setShowUnsavedModal(false)
  }
  function requestNavigation(action) {
    if (hasUnsavedChanges) { setPendingNavigation(() => action); setShowUnsavedModal(true); return }
    action()
  }
  async function handleSaveAndNavigate() { const ok = await saveDay(); if (ok) executePendingNavigation() }
  function logout() { localStorage.removeItem('zapateria_token'); setUser(null) }

  if (!user) return <LoginScreen onLogin={setUser} />

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="shell">

        {/* ── HEADER ── */}
        <header className="topbar">
          <div>
            <p className="eyebrow">Punta Pie Calzado Infantil</p>
            <h1>Control de ventas y gastos</h1>
            <p className="muted">{user.display_name} · {user.role === 'admin' ? 'Administrador' : 'Tienda'}</p>
          </div>
          <div className="topbar-actions">
            {user.role === 'admin' ? (
              <button ref={notificationButtonRef} type="button"
                className={`notification-trigger ${notificationPanelOpen ? 'active' : ''}`}
                onClick={() => setNotificationPanelOpen(v => !v)} title="Notificaciones">
                <BellIcon size={18} />
                {unreadNotifications.length > 0 ? <span className="notification-badge">{unreadNotifications.length}</span> : null}
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
                    <button type="button" className="secondary small-button" onClick={markAllNotificationsAsRead} disabled={unreadNotifications.length === 0}>
                      Marcar todas
                    </button>
                  </div>
                </div>
                <div className="notification-list">
                  {notifications.length === 0
                    ? <div className="notification-empty">No hay notificaciones.</div>
                    : notifications.map(n => (
                      <div key={n.id} className={`notification-card ${n.is_read ? 'read' : 'unread'}`}>
                        <div className="notification-card-top">
                          <div className="notification-card-main">
                            <div className="notification-chip">
                              {n.type === 'daily_sale_edited' ? 'Edición' : n.type === 'daily_expense_added' ? 'Gasto' : 'Aviso'}
                            </div>
                            <div className="notification-card-title">{n.title}</div>
                          </div>
                          {!n.is_read ? <button type="button" className="secondary small-button" onClick={() => markNotificationAsRead(n.id)}>Marcar</button> : null}
                        </div>
                        <div className="notification-card-date">{formatDateTime(n.created_at)}</div>
                        <div className="notification-card-message">{n.message}</div>
                      </div>
                    ))}
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
          <StatCard label="Balance mes actual" value={money(currentMonthSummary.balance)} accent={currentMonthSummary.balance >= 0 ? 'var(--success)' : 'var(--danger)'} />
        </section>

        {/* ── TABS ── */}
        <nav className="tabs">
          <button className={activeTab === 'daily' ? 'active' : ''} onClick={() => requestNavigation(() => setActiveTab('daily'))}>Resumen diario</button>
          {user.role === 'admin' ? <button className={activeTab === 'monthly' ? 'active' : ''} onClick={() => requestNavigation(() => setActiveTab('monthly'))}>Resumen mensual</button> : null}
          {user.role === 'admin' ? <button className={activeTab === 'stats' ? 'active' : ''} onClick={() => requestNavigation(() => setActiveTab('stats'))}>Estadísticas</button> : null}
          {user.role === 'admin' ? <button type="button" onClick={() => setLogsModalOpen(true)}>Logs</button> : null}
        </nav>

        {/* ════════════════════════════════════════
            TAB: DAILY
        ════════════════════════════════════════ */}
        {activeTab === 'daily' && (
          <section className="two-columns">
            {/* LEFT: form */}
            <div className="card stack">
              <h2>Registro de ventas por día</h2>

              {user.role === 'admin' ? (
                <div style={checkboxWrapStyle}>
                  <label style={checkboxLabelStyle}>
                    <input type="checkbox" style={checkboxInputStyle} checked={ext} onChange={e => toggleExtendedSchedule(e.target.checked)} />
                    <span>Habilitar horario extendido</span>
                  </label>
                </div>
              ) : null}

              {/* Date navigation */}
              <div style={{ ...rowStyle, marginBottom: '16px' }}>
                <button type="button" className="secondary" style={navButtonStyle}
                  disabled={selectedDate <= STORE_OPEN_DATE}
                  onClick={() => requestNavigation(() => setSelectedDate(prev => nextAllowedDate(prev, -1, ext)))}>
                  <ChevronIcon direction="left" />
                </button>
                <input type="date" value={selectedDate} style={dateInputStyle}
                  min={STORE_OPEN_DATE} max={getTodayKey()}
                  onChange={e => requestNavigation(() => {
                    const raw = e.target.value
                    if (isFutureDate(raw)) { setError('No se pueden registrar ventas para fechas futuras.'); setSelectedDate(getTodayKey()); return }
                    if (isBeforeOpenDate(raw)) { setError('No hay datos antes de la apertura (16/04/2026).'); setSelectedDate(STORE_OPEN_DATE); return }
                    setSelectedDate(normalizeDate(raw, ext))
                  })} />
                <button type="button" className="secondary" style={navButtonStyle}
                  disabled={selectedDate >= getTodayKey()}
                  onClick={() => requestNavigation(() => setSelectedDate(prev => clampToToday(nextAllowedDate(prev, 1, ext))))}>
                  <ChevronIcon direction="right" />
                </button>
                <button type="button" className="secondary" style={todayButtonStyle}
                  onClick={() => requestNavigation(() => setSelectedDate(normalizeDate(getTodayKey(), ext)))}>
                  Hoy
                </button>
              </div>

              {!ext ? <p className="muted" style={{ fontSize: '13px', marginTop: 0 }}>Domingos cerrados · sábados sin tarde</p> : null}

              {/* ── VENTAS FORM — 4 métodos × 2 turnos ── */}
              <form onSubmit={saveDay} className="grid-form">

                <SectionLabel>☀️ Mañana</SectionLabel>
                <AmountInput label="Efectivo" field="morning_cash" form={form} setForm={setForm} disabled={!isEditing} />
                <AmountInput label="Tarjeta" field="morning_card" form={form} setForm={setForm} disabled={!isEditing} />
                <AmountInput label="Bizum" field="morning_bizum" form={form} setForm={setForm} disabled={!isEditing} />
                <AmountInput label="Bonos consumo" field="morning_bonos" form={form} setForm={setForm} disabled={!isEditing} />
                <TotalReadout label="Total mañana" value={money(morningTotal)} span />

                <SectionLabel>🌆 Tarde</SectionLabel>
                <AmountInput label="Efectivo" field="afternoon_cash"
                  form={{ ...form, afternoon_cash: isSatAfternoonOff ? '' : form.afternoon_cash }}
                  setForm={setForm} disabled={!isEditing || isSatAfternoonOff} />
                <AmountInput label="Tarjeta" field="afternoon_card"
                  form={{ ...form, afternoon_card: isSatAfternoonOff ? '' : form.afternoon_card }}
                  setForm={setForm} disabled={!isEditing || isSatAfternoonOff} />
                <AmountInput label="Bizum" field="afternoon_bizum"
                  form={{ ...form, afternoon_bizum: isSatAfternoonOff ? '' : form.afternoon_bizum }}
                  setForm={setForm} disabled={!isEditing || isSatAfternoonOff} />
                <AmountInput label="Bonos consumo" field="afternoon_bonos"
                  form={{ ...form, afternoon_bonos: isSatAfternoonOff ? '' : form.afternoon_bonos }}
                  setForm={setForm} disabled={!isEditing || isSatAfternoonOff} />
                <TotalReadout label="Total tarde" value={isSatAfternoonOff ? '—' : money(afternoonTotal)} span />

                <SectionLabel>📊 Resumen</SectionLabel>
                <label>
                  Clientes
                  <input type="number" min="0" disabled={!isEditing} value={form.customers} onChange={e => setForm(p => ({ ...p, customers: e.target.value }))} />
                </label>
                <TotalReadout label="Total ventas del día" value={money(totalSales)} accent="var(--success)" />

                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {showSaveButton ? <button type="submit">Guardar</button> : null}
                  {showEditButton ? (
                    <button type="button" className="secondary" onClick={() => isEditing ? cancelEdit() : unlockForEdit()}>
                      {editButtonLabel}
                    </button>
                  ) : null}
                </div>
              </form>

              {/* ── GASTOS IMPREVISTOS ── */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px', marginTop: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: '14px' }}>Gastos imprevistos</span>
                    {dailyExpenses.filter(e => e.sale_date === selectedDate).length > 0 && (
                      <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--danger)' }}>
                        Total: {money(dailyExpenses.filter(e => e.sale_date === selectedDate).reduce((a, b) => a + b.amount, 0))}
                      </span>
                    )}
                  </div>
                  <button type="button"
                    style={{ minWidth: '36px', height: '36px', padding: 0, fontSize: '20px', lineHeight: 1 }}
                    onClick={() => setShowImprevistoForm(v => !v)} title="Añadir gasto imprevisto">
                    {showImprevistoForm ? '×' : '+'}
                  </button>
                </div>

                {showImprevistoForm ? (
                  <form onSubmit={saveImprevisto} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '10px', alignItems: 'end', marginBottom: '12px' }}>
                    <label style={{ margin: 0 }}>
                      <span style={{ fontSize: '12px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>Concepto</span>
                      <input type="text" placeholder="p.ej. Bolsas" maxLength={255} required
                        value={imprevistoForm.concept} onChange={e => setImprevistoForm(p => ({ ...p, concept: e.target.value }))} />
                    </label>
                    <label style={{ margin: 0 }}>
                      <span style={{ fontSize: '12px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>Importe (€)</span>
                      <input type="number" min="0" step="0.01" placeholder="0.00" required
                        value={imprevistoForm.amount} onChange={e => setImprevistoForm(p => ({ ...p, amount: e.target.value }))} />
                    </label>
                    <button type="submit" disabled={savingImprevisto} style={{ height: '44px', whiteSpace: 'nowrap' }}>
                      {savingImprevisto ? '...' : 'Añadir'}
                    </button>
                  </form>
                ) : null}

                {dailyExpenses.filter(e => e.sale_date === selectedDate).length > 0 ? (
                  <div style={{ display: 'grid', gap: '6px' }}>
                    {dailyExpenses.filter(e => e.sale_date === selectedDate).map(exp => (
                      <div key={exp.id} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.18)',
                        borderRadius: '10px', padding: '8px 12px', fontSize: '13px',
                      }}>
                        <span style={{ color: '#fca5a5' }}>{exp.concept}</span>
                        <strong style={{ color: 'var(--danger)' }}>{money(exp.amount)}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  !showImprevistoForm && <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>Sin gastos imprevistos este día.</p>
                )}
              </div>
            </div>

            {/* RIGHT: objective + table */}
            <div className="card stack">
              <h2>Objetivo diario</h2>
              <p className="muted">{formatDate(selectedDate)} · Meta: {money(DAILY_TARGET)}</p>
              <div className="progress">
                <div className="progress-bar" style={{ width: `${Math.min((totalSales / DAILY_TARGET) * 100, 100)}%` }} />
              </div>
              <p>{totalSales >= DAILY_TARGET ? '✅ Objetivo diario alcanzado' : `Faltan ${money(Math.max(DAILY_TARGET - totalSales, 0))}`}</p>

              <div className="history-table" style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: '1000px' }}>
                  <thead>
                    <tr>
                      <th rowSpan={2} style={{ verticalAlign: 'bottom' }}>Fecha</th>
                      <th colSpan={5} style={{ textAlign: 'center', color: 'var(--primary)', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>☀️ Mañana</th>
                      <th colSpan={5} style={{ textAlign: 'center', color: 'var(--primary)', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>🌆 Tarde</th>
                      <th rowSpan={2} style={{ verticalAlign: 'bottom', color: 'var(--danger)' }}>Gastos</th>
                      <th rowSpan={2} style={{ verticalAlign: 'bottom' }}>Balance</th>
                    </tr>
                    <tr>
                      <th>Efec.</th><th>Tarj.</th><th>Bizum</th><th>Bonos</th><th style={{ color: 'var(--primary)' }}>Total</th>
                      <th>Efec.</th><th>Tarj.</th><th>Bizum</th><th>Bonos</th><th style={{ color: 'var(--primary)' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDailyRows.map(row => {
                      const bal = row.daily_balance !== undefined ? row.daily_balance : row.total_sales
                      const missedTarget = row.total_sales > 0 && row.total_sales < DAILY_TARGET
                      return (
                        <tr key={row.id} style={missedTarget ? { background: 'rgba(202,138,4,0.14)' } : undefined}>
                          <td style={{ whiteSpace: 'nowrap' }}>{formatDate(row.sale_date)}</td>
                          <td>{money(row.morning_cash)}</td>
                          <td>{money(row.morning_card)}</td>
                          <td>{money(row.morning_bizum)}</td>
                          <td>{money(row.morning_bonos)}</td>
                          <td><strong style={{ color: 'var(--primary)' }}>{money(row.morning_total)}</strong></td>
                          <td>{money(row.afternoon_cash)}</td>
                          <td>{money(row.afternoon_card)}</td>
                          <td>{money(row.afternoon_bizum)}</td>
                          <td>{money(row.afternoon_bonos)}</td>
                          <td><strong style={{ color: 'var(--primary)' }}>{money(row.afternoon_total)}</strong></td>
                          <td style={{ color: 'var(--danger)' }}>{money(row.daily_expenses_total)}</td>
                          <td><strong style={{ color: bal >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(bal)}</strong></td>
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
                <button type="button" className="secondary" style={navButtonStyle} onClick={() => requestNavigation(() => setSelectedMonth(prev => addMonths(prev, -1)))}><ChevronIcon direction="left" /></button>
                <input type="month" value={selectedMonth} style={monthInputStyle} onChange={e => requestNavigation(() => setSelectedMonth(e.target.value))} />
                <button type="button" className="secondary" style={navButtonStyle} onClick={() => requestNavigation(() => setSelectedMonth(prev => addMonths(prev, 1)))}><ChevronIcon direction="right" /></button>
                <button type="button" className="secondary" style={currentMonthButtonStyle} onClick={() => requestNavigation(() => setSelectedMonth(todayMonth))}>Mes actual</button>
              </div>
              <h2>Gastos fijos del mes</h2>
              {EXPENSE_CATEGORIES.map(category => {
                const item = monthlyExpenses.find(e => e.month_key === selectedMonth && e.category === category)
                return (
                  <div key={category} className="expense-row">
                    <span>{category}</span>
                    <input type="number" min="0" step="0.01" defaultValue={item?.amount || ''} onBlur={e => saveExpense(category, e.target.value)} />
                  </div>
                )
              })}
            </div>
            <div className="card stack">
              <h2>Resultado del mes</h2>
              <p style={{ margin: 0, color: 'var(--muted)' }}>{getMonthLabel(selectedMonth)}</p>
              <div style={{ marginTop: '12px', display: 'grid', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="muted">Facturación</span>
                  <strong style={{ color: 'var(--primary)' }}>{money(viewedMonth.salesTotal)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="muted">Gastos fijos</span>
                  <strong style={{ color: 'var(--danger)' }}>{money(viewedMonth.expensesTotal)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                  <span className="muted">Balance</span>
                  <strong style={{ color: viewedMonth.balance >= 0 ? 'var(--success)' : 'var(--danger)', fontSize: '18px' }}>{money(viewedMonth.balance)}</strong>
                </div>
              </div>
              <div className="progress" style={{ marginTop: '8px' }}>
                <div className="progress-bar green" style={{ width: `${Math.min(viewedMonth.progress, 100)}%` }} />
              </div>
              <p className="muted" style={{ fontSize: '13px' }}>{viewedMonth.progress}% del objetivo mensual ({money(MONTHLY_TARGET)})</p>
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
                  <tr><th>Mes</th><th>Ventas</th><th>Gastos</th><th>Balance</th><th>% objetivo</th></tr>
                </thead>
                <tbody>
                  {stats.monthly_summaries.map(item => (
                    <tr key={item.month_key}>
                      <td>{getMonthLabel(item.month_key)}</td>
                      <td>{money(item.sales_total)}</td>
                      <td>{money(item.expenses_total)}</td>
                      <td style={{ color: item.balance >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{money(item.balance)}</td>
                      <td><span style={{ color: item.target_progress_pct >= 100 ? 'var(--success)' : 'var(--text)' }}>{item.target_progress_pct}%</span></td>
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
          <div className="modal-panel logs-modal-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ marginBottom: '4px' }}>Logs de actividad</h2>
                <p className="muted" style={{ margin: 0 }}>Historial completo con desglose por método de pago.</p>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button type="button" className="secondary" onClick={exportLogsToExcel}>Exportar Excel</button>
                <button type="button" className="secondary" onClick={() => setLogsModalOpen(false)}>Cerrar</button>
              </div>
            </div>
            <div className="history-table logs-modal-table">
              <table style={{ minWidth: '1200px' }}>
                <thead>
                  <tr>
                    <th rowSpan={2}>Fecha/hora</th>
                    <th rowSpan={2}>Usuario</th>
                    <th rowSpan={2}>Día</th>
                    <th rowSpan={2}>Acción</th>
                    <th colSpan={5} style={{ textAlign: 'center', color: 'var(--primary)' }}>☀️ Mañana</th>
                    <th colSpan={5} style={{ textAlign: 'center', color: 'var(--primary)' }}>🌆 Tarde</th>
                    <th rowSpan={2}>Clientes</th>
                    <th rowSpan={2}>Total</th>
                  </tr>
                  <tr>
                    <th>Efec.</th><th>Tarj.</th><th>Bizum</th><th>Bonos</th><th>Total</th>
                    <th>Efec.</th><th>Tarj.</th><th>Bizum</th><th>Bonos</th><th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {changeLogs.filter(l => l.action === 'create' || l.action === 'update').length === 0 ? (
                    <tr><td colSpan={16} style={{ textAlign: 'center', padding: '18px' }}>No hay logs disponibles.</td></tr>
                  ) : (
                    changeLogs.filter(l => l.action === 'create' || l.action === 'update').map(l => (
                      <tr key={l.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(l.changed_at)}</td>
                        <td>{l.changed_by_display_name}</td>
                        <td>{formatDate(l.sale_date)}</td>
                        <td><span className={l.action === 'create' ? 'log-action-create' : 'log-action-update'}>{l.action === 'create' ? 'Create' : 'Update'}</span></td>
                        <td>{money(l.morning_cash)}</td>
                        <td>{money(l.morning_card)}</td>
                        <td>{money(l.morning_bizum)}</td>
                        <td>{money(l.morning_bonos)}</td>
                        <td><strong>{money(l.morning_total)}</strong></td>
                        <td>{money(l.afternoon_cash)}</td>
                        <td>{money(l.afternoon_card)}</td>
                        <td>{money(l.afternoon_bizum)}</td>
                        <td>{money(l.afternoon_bonos)}</td>
                        <td><strong>{money(l.afternoon_total)}</strong></td>
                        <td>{l.customers ?? '—'}</td>
                        <td><strong>{money(l.total_sales)}</strong></td>
                      </tr>
                    ))
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
          <div className="modal-panel" style={{ width: 'min(520px, 92vw)' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ marginBottom: '4px' }}>¿Guardar los cambios?</h2>
                <p className="muted" style={{ margin: 0 }}>Tienes cambios sin guardar. ¿Qué quieres hacer?</p>
              </div>
            </div>
            <div style={{ padding: '0 22px 22px 22px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button type="button" className="secondary" onClick={() => { setPendingNavigation(null); setShowUnsavedModal(false) }}>Cancelar</button>
              <button type="button" onClick={handleSaveAndNavigate}>Guardar</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
