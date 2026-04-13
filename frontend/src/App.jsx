import { useEffect, useMemo, useRef, useState } from 'react'
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

function BellIcon({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
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

function buildMonthSummary(monthKey, sales, expenses) {
  const salesTotal = sales.filter((s) => s.sale_date.startsWith(monthKey)).reduce((acc, item) => acc + item.total_sales, 0)
  const expensesTotal = expenses.filter((e) => e.month_key === monthKey).reduce((acc, item) => acc + item.amount, 0)
  const balance = salesTotal - expensesTotal
  return {
    salesTotal,
    expensesTotal,
    balance,
    progress: MONTHLY_TARGET ? Math.round((salesTotal / MONTHLY_TARGET) * 100) : 0,
  }
}

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  width: '100%',
  flexWrap: 'nowrap',
}

const checkboxWrapStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  width: '100%',
  marginBottom: '16px',
}

const checkboxLabelStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '10px',
  cursor: 'pointer',
  color: '#dbe7ff',
  fontSize: '15px',
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
}

const checkboxInputStyle = {
  width: '18px',
  height: '18px',
  margin: 0,
  accentColor: '#22d3ee',
  flex: '0 0 auto',
}

const navButtonStyle = {
  width: '48px',
  minWidth: '48px',
  height: '44px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  flex: '0 0 auto',
}

const dateInputStyle = {
  flex: '1 1 auto',
  minWidth: '220px',
  height: '44px',
}

const monthInputStyle = {
  flex: '1 1 auto',
  minWidth: '220px',
  height: '44px',
}

const todayButtonStyle = {
  minWidth: '90px',
  height: '44px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  whiteSpace: 'nowrap',
  flex: '0 0 auto',
}

const currentMonthButtonStyle = {
  minWidth: '120px',
  height: '44px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  whiteSpace: 'nowrap',
  flex: '0 0 auto',
}

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
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
    }
  }

  return (
    <div className="shell center-screen">
      <div className="login-card">
        <div>
          <p className="eyebrow">Zapatería</p>
          <h1>Control de ventas y gastos</h1>
          <p className="muted">Acceso online compartido con PostgreSQL, backend FastAPI y permisos por rol.</p>
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
  const [settings, setSettings] = useState({ extended_schedule_enabled: false })
  const [stats, setStats] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [changeLogs, setChangeLogs] = useState([])
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false)
  const [logsModalOpen, setLogsModalOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState(getTodayKey())
  const [selectedMonth, setSelectedMonth] = useState(getMonthKey(getTodayKey()))
  const [activeTab, setActiveTab] = useState('daily')
  const [form, setForm] = useState({ morning_sales: '', afternoon_sales: '', customers: '' })
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

  const unreadNotifications = notifications.filter((item) => !item.is_read)

  useEffect(() => {
    const token = localStorage.getItem('zapateria_token')
    if (!token) return
    loadSession()
  }, [])

  useEffect(() => {
    setSelectedDate((prev) => normalizeDate(prev, extendedSchedule))
  }, [extendedSchedule])

  useEffect(() => {
    if (selectedSale) {
      setForm({
        morning_sales: selectedSale.morning_sales || '',
        afternoon_sales: selectedSale.afternoon_sales || '',
        customers: selectedSale.customers ?? '',
      })
      setIsEditing(!selectedSale.is_locked)
    } else {
      setForm({ morning_sales: '', afternoon_sales: '', customers: '' })
      setIsEditing(true)
    }
  }, [selectedSale])

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!notificationPanelOpen) return
      const clickedInsidePanel = notificationPanelRef.current?.contains(event.target)
      const clickedButton = notificationButtonRef.current?.contains(event.target)
      if (!clickedInsidePanel && !clickedButton) {
        setNotificationPanelOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [notificationPanelOpen])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setLogsModalOpen(false)
      }
    }

    if (logsModalOpen) {
      document.addEventListener('keydown', onKeyDown)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [logsModalOpen])

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

  async function saveDay(e) {
    e.preventDefault()
    setMessage('')
    setError('')

    try {
      const payload = {
        sale_date: selectedDate,
        morning_sales: Number(form.morning_sales || 0),
        afternoon_sales: Number(isSaturday(selectedDate) && !extendedSchedule ? 0 : (form.afternoon_sales || 0)),
        worked: !isSunday(selectedDate) || extendedSchedule,
        customers: form.customers === '' ? null : Number(form.customers),
        extended_schedule: extendedSchedule,
      }

      await apiFetch('/api/daily-sales', {
        method: 'PUT',
        body: JSON.stringify(payload),
      })

      await loadBusinessData(user)
      setIsEditing(false)
      setMessage('Día guardado correctamente.')
    } catch (err) {
      setError(err.message)
    }
  }

  async function unlockForEdit() {
    setMessage('')
    setError('')
    try {
      await apiFetch(`/api/daily-sales/${selectedDate}/unlock`, {
        method: 'POST',
      })
      await loadBusinessData(user)
      setIsEditing(true)
      setMessage('Modo edición activado.')
    } catch (err) {
      setError(err.message)
    }
  }

  async function saveExpense(category, amount) {
    setMessage('')
    setError('')
    try {
      await apiFetch('/api/monthly-expenses', {
        method: 'PUT',
        body: JSON.stringify({ month_key: selectedMonth, category, amount: Number(amount || 0) }),
      })
      await loadBusinessData(user)
      setMessage('Gasto actualizado correctamente.')
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleExtendedSchedule(checked) {
    try {
      await apiFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ extended_schedule_enabled: checked }),
      })
      await loadBusinessData(user)
    } catch (err) {
      setError(err.message)
    }
  }

  async function markNotificationAsRead(notificationId) {
    try {
      await apiFetch(`/api/admin/notifications/${notificationId}/read`, {
        method: 'POST',
      })
      await loadBusinessData(user)
    } catch (err) {
      setError(err.message)
    }
  }

  async function markAllNotificationsAsRead() {
    try {
      const unread = notifications.filter((item) => !item.is_read)
      await Promise.all(
        unread.map((item) =>
          apiFetch(`/api/admin/notifications/${item.id}/read`, {
            method: 'POST',
          })
        )
      )
      await loadBusinessData(user)
    } catch (err) {
      setError(err.message)
    }
  }

  function logout() {
    localStorage.removeItem('zapateria_token')
    setUser(null)
  }

  if (!user) {
    return <LoginScreen onLogin={setUser} />
  }

  const isSaturdayAfternoonDisabled = isSaturday(selectedDate) && !extendedSchedule
  const totalSales = Number(form.morning_sales || 0) + Number(isSaturdayAfternoonDisabled ? 0 : (form.afternoon_sales || 0))

  return (
    <>
      <div className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Zapatería</p>
            <h1>Control compartido de ventas y gastos</h1>
            <p className="muted">
              Usuario: {user.display_name} · Rol: {user.role === 'admin' ? 'Administrador' : 'Tienda'}
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
                    <div className="notification-panel-subtitle">
                      {unreadNotifications.length} sin leer
                    </div>
                  </div>

                  <div className="notification-panel-actions">
                    <button
                      type="button"
                      className="secondary small-button"
                      onClick={markAllNotificationsAsRead}
                      disabled={unreadNotifications.length === 0}
                    >
                      Marcar todas
                    </button>
                  </div>
                </div>

                <div className="notification-list">
                  {notifications.length === 0 ? (
                    <div className="notification-empty">No hay notificaciones.</div>
                  ) : (
                    notifications.map((item) => (
                      <div
                        key={item.id}
                        className={`notification-card ${item.is_read ? 'read' : 'unread'}`}
                      >
                        <div className="notification-card-top">
                          <div className="notification-card-main">
                            <div className="notification-chip">
                              {item.type === 'daily_sale_edited' ? 'Edición' : 'Aviso'}
                            </div>
                            <div className="notification-card-title">{item.title}</div>
                          </div>

                          {!item.is_read ? (
                            <button
                              type="button"
                              className="secondary small-button"
                              onClick={() => markNotificationAsRead(item.id)}
                            >
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

        {message ? <div className="success-box">{message}</div> : null}
        {error ? <div className="error-box">{error}</div> : null}

        <section className="stats-grid">
          <div className="card"><span className="muted">Ventas día seleccionado</span><strong>{money(totalSales)}</strong></div>
          <div className="card"><span className="muted">Ventas mes actual</span><strong>{money(currentMonthSummary.salesTotal)}</strong></div>
          <div className="card"><span className="muted">Gastos mes actual</span><strong>{money(currentMonthSummary.expensesTotal)}</strong></div>
          <div className="card"><span className="muted">Balance mes actual</span><strong>{money(currentMonthSummary.balance)}</strong></div>
        </section>

        <nav className="tabs">
          <button className={activeTab === 'daily' ? 'active' : ''} onClick={() => setActiveTab('daily')}>Resumen diario</button>
          {user.role === 'admin' ? <button className={activeTab === 'monthly' ? 'active' : ''} onClick={() => setActiveTab('monthly')}>Resumen mensual</button> : null}
          {user.role === 'admin' ? <button className={activeTab === 'stats' ? 'active' : ''} onClick={() => setActiveTab('stats')}>Estadísticas</button> : null}
          {user.role === 'admin' ? (
            <button type="button" onClick={() => setLogsModalOpen(true)}>Logs</button>
          ) : null}
        </nav>

        {activeTab === 'daily' && (
          <section className="two-columns">
            <div className="card stack">
              <h2>Registro de ventas por día</h2>

              {user.role === 'admin' ? (
                <div style={checkboxWrapStyle}>
                  <label style={checkboxLabelStyle}>
                    <input
                      type="checkbox"
                      style={checkboxInputStyle}
                      checked={extendedSchedule}
                      onChange={(e) => toggleExtendedSchedule(e.target.checked)}
                    />
                    <span>Habilitar horario extendido</span>
                  </label>
                </div>
              ) : null}

              <div style={{ ...rowStyle, marginBottom: '16px' }}>
                <button
                  type="button"
                  className="secondary"
                  style={navButtonStyle}
                  onClick={() => setSelectedDate((prev) => nextAllowedDate(prev, -1, extendedSchedule))}
                >
                  ◀
                </button>

                <input
                  type="date"
                  value={selectedDate}
                  style={dateInputStyle}
                  onChange={(e) => setSelectedDate(normalizeDate(e.target.value, extendedSchedule))}
                />

                <button
                  type="button"
                  className="secondary"
                  style={navButtonStyle}
                  onClick={() => setSelectedDate((prev) => nextAllowedDate(prev, 1, extendedSchedule))}
                >
                  ▶
                </button>

                <button
                  type="button"
                  className="secondary"
                  style={todayButtonStyle}
                  onClick={() => setSelectedDate(normalizeDate(getTodayKey(), extendedSchedule))}
                >
                  Hoy
                </button>
              </div>

              {!extendedSchedule ? <p className="muted">Domingos cerrados y sábados por la tarde deshabilitados.</p> : null}

              <form onSubmit={saveDay} className="grid-form">
                <label>
                  Ventas mañana
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!isEditing}
                    value={form.morning_sales}
                    onChange={(e) => setForm((prev) => ({ ...prev, morning_sales: e.target.value }))}
                  />
                </label>

                <label>
                  Ventas tarde
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!isEditing || isSaturdayAfternoonDisabled}
                    value={isSaturdayAfternoonDisabled ? '' : form.afternoon_sales}
                    onChange={(e) => setForm((prev) => ({ ...prev, afternoon_sales: e.target.value }))}
                  />
                </label>

                <label>
                  Clientes
                  <input
                    type="number"
                    min="0"
                    disabled={!isEditing}
                    value={form.customers}
                    onChange={(e) => setForm((prev) => ({ ...prev, customers: e.target.value }))}
                  />
                </label>

                <label>
                  Total ventas
                  <input type="text" readOnly value={money(totalSales)} />
                </label>

                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button type="submit" disabled={!isEditing}>Guardar</button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={unlockForEdit}
                    disabled={!selectedSale || isEditing}
                  >
                    Editar
                  </button>
                </div>
              </form>
            </div>

            <div className="card stack">
              <h2>Objetivo diario</h2>
              <p className="muted">{formatDate(selectedDate)} · Meta: {money(DAILY_TARGET)}</p>

              <div className="progress">
                <div
                  className="progress-bar"
                  style={{ width: `${Math.min((totalSales / DAILY_TARGET) * 100, 100)}%` }}
                />
              </div>

              <p>
                {totalSales >= DAILY_TARGET
                  ? 'Objetivo diario alcanzado'
                  : `Faltan ${money(Math.max(DAILY_TARGET - totalSales, 0))}`}
              </p>

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
                    {dailySales.slice().sort((a, b) => b.sale_date.localeCompare(a.sale_date)).map((item) => {
                      const missedTarget = item.total_sales < DAILY_TARGET
                      return (
                        <tr
                          key={item.id}
                          style={
                            missedTarget
                              ? {
                                  background: 'rgba(202, 138, 4, 0.16)',
                                  color: '#f8fafc',
                                }
                              : undefined
                          }
                        >
                          <td>{formatDate(item.sale_date)}</td>
                          <td>{money(item.morning_sales)}</td>
                          <td>{money(item.afternoon_sales)}</td>
                          <td>{money(item.total_sales)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'monthly' && user.role === 'admin' && (
          <section className="two-columns">
            <div className="card stack">
              <div style={{ ...rowStyle, marginBottom: '16px' }}>
                <button
                  type="button"
                  className="secondary"
                  style={navButtonStyle}
                  onClick={() => setSelectedMonth((prev) => addMonths(prev, -1))}
                >
                  ◀
                </button>

                <input
                  type="month"
                  value={selectedMonth}
                  style={monthInputStyle}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                />

                <button
                  type="button"
                  className="secondary"
                  style={navButtonStyle}
                  onClick={() => setSelectedMonth((prev) => addMonths(prev, 1))}
                >
                  ▶
                </button>

                <button
                  type="button"
                  className="secondary"
                  style={currentMonthButtonStyle}
                  onClick={() => setSelectedMonth(todayMonth)}
                >
                  Mes actual
                </button>
              </div>

              <h2>Gastos del mes</h2>
              {EXPENSE_CATEGORIES.map((category) => {
                const item = monthlyExpenses.find((expense) => expense.month_key === selectedMonth && expense.category === category)
                return (
                  <div key={category} className="expense-row">
                    <span>{category}</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={item?.amount || ''}
                      onBlur={(e) => saveExpense(category, e.target.value)}
                    />
                  </div>
                )
              })}
            </div>

            <div className="card stack">
              <h2>Resultado del mes</h2>
              <p>Mes: {getMonthLabel(selectedMonth)}</p>
              <p>Facturación: <strong>{money(viewedMonth.salesTotal)}</strong></p>
              <p>Gastos: <strong>{money(viewedMonth.expensesTotal)}</strong></p>
              <p>Balance: <strong>{money(viewedMonth.balance)}</strong></p>
              <div className="progress">
                <div className="progress-bar green" style={{ width: `${Math.min(viewedMonth.progress, 100)}%` }} />
              </div>
              <p>Progreso mensual: {viewedMonth.progress}% de {money(MONTHLY_TARGET)}</p>
            </div>
          </section>
        )}

        {activeTab === 'stats' && user.role === 'admin' && stats && (
          <section className="card stack">
            <h2>Estadísticas</h2>

            <div className="stats-grid">
              <div className="mini-card"><span className="muted">% días con objetivo</span><strong>{stats.daily_target_rate}%</strong></div>
              <div className="mini-card"><span className="muted">% meses con objetivo</span><strong>{stats.monthly_target_rate}%</strong></div>
              <div className="mini-card"><span className="muted">Día más fuerte</span><strong>{stats.best_weekday}</strong></div>
              <div className="mini-card"><span className="muted">Día más flojo</span><strong>{stats.worst_weekday}</strong></div>
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
                      <td>{money(item.balance)}</td>
                      <td>{item.target_progress_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {logsModalOpen ? (
        <div className="modal-backdrop" onClick={() => setLogsModalOpen(false)}>
          <div className="modal-panel logs-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ marginBottom: '4px' }}>Logs de actividad</h2>
                <p className="muted" style={{ margin: 0 }}>
                  Día y hora, ventas, clientes, total, usuario y acción realizada.
                </p>
              </div>

              <button
                type="button"
                className="secondary"
                onClick={() => setLogsModalOpen(false)}
              >
                Cerrar
              </button>
            </div>

            <div className="history-table logs-modal-table">
              <table>
                <thead>
                  <tr>
                    <th>Fecha y hora</th>
                    <th>Usuario</th>
                    <th>Día</th>
                    <th>Acción</th>
                    <th>Mañana</th>
                    <th>Tarde</th>
                    <th>Clientes</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {changeLogs.length === 0 ? (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center', padding: '18px' }}>
                        No hay logs disponibles.
                      </td>
                    </tr>
                  ) : (
                    changeLogs.map((item) => {
                      const total = Number(item.morning_sales || 0) + Number(item.afternoon_sales || 0)
                      return (
                        <tr key={item.id}>
                          <td>{formatDateTime(item.changed_at)}</td>
                          <td>{item.changed_by_display_name}</td>
                          <td>{formatDate(item.sale_date)}</td>
                          <td>{item.action}</td>
                          <td>{money(item.morning_sales)}</td>
                          <td>{money(item.afternoon_sales)}</td>
                          <td>{item.customers ?? '—'}</td>
                          <td>{money(total)}</td>
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
    </>
  )
}