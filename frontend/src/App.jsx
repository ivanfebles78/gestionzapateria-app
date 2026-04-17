import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { apiFetch } from './lib/api'

const DAILY_TARGET = 500
const MONTHLY_TARGET = 12000
const PAYMENT_METHODS = [
  { key: 'cash', label: 'Efectivo' },
  { key: 'card', label: 'Tarjeta' },
  { key: 'bizum', label: 'Bizum' },
  { key: 'bonos', label: 'Bonos consumo' },
]
const EXPENSE_CATEGORIES = [
  'Alquiler', 'Internet', 'Alarma', 'Agua y luz', 'Empleado 1', 'Empleado 2', 'Seguridad Social', 'Otros',
]

function BellIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0 1 18 14.158V11a6.002 6.002 0 0 0-4-5.659V4a2 2 0 1 0-4 0v1.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5" />
      <path d="M9 17a3 3 0 0 0 6 0" />
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
  const d = new Date()
  return d.toISOString().slice(0, 10)
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
  do {
    candidate = addDays(candidate, direction)
  } while (!isWorkingDay(candidate, extendedSchedule))
  return candidate
}

function normalizeDate(dateStr, extendedSchedule) {
  if (isWorkingDay(dateStr, extendedSchedule)) return dateStr
  return nextAllowedDate(dateStr, -1, extendedSchedule)
}

function isFutureDate(dateStr) {
  return dateStr > getTodayKey()
}

function clampToToday(dateStr) {
  return isFutureDate(dateStr) ? getTodayKey() : dateStr
}

function isFutureMonth(monthKey) {
  return monthKey > getMonthKey(getTodayKey())
}

function clampToCurrentMonth(monthKey) {
  return isFutureMonth(monthKey) ? getMonthKey(getTodayKey()) : monthKey
}

function buildMonthSummary(monthKey, sales, expenses) {
  const salesTotal = sales.filter((s) => s.sale_date.startsWith(monthKey)).reduce((acc, item) => acc + item.total_sales, 0)
  const expensesTotal = expenses.filter((e) => e.month_key === monthKey).reduce((acc, item) => acc + item.amount, 0)
  const balance = salesTotal - expensesTotal
  return { salesTotal, expensesTotal, balance, progress: MONTHLY_TARGET ? Math.round((salesTotal / MONTHLY_TARGET) * 100) : 0 }
}

function buildMonthDailyRows(monthKey, sales, extendedSchedule) {
  const [year, month] = monthKey.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  const salesMap = new Map(sales.map((item) => [item.sale_date, item]))
  const rows = []
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (!isWorkingDay(dateStr, extendedSchedule)) continue
    const existing = salesMap.get(dateStr)
    rows.push(existing || {
      id: `empty-${dateStr}`,
      sale_date: dateStr,
      morning_cash: 0, morning_card: 0, morning_bizum: 0, morning_bonos: 0, morning_total: 0,
      morning_cash_customers: 0, morning_card_customers: 0, morning_bizum_customers: 0, morning_bonos_customers: 0, morning_customers_total: 0,
      afternoon_cash: 0, afternoon_card: 0, afternoon_bizum: 0, afternoon_bonos: 0, afternoon_total: 0,
      afternoon_cash_customers: 0, afternoon_card_customers: 0, afternoon_bizum_customers: 0, afternoon_bonos_customers: 0, afternoon_customers_total: 0,
      total_sales: 0, daily_expenses_total: 0, daily_balance: 0, customers_total: 0,
    })
  }
  return rows.sort((a, b) => b.sale_date.localeCompare(a.sale_date))
}

function normalizeFormFromSale(sale) {
  if (!sale) {
    return {
      morning_cash: '', morning_card: '', morning_bizum: '', morning_bonos: '',
      morning_cash_customers: '', morning_card_customers: '', morning_bizum_customers: '', morning_bonos_customers: '',
      afternoon_cash: '', afternoon_card: '', afternoon_bizum: '', afternoon_bonos: '',
      afternoon_cash_customers: '', afternoon_card_customers: '', afternoon_bizum_customers: '', afternoon_bonos_customers: '',
    }
  }
  return {
    morning_cash: sale.morning_cash || '', morning_card: sale.morning_card || '', morning_bizum: sale.morning_bizum || '', morning_bonos: sale.morning_bonos || '',
    morning_cash_customers: sale.morning_cash_customers || '', morning_card_customers: sale.morning_card_customers || '', morning_bizum_customers: sale.morning_bizum_customers || '', morning_bonos_customers: sale.morning_bonos_customers || '',
    afternoon_cash: sale.afternoon_cash || '', afternoon_card: sale.afternoon_card || '', afternoon_bizum: sale.afternoon_bizum || '', afternoon_bonos: sale.afternoon_bonos || '',
    afternoon_cash_customers: sale.afternoon_cash_customers || '', afternoon_card_customers: sale.afternoon_card_customers || '', afternoon_bizum_customers: sale.afternoon_bizum_customers || '', afternoon_bonos_customers: sale.afternoon_bonos_customers || '',
  }
}

function formsEqual(a, b) {
  return Object.keys(a).every((key) => String(a[key] ?? '') === String(b[key] ?? ''))
}

function calcSectionTotals(form, prefix) {
  const salesTotal = PAYMENT_METHODS.reduce((acc, method) => acc + Number(form[`${prefix}_${method.key}`] || 0), 0)
  const customersTotal = PAYMENT_METHODS.reduce((acc, method) => acc + Number(form[`${prefix}_${method.key}_customers`] || 0), 0)
  return { salesTotal, customersTotal }
}

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    try {
      const token = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
      localStorage.setItem('zapateria_token', token.access_token)
      const me = await apiFetch('/api/auth/me')
      await onLogin(me)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="shell center-screen">
      <div className="login-card">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
          <img src="/logo-zapateria.png" alt="Logo de la zapatería" className="logo-img" />
          <div style={{ textAlign: 'center' }}>
            <p className="eyebrow">Zapatería</p>
            <h1>Control de ventas y gastos</h1>
            <p className="muted">Acceso online compartido con PostgreSQL, backend FastAPI y permisos por rol.</p>
          </div>
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
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error ? <div className="error-box">{error}</div> : null}
          <button type="submit">Entrar</button>
        </form>
      </div>
    </div>
  )
}

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
  const [form, setForm] = useState(normalizeFormFromSale(null))
  const [expenseForm, setExpenseForm] = useState({ concept: '', amount: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isEditing, setIsEditing] = useState(true)
  const notificationPanelRef = useRef(null)
  const notificationButtonRef = useRef(null)

  const extendedSchedule = settings.extended_schedule_enabled
  const selectedSale = useMemo(() => dailySales.find((item) => item.sale_date === selectedDate), [dailySales, selectedDate])
  const selectedDayExpenses = useMemo(() => dailyExpenses.filter((item) => item.sale_date === selectedDate), [dailyExpenses, selectedDate])
  const viewedMonth = useMemo(() => buildMonthSummary(selectedMonth, dailySales, monthlyExpenses), [selectedMonth, dailySales, monthlyExpenses])
  const currentMonthSummary = useMemo(() => buildMonthSummary(getMonthKey(getTodayKey()), dailySales, monthlyExpenses), [dailySales, monthlyExpenses])
  const visibleDailyRows = useMemo(() => buildMonthDailyRows(getMonthKey(selectedDate), dailySales, extendedSchedule).filter((item) => item.sale_date <= getTodayKey()), [selectedDate, dailySales, extendedSchedule])
  const unreadNotifications = notifications.filter((item) => !item.is_read)
  const initialForm = useMemo(() => normalizeFormFromSale(selectedSale), [selectedSale])
  const hasUnsavedChanges = isEditing && !formsEqual(form, initialForm)
  const isExistingSavedRecord = Boolean(selectedSale)

  const morning = calcSectionTotals(form, 'morning')
  const afternoon = calcSectionTotals(form, 'afternoon')
  const totalSales = morning.salesTotal + afternoon.salesTotal
  const totalCustomers = morning.customersTotal + afternoon.customersTotal
  const totalExpenses = selectedDayExpenses.reduce((acc, item) => acc + Number(item.amount || 0), 0)
  const balance = totalSales - totalExpenses
  const targetProgress = DAILY_TARGET ? Math.round((totalSales / DAILY_TARGET) * 100) : 0

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
    if (selectedSale) setIsEditing(!selectedSale.is_locked)
    else setIsEditing(true)
  }, [initialForm, selectedSale])

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!notificationPanelOpen) return
      const clickedInsidePanel = notificationPanelRef.current?.contains(event.target)
      const clickedButton = notificationButtonRef.current?.contains(event.target)
      if (!clickedInsidePanel && !clickedButton) setNotificationPanelOpen(false)
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [notificationPanelOpen])

  useEffect(() => {
    if (!message && !error) return
    const timer = setTimeout(() => { setMessage(''); setError('') }, 3000)
    return () => clearTimeout(timer)
  }, [message, error])

  async function loadSession() {
    try {
      const me = await apiFetch('/api/auth/me')
      const today = getTodayKey()
      setSelectedDate(today)
      setSelectedMonth(getMonthKey(today))
      setActiveTab('daily')
      setUser(me)
      await loadBusinessData(me, today)
    } catch {
      localStorage.removeItem('zapateria_token')
      setUser(null)
    }
  }

  async function handleLogin(me) {
    const today = getTodayKey()
    setSelectedDate(today)
    setSelectedMonth(getMonthKey(today))
    setActiveTab('daily')
    setUser(me)
    await loadBusinessData(me, today)
  }

  async function loadBusinessData(currentUser = user, dateKey = selectedDate) {
    const [sales, expenses, appSettings, dashboardStats, expensesForDay] = await Promise.all([
      apiFetch('/api/daily-sales'),
      apiFetch('/api/monthly-expenses'),
      apiFetch('/api/settings'),
      apiFetch('/api/stats/dashboard'),
      apiFetch(`/api/daily-expenses?sale_date=${dateKey}`),
    ])
    setDailySales(sales)
    setMonthlyExpenses(expenses)
    setSettings(appSettings)
    setStats(dashboardStats)
    setDailyExpenses(expensesForDay)
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

  async function refreshDailyExpenses(dateKey = selectedDate) {
    const items = await apiFetch(`/api/daily-expenses?sale_date=${dateKey}`)
    setDailyExpenses(items)
  }

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
      await apiFetch('/api/daily-sales', {
        method: 'PUT',
        body: JSON.stringify({
          sale_date: selectedDate,
          morning_cash: Number(form.morning_cash || 0),
          morning_card: Number(form.morning_card || 0),
          morning_bizum: Number(form.morning_bizum || 0),
          morning_bonos: Number(form.morning_bonos || 0),
          morning_cash_customers: Number(form.morning_cash_customers || 0),
          morning_card_customers: Number(form.morning_card_customers || 0),
          morning_bizum_customers: Number(form.morning_bizum_customers || 0),
          morning_bonos_customers: Number(form.morning_bonos_customers || 0),
          afternoon_cash: Number(form.afternoon_cash || 0),
          afternoon_card: Number(form.afternoon_card || 0),
          afternoon_bizum: Number(form.afternoon_bizum || 0),
          afternoon_bonos: Number(form.afternoon_bonos || 0),
          afternoon_cash_customers: Number(form.afternoon_cash_customers || 0),
          afternoon_card_customers: Number(form.afternoon_card_customers || 0),
          afternoon_bizum_customers: Number(form.afternoon_bizum_customers || 0),
          afternoon_bonos_customers: Number(form.afternoon_bonos_customers || 0),
          worked: !isSunday(selectedDate) || extendedSchedule,
          extended_schedule: extendedSchedule,
        }),
      })
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
    setMessage('')
    setError('')
    try {
      await apiFetch(`/api/daily-sales/${selectedDate}/unlock`, { method: 'POST' })
      await loadBusinessData(user)
      setIsEditing(true)
      setMessage('Modo edición activado.')
    } catch (err) {
      setError(err.message)
    }
  }

  function cancelEdit() {
    if (!selectedSale) return
    setForm(initialForm)
    setIsEditing(false)
    setMessage('Edición cancelada.')
  }

  async function addDailyExpense(e) {
    if (e) e.preventDefault()
    setError('')
    setMessage('')
    try {
      await apiFetch('/api/daily-expenses', {
        method: 'POST',
        body: JSON.stringify({
          sale_date: selectedDate,
          concept: expenseForm.concept,
          amount: Number(expenseForm.amount || 0),
        }),
      })
      setExpenseForm({ concept: '', amount: '' })
      setShowExpenseModal(false)
      await loadBusinessData(user)
      setMessage('Gasto diario añadido correctamente.')
    } catch (err) {
      setError(err.message)
    }
  }

  async function saveExpense(category, amount) {
    setMessage('')
    setError('')
    try {
      await apiFetch('/api/monthly-expenses', { method: 'PUT', body: JSON.stringify({ month_key: selectedMonth, category, amount: Number(amount || 0) }) })
      await loadBusinessData(user)
      setMessage('Gasto mensual actualizado correctamente.')
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleExtendedSchedule(checked) {
    try {
      await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ extended_schedule_enabled: checked }) })
      await loadBusinessData(user)
    } catch (err) {
      setError(err.message)
    }
  }

  async function markNotificationAsRead(notificationId) {
    try {
      await apiFetch(`/api/admin/notifications/${notificationId}/read`, { method: 'POST' })
      await loadBusinessData(user)
    } catch (err) {
      setError(err.message)
    }
  }

  async function markAllNotificationsAsRead() {
    try {
      const unread = notifications.filter((item) => !item.is_read)
      await Promise.all(unread.map((item) => apiFetch(`/api/admin/notifications/${item.id}/read`, { method: 'POST' })))
      await loadBusinessData(user)
    } catch (err) {
      setError(err.message)
    }
  }

  function exportLogsToExcel() {
    const rows = changeLogs.filter((item) => item.action === 'create' || item.action === 'update').map((item) => ({
      'Fecha y hora': formatDateTime(item.changed_at),
      Usuario: item.changed_by_display_name,
      Día: formatDate(item.sale_date),
      Acción: item.action === 'create' ? 'Create' : 'Update',
      'Efectivo mañana': item.morning_cash,
      'Tarjeta mañana': item.morning_card,
      'Bizum mañana': item.morning_bizum,
      'Bonos mañana': item.morning_bonos,
      'Clientes mañana': item.morning_customers_total,
      'Total mañana': item.morning_total,
      'Efectivo tarde': item.afternoon_cash,
      'Tarjeta tarde': item.afternoon_card,
      'Bizum tarde': item.afternoon_bizum,
      'Bonos tarde': item.afternoon_bonos,
      'Clientes tarde': item.afternoon_customers_total,
      'Total tarde': item.afternoon_total,
      'Total ventas': item.total_sales,
      'Gastos': item.daily_expenses_total,
      'Balance': item.daily_balance,
      'Clientes día': item.customers_total,
    }))
    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Logs')
    XLSX.writeFile(workbook, 'logs_zapateria.xlsx')
  }

  function logout() {
    localStorage.removeItem('zapateria_token')
    setUser(null)
  }

  if (!user) return <LoginScreen onLogin={handleLogin} />

  const showSaveButton = !isExistingSavedRecord || isEditing
  const showEditButton = isExistingSavedRecord
  const editButtonLabel = isExistingSavedRecord && isEditing ? 'Cancelar' : 'Editar'

  return (
    <>
      <div className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Zapatería</p>
            <h1>Control compartido de ventas y gastos</h1>
            <p className="muted">Usuario: {user.display_name} · Rol: {user.role === 'admin' ? 'Administrador' : 'Tienda'}</p>
          </div>
          <div className="topbar-actions">
            {user.role === 'admin' ? (
              <button ref={notificationButtonRef} type="button" className="notification-trigger" onClick={() => setNotificationPanelOpen((prev) => !prev)} title="Notificaciones">
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
                    <div className="muted">{unreadNotifications.length} sin leer</div>
                  </div>
                  <button type="button" className="secondary small-button" onClick={markAllNotificationsAsRead} disabled={!unreadNotifications.length}>Marcar todas</button>
                </div>
                <div className="notification-list">
                  {notifications.length === 0 ? <div className="notification-empty">No hay notificaciones.</div> : notifications.map((item) => (
                    <div key={item.id} className={`notification-card ${item.is_read ? 'read' : 'unread'}`}>
                      <div className="notification-card-top">
                        <div>
                          <div className="notification-chip">{item.type === 'daily_sale_edited' ? 'Edición' : 'Aviso'}</div>
                          <div className="notification-card-title">{item.title}</div>
                        </div>
                        {!item.is_read ? <button type="button" className="secondary small-button" onClick={() => markNotificationAsRead(item.id)}>Marcar</button> : null}
                      </div>
                      <div className="notification-card-date">{formatDateTime(item.created_at)}</div>
                      <div className="notification-card-message">{item.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </header>

        {message ? <div className="success-box dismissible-alert"><span>{message}</span><button type="button" className="alert-close" onClick={() => setMessage('')}>×</button></div> : null}
        {error ? <div className="error-box dismissible-alert"><span>{error}</span><button type="button" className="alert-close" onClick={() => setError('')}>×</button></div> : null}

        <section className="stats-grid">
          <div className="card"><span className="muted">Ventas día seleccionado</span><strong>{money(totalSales)}</strong></div>
          <div className="card"><span className="muted">Ventas mes actual</span><strong>{money(currentMonthSummary.salesTotal)}</strong></div>
          {user.role === 'admin' ? <><div className="card"><span className="muted">Gastos mes actual</span><strong>{money(currentMonthSummary.expensesTotal)}</strong></div><div className="card"><span className="muted">Balance mes actual</span><strong>{money(currentMonthSummary.balance)}</strong></div></> : null}
        </section>

        <nav className="tabs">
          <button className={activeTab === 'daily' ? 'active' : ''} onClick={() => setActiveTab('daily')}>Resumen diario</button>
          {user.role === 'admin' ? <button className={activeTab === 'monthly' ? 'active' : ''} onClick={() => setActiveTab('monthly')}>Resumen mensual</button> : null}
          {user.role === 'admin' ? <button className={activeTab === 'stats' ? 'active' : ''} onClick={() => setActiveTab('stats')}>Estadísticas</button> : null}
          {user.role === 'admin' ? <button type="button" onClick={() => setLogsModalOpen(true)}>Logs</button> : null}
        </nav>

        {activeTab === 'daily' && (
          <>
            <section className="card stack full-width section-block">
              <h2>Registro de ventas por día</h2>
              {user.role === 'admin' ? (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: '#dbe7ff' }}>
                  <input type="checkbox" checked={extendedSchedule} onChange={(e) => toggleExtendedSchedule(e.target.checked)} />
                  <span>Habilitar horario extendido</span>
                </label>
              ) : null}

              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="secondary" onClick={() => setSelectedDate((prev) => nextAllowedDate(prev, -1, extendedSchedule))}>◀</button>
                <input type="date" value={selectedDate} max={getTodayKey()} onChange={(e) => {
                  const rawDate = e.target.value
                  if (isFutureDate(rawDate)) {
                    setError('No se pueden registrar ventas para fechas futuras.')
                    setSelectedDate(getTodayKey())
                    return
                  }
                  setSelectedDate(normalizeDate(rawDate, extendedSchedule))
                }} />
                <button type="button" className="secondary" disabled={selectedDate >= getTodayKey()} onClick={() => setSelectedDate((prev) => clampToToday(nextAllowedDate(prev, 1, extendedSchedule)))}>▶</button>
                <button type="button" className="secondary" onClick={() => setSelectedDate(getTodayKey())}>Hoy</button>
                <button type="button" className="secondary" onClick={() => setShowExpenseModal(true)}>Añadir gasto</button>
              </div>

              <div className="grid-form">
                <div className="form-block morning stack">
                  <h3>Mañana</h3>
                  {PAYMENT_METHODS.map((method) => (
                    <div key={`m-${method.key}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <label>{method.label} (€)
                        <input type="number" min="0" step="0.01" disabled={!isEditing} value={form[`morning_${method.key}`]} onChange={(e) => setForm((prev) => ({ ...prev, [`morning_${method.key}`]: e.target.value }))} />
                      </label>
                      <label>Clientes {method.label}
                        <input type="number" min="0" step="1" disabled={!isEditing} value={form[`morning_${method.key}_customers`]} onChange={(e) => setForm((prev) => ({ ...prev, [`morning_${method.key}_customers`]: e.target.value }))} />
                      </label>
                    </div>
                  ))}
                  <div className="metric-card"><span className="muted">Total ventas mañana</span><strong>{money(morning.salesTotal)}</strong></div>
                  <div className="metric-card"><span className="muted">Total clientes mañana</span><strong>{morning.customersTotal}</strong></div>
                </div>

                <div className="form-block afternoon stack">
                  <h3>Tarde</h3>
                  {PAYMENT_METHODS.map((method) => (
                    <div key={`a-${method.key}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <label>{method.label} (€)
                        <input type="number" min="0" step="0.01" disabled={!isEditing || (isSaturday(selectedDate) && !extendedSchedule)} value={form[`afternoon_${method.key}`]} onChange={(e) => setForm((prev) => ({ ...prev, [`afternoon_${method.key}`]: e.target.value }))} />
                      </label>
                      <label>Clientes {method.label}
                        <input type="number" min="0" step="1" disabled={!isEditing || (isSaturday(selectedDate) && !extendedSchedule)} value={form[`afternoon_${method.key}_customers`]} onChange={(e) => setForm((prev) => ({ ...prev, [`afternoon_${method.key}_customers`]: e.target.value }))} />
                      </label>
                    </div>
                  ))}
                  <div className="metric-card"><span className="muted">Total ventas tarde</span><strong>{money(afternoon.salesTotal)}</strong></div>
                  <div className="metric-card"><span className="muted">Total clientes tarde</span><strong>{afternoon.customersTotal}</strong></div>
                </div>

                <div className="form-block totals stack">
                  <h3>Resumen del día</h3>
                  <div className="metric-card"><span className="muted">Total ventas día</span><strong>{money(totalSales)}</strong></div>
                  <div className="metric-card"><span className="muted">Total gastos día</span><strong>{money(totalExpenses)}</strong></div>
                  <div className="metric-card"><span className="muted">Balance día</span><strong>{money(balance)}</strong></div>
                  <div className="metric-card"><span className="muted">Total clientes día</span><strong>{totalCustomers}</strong></div>
                </div>

                <div className="form-block stack">
                  <h3>Acciones</h3>
                  {showSaveButton ? <button type="button" onClick={saveDay}>Guardar</button> : null}
                  {showEditButton ? <button type="button" className="secondary" onClick={() => (isEditing ? cancelEdit() : unlockForEdit())}>{isEditing ? 'Cancelar' : 'Editar'}</button> : null}
                  <div className="muted">Los domingos no se trabaja y los sábados por la tarde se deshabilitan si no hay horario ampliado.</div>
                </div>
              </div>
            </section>

            <section className="card stack full-width section-block">
              <h2>Objetivo diario</h2>
              <div className="goal-banner">
                <div className="goal-meta">
                  <span className="muted">{formatDate(selectedDate)} · Meta: {money(DAILY_TARGET)}</span>
                  <strong>{targetProgress}%</strong>
                </div>
                <div className="progress"><div className="progress-bar" style={{ width: `${Math.min(targetProgress, 100)}%` }} /></div>
                <div>{totalSales >= DAILY_TARGET ? `Objetivo alcanzado (${targetProgress}%)` : `Faltan ${money(Math.max(DAILY_TARGET - totalSales, 0))} · ${targetProgress}% del objetivo`}</div>
              </div>

              <div className="table-wrap">
                <table className="sales-table">
                  <thead>
                    <tr>
                      <th rowSpan="2" className="date-col">Fecha</th>
                      <th colSpan="10" className="table-group-header morning-col">Mañana</th>
                      <th colSpan="10" className="table-group-header afternoon-col">Tarde</th>
                      <th rowSpan="2" className="expense-col">Gastos</th>
                      <th rowSpan="2" className="total-col">Balance día</th>
                      <th rowSpan="2" className="total-col">Total día</th>
                    </tr>
                    <tr>
                      <th className="morning-col">Ef.</th>
                      <th className="morning-col">Tar.</th>
                      <th className="morning-col">Biz.</th>
                      <th className="morning-col">Bon.</th>
                      <th className="total-col">Total</th>
                      <th className="morning-col">Cli. Ef.</th>
                      <th className="morning-col">Cli. Tar.</th>
                      <th className="morning-col">Cli. Biz.</th>
                      <th className="morning-col">Cli. Bon.</th>
                      <th className="total-col">Cli. total</th>

                      <th className="afternoon-col">Ef.</th>
                      <th className="afternoon-col">Tar.</th>
                      <th className="afternoon-col">Biz.</th>
                      <th className="afternoon-col">Bon.</th>
                      <th className="total-col">Total</th>
                      <th className="afternoon-col">Cli. Ef.</th>
                      <th className="afternoon-col">Cli. Tar.</th>
                      <th className="afternoon-col">Cli. Biz.</th>
                      <th className="afternoon-col">Cli. Bon.</th>
                      <th className="total-col">Cli. total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDailyRows.map((item) => (
                      <tr key={item.id}>
                        <td className="date-col">{formatDate(item.sale_date)}</td>
                        <td className="morning-col">{money(item.morning_cash)}</td>
                        <td className="morning-col">{money(item.morning_card)}</td>
                        <td className="morning-col">{money(item.morning_bizum || 0)}</td>
                        <td className="morning-col">{money(item.morning_bonos || 0)}</td>
                        <td className="total-col">{money(item.morning_total)}</td>
                        <td className="morning-col">{item.morning_cash_customers || 0}</td>
                        <td className="morning-col">{item.morning_card_customers || 0}</td>
                        <td className="morning-col">{item.morning_bizum_customers || 0}</td>
                        <td className="morning-col">{item.morning_bonos_customers || 0}</td>
                        <td className="total-col">{item.morning_customers_total || 0}</td>

                        <td className="afternoon-col">{money(item.afternoon_cash)}</td>
                        <td className="afternoon-col">{money(item.afternoon_card)}</td>
                        <td className="afternoon-col">{money(item.afternoon_bizum || 0)}</td>
                        <td className="afternoon-col">{money(item.afternoon_bonos || 0)}</td>
                        <td className="total-col">{money(item.afternoon_total)}</td>
                        <td className="afternoon-col">{item.afternoon_cash_customers || 0}</td>
                        <td className="afternoon-col">{item.afternoon_card_customers || 0}</td>
                        <td className="afternoon-col">{item.afternoon_bizum_customers || 0}</td>
                        <td className="afternoon-col">{item.afternoon_bonos_customers || 0}</td>
                        <td className="total-col">{item.afternoon_customers_total || 0}</td>

                        <td className="expense-col">{money(item.daily_expenses_total)}</td>
                        <td className={item.daily_balance >= 0 ? 'balance-positive' : 'balance-negative'}>{money(item.daily_balance)}</td>
                        <td className="total-col">{money(item.total_sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {activeTab === 'monthly' && user.role === 'admin' && (
          <section className="card stack full-width section-block">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="secondary" onClick={() => setSelectedMonth((prev) => addMonths(prev, -1))}>◀</button>
              <input type="month" value={selectedMonth} max={getMonthKey(getTodayKey())} onChange={(e) => { const rawMonth = e.target.value; if (isFutureMonth(rawMonth)) { setError('No se puede seleccionar un mes futuro.'); setSelectedMonth(getMonthKey(getTodayKey())); return } setSelectedMonth(rawMonth) }} />
              <button type="button" className="secondary" disabled={selectedMonth >= getMonthKey(getTodayKey())} onClick={() => setSelectedMonth((prev) => clampToCurrentMonth(addMonths(prev, 1)))}>▶</button>
              <button type="button" className="secondary" onClick={() => setSelectedMonth(getMonthKey(getTodayKey()))}>Mes actual</button>
            </div>
            <h2>Gastos del mes</h2>
            {EXPENSE_CATEGORIES.map((category) => {
              const item = monthlyExpenses.find((expense) => expense.month_key === selectedMonth && expense.category === category)
              return (
                <div key={category} className="expense-row">
                  <span>{category}</span>
                  <input type="number" min="0" step="0.01" defaultValue={item?.amount || ''} onBlur={(e) => saveExpense(category, e.target.value)} />
                </div>
              )
            })}
            <div className="metrics-grid">
              <div className="metric-card"><span className="muted">Facturación</span><strong>{money(viewedMonth.salesTotal)}</strong></div>
              <div className="metric-card"><span className="muted">Gastos</span><strong>{money(viewedMonth.expensesTotal)}</strong></div>
              <div className="metric-card"><span className="muted">Balance</span><strong>{money(viewedMonth.balance)}</strong></div>
            </div>
          </section>
        )}

        {activeTab === 'stats' && user.role === 'admin' && stats && (
          <section className="card stack full-width section-block">
            <h2>Estadísticas</h2>
            <div className="stats-grid">
              <div className="card"><span className="muted">% días con objetivo</span><strong>{stats.daily_target_rate}%</strong></div>
              <div className="card"><span className="muted">% meses con objetivo</span><strong>{stats.monthly_target_rate}%</strong></div>
              <div className="card"><span className="muted">Día más fuerte</span><strong>{stats.best_weekday}</strong></div>
              <div className="card"><span className="muted">Día más flojo</span><strong>{stats.worst_weekday}</strong></div>
            </div>

            <div className="metrics-grid">
              <div className="metric-card">
                <h3>Medios de pago (% importe y % compras)</h3>
                <div className="history-table">
                  <table className="basic-table">
                    <thead>
                      <tr><th>Método</th><th>Importe</th><th>% importe</th><th>Compras</th><th>% compras</th></tr>
                    </thead>
                    <tbody>
                      {stats.payment_method_stats?.map((item) => (
                        <tr key={item.method}>
                          <td>{item.method}</td>
                          <td>{money(item.amount_total)}</td>
                          <td>{item.amount_pct}%</td>
                          <td>{item.customers_total}</td>
                          <td>{item.customers_pct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="metric-card">
                <h3>Tramos con más clientes</h3>
                <div className="history-table">
                  <table className="basic-table">
                    <thead><tr><th>Tramo</th><th>Clientes</th></tr></thead>
                    <tbody>
                      {stats.customer_traffic?.map((item) => (
                        <tr key={item.slot}><td>{item.slot}</td><td>{item.customers_total}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="metric-card">
                <h3>Evolución mensual</h3>
                <div className="history-table">
                  <table className="basic-table">
                    <thead><tr><th>Mes</th><th>Ventas</th><th>Gastos</th><th>Balance</th><th>% objetivo</th></tr></thead>
                    <tbody>
                      {stats.monthly_summaries.map((item) => (
                        <tr key={item.month_key}><td>{getMonthLabel(item.month_key)}</td><td>{money(item.sales_total)}</td><td>{money(item.expenses_total)}</td><td>{money(item.balance)}</td><td>{item.target_progress_pct}%</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      {showExpenseModal ? (
        <div className="modal-backdrop" onClick={() => setShowExpenseModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Añadir gasto diario</h2>
                <p className="muted">Introduce el concepto y el importe del gasto inesperado.</p>
              </div>
              <button type="button" className="secondary" onClick={() => setShowExpenseModal(false)}>Cerrar</button>
            </div>
            <form className="modal-body" onSubmit={addDailyExpense}>
              <label>Concepto<input value={expenseForm.concept} onChange={(e) => setExpenseForm((prev) => ({ ...prev, concept: e.target.value }))} /></label>
              <label>Importe<input type="number" min="0" step="0.01" value={expenseForm.amount} onChange={(e) => setExpenseForm((prev) => ({ ...prev, amount: e.target.value }))} /></label>
              <div className="history-table">
                <table className="basic-table">
                  <thead><tr><th>Concepto</th><th>Importe</th></tr></thead>
                  <tbody>
                    {selectedDayExpenses.map((item) => <tr key={item.id}><td>{item.concept}</td><td>{money(item.amount)}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button type="button" className="secondary" onClick={() => setShowExpenseModal(false)}>Cancelar</button>
                <button type="submit">Guardar gasto</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {logsModalOpen ? (
        <div className="modal-backdrop" onClick={() => setLogsModalOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Logs de actividad</h2>
                <p className="muted">Incluye importes y clientes por medio de pago.</p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="secondary" onClick={exportLogsToExcel}>Exportar a excel</button>
                <button type="button" className="secondary" onClick={() => setLogsModalOpen(false)}>Cerrar</button>
              </div>
            </div>
            <div className="modal-body">
              <div className="history-table">
                <table className="basic-table">
                  <thead>
                    <tr>
                      <th>Fecha y hora</th><th>Usuario</th><th>Día</th><th>Acción</th><th>Total ventas</th><th>Gastos</th><th>Balance</th><th>Clientes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changeLogs.map((item) => (
                      <tr key={item.id}>
                        <td>{formatDateTime(item.changed_at)}</td>
                        <td>{item.changed_by_display_name}</td>
                        <td>{formatDate(item.sale_date)}</td>
                        <td>{item.action}</td>
                        <td>{money(item.total_sales)}</td>
                        <td>{money(item.daily_expenses_total)}</td>
                        <td>{money(item.daily_balance)}</td>
                        <td>{item.customers_total}</td>
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
