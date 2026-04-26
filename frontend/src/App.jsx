import React, { useEffect, useMemo, useState } from "react";
import "./styles.css";

const STORAGE_KEY = "zapateria_control_app_v1";
const DAILY_TARGET = 500;
const MONTHLY_TARGET = 12000;

const USERS = [
  { username: "Ivan", password: "Nicole@1", role: "admin", displayName: "Iván" },
  { username: "Claudia", password: "Nicole@1", role: "admin", displayName: "Claudia" },
  { username: "Tienda", password: "tienda", role: "store", displayName: "Tienda" },
];

const expenseCategories = [
  "Alquiler",
  "Internet",
  "Alarma",
  "Agua y luz",
  "Empleado 1",
  "Empleado 2",
  "Seguridad Social",
  "Otros",
];

const PAYMENT_METHODS = [
  { key: "cash", label: "Efectivo" },
  { key: "card", label: "Tarjeta" },
  { key: "bizum", label: "Bizum" },
  { key: "transfer", label: "Transferencia" },
];

const EMPTY_SHIFT = { cash: "", card: "", bizum: "", transfer: "" };

function formatDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("es-ES");
}

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getWeekdayIndex(dateStr) {
  return new Date(`${dateStr}T12:00:00`).getDay();
}

function isSunday(dateStr) { return getWeekdayIndex(dateStr) === 0; }
function isSaturday(dateStr) { return getWeekdayIndex(dateStr) === 6; }

function isWorkingDay(dateStr, extendedSchedule) {
  if (extendedSchedule) return true;
  return !isSunday(dateStr);
}

function getNextAllowedDate(dateStr, direction, extendedSchedule) {
  let nextDate = dateStr;
  do { nextDate = addDays(nextDate, direction); }
  while (!isWorkingDay(nextDate, extendedSchedule));
  return nextDate;
}

function normalizeDateForSchedule(dateStr, extendedSchedule) {
  if (isWorkingDay(dateStr, extendedSchedule)) return dateStr;
  return getNextAllowedDate(dateStr, -1, extendedSchedule);
}

function getMonthKey(dateStr) { return dateStr.slice(0, 7); }

function getMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });
}

function addMonths(monthKey, delta) {
  const [year, month] = monthKey.split("-").map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getWeekdayName(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("es-ES", { weekday: "long" });
}

function amount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(n) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(Number(n || 0));
}

// ── Migración de turnos ─────────────────────────────────────
// Antes: morning/afternoon eran strings ("300"). Ahora son objetos
// con desglose por método de pago. Conservamos el dato vertiendo el
// total antiguo en "Efectivo" por defecto.
function migrateShift(value) {
  if (value == null) return { ...EMPTY_SHIFT };
  if (typeof value === "object" && !Array.isArray(value)) {
    return {
      cash: value.cash ?? "",
      card: value.card ?? "",
      bizum: value.bizum ?? "",
      transfer: value.transfer ?? "",
    };
  }
  const legacy = String(value);
  return { cash: legacy, card: "", bizum: "", transfer: "" };
}

function migrateSalesByDay(raw) {
  if (!raw || typeof raw !== "object") return {};
  const result = {};
  for (const [date, entry] of Object.entries(raw)) {
    result[date] = {
      morning: migrateShift(entry?.morning),
      afternoon: migrateShift(entry?.afternoon),
    };
  }
  return result;
}

function shiftTotal(shift) {
  if (!shift) return 0;
  return amount(shift.cash) + amount(shift.card) + amount(shift.bizum) + amount(shift.transfer);
}

function dayTotal(entry, opts = {}) {
  if (!entry) return 0;
  const morning = shiftTotal(entry.morning);
  const afternoon = opts.skipAfternoon ? 0 : shiftTotal(entry.afternoon);
  return morning + afternoon;
}

function createDefaultState() {
  const today = getTodayKey();
  return {
    salesByDay: {
      [today]: { morning: { ...EMPTY_SHIFT }, afternoon: { ...EMPTY_SHIFT } },
    },
    expensesByMonth: {},
    settings: { extendedSchedule: false },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    const parsed = JSON.parse(raw);
    return {
      ...createDefaultState(),
      ...parsed,
      salesByDay: migrateSalesByDay(parsed.salesByDay),
      settings: {
        ...createDefaultState().settings,
        ...(parsed.settings || {}),
      },
    };
  } catch {
    return createDefaultState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getMonthlySalesMap(salesByDay) {
  const result = {};
  for (const [date, entry] of Object.entries(salesByDay || {})) {
    const monthKey = getMonthKey(date);
    result[monthKey] = (result[monthKey] || 0) + dayTotal(entry);
  }
  return result;
}

function getMonthlyMethodMap(salesByDay) {
  // Devuelve por mes el desglose por método de pago.
  const result = {};
  for (const [date, entry] of Object.entries(salesByDay || {})) {
    const monthKey = getMonthKey(date);
    if (!result[monthKey]) result[monthKey] = { cash: 0, card: 0, bizum: 0, transfer: 0 };
    for (const m of PAYMENT_METHODS) {
      result[monthKey][m.key] += amount(entry?.morning?.[m.key]) + amount(entry?.afternoon?.[m.key]);
    }
  }
  return result;
}

function normalizeExpenseRecords(expenses) {
  if (!expenses) return [];
  if (Array.isArray(expenses)) {
    return expenses.filter(Boolean).map((expense, index) => ({
      id: expense.id || `expense-${Date.now()}-${index}`,
      category: expense.category || expense.concept || "Otros",
      description: expense.description || "",
      amount: String(expense.amount ?? expense.value ?? ""),
    }));
  }
  return Object.entries(expenses)
    .filter(([, value]) => amount(value) > 0)
    .map(([category, value]) => ({
      id: `legacy-${category}`,
      category,
      description: "",
      amount: String(value),
    }));
}

function getMonthlyExpensesTotal(expenses) {
  return normalizeExpenseRecords(expenses).reduce((sum, e) => sum + amount(e.amount), 0);
}

function getAllMonthKeys(state) {
  const salesMonths = Object.keys(getMonthlySalesMap(state.salesByDay || {}));
  const expenseMonths = Object.keys(state.expensesByMonth || {});
  return [...new Set([...salesMonths, ...expenseMonths])].sort();
}

function getStats(state) {
  const extendedSchedule = !!state.settings?.extendedSchedule;
  const salesEntries = Object.entries(state.salesByDay || {}).sort(([a], [b]) => a.localeCompare(b));
  const monthlySales = getMonthlySalesMap(state.salesByDay || {});
  const monthKeys = getAllMonthKeys(state);

  const monthlyData = monthKeys.map((monthKey) => {
    const sales = monthlySales[monthKey] || 0;
    const expenses = getMonthlyExpensesTotal(state.expensesByMonth?.[monthKey] || {});
    return {
      monthKey,
      month: getMonthLabel(monthKey),
      ventas: sales,
      gastos: expenses,
      beneficio: sales - expenses,
      cumpleObjetivo: sales >= MONTHLY_TARGET,
    };
  });

  let daysMeetingTarget = 0;
  let morningWins = 0;
  let afternoonWins = 0;
  const weekdayTotals = {};
  const methodTotals = { cash: 0, card: 0, bizum: 0, transfer: 0 };

  const dailyData = salesEntries.map(([date, entry]) => {
    const morning = shiftTotal(entry?.morning);
    const afternoon = !extendedSchedule && isSaturday(date) ? 0 : shiftTotal(entry?.afternoon);
    const total = morning + afternoon;
    const weekday = getWeekdayName(date);
    weekdayTotals[weekday] = (weekdayTotals[weekday] || 0) + total;
    if (total >= DAILY_TARGET) daysMeetingTarget += 1;
    if (morning > afternoon) morningWins += 1;
    if (afternoon > morning) afternoonWins += 1;
    for (const m of PAYMENT_METHODS) {
      methodTotals[m.key] += amount(entry?.morning?.[m.key]);
      if (extendedSchedule || !isSaturday(date)) {
        methodTotals[m.key] += amount(entry?.afternoon?.[m.key]);
      }
    }
    return {
      date,
      fecha: formatDate(date),
      weekday,
      morning,
      afternoon,
      total,
      cumpleObjetivo: total >= DAILY_TARGET,
    };
  });

  const bestWeekday = Object.entries(weekdayTotals).sort((a, b) => b[1] - a[1])[0];
  const worstWeekday = Object.entries(weekdayTotals).sort((a, b) => a[1] - b[1])[0];
  const totalDays = dailyData.length;
  const totalMonthly = monthlyData.length;
  const monthsMeetingTarget = monthlyData.filter((m) => m.cumpleObjetivo).length;
  const grandTotal = methodTotals.cash + methodTotals.card + methodTotals.bizum + methodTotals.transfer;

  return {
    dailyData,
    monthlyData,
    methodTotals,
    grandTotal,
    overview: {
      totalDays,
      totalMonthly,
      daysMeetingTarget,
      monthsMeetingTarget,
      dailyTargetRate: totalDays ? Math.round((daysMeetingTarget / totalDays) * 100) : 0,
      monthlyTargetRate: totalMonthly ? Math.round((monthsMeetingTarget / totalMonthly) * 100) : 0,
      bestWeekday: bestWeekday?.[0] || "—",
      worstWeekday: worstWeekday?.[0] || "—",
      bestWeekdayAmount: bestWeekday?.[1] || 0,
      worstWeekdayAmount: worstWeekday?.[1] || 0,
      morningWins,
      afternoonWins,
    },
  };
}

function StatCard({ title, value, hint }) {
  return (
    <div className="card kpi-card">
      <div className="kpi-label">{title}</div>
      <div className="kpi-value">{value}</div>
      {hint ? <div className="muted" style={{ fontSize: 12 }}>{hint}</div> : null}
    </div>
  );
}

function ShiftPanel({ title, shift, disabled, accent, onChange }) {
  const total = shiftTotal(shift);
  return (
    <div className={`form-block ${accent}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <span style={{ fontWeight: 700, color: "#67e8f9", fontSize: 18 }}>{money(total)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {PAYMENT_METHODS.map((m) => (
          <label key={m.key}>
            {m.label}
            <input
              value={shift?.[m.key] ?? ""}
              onChange={(e) => onChange(m.key, e.target.value)}
              placeholder="0.00"
              disabled={disabled}
              inputMode="decimal"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    const user = USERS.find((u) => u.username === username && u.password === password);
    if (!user) { setError("Usuario o contraseña incorrectos."); return; }
    setError("");
    onLogin(user);
  };

  return (
    <div className="center-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div>
          <div className="eyebrow">Zapatería · Control</div>
          <h1 style={{ marginTop: 8 }}>Acceso a la aplicación</h1>
          <p className="muted" style={{ marginTop: 6 }}>Selecciona el usuario e introduce la contraseña.</p>
        </div>
        <label>
          Usuario
          <select value={username} onChange={(e) => setUsername(e.target.value)}>
            <option value="">Selecciona un usuario</option>
            {USERS.map((u) => (
              <option key={u.username} value={u.username}>{u.displayName}</option>
            ))}
          </select>
        </label>
        <label>
          Contraseña
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Introduce la contraseña" />
        </label>
        {error ? <div className="error-box">{error}</div> : null}
        <button type="submit">Entrar</button>
      </form>
    </div>
  );
}

export default function App() {
  const [appState, setAppState] = useState(createDefaultState());
  const [currentUser, setCurrentUser] = useState(null);
  const [tab, setTab] = useState("day");
  const [selectedDate, setSelectedDate] = useState(getTodayKey());
  const [selectedMonth, setSelectedMonth] = useState(getMonthKey(getTodayKey()));
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [expenseForm, setExpenseForm] = useState({ category: "Otros", description: "", amount: "" });

  const todayKey = getTodayKey();
  const currentMonthKey = getMonthKey(todayKey);
  const extendedSchedule = !!appState.settings?.extendedSchedule;

  useEffect(() => {
    const loaded = loadState();
    setAppState(loaded);
    setSelectedDate((prev) => normalizeDateForSchedule(prev, !!loaded.settings?.extendedSchedule));
  }, []);

  useEffect(() => { saveState(appState); }, [appState]);

  useEffect(() => {
    setSelectedDate((prev) => normalizeDateForSchedule(prev, extendedSchedule));
  }, [extendedSchedule]);

  const selectedDayEntry = appState.salesByDay?.[selectedDate] || { morning: { ...EMPTY_SHIFT }, afternoon: { ...EMPTY_SHIFT } };
  const isSelectedDateSaturday = isSaturday(selectedDate);
  const isSelectedDateSunday = isSunday(selectedDate);
  const isAfternoonDisabled = !extendedSchedule && isSelectedDateSaturday;
  const isDateClosed = !extendedSchedule && isSelectedDateSunday;

  const morningTotal = shiftTotal(selectedDayEntry.morning);
  const afternoonTotal = isAfternoonDisabled ? 0 : shiftTotal(selectedDayEntry.afternoon);
  const selectedDayTotal = morningTotal + afternoonTotal;

  const viewedMonthExpenses = appState.expensesByMonth?.[selectedMonth] || [];
  const viewedMonthExpenseRecords = normalizeExpenseRecords(viewedMonthExpenses);
  const viewedMonthSales = getMonthlySalesMap(appState.salesByDay || {})[selectedMonth] || 0;
  const viewedMonthExpensesTotal = getMonthlyExpensesTotal(viewedMonthExpenses);
  const viewedMonthBalance = viewedMonthSales - viewedMonthExpensesTotal;
  const viewedMonthMethods = getMonthlyMethodMap(appState.salesByDay || {})[selectedMonth]
    || { cash: 0, card: 0, bizum: 0, transfer: 0 };

  const stats = useMemo(() => getStats(appState), [appState]);

  const monthlySalesMap = getMonthlySalesMap(appState.salesByDay || {});
  const currentMonthSales = monthlySalesMap[currentMonthKey] || 0;
  const currentMonthExpenses = getMonthlyExpensesTotal(appState.expensesByMonth?.[currentMonthKey] || {});
  const currentMonthBalance = currentMonthSales - currentMonthExpenses;

  const updateShiftField = (shift, methodKey, value) => {
    const clean = value.replace(/[^0-9.,]/g, "").replace(",", ".");
    setAppState((prev) => {
      const prevEntry = prev.salesByDay?.[selectedDate] || { morning: { ...EMPTY_SHIFT }, afternoon: { ...EMPTY_SHIFT } };
      return {
        ...prev,
        salesByDay: {
          ...prev.salesByDay,
          [selectedDate]: {
            ...prevEntry,
            [shift]: {
              ...(prevEntry[shift] || EMPTY_SHIFT),
              [methodKey]: clean,
            },
          },
        },
      };
    });
  };

  const openNewExpenseModal = () => {
    setEditingExpenseId(null);
    setExpenseForm({ category: "Otros", description: "", amount: "" });
    setIsExpenseModalOpen(true);
  };

  const openEditExpenseModal = (expense) => {
    setEditingExpenseId(expense.id);
    setExpenseForm({
      category: expense.category || "Otros",
      description: expense.description || "",
      amount: String(expense.amount || ""),
    });
    setIsExpenseModalOpen(true);
  };

  const closeExpenseModal = () => {
    setIsExpenseModalOpen(false);
    setEditingExpenseId(null);
    setExpenseForm({ category: "Otros", description: "", amount: "" });
  };

  const saveExpense = () => {
    const cleanAmount = String(expenseForm.amount || "").replace(/[^0-9.,]/g, "").replace(",", ".");
    if (!expenseForm.category || !cleanAmount || amount(cleanAmount) <= 0) return;
    setAppState((prev) => {
      const currentExpenses = normalizeExpenseRecords(prev.expensesByMonth?.[selectedMonth] || []);
      const nextExpense = {
        id: editingExpenseId || `expense-${Date.now()}`,
        category: expenseForm.category,
        description: expenseForm.description.trim(),
        amount: cleanAmount,
      };
      const nextExpenses = editingExpenseId
        ? currentExpenses.map((e) => (e.id === editingExpenseId ? nextExpense : e))
        : [...currentExpenses, nextExpense];
      return {
        ...prev,
        expensesByMonth: { ...prev.expensesByMonth, [selectedMonth]: nextExpenses },
      };
    });
    closeExpenseModal();
  };

  const deleteExpense = (expenseId) => {
    setAppState((prev) => {
      const currentExpenses = normalizeExpenseRecords(prev.expensesByMonth?.[selectedMonth] || []);
      return {
        ...prev,
        expensesByMonth: {
          ...prev.expensesByMonth,
          [selectedMonth]: currentExpenses.filter((e) => e.id !== expenseId),
        },
      };
    });
  };

  const toggleExtendedSchedule = (checked) => {
    setAppState((prev) => ({
      ...prev,
      settings: { ...(prev.settings || {}), extendedSchedule: checked },
    }));
  };

  const goToPreviousAllowedDay = () => setSelectedDate((p) => getNextAllowedDate(p, -1, extendedSchedule));
  const goToNextAllowedDay = () => setSelectedDate((p) => getNextAllowedDate(p, 1, extendedSchedule));

  const handleDateInputChange = (value) => {
    if (!value) return;
    if (!extendedSchedule && isSunday(value)) return;
    setSelectedDate(normalizeDateForSchedule(value, extendedSchedule));
  };

  if (!currentUser) return <LoginScreen onLogin={setCurrentUser} />;

  const dailyProgress = Math.min((selectedDayTotal / DAILY_TARGET) * 100, 100);
  const monthlyProgress = Math.min((viewedMonthSales / MONTHLY_TARGET) * 100, 100);

  return (
    <div className="shell">
      <div className="card topbar">
        <div>
          <div className="eyebrow">Zapatería</div>
          <h1>Control de ventas, gastos y rentabilidad</h1>
          <div className="muted" style={{ marginTop: 4 }}>
            Hoy: {formatDate(todayKey)} · Usuario: {currentUser.displayName}
          </div>
        </div>
        <div className="topbar-actions">
          <span className="kpi-label">{currentUser.role === "admin" ? "Administrador" : "Tienda"}</span>
          <button className="btn-logout" onClick={() => setCurrentUser(null)}>Salir</button>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard title="Ventas día seleccionado" value={money(selectedDayTotal)} hint={`${formatDate(selectedDate)} · Objetivo ${money(DAILY_TARGET)}`} />
        <StatCard title="Ventas mes actual" value={money(currentMonthSales)} hint={getMonthLabel(currentMonthKey)} />
        <StatCard title="Gastos mes actual" value={money(currentMonthExpenses)} hint="Acumulado mensual" />
        <StatCard title="Balance mes actual" value={money(currentMonthBalance)} hint={currentMonthBalance >= 0 ? "Resultado positivo" : "Resultado negativo"} />
      </div>

      <div className="tabs">
        <button className={tab === "day" ? "active" : ""} onClick={() => setTab("day")}>Resumen diario</button>
        {currentUser.role === "admin" && (
          <button className={tab === "month" ? "active" : ""} onClick={() => setTab("month")}>Resumen mensual</button>
        )}
        {currentUser.role === "admin" && (
          <button className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}>Estadísticas</button>
        )}
      </div>

      {tab === "day" && (
        <div className="stack">
          <div className="card">
            <h2>Registro de ventas por día</h2>
            <p className="muted">Desglose por método de pago en mañana y tarde. Los domingos se omiten salvo horario extendido.</p>

            {currentUser.role === "admin" && (
              <div className="section-block" style={{ marginTop: 16 }}>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    className="toggle-checkbox"
                    checked={extendedSchedule}
                    onChange={(e) => toggleExtendedSchedule(e.target.checked)}
                  />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                  Habilitar horario extendido (domingos y sábados tarde)
                </label>
              </div>
            )}

            <div className="date-nav" style={{ marginTop: 16 }}>
              <button type="button" className="secondary nav-btn" onClick={goToPreviousAllowedDay}>‹</button>
              <input type="date" className="date-input" value={selectedDate} onChange={(e) => handleDateInputChange(e.target.value)} />
              <button type="button" className="secondary nav-btn" onClick={goToNextAllowedDay}>›</button>
              <button type="button" className="secondary btn-sm" onClick={() => setSelectedDate(normalizeDateForSchedule(todayKey, extendedSchedule))}>Hoy</button>
              <button type="button" className="secondary btn-sm" onClick={() => setSelectedDate(normalizeDateForSchedule(addDays(todayKey, -7), extendedSchedule))}>-7d</button>
              <button type="button" className="secondary btn-sm" onClick={() => setSelectedDate(normalizeDateForSchedule(addDays(todayKey, -14), extendedSchedule))}>-14d</button>
            </div>

            {!extendedSchedule && (
              <div className="success-box" style={{ marginTop: 14, background: "rgba(245,158,11,0.12)", color: "#fbbf24", borderColor: "rgba(245,158,11,0.25)" }}>
                Horario normal: domingos omitidos y sábados tarde deshabilitada.
              </div>
            )}

            {isDateClosed && (
              <div className="error-box" style={{ marginTop: 12 }}>Este día está cerrado en horario normal.</div>
            )}

            <div className="form-2col" style={{ marginTop: 16 }}>
              <ShiftPanel
                title="Mañana"
                accent="morning"
                shift={selectedDayEntry.morning}
                disabled={isDateClosed}
                onChange={(method, value) => updateShiftField("morning", method, value)}
              />
              {isAfternoonDisabled ? (
                <div className="form-block">
                  <h3 style={{ margin: 0 }}>Tarde</h3>
                  <p className="muted" style={{ marginTop: 8 }}>Sábado tarde deshabilitado en horario normal.</p>
                </div>
              ) : (
                <ShiftPanel
                  title="Tarde"
                  accent="afternoon"
                  shift={selectedDayEntry.afternoon}
                  disabled={isDateClosed}
                  onChange={(method, value) => updateShiftField("afternoon", method, value)}
                />
              )}
            </div>

            <div className="totals-row" style={{ marginTop: 16 }}>
              <strong>Mañana:</strong><span>{money(morningTotal)}</span>
              <strong>Tarde:</strong><span>{money(afternoonTotal)}</span>
              <strong style={{ marginLeft: "auto" }}>Total día:</strong>
              <span style={{ fontSize: 22, color: "#67e8f9", fontWeight: 700 }}>{money(selectedDayTotal)}</span>
            </div>
          </div>

          <div className="card">
            <h2>Objetivo diario</h2>
            <p className="muted">{formatDate(selectedDate)} · Meta {money(DAILY_TARGET)} · {Math.round((selectedDayTotal / DAILY_TARGET) * 100) || 0}%</p>
            <div className="progress" style={{ marginTop: 10 }}>
              <div className="progress-bar" style={{ width: `${dailyProgress}%` }} />
            </div>
            <div style={{ marginTop: 10 }}>
              {selectedDayTotal >= DAILY_TARGET ? (
                <span className="success-box" style={{ display: "inline-block", padding: "4px 12px" }}>Objetivo diario alcanzado</span>
              ) : (
                <span className="muted">Faltan {money(Math.max(DAILY_TARGET - selectedDayTotal, 0))}</span>
              )}
            </div>
            <div className="muted" style={{ marginTop: 8, textTransform: "capitalize" }}>
              Día: {getWeekdayName(selectedDate)} · Mes: {getMonthLabel(getMonthKey(selectedDate))}
            </div>
          </div>
        </div>
      )}

      {tab === "month" && currentUser.role === "admin" && (
        <div className="stack">
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div className="kpi-label">Mes seleccionado</div>
                <div style={{ fontSize: 18, fontWeight: 700, textTransform: "capitalize" }}>{getMonthLabel(selectedMonth)}</div>
              </div>
              <div className="date-nav">
                <button type="button" className="secondary nav-btn" onClick={() => setSelectedMonth((p) => addMonths(p, -1))}>‹</button>
                <input type="month" className="date-input" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} />
                <button type="button" className="secondary nav-btn" onClick={() => setSelectedMonth((p) => addMonths(p, 1))}>›</button>
                <button type="button" className="secondary btn-sm" onClick={() => setSelectedMonth(currentMonthKey)}>Mes actual</button>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Desglose por método de pago — {getMonthLabel(selectedMonth)}</h2>
            <div className="stats-grid" style={{ marginTop: 12 }}>
              {PAYMENT_METHODS.map((m) => {
                const v = viewedMonthMethods[m.key] || 0;
                const pct = viewedMonthSales > 0 ? Math.round((v / viewedMonthSales) * 100) : 0;
                return <StatCard key={m.key} title={m.label} value={money(v)} hint={`${pct}% del total`} />;
              })}
            </div>
          </div>

          <div className="monthly-layout">
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2>Gastos del mes</h2>
                <button type="button" onClick={openNewExpenseModal}>+ Gastos</button>
              </div>
              <table className="basic-table">
                <thead>
                  <tr>
                    <th>Categoría</th>
                    <th>Detalle</th>
                    <th style={{ textAlign: "right" }}>Importe</th>
                    <th style={{ textAlign: "center" }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {viewedMonthExpenseRecords.length ? viewedMonthExpenseRecords.map((expense) => (
                    <tr key={expense.id}>
                      <td><strong>{expense.category}</strong></td>
                      <td className="muted">{expense.description || "—"}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{money(expense.amount)}</td>
                      <td>
                        <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
                          <button type="button" className="secondary btn-sm" onClick={() => openEditExpenseModal(expense)}>Editar</button>
                          <button type="button" className="btn-sm" style={{ background: "#dc2626", color: "#fff" }} onClick={() => deleteExpense(expense.id)}>Borrar</button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={4} style={{ textAlign: "center", padding: 24 }} className="muted">
                      Aún no hay gastos. Pulsa "+ Gastos" para añadir el primero.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="stack">
              <div className="card">
                <h2>Resultado del mes</h2>
                <div className="monthly-kpi-card" style={{ marginTop: 10 }}>
                  <span className="kpi-label">Facturación</span>
                  <strong style={{ fontSize: 22 }}>{money(viewedMonthSales)}</strong>
                </div>
                <div className="monthly-kpi-card" style={{ marginTop: 8 }}>
                  <span className="kpi-label">Gastos</span>
                  <strong style={{ fontSize: 22 }}>{money(viewedMonthExpensesTotal)}</strong>
                </div>
                <div className="monthly-kpi-card" style={{ marginTop: 8 }}>
                  <span className="kpi-label">Beneficio</span>
                  <strong style={{ fontSize: 26, color: viewedMonthBalance >= 0 ? "#86efac" : "#fca5a5" }}>
                    {money(viewedMonthBalance)}
                  </strong>
                </div>
              </div>

              <div className="card">
                <h2>Objetivo mensual</h2>
                <p className="muted">Meta {money(MONTHLY_TARGET)} · {Math.round((viewedMonthSales / MONTHLY_TARGET) * 100) || 0}%</p>
                <div className="progress" style={{ marginTop: 10 }}>
                  <div className="progress-bar green" style={{ width: `${monthlyProgress}%` }} />
                </div>
                <div style={{ marginTop: 10 }}>
                  {viewedMonthSales >= MONTHLY_TARGET ? (
                    <span className="success-box" style={{ display: "inline-block", padding: "4px 12px" }}>Objetivo alcanzado</span>
                  ) : (
                    <span className="muted">Faltan {money(Math.max(MONTHLY_TARGET - viewedMonthSales, 0))}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "stats" && currentUser.role === "admin" && (
        <div className="stack">
          <div className="stats-grid">
            <StatCard title="% días con objetivo" value={`${stats.overview.dailyTargetRate}%`} hint={`${stats.overview.daysMeetingTarget} días`} />
            <StatCard title="% meses con objetivo" value={`${stats.overview.monthlyTargetRate}%`} hint={`${stats.overview.monthsMeetingTarget} meses`} />
            <StatCard title="Día más fuerte" value={stats.overview.bestWeekday} hint={money(stats.overview.bestWeekdayAmount)} />
            <StatCard title="Día más débil" value={stats.overview.worstWeekday} hint={money(stats.overview.worstWeekdayAmount)} />
          </div>

          <div className="card">
            <h2>Total histórico por método de pago</h2>
            <div className="stats-grid" style={{ marginTop: 12 }}>
              {PAYMENT_METHODS.map((m) => {
                const v = stats.methodTotals[m.key] || 0;
                const pct = stats.grandTotal > 0 ? Math.round((v / stats.grandTotal) * 100) : 0;
                return <StatCard key={m.key} title={m.label} value={money(v)} hint={`${pct}% del total`} />;
              })}
            </div>
          </div>

          <div className="card">
            <h2>Mañana vs tarde</h2>
            <div style={{ display: "flex", gap: 24, marginTop: 12 }}>
              <div>
                <div className="kpi-label">Mañana gana</div>
                <div className="kpi-value">{stats.overview.morningWins}</div>
              </div>
              <div>
                <div className="kpi-label">Tarde gana</div>
                <div className="kpi-value">{stats.overview.afternoonWins}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Histórico mensual</h2>
            <table className="basic-table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Mes</th>
                  <th style={{ textAlign: "right" }}>Ventas</th>
                  <th style={{ textAlign: "right" }}>Gastos</th>
                  <th style={{ textAlign: "right" }}>Beneficio</th>
                </tr>
              </thead>
              <tbody>
                {stats.monthlyData.length ? stats.monthlyData.map((m) => (
                  <tr key={m.monthKey}>
                    <td style={{ textTransform: "capitalize" }}>{m.month}</td>
                    <td style={{ textAlign: "right" }}>{money(m.ventas)}</td>
                    <td style={{ textAlign: "right" }}>{money(m.gastos)}</td>
                    <td style={{ textAlign: "right", color: m.beneficio >= 0 ? "#86efac" : "#fca5a5", fontWeight: 700 }}>
                      {money(m.beneficio)}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 16 }}>Sin datos.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Histórico diario</h2>
            <p className="muted">Objetivo {money(DAILY_TARGET)}</p>
            <div style={{ maxHeight: 360, overflowY: "auto", marginTop: 8 }}>
              <table className="basic-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Día</th>
                    <th style={{ textAlign: "right" }}>Mañana</th>
                    <th style={{ textAlign: "right" }}>Tarde</th>
                    <th style={{ textAlign: "right" }}>Total</th>
                    <th>Objetivo</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.dailyData.length ? stats.dailyData.map((row) => (
                    <tr key={row.date}>
                      <td>{row.fecha}</td>
                      <td style={{ textTransform: "capitalize" }}>{row.weekday}</td>
                      <td style={{ textAlign: "right" }}>{money(row.morning)}</td>
                      <td style={{ textAlign: "right" }}>{money(row.afternoon)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{money(row.total)}</td>
                      <td>{row.cumpleObjetivo ? "✓" : "—"}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 16 }}>Sin datos.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {isExpenseModalOpen && (
        <div className="modal-backdrop" onClick={closeExpenseModal}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>{editingExpenseId ? "Editar gasto" : "Añadir nuevo gasto"}</h2>
                <p className="muted" style={{ textTransform: "capitalize" }}>{getMonthLabel(selectedMonth)}</p>
              </div>
              <button type="button" className="secondary btn-sm" onClick={closeExpenseModal}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-2col">
                <label>
                  Categoría
                  <select
                    value={expenseForm.category}
                    onChange={(e) => setExpenseForm((p) => ({ ...p, category: e.target.value }))}
                  >
                    {expenseCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label>
                  Importe
                  <input
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm((p) => ({ ...p, amount: e.target.value.replace(/[^0-9.,]/g, "") }))}
                    placeholder="0.00"
                  />
                </label>
              </div>
              <label>
                Detalle / proveedor
                <input
                  value={expenseForm.description}
                  onChange={(e) => setExpenseForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Ej. Pago proveedor calzado, factura, alquiler..."
                />
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button type="button" className="secondary" onClick={closeExpenseModal}>Cancelar</button>
                <button type="button" onClick={saveExpense}>
                  {editingExpenseId ? "Guardar cambios" : "Añadir gasto"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
