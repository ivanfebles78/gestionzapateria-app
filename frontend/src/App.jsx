import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { apiFetch } from './lib/api'

// ─── Constants ────────────────────────────────────────────────────────────────
const DAILY_TARGET = 500
const MONTHLY_TARGET = 12000
const STORE_OPEN_DATE = '2026-04-16'
const PAYMENT_METHODS = [
  { key: 'cash',  label: 'Efectivo' },
  { key: 'card',  label: 'Tarjeta' },
  { key: 'bizum', label: 'Bizum' },
  { key: 'bonos', label: 'Bonos' },
]
const EXPENSE_CATEGORIES = [
  'Alquiler', 'Internet', 'Alarma', 'Agua y luz',
  'Empleado 1', 'Empleado 2', 'Seguridad Social', 'Otros',
]
const METHOD_COLORS = {
  cash:  '#22d3ee',
  card:  '#818cf8',
  bizum: '#34d399',
  bonos: '#f59e0b',
}

// ─── Icons ────────────────────────────────────────────────────────────────────
function BellIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0 1 18 14.158V11a6.002 6.002 0 0 0-4-5.659V4a2 2 0 1 0-4 0v1.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5" />
      <path d="M9 17a3 3 0 0 0 6 0" />
    </svg>
  )
}
function ChevronL({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
}
function ChevronR({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function money(n) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(n || 0))
}

function formatNumber(n) {
  return new Intl.NumberFormat('es-ES').format(Number(n || 0))
}

function formatDate(d) {
  return new Date(`${d}T12:00:00`).toLocaleDateString('es-ES')
}

function formatWeekday(d) {
  return new Date(`${d}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long' })
}

function formatDateTime(v) { return new Date(v).toLocaleString('es-ES') }
function getTodayKey() { return new Date().toISOString().slice(0, 10) }
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function addMonths(mk, delta) {
  const [y, m] = mk.split('-').map(Number)
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
function nextAllowedDate(dateStr, dir, ext) {
  let c = dateStr
  do { c = addDays(c, dir) } while (!isWorkingDay(c, ext) || (dir < 0 && c < STORE_OPEN_DATE))
  if (c < STORE_OPEN_DATE) return STORE_OPEN_DATE
  return c
}
function normalizeDate(d, ext) {
  if (isWorkingDay(d, ext)) return d
  return nextAllowedDate(d, -1, ext)
}
function isFutureDate(d) { return d > getTodayKey() }
function clampToToday(d) { return isFutureDate(d) ? getTodayKey() : d }

// ─── Business helpers ─────────────────────────────────────────────────────────
function buildMonthSummary(mk, sales, expenses) {
  const st = sales.filter(s => s.sale_date.startsWith(mk)).reduce((a, s) => a + s.total_sales, 0)
  const et = expenses.filter(e => e.month_key === mk).reduce((a, e) => a + e.amount, 0)
  return { salesTotal: st, expensesTotal: et, balance: st - et, progress: MONTHLY_TARGET ? Math.round((st / MONTHLY_TARGET) * 100) : 0 }
}

function buildMonthDailyRows(mk, sales, ext) {
  const [y, m] = mk.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  const map = new Map(sales.map(s => [s.sale_date, s]))
  const rows = []
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (!isWorkingDay(ds, ext)) continue
    rows.push(map.get(ds) || {
      id: `empty-${ds}`, sale_date: ds,
      morning_cash: 0, morning_card: 0, morning_bizum: 0, morning_bonos: 0, morning_total: 0, morning_customers_total: 0,
      morning_cash_customers: 0, morning_card_customers: 0, morning_bizum_customers: 0, morning_bonos_customers: 0,
      afternoon_cash: 0, afternoon_card: 0, afternoon_bizum: 0, afternoon_bonos: 0, afternoon_total: 0, afternoon_customers_total: 0,
      afternoon_cash_customers: 0, afternoon_card_customers: 0, afternoon_bizum_customers: 0, afternoon_bonos_customers: 0,
      total_sales: 0, daily_expenses_total: 0, daily_balance: 0, customers_total: 0,
    })
  }
  return rows.sort((a, b) => b.sale_date.localeCompare(a.sale_date))
}

const EMPTY_FORM = Object.fromEntries([
  ...PAYMENT_METHODS.flatMap(m => [
    [`morning_${m.key}`, ''], [`morning_${m.key}_customers`, ''],
    [`afternoon_${m.key}`, ''], [`afternoon_${m.key}_customers`, ''],
  ])
])
function normalizeFormFromSale(sale) {
  if (!sale) return EMPTY_FORM
  return Object.fromEntries([
    ...PAYMENT_METHODS.flatMap(m => [
      [`morning_${m.key}`, sale[`morning_${m.key}`] || ''],
      [`morning_${m.key}_customers`, sale[`morning_${m.key}_customers`] || ''],
      [`afternoon_${m.key}`, sale[`afternoon_${m.key}`] || ''],
      [`afternoon_${m.key}_customers`, sale[`afternoon_${m.key}_customers`] || ''],
    ])
  ])
}
function formsEqual(a, b) { return Object.keys(a).every(k => String(a[k] ?? '') === String(b[k] ?? '')) }
function calcSection(form, prefix) {
  const salesTotal = PAYMENT_METHODS.reduce((a, m) => a + Number(form[`${prefix}_${m.key}`] || 0), 0)
  const customersTotal = PAYMENT_METHODS.reduce((a, m) => a + Number(form[`${prefix}_${m.key}_customers`] || 0), 0)
  return { salesTotal, customersTotal }
}

// ─── Pie chart component (SVG, no deps) ───────────────────────────────────────
function PieChart({ data, title, valueKey, labelFormatter = v => v }) {
  const total = data.reduce((a, d) => a + d[valueKey], 0)
  if (!total) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>Sin datos</div>

  let cumAngle = -Math.PI / 2
  const slices = data.map(d => {
    const frac = d[valueKey] / total
    const start = cumAngle
    const end = cumAngle + frac * 2 * Math.PI
    cumAngle = end
    const x1 = 80 + 70 * Math.cos(start), y1 = 80 + 70 * Math.sin(start)
    const x2 = 80 + 70 * Math.cos(end),   y2 = 80 + 70 * Math.sin(end)
    const large = frac > 0.5 ? 1 : 0
    return { ...d, frac, path: `M80,80 L${x1},${y1} A70,70 0 ${large},1 ${x2},${y2} Z` }
  })

  return (
    <div>
      {title && <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>{title}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <svg viewBox="0 0 160 160" width="120" height="120" style={{ flexShrink: 0 }}>
          {slices.map(s => <path key={s.method} d={s.path} fill={METHOD_COLORS[s.method]} opacity="0.9" />)}
        </svg>
        <div style={{ display: 'grid', gap: '6px' }}>
          {slices.map(s => (
            <div key={s.method} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: METHOD_COLORS[s.method], flexShrink: 0, display: 'inline-block' }} />
              <span style={{ color: 'var(--muted)' }}>{s.label}</span>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{labelFormatter(s[valueKey])}</span>
              <span style={{ color: 'var(--muted)', fontSize: '11px' }}>({Math.round(s.frac * 100)}%)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Bar chart for customer traffic ───────────────────────────────────────────
function BarChart({ data, colorMorning = '#22d3ee', colorAfternoon = '#818cf8', title }) {
  if (!data || data.length === 0) return <div style={{ color: 'var(--muted)', padding: '20px', textAlign: 'center' }}>Sin datos</div>
  const maxMorning = Math.max(...data.map(d => d.morning_customers_total || 0), 1)
  const maxAfternoon = Math.max(...data.map(d => d.afternoon_customers_total || 0), 1)
  const maxVal = Math.max(maxMorning, maxAfternoon, 1)
  const BAR_H = 140

  return (
    <div>
      {title && <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>{title}</div>}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
          <span style={{ width: 10, height: 10, background: colorMorning, borderRadius: 2, display: 'inline-block' }} />
          <span style={{ color: 'var(--muted)' }}>Mañana</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
          <span style={{ width: 10, height: 10, background: colorAfternoon, borderRadius: 2, display: 'inline-block' }} />
          <span style={{ color: 'var(--muted)' }}>Tarde</span>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${Math.max(data.length * 32, 200)} ${BAR_H + 30}`} width="100%" style={{ minWidth: `${Math.max(data.length * 32, 200)}px` }}>
          {data.map((d, i) => {
            const mH = Math.round((d.morning_customers_total || 0) / maxVal * BAR_H)
            const aH = Math.round((d.afternoon_customers_total || 0) / maxVal * BAR_H)
            const x = i * 32 + 2
            return (
              <g key={d.sale_date || i}>
                <rect x={x} y={BAR_H - mH} width={13} height={mH || 1} fill={colorMorning} opacity="0.85" rx="2" />
                <rect x={x + 15} y={BAR_H - aH} width={13} height={aH || 1} fill={colorAfternoon} opacity="0.85" rx="2" />
                <text x={x + 13} y={BAR_H + 16} textAnchor="middle" fontSize="8" fill="#64748b">
                  {d.sale_date ? d.sale_date.slice(5) : ''}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
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
    e.preventDefault(); setLoading(true); setError('')
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
          <img src="/logo-zapateria.png" alt="Punta Pie Calzado Infantil" className="logo-img" />
          <div style={{ textAlign: 'center' }}>
            <p className="eyebrow" style={{ marginBottom: '6px' }}>Punta Pie Calzado Infantil</p>
            <h1 style={{ fontSize: '22px' }}>Control de ventas y gastos</h1>
          </div>
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
          <button type="submit" disabled={loading}>{loading ? 'Entrando…' : 'Entrar'}</button>
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
  const [monthlyExpenses, setMonthlyExpenses] = useState([])
  const [dailyExpenses, setDailyExpenses] = useState([])
  const [settings, setSettings] = useState({ extended_schedule_enabled: false })
  const [stats, setStats] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [changeLogs, setChangeLogs] = useState([])
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false)
  const [logsModalOpen, setLogsModalOpen] = useState(false)
  const [showExpenseModal, setShowExpenseModal] = useState(false)
  const [selectedDate, setSelectedDate] = useState(getTodayKey())
  const [selectedMonth, setSelectedMonth] = useState(getMonthKey(getTodayKey()))
  const [activeTab, setActiveTab] = useState('daily')
  const [form, setForm] = useState(EMPTY_FORM)
  const [expenseForm, setExpenseForm] = useState({ concept: '', amount: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isEditing, setIsEditing] = useState(true)
  // Log filters
  const [logFilterUser, setLogFilterUser] = useState('')
  const [logFilterAction, setLogFilterAction] = useState('')
  const [logFilterFrom, setLogFilterFrom] = useState('')
  const [logFilterTo, setLogFilterTo] = useState('')

  const notificationPanelRef = useRef(null)
  const notificationButtonRef = useRef(null)

  const ext = settings.extended_schedule_enabled
  const isSatOff = isSaturday(selectedDate) && !ext
  const selectedSale = useMemo(() => dailySales.find(s => s.sale_date === selectedDate), [dailySales, selectedDate])
  const selectedDayExpenses = useMemo(() => dailyExpenses.filter(e => e.sale_date === selectedDate), [dailyExpenses, selectedDate])
  const viewedMonth = useMemo(() => buildMonthSummary(selectedMonth, dailySales, monthlyExpenses), [selectedMonth, dailySales, monthlyExpenses])
  const currentMonthSummary = useMemo(() => buildMonthSummary(getMonthKey(getTodayKey()), dailySales, monthlyExpenses), [dailySales, monthlyExpenses])
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

  const morning = calcSection(form, 'morning')
  const afternoon = calcSection(isSatOff ? EMPTY_FORM : form, 'afternoon')
  const totalSales = morning.salesTotal + afternoon.salesTotal
  const totalCustomers = morning.customersTotal + afternoon.customersTotal
  const totalExpenses = selectedDayExpenses.reduce((a, e) => a + Number(e.amount || 0), 0)
  const balance = totalSales - totalExpenses
  const targetProgress = DAILY_TARGET ? Math.round((totalSales / DAILY_TARGET) * 100) : 0

  // Unique log users for filter
  const logUsers = useMemo(() => [...new Set(changeLogs.map(l => l.changed_by_display_name))], [changeLogs])

  // Filtered logs
  const filteredLogs = useMemo(() => changeLogs.filter(l => {
    if (logFilterUser && l.changed_by_display_name !== logFilterUser) return false
    if (logFilterAction && l.action !== logFilterAction) return false
    if (logFilterFrom && l.sale_date < logFilterFrom) return false
    if (logFilterTo && l.sale_date > logFilterTo) return false
    return true
  }), [changeLogs, logFilterUser, logFilterAction, logFilterFrom, logFilterTo])

  // Payment method stats from logs (or stats from backend)
  const paymentStats = useMemo(() => {
    if (stats?.payment_method_stats?.length) {
      return PAYMENT_METHODS.map(m => {
        const found = stats.payment_method_stats.find(s => s.method === m.label || s.method === m.key)
        return { method: m.key, label: m.label, amount_total: found?.amount_total || 0, customers_total: found?.customers_total || 0 }
      })
    }
    return []
  }, [stats])

  // ── Effects ──────────────────────────────────────────────────────────────────
  useEffect(() => { if (localStorage.getItem('zapateria_token')) loadSession() }, [])
  useEffect(() => { setSelectedDate(prev => normalizeDate(prev, ext)) }, [ext])
  useEffect(() => { setForm(initialForm); setIsEditing(selectedSale ? !selectedSale.is_locked : true) }, [initialForm, selectedSale])
  useEffect(() => {
    function onOutside(e) {
      if (!notificationPanelOpen) return
      if (notificationPanelRef.current?.contains(e.target)) return
      if (notificationButtonRef.current?.contains(e.target)) return
      setNotificationPanelOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [notificationPanelOpen])
  useEffect(() => {
    if (!message && !error) return
    const t = setTimeout(() => { setMessage(''); setError('') }, 3500)
    return () => clearTimeout(t)
  }, [message, error])
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') { setLogsModalOpen(false); setShowExpenseModal(false) } }
    if (logsModalOpen || showExpenseModal) { document.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden' }
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [logsModalOpen, showExpenseModal])

  // ── Data ──────────────────────────────────────────────────────────────────────
  async function loadSession() {
    try {
      const me = await apiFetch('/api/auth/me')
      setUser(me); await loadBusinessData(me)
    } catch { localStorage.removeItem('zapateria_token'); setUser(null) }
  }

  async function handleLogin(me) { setUser(me); await loadBusinessData(me) }

  async function loadBusinessData(currentUser = user) {
    const [sales, mExp, appSettings, dash, dayExp] = await Promise.all([
      apiFetch('/api/daily-sales'),
      apiFetch('/api/monthly-expenses'),
      apiFetch('/api/settings'),
      apiFetch('/api/stats/dashboard'),
      apiFetch('/api/daily-expenses'),
    ])
    setDailySales(sales); setMonthlyExpenses(mExp); setSettings(appSettings); setStats(dash); setDailyExpenses(dayExp)
    if (currentUser?.role === 'admin') {
      const [notifs, logs] = await Promise.all([
        apiFetch('/api/admin/notifications?limit=20'),
        apiFetch('/api/admin/change-logs?limit=200'),
      ])
      setNotifications(notifs); setChangeLogs(logs)
    } else { setNotifications([]); setChangeLogs([]) }
  }

  // ── Actions ───────────────────────────────────────────────────────────────────
  async function saveDay() {
    setMessage(''); setError('')
    if (isFutureDate(selectedDate)) { setSelectedDate(getTodayKey()); setError('No se pueden registrar ventas para fechas futuras.'); return false }
    if (selectedDate < STORE_OPEN_DATE) { setSelectedDate(STORE_OPEN_DATE); setError('No hay datos antes de la apertura (16/04/2026).'); return false }
    try {
      const af = isSatOff
      await apiFetch('/api/daily-sales', {
        method: 'PUT',
        body: JSON.stringify({
          sale_date: selectedDate,
          morning_cash: Number(form.morning_cash || 0), morning_card: Number(form.morning_card || 0),
          morning_bizum: Number(form.morning_bizum || 0), morning_bonos: Number(form.morning_bonos || 0),
          morning_cash_customers: Number(form.morning_cash_customers || 0), morning_card_customers: Number(form.morning_card_customers || 0),
          morning_bizum_customers: Number(form.morning_bizum_customers || 0), morning_bonos_customers: Number(form.morning_bonos_customers || 0),
          afternoon_cash: af ? 0 : Number(form.afternoon_cash || 0), afternoon_card: af ? 0 : Number(form.afternoon_card || 0),
          afternoon_bizum: af ? 0 : Number(form.afternoon_bizum || 0), afternoon_bonos: af ? 0 : Number(form.afternoon_bonos || 0),
          afternoon_cash_customers: af ? 0 : Number(form.afternoon_cash_customers || 0), afternoon_card_customers: af ? 0 : Number(form.afternoon_card_customers || 0),
          afternoon_bizum_customers: af ? 0 : Number(form.afternoon_bizum_customers || 0), afternoon_bonos_customers: af ? 0 : Number(form.afternoon_bonos_customers || 0),
          worked: !isSunday(selectedDate) || ext, extended_schedule: ext,
        }),
      })
      await loadBusinessData(user); setIsEditing(false)
      setMessage(selectedSale ? 'Día actualizado correctamente.' : 'Día guardado correctamente.')
      return true
    } catch (err) { setError(err.message); return false }
  }

  async function unlockForEdit() {
    setMessage(''); setError('')
    try { await apiFetch(`/api/daily-sales/${selectedDate}/unlock`, { method: 'POST' }); await loadBusinessData(user); setIsEditing(true); setMessage('Modo edición activado.') }
    catch (err) { setError(err.message) }
  }

  function cancelEdit() { if (!selectedSale) return; setForm(initialForm); setIsEditing(false); setMessage('Edición cancelada.') }

  async function addDailyExpense(e) {
    e.preventDefault(); setError(''); setMessage('')
    try {
      await apiFetch('/api/daily-expenses', { method: 'POST', body: JSON.stringify({ sale_date: selectedDate, concept: expenseForm.concept, amount: Number(expenseForm.amount || 0) }) })
      setExpenseForm({ concept: '', amount: '' }); setShowExpenseModal(false)
      await loadBusinessData(user); setMessage('Gasto diario añadido correctamente.')
    } catch (err) { setError(err.message) }
  }

  async function saveExpense(category, amount) {
    setMessage(''); setError('')
    try { await apiFetch('/api/monthly-expenses', { method: 'PUT', body: JSON.stringify({ month_key: selectedMonth, category, amount: Number(amount || 0) }) }); await loadBusinessData(user); setMessage('Gasto actualizado.') }
    catch (err) { setError(err.message) }
  }

  async function toggleExtendedSchedule(checked) {
    try { await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ extended_schedule_enabled: checked }) }); await loadBusinessData(user) }
    catch (err) { setError(err.message) }
  }

  async function markNotificationAsRead(id) {
    try { await apiFetch(`/api/admin/notifications/${id}/read`, { method: 'POST' }); await loadBusinessData(user) }
    catch (err) { setError(err.message) }
  }

  async function markAllNotificationsAsRead() {
    try { await Promise.all(notifications.filter(n => !n.is_read).map(n => apiFetch(`/api/admin/notifications/${n.id}/read`, { method: 'POST' }))); await loadBusinessData(user) }
    catch (err) { setError(err.message) }
  }

  function exportLogsToExcel() {
    const rows = filteredLogs.map(l => ({
      'Fecha y hora': formatDateTime(l.changed_at), Usuario: l.changed_by_display_name,
      Día: formatDate(l.sale_date), Acción: l.action,
      'Ef. Mañana': l.morning_cash, 'Tar. Mañana': l.morning_card, 'Biz. Mañana': l.morning_bizum, 'Bon. Mañana': l.morning_bonos,
      'Cli. Mañana': l.morning_customers_total, 'Total Mañana': l.morning_total,
      'Ef. Tarde': l.afternoon_cash, 'Tar. Tarde': l.afternoon_card, 'Biz. Tarde': l.afternoon_bizum, 'Bon. Tarde': l.afternoon_bonos,
      'Cli. Tarde': l.afternoon_customers_total, 'Total Tarde': l.afternoon_total,
      'Total Ventas': l.total_sales, Gastos: l.daily_expenses_total, Balance: l.daily_balance, 'Cli. Total': l.customers_total,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Logs')
    XLSX.writeFile(wb, 'logs_zapateria.xlsx')
  }

  function logout() { localStorage.removeItem('zapateria_token'); setUser(null) }

  if (!user) return <LoginScreen onLogin={handleLogin} />

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
              <button ref={notificationButtonRef} type="button" className={`notification-trigger${notificationPanelOpen ? ' active' : ''}`}
                onClick={() => setNotificationPanelOpen(v => !v)} title="Notificaciones">
                <BellIcon size={18} />
                {unreadNotifications.length > 0 ? <span className="notification-badge">{unreadNotifications.length}</span> : null}
              </button>
            ) : null}
            <button className="btn-logout" onClick={logout}>Salir</button>

            {user.role === 'admin' && notificationPanelOpen ? (
              <div ref={notificationPanelRef} className="notification-panel">
                <div className="notification-panel-header">
                  <div>
                    <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '15px' }}>Notificaciones</div>
                    <div className="muted" style={{ fontSize: '13px' }}>{unreadNotifications.length} sin leer</div>
                  </div>
                  <button type="button" className="secondary small-button" onClick={markAllNotificationsAsRead} disabled={!unreadNotifications.length}>Marcar todas</button>
                </div>
                <div className="notification-list">
                  {notifications.length === 0 ? (
                    <div className="notification-empty">No hay notificaciones.</div>
                  ) : notifications.map(n => (
                    <div key={n.id} className={`notification-card ${n.is_read ? 'read' : 'unread'}`}>
                      <div className="notification-card-top">
                        <div>
                          <div className="notification-chip">{n.type === 'daily_sale_edited' ? 'Edición' : n.type === 'daily_expense_added' ? 'Gasto' : 'Aviso'}</div>
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
        {message ? <div className="success-box dismissible-alert"><span>{message}</span><button type="button" className="alert-close" onClick={() => setMessage('')}>×</button></div> : null}
        {error   ? <div className="error-box dismissible-alert"><span>{error}</span><button type="button" className="alert-close" onClick={() => setError('')}>×</button></div>   : null}

        {/* ── TOP KPI CARDS ── */}
        <section className="stats-grid">
          <div className="card kpi-card">
            <span className="kpi-label">Ventas hoy</span>
            <span className="kpi-value">{money(totalSales)}</span>
          </div>
          <div className="card kpi-card">
            <span className="kpi-label">Ventas mes actual</span>
            <span className="kpi-value" style={{ color: 'var(--primary)' }}>{money(currentMonthSummary.salesTotal)}</span>
          </div>
          {user.role === 'admin' ? (
            <>
              <div className="card kpi-card">
                <span className="kpi-label">Gastos mes actual</span>
                <span className="kpi-value" style={{ color: 'var(--danger)' }}>{money(currentMonthSummary.expensesTotal)}</span>
              </div>
              <div className="card kpi-card">
                <span className="kpi-label">Balance mes actual</span>
                <span className="kpi-value" style={{ color: currentMonthSummary.balance >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(currentMonthSummary.balance)}</span>
              </div>
            </>
          ) : null}
        </section>

        {/* ── TABS ── */}
        <nav className="tabs">
          <button className={activeTab === 'daily' ? 'active' : ''} onClick={() => setActiveTab('daily')}>Resumen diario</button>
          {user.role === 'admin' ? <button className={activeTab === 'monthly' ? 'active' : ''} onClick={() => setActiveTab('monthly')}>Resumen mensual</button> : null}
          {user.role === 'admin' ? <button className={activeTab === 'stats' ? 'active' : ''} onClick={() => setActiveTab('stats')}>Estadísticas</button> : null}
          {user.role === 'admin' ? <button type="button" onClick={() => setLogsModalOpen(true)}>Logs</button> : null}
        </nav>

        {/* ════════════════════════════════════════
            TAB: DAILY
        ════════════════════════════════════════ */}
        {activeTab === 'daily' && (
          <>
            <section className="card stack section-block">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <h2>Registro de ventas — {formatDate(selectedDate)} ({formatWeekday(selectedDate)})
				</h2>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* Edit / cancel button — small, inline */}
                  {showEditButton ? (
                    <button type="button" className="secondary btn-sm"
                      onClick={() => isEditing ? cancelEdit() : unlockForEdit()}>
                      {isEditing ? 'Cancelar' : 'Editar'}
                    </button>
                  ) : null}
                  <button type="button" className="secondary btn-sm" onClick={() => setShowExpenseModal(true)}>＋ Gasto</button>
                  {showSaveButton ? <button type="button" className="btn-sm" onClick={saveDay}>Guardar</button> : null}
                </div>
              </div>

              {/* Checkbox + date nav — same row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                {user.role === 'admin' ? (
                  <label className="toggle-label">
                    <input type="checkbox" className="toggle-checkbox" checked={ext} onChange={e => toggleExtendedSchedule(e.target.checked)} />
                    <span className="toggle-track"><span className="toggle-thumb" /></span>
                    <span>Horario extendido</span>
                  </label>
                ) : null}

                <div className="date-nav">
                  <button type="button" className="secondary nav-btn" disabled={selectedDate <= STORE_OPEN_DATE}
                    onClick={() => setSelectedDate(prev => nextAllowedDate(prev, -1, ext))}>
                    <ChevronL />
                  </button>
                  <input
					  type="date"
					  className="date-input"
					  value={selectedDate}
					  min={STORE_OPEN_DATE}
					  max={getTodayKey()}
					  onChange={e => {
						const raw = e.target.value

						if (isFutureDate(raw)) {
						  setError('No se pueden registrar ventas para fechas futuras.')
						  setSelectedDate(getTodayKey())
						  return
						}

						if (raw < STORE_OPEN_DATE) {
						  setError('No hay datos antes de la apertura (16/04/2026).')
						  setSelectedDate(STORE_OPEN_DATE)
						  return
						}

						if (!ext && isSunday(raw)) {
						  setSelectedDate(normalizeDate(raw, ext))
						  setError('Los domingos no se pueden seleccionar si el horario extendido no está activado.')
						  return
						}

						setSelectedDate(normalizeDate(raw, ext))
					  }}
					/>
                  <button type="button" className="secondary nav-btn" disabled={selectedDate >= getTodayKey()}
                    onClick={() => setSelectedDate(prev => clampToToday(nextAllowedDate(prev, 1, ext)))}>
                    <ChevronR />
                  </button>
                  <button type="button" className="secondary btn-sm" onClick={() => setSelectedDate(getTodayKey())}>Hoy</button>
                </div>
              </div>

              {!ext ? <p className="muted" style={{ fontSize: '13px', margin: 0 }}>Domingos cerrados · sábados sin tarde</p> : null}

              {/* 2-column form blocks */}
              <div className="form-2col">
                {/* MAÑANA */}
                <div className="form-block morning stack">
                  <h3 style={{ color: 'var(--primary)', fontSize: '14px', marginBottom: 4 }}>☀️ Mañana</h3>
                  {PAYMENT_METHODS.map(m => (
                    <div key={`mo-${m.key}`} className="method-row">
                      <span className="method-dot" style={{ background: METHOD_COLORS[m.key] }} />
                      <label style={{ flex: 1 }}>
                        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{m.label} (€)</span>
                        <input type="number" min="0" step="0.01" disabled={!isEditing}
                          value={form[`morning_${m.key}`]}
                          onChange={e => setForm(p => ({ ...p, [`morning_${m.key}`]: e.target.value }))} />
                      </label>
                      <label style={{ width: 80 }}>
                        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Clientes</span>
                        <input type="number" min="0" step="1" disabled={!isEditing}
                          value={form[`morning_${m.key}_customers`]}
                          onChange={e => setForm(p => ({ ...p, [`morning_${m.key}_customers`]: e.target.value }))} />
                      </label>
                    </div>
                  ))}
                  <div className="totals-row">
                    <span className="muted" style={{ fontSize: '13px' }}>Total mañana</span>
                    <strong style={{ color: 'var(--primary)' }}>{money(morning.salesTotal)}</strong>
                    <span className="muted" style={{ fontSize: '13px' }}>Clientes: <strong style={{ color: 'var(--text)' }}>{morning.customersTotal}</strong></span>
                  </div>
                </div>

                {/* TARDE */}
				{!isSatOff ? (
				  <div className="form-block afternoon stack">
					<h3 style={{ color: '#a78bfa', fontSize: '14px', marginBottom: 4 }}>🌆 Tarde</h3>
					{PAYMENT_METHODS.map(m => (
					  <div key={`af-${m.key}`} className="method-row">
						<span className="method-dot" style={{ background: METHOD_COLORS[m.key] }} />
						<label style={{ flex: 1 }}>
						  <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{m.label} (€)</span>
						  <input
							type="number"
							min="0"
							step="0.01"
							disabled={!isEditing}
							value={form[`afternoon_${m.key}`]}
							onChange={e => setForm(p => ({ ...p, [`afternoon_${m.key}`]: e.target.value }))}
						  />
						</label>
						<label style={{ width: 80 }}>
						  <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Clientes</span>
						  <input
							type="number"
							min="0"
							step="1"
							disabled={!isEditing}
							value={form[`afternoon_${m.key}_customers`]}
							onChange={e => setForm(p => ({ ...p, [`afternoon_${m.key}_customers`]: e.target.value }))}
						  />
						</label>
					  </div>
					))}
					<div className="totals-row">
					  <span className="muted" style={{ fontSize: '13px' }}>Total tarde</span>
					  <strong style={{ color: '#a78bfa' }}>{money(afternoon.salesTotal)}</strong>
					  <span className="muted" style={{ fontSize: '13px' }}>
						Clientes: <strong style={{ color: 'var(--text)' }}>{afternoon.customersTotal}</strong>
					  </span>
					</div>
				  </div>
				) : null}
              </div>

              {/* Day summary strip */}
              <div className="day-summary-strip">
                <div className="day-kpi">
                  <span>Total ventas</span>
                  <strong style={{ color: 'var(--success)' }}>{money(totalSales)}</strong>
                </div>
                <div className="day-kpi">
                  <span>Gastos</span>
                  <strong style={{ color: 'var(--danger)' }}>{money(totalExpenses)}</strong>
                </div>
                <div className="day-kpi">
                  <span>Balance</span>
                  <strong style={{ color: balance >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(balance)}</strong>
                </div>
                <div className="day-kpi">
                  <span>Clientes</span>
                  <strong>{formatNumber(totalCustomers)}</strong>
                </div>
              </div>

              {/* Gastos del día */}
              {selectedDayExpenses.length > 0 ? (
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Gastos imprevistos del día</div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {selectedDayExpenses.map(exp => (
                      <div key={exp.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 10, background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.18)', fontSize: '13px' }}>
                        <span style={{ color: '#fca5a5' }}>{exp.concept}</span>
                        <strong style={{ color: 'var(--danger)' }}>{money(exp.amount)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            {/* ── OBJETIVO DIARIO + TABLE ── */}
            <section className="card stack section-block">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <h2>Objetivo diario</h2>
                <span className="muted" style={{ fontSize: '13px' }}>Meta: {money(DAILY_TARGET)} · {targetProgress}%</span>
              </div>
              <div className="progress"><div className="progress-bar" style={{ width: `${Math.min(targetProgress, 100)}%` }} /></div>
              <p style={{ margin: 0, fontSize: '14px' }}>
                {totalSales >= DAILY_TARGET
                  ? `✅ Objetivo alcanzado (${targetProgress}%)`
                  : `Faltan ${money(Math.max(DAILY_TARGET - totalSales, 0))} · ${targetProgress}% del objetivo`}
              </p>

              {/* Compact table: no per-method customer columns */}
              <div style={{ overflowX: 'auto' }}>
                <table className="sales-table">
                  <thead>
				  <tr>
					<th rowSpan={2} className="date-col" style={{ verticalAlign: 'bottom' }}>Fecha</th>
					<th colSpan={5} className="table-group-header morning-col">☀️ Mañana</th>
					<th colSpan={5} className="table-group-header afternoon-col">🌆 Tarde</th>
					<th rowSpan={2} className="expense-col" style={{ verticalAlign: 'bottom' }}>Gastos</th>
					<th rowSpan={2} className="balance-col" style={{ verticalAlign: 'bottom' }}>Total</th>
				  </tr>
				  <tr>
					<th className="morning-col">Ef.</th>
					<th className="morning-col">Tar.</th>
					<th className="morning-col">Biz.</th>
					<th className="morning-col">Bon.</th>
					<th className="total-col">Total</th>
					<th className="afternoon-col">Ef.</th>
					<th className="afternoon-col">Tar.</th>
					<th className="afternoon-col">Biz.</th>
					<th className="afternoon-col">Bon.</th>
					<th className="total-col">Total</th>
				  </tr>
				</thead>
                  <tbody>
                    {visibleDailyRows.map(row => (
                      <tr key={row.id}>
                        <td className="date-col">{formatDate(row.sale_date)}</td>
                        <td className="morning-col">{money(row.morning_cash)}</td>
						<td className="morning-col">{money(row.morning_card)}</td>
						<td className="morning-col">{money(row.morning_bizum || 0)}</td>
						<td className="morning-col">{money(row.morning_bonos || 0)}</td>
						<td className="total-col">{money(row.morning_total || 0)}</td>
						<td className="afternoon-col">{money(row.afternoon_cash)}</td>
						<td className="afternoon-col">{money(row.afternoon_card)}</td>
						<td className="afternoon-col">{money(row.afternoon_bizum || 0)}</td>
						<td className="afternoon-col">{money(row.afternoon_bonos || 0)}</td>
						<td className="total-col">{money(row.afternoon_total || 0)}</td>
						<td className="expense-col">{money(row.daily_expenses_total || 0)}</td>
						<td className={row.daily_balance >= 0 ? 'balance-col balance-positive' : 'balance-col balance-negative'}>
						  {money(row.daily_balance || 0)}
						</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* ════════════════════════════════════════
            TAB: MONTHLY
        ════════════════════════════════════════ */}
        {activeTab === 'monthly' && user.role === 'admin' && (
          <section className="card stack section-block">
            {/* Month navigation — single row */}
            <div className="date-nav" style={{ marginBottom: 8 }}>
              <button type="button" className="secondary nav-btn" onClick={() => setSelectedMonth(prev => addMonths(prev, -1))}><ChevronL /></button>
              <input type="month" className="date-input" value={selectedMonth} max={getMonthKey(getTodayKey())}
                onChange={e => {
                  const raw = e.target.value
                  if (raw > getMonthKey(getTodayKey())) { setError('No se puede seleccionar un mes futuro.'); setSelectedMonth(getMonthKey(getTodayKey())); return }
                  setSelectedMonth(raw)
                }} />
              <button type="button" className="secondary nav-btn" disabled={selectedMonth >= getMonthKey(getTodayKey())} onClick={() => setSelectedMonth(prev => { const n = addMonths(prev, 1); return n > getMonthKey(getTodayKey()) ? getMonthKey(getTodayKey()) : n })}><ChevronR /></button>
              <button type="button" className="secondary btn-sm" onClick={() => setSelectedMonth(getMonthKey(getTodayKey()))}>Mes actual</button>
            </div>

            <div className="monthly-layout">
              {/* Left: expenses table */}
              <div>
                <h3 style={{ marginBottom: 14, fontSize: '15px' }}>Gastos fijos — {getMonthLabel(selectedMonth)}</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontSize: '12px', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Concepto</th>
                      <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--muted)', fontSize: '12px', fontWeight: 600, borderBottom: '1px solid var(--border)', width: 120 }}>Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {EXPENSE_CATEGORIES.map(category => {
                      const item = monthlyExpenses.find(e => e.month_key === selectedMonth && e.category === category)
                      return (
                        <tr key={category}>
                          <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: '14px', whiteSpace: 'nowrap' }}>{category}</td>
                          <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', width: 120 }}>
                            <input type="number" min="0" step="0.01" defaultValue={item?.amount || ''}
                              onBlur={e => saveExpense(category, e.target.value)}
                              style={{ textAlign: 'right', padding: '6px 10px', fontSize: '14px' }} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Right: summary cards */}
              <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
                <h3 style={{ fontSize: '15px', marginBottom: 4 }}>Resultado del mes</h3>
                <div className="monthly-kpi-card">
                  <span style={{ color: 'var(--muted)', fontSize: '13px' }}>Facturación</span>
                  <strong style={{ fontSize: '22px', color: 'var(--primary)' }}>{money(viewedMonth.salesTotal)}</strong>
                </div>
                <div className="monthly-kpi-card">
                  <span style={{ color: 'var(--muted)', fontSize: '13px' }}>Gastos fijos</span>
                  <strong style={{ fontSize: '22px', color: 'var(--danger)' }}>{money(viewedMonth.expensesTotal)}</strong>
                </div>
                <div className="monthly-kpi-card" style={{ border: `1px solid ${viewedMonth.balance >= 0 ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}` }}>
                  <span style={{ color: 'var(--muted)', fontSize: '13px' }}>Balance</span>
                  <strong style={{ fontSize: '26px', color: viewedMonth.balance >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(viewedMonth.balance)}</strong>
                </div>
                <div style={{ marginTop: 4 }}>
                  <div className="progress"><div className="progress-bar green" style={{ width: `${Math.min(viewedMonth.progress, 100)}%` }} /></div>
                  <p className="muted" style={{ fontSize: '12px', marginTop: 6 }}>{viewedMonth.progress}% del objetivo mensual ({money(MONTHLY_TARGET)})</p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ════════════════════════════════════════
            TAB: STATS
        ════════════════════════════════════════ */}
        {activeTab === 'stats' && user.role === 'admin' && stats && (
          <section className="card stack section-block">
            <h2>Estadísticas</h2>

            {/* KPI cards */}
            <div className="stats-grid">
              {[
                { label: '% días con objetivo', value: `${stats.daily_target_rate}%`, accent: 'var(--primary)' },
                { label: '% meses con objetivo', value: `${stats.monthly_target_rate}%`, accent: 'var(--primary)' },
                { label: 'Día más fuerte', value: stats.best_weekday, accent: 'var(--success)' },
                { label: 'Día más flojo', value: stats.worst_weekday, accent: 'var(--danger)' },
              ].map(k => (
                <div key={k.label} className="card kpi-card">
                  <span className="kpi-label">{k.label}</span>
                  <span className="kpi-value" style={{ color: k.accent }}>{k.value}</span>
                </div>
              ))}
            </div>

            {/* Charts row */}
            <div className="stats-charts-grid">
              {/* Clientes por día */}
              <div className="chart-card">
                <BarChart
                  title="Clientes por día (mañana vs tarde)"
                  data={visibleDailyRows.slice(0, 30).reverse()}
                />
              </div>

              {/* Pie: importe por método */}
              <div className="chart-card">
                {paymentStats.length > 0
                  ? <PieChart data={paymentStats} title="Ventas por método de pago" valueKey="amount_total" labelFormatter={money} />
                  : <div style={{ color: 'var(--muted)', fontSize: '13px' }}>Datos de métodos de pago no disponibles aún.</div>}
              </div>

              {/* Pie: clientes por método */}
              <div className="chart-card">
                {paymentStats.length > 0
                  ? <PieChart data={paymentStats} title="Compras por método de pago" valueKey="customers_total" />
                  : null}
              </div>
            </div>

            {/* Monthly evolution table */}
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>Evolución mensual</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="basic-table">
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
            </div>
          </section>
        )}
      </div>

      {/* ════════════════════════════════════════
          MODAL: GASTOS DIARIOS
      ════════════════════════════════════════ */}
      {showExpenseModal ? (
        <div className="modal-backdrop" onClick={() => setShowExpenseModal(false)}>
          <div className="modal-panel" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Añadir gasto diario</h2>
                <p className="muted" style={{ margin: 0, fontSize: '13px' }}>{formatDate(selectedDate)}</p>
              </div>
              <button type="button" className="secondary btn-sm" onClick={() => setShowExpenseModal(false)}>Cerrar</button>
            </div>
            <form className="modal-body" onSubmit={addDailyExpense}>
              <label>
                Concepto
                <input value={expenseForm.concept} placeholder="ej. Bolsas de papel" onChange={e => setExpenseForm(p => ({ ...p, concept: e.target.value }))} required />
              </label>
              <label>
                Importe (€)
                <input type="number" min="0" step="0.01" value={expenseForm.amount} placeholder="0.00" onChange={e => setExpenseForm(p => ({ ...p, amount: e.target.value }))} required />
              </label>

              {selectedDayExpenses.length > 0 ? (
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>Gastos ya registrados hoy</div>
                  <table className="basic-table">
                    <thead><tr><th>Concepto</th><th>Importe</th></tr></thead>
                    <tbody>
                      {selectedDayExpenses.map(item => <tr key={item.id}><td>{item.concept}</td><td>{money(item.amount)}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="secondary" onClick={() => setShowExpenseModal(false)}>Cancelar</button>
                <button type="submit">Añadir gasto</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* ════════════════════════════════════════
          MODAL: LOGS
      ════════════════════════════════════════ */}
      {logsModalOpen ? (
        <div className="modal-backdrop" onClick={() => setLogsModalOpen(false)}>
          <div className="modal-panel logs-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Logs de actividad</h2>
                <p className="muted" style={{ margin: 0, fontSize: '13px' }}>{filteredLogs.length} registros</p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="secondary btn-sm" onClick={exportLogsToExcel}>Excel</button>
                <button type="button" className="secondary btn-sm" onClick={() => setLogsModalOpen(false)}>Cerrar</button>
              </div>
            </div>

            {/* Filters */}
            <div className="log-filters">
              <select value={logFilterUser} onChange={e => setLogFilterUser(e.target.value)}>
                <option value="">Todos los usuarios</option>
                {logUsers.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <select value={logFilterAction} onChange={e => setLogFilterAction(e.target.value)}>
                <option value="">Todas las acciones</option>
                <option value="create">Create</option>
                <option value="update">Update</option>
              </select>
              <input type="date" value={logFilterFrom} max={getTodayKey()} placeholder="Desde"
                onChange={e => setLogFilterFrom(e.target.value)} style={{ flex: 1 }} />
              <input type="date" value={logFilterTo} max={getTodayKey()} placeholder="Hasta"
                onChange={e => setLogFilterTo(e.target.value)} style={{ flex: 1 }} />
              {(logFilterUser || logFilterAction || logFilterFrom || logFilterTo) ? (
                <button type="button" className="secondary btn-sm" onClick={() => { setLogFilterUser(''); setLogFilterAction(''); setLogFilterFrom(''); setLogFilterTo('') }}>Limpiar</button>
              ) : null}
            </div>

            <div className="modal-body" style={{ paddingTop: 0 }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="basic-table logs-table">
                  <thead>
                    <tr>
                      <th>Fecha/hora</th>
                      <th>Usuario</th>
                      <th>Día</th>
                      <th>Acción</th>
                      <th style={{ color: 'var(--primary)' }}>Mañ. Ef.</th>
                      <th style={{ color: 'var(--primary)' }}>Mañ. Tar.</th>
                      <th style={{ color: 'var(--primary)' }}>Mañ. Biz.</th>
                      <th style={{ color: 'var(--primary)' }}>Mañ. Bon.</th>
                      <th style={{ color: 'var(--primary)', fontWeight: 700 }}>Total Mañ.</th>
                      <th style={{ color: '#a78bfa' }}>Tar. Ef.</th>
                      <th style={{ color: '#a78bfa' }}>Tar. Tar.</th>
                      <th style={{ color: '#a78bfa' }}>Tar. Biz.</th>
                      <th style={{ color: '#a78bfa' }}>Tar. Bon.</th>
                      <th style={{ color: '#a78bfa', fontWeight: 700 }}>Total Tar.</th>
                      <th>Gastos</th>
                      <th>Balance</th>
                      <th>Total</th>
                      <th>Clientes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.length === 0 ? (
                      <tr><td colSpan={18} style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>No hay logs con los filtros seleccionados.</td></tr>
                    ) : filteredLogs.map(l => (
                      <tr key={l.id}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '12px' }}>{formatDateTime(l.changed_at)}</td>
                        <td>{l.changed_by_display_name}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(l.sale_date)}</td>
                        <td>
                          <span className={l.action === 'create' ? 'log-chip-create' : 'log-chip-update'}>
                            {l.action === 'create' ? 'Create' : 'Update'}
                          </span>
                        </td>
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
                        <td style={{ color: 'var(--danger)' }}>{money(l.daily_expenses_total)}</td>
                        <td style={{ color: l.daily_balance >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{money(l.daily_balance)}</td>
                        <td><strong>{money(l.total_sales)}</strong></td>
                        <td>{l.customers_total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
