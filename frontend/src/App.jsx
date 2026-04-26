import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./styles.css";
import { apiFetch, ApiError, getToken, setToken } from "./lib/api.js";

const DAILY_TARGET = 500;
const MONTHLY_TARGET = 12000;

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
  { key: "bonos", label: "Bonos" },
];

function emptyShift() {
  return { cash: "", card: "", bizum: "", bonos: "" };
}

function emptyCustomers() {
  return { cash: 0, card: 0, bizum: 0, bonos: 0 };
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("es-ES");
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

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function money(n) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(Number(n || 0));
}

function shiftAmountTotal(shift) {
  if (!shift) return 0;
  return num(shift.cash) + num(shift.card) + num(shift.bizum) + num(shift.bonos);
}

// Convierte un DailySale del backend al estado local (mañana/tarde con strings editables).
function saleToLocal(sale) {
  return {
    sale_date: sale.sale_date,
    morning: {
      cash: String(sale.morning_cash ?? ""),
      card: String(sale.morning_card ?? ""),
      bizum: String(sale.morning_bizum ?? ""),
      bonos: String(sale.morning_bonos ?? ""),
    },
    afternoon: {
      cash: String(sale.afternoon_cash ?? ""),
      card: String(sale.afternoon_card ?? ""),
      bizum: String(sale.afternoon_bizum ?? ""),
      bonos: String(sale.afternoon_bonos ?? ""),
    },
    morning_customers: {
      cash: sale.morning_cash_customers || 0,
      card: sale.morning_card_customers || 0,
      bizum: sale.morning_bizum_customers || 0,
      bonos: sale.morning_bonos_customers || 0,
    },
    afternoon_customers: {
      cash: sale.afternoon_cash_customers || 0,
      card: sale.afternoon_card_customers || 0,
      bizum: sale.afternoon_bizum_customers || 0,
      bonos: sale.afternoon_bonos_customers || 0,
    },
    worked: sale.worked ?? true,
    extended_schedule: sale.extended_schedule ?? false,
    total_sales: num(sale.total_sales),
    morning_total: num(sale.morning_total),
    afternoon_total: num(sale.afternoon_total),
    daily_expenses_total: num(sale.daily_expenses_total),
    daily_balance: num(sale.daily_balance),
  };
}

function emptyLocalSale(dateStr) {
  return {
    sale_date: dateStr,
    morning: emptyShift(),
    afternoon: emptyShift(),
    morning_customers: emptyCustomers(),
    afternoon_customers: emptyCustomers(),
    worked: !isSunday(dateStr),
    extended_schedule: false,
    total_sales: 0,
    morning_total: 0,
    afternoon_total: 0,
    daily_expenses_total: 0,
    daily_balance: 0,
  };
}

// ─────────────────────────────────────────────────
// Componentes
// ─────────────────────────────────────────────────

function StatCard({ title, value, hint }) {
  return (
    <div className="card kpi-card">
      <div className="kpi-label">{title}</div>
      <div className="kpi-value">{value}</div>
      {hint ? <div className="muted" style={{ fontSize: 12 }}>{hint}</div> : null}
    </div>
  );
}

function ShiftPanel({ title, accent, shift, disabled, onChange }) {
  const total = shiftAmountTotal(shift);
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

function LoginScreen({ onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setToken(res.access_token);
      const me = await apiFetch("/api/auth/me");
      onLoggedIn(me);
    } catch (err) {
      setError(err.message || "Error al iniciar sesión");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div>
          <div className="eyebrow">Zapatería · Control</div>
          <h1 style={{ marginTop: 8 }}>Acceso a la aplicación</h1>
          <p className="muted" style={{ marginTop: 6 }}>Introduce tu usuario y contraseña.</p>
        </div>
        <label>
          Usuario
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Iván / Claudia / Tienda" autoFocus />
        </label>
        <label>
          Contraseña
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" />
        </label>
        {error ? <div className="error-box">{error}</div> : null}
        <button type="submit" disabled={busy}>{busy ? "Entrando..." : "Entrar"}</button>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [globalError, setGlobalError] = useState("");
  const [loading, setLoading] = useState(false);

  const [tab, setTab] = useState("day");
  const [extendedSchedule, setExtendedScheduleState] = useState(false);

  // Estado de datos del backend
  const [allSales, setAllSales] = useState([]); // [DailySaleRead, ...] (todas)
  const [monthlyExpenses, setMonthlyExpenses] = useState([]); // [MonthlyExpenseRead, ...]

  // Día seleccionado y su forma editable
  const [selectedDate, setSelectedDate] = useState(getTodayKey());
  const [selectedSale, setSelectedSale] = useState(emptyLocalSale(getTodayKey()));
  const [dailyExpensesForDay, setDailyExpensesForDay] = useState([]);
  const [savingDay, setSavingDay] = useState(false);
  const [dayMessage, setDayMessage] = useState("");

  // Mes seleccionado para tab mensual
  const [selectedMonth, setSelectedMonth] = useState(getMonthKey(getTodayKey()));

  // Modal de gasto diario
  const [dailyExpenseModal, setDailyExpenseModal] = useState(null); // null | { id?, concept, amount }

  // Modal de gasto mensual
  const [monthlyExpenseModal, setMonthlyExpenseModal] = useState(null); // null | { category, amount }

  const todayKey = getTodayKey();
  const currentMonthKey = getMonthKey(todayKey);

  // ─── Autenticación inicial ───
  useEffect(() => {
    let alive = true;
    (async () => {
      const tk = getToken();
      if (!tk) { setAuthChecking(false); return; }
      try {
        const me = await apiFetch("/api/auth/me");
        if (alive) setCurrentUser(me);
      } catch {
        setToken(null);
      } finally {
        if (alive) setAuthChecking(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // ─── Carga inicial al loguearse ───
  const reloadAll = useCallback(async () => {
    setLoading(true);
    setGlobalError("");
    try {
      const [settings, sales, mExpenses] = await Promise.all([
        apiFetch("/api/settings"),
        apiFetch("/api/daily-sales"),
        apiFetch("/api/monthly-expenses"),
      ]);
      setExtendedScheduleState(!!settings?.extended_schedule_enabled);
      setAllSales(Array.isArray(sales) ? sales : []);
      setMonthlyExpenses(Array.isArray(mExpenses) ? mExpenses : []);
    } catch (err) {
      setGlobalError(err.message || "Error cargando datos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    reloadAll();
  }, [currentUser, reloadAll]);

  // ─── Cuando cambia el día seleccionado, reflejar venta + cargar gastos del día ───
  useEffect(() => {
    if (!currentUser) return;
    const found = allSales.find((s) => s.sale_date === selectedDate);
    setSelectedSale(found ? saleToLocal(found) : emptyLocalSale(selectedDate));
    setDayMessage("");
    let alive = true;
    (async () => {
      try {
        const list = await apiFetch(`/api/daily-expenses?sale_date=${encodeURIComponent(selectedDate)}`);
        if (alive) setDailyExpensesForDay(Array.isArray(list) ? list : []);
      } catch (err) {
        if (alive) setDailyExpensesForDay([]);
      }
    })();
    return () => { alive = false; };
  }, [selectedDate, allSales, currentUser]);

  const isSelectedDateSaturday = isSaturday(selectedDate);
  const isSelectedDateSunday = isSunday(selectedDate);
  const isAfternoonDisabled = !extendedSchedule && isSelectedDateSaturday;
  const isDateClosed = !extendedSchedule && isSelectedDateSunday;

  const morningTotal = shiftAmountTotal(selectedSale.morning);
  const afternoonTotal = isAfternoonDisabled ? 0 : shiftAmountTotal(selectedSale.afternoon);
  const selectedDayTotal = morningTotal + afternoonTotal;

  // KPIs del mes actual
  const monthlySalesByMonth = useMemo(() => {
    const m = {};
    for (const s of allSales) {
      const k = getMonthKey(s.sale_date);
      m[k] = (m[k] || 0) + num(s.total_sales);
    }
    return m;
  }, [allSales]);

  const monthlyExpensesByMonth = useMemo(() => {
    const m = {};
    for (const e of monthlyExpenses) {
      m[e.month_key] = (m[e.month_key] || 0) + num(e.amount);
    }
    return m;
  }, [monthlyExpenses]);

  const currentMonthSales = monthlySalesByMonth[currentMonthKey] || 0;
  const currentMonthExpenses = monthlyExpensesByMonth[currentMonthKey] || 0;
  const currentMonthBalance = currentMonthSales - currentMonthExpenses;

  // Mes visualizado
  const viewedMonthSales = monthlySalesByMonth[selectedMonth] || 0;
  const viewedMonthExpensesTotal = monthlyExpensesByMonth[selectedMonth] || 0;
  const viewedMonthBalance = viewedMonthSales - viewedMonthExpensesTotal;
  const viewedMonthExpenses = useMemo(
    () => monthlyExpenses.filter((e) => e.month_key === selectedMonth),
    [monthlyExpenses, selectedMonth]
  );

  // Desglose por método de pago en el mes visualizado
  const viewedMonthMethodTotals = useMemo(() => {
    const t = { cash: 0, card: 0, bizum: 0, bonos: 0 };
    for (const s of allSales) {
      if (getMonthKey(s.sale_date) !== selectedMonth) continue;
      t.cash += num(s.morning_cash) + num(s.afternoon_cash);
      t.card += num(s.morning_card) + num(s.afternoon_card);
      t.bizum += num(s.morning_bizum) + num(s.afternoon_bizum);
      t.bonos += num(s.morning_bonos) + num(s.afternoon_bonos);
    }
    return t;
  }, [allSales, selectedMonth]);

  // Stats globales
  const stats = useMemo(() => {
    const sortedSales = [...allSales].sort((a, b) => a.sale_date.localeCompare(b.sale_date));
    let daysMeetingTarget = 0;
    let morningWins = 0;
    let afternoonWins = 0;
    const weekdayTotals = {};
    const methodTotals = { cash: 0, card: 0, bizum: 0, bonos: 0 };
    const dailyData = sortedSales.map((s) => {
      const total = num(s.total_sales);
      const wd = getWeekdayName(s.sale_date);
      weekdayTotals[wd] = (weekdayTotals[wd] || 0) + total;
      if (total >= DAILY_TARGET) daysMeetingTarget += 1;
      if (num(s.morning_total) > num(s.afternoon_total)) morningWins += 1;
      if (num(s.afternoon_total) > num(s.morning_total)) afternoonWins += 1;
      methodTotals.cash += num(s.morning_cash) + num(s.afternoon_cash);
      methodTotals.card += num(s.morning_card) + num(s.afternoon_card);
      methodTotals.bizum += num(s.morning_bizum) + num(s.afternoon_bizum);
      methodTotals.bonos += num(s.morning_bonos) + num(s.afternoon_bonos);
      return {
        date: s.sale_date,
        fecha: formatDate(s.sale_date),
        weekday: wd,
        morning: num(s.morning_total),
        afternoon: num(s.afternoon_total),
        total,
        gastos: num(s.daily_expenses_total),
        balance: num(s.daily_balance),
        cumpleObjetivo: total >= DAILY_TARGET,
      };
    });

    const monthKeys = Array.from(new Set([
      ...Object.keys(monthlySalesByMonth),
      ...Object.keys(monthlyExpensesByMonth),
    ])).sort();
    let monthsMeetingTarget = 0;
    const monthlyData = monthKeys.map((k) => {
      const ventas = monthlySalesByMonth[k] || 0;
      const gastos = monthlyExpensesByMonth[k] || 0;
      const cumple = ventas >= MONTHLY_TARGET;
      if (cumple) monthsMeetingTarget += 1;
      return {
        monthKey: k,
        month: getMonthLabel(k),
        ventas,
        gastos,
        beneficio: ventas - gastos,
        cumpleObjetivo: cumple,
      };
    });

    const totalDays = dailyData.length;
    const totalMonthly = monthlyData.length;
    const grandTotal = methodTotals.cash + methodTotals.card + methodTotals.bizum + methodTotals.bonos;
    const wdEntries = Object.entries(weekdayTotals);
    const bestWeekday = wdEntries.sort((a, b) => b[1] - a[1])[0];
    const worstWeekday = wdEntries.sort((a, b) => a[1] - b[1])[0];

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
  }, [allSales, monthlySalesByMonth, monthlyExpensesByMonth]);

  // ─── Acciones ───
  const updateShiftField = (shift, methodKey, value) => {
    const clean = value.replace(/[^0-9.,]/g, "").replace(",", ".");
    setSelectedSale((prev) => ({
      ...prev,
      [shift]: { ...prev[shift], [methodKey]: clean },
    }));
  };

  const saveDay = async () => {
    setSavingDay(true);
    setDayMessage("");
    try {
      const payload = {
        sale_date: selectedDate,
        morning_cash: num(selectedSale.morning.cash),
        morning_card: num(selectedSale.morning.card),
        morning_bizum: num(selectedSale.morning.bizum),
        morning_bonos: num(selectedSale.morning.bonos),
        morning_cash_customers: selectedSale.morning_customers.cash || 0,
        morning_card_customers: selectedSale.morning_customers.card || 0,
        morning_bizum_customers: selectedSale.morning_customers.bizum || 0,
        morning_bonos_customers: selectedSale.morning_customers.bonos || 0,
        afternoon_cash: isAfternoonDisabled ? 0 : num(selectedSale.afternoon.cash),
        afternoon_card: isAfternoonDisabled ? 0 : num(selectedSale.afternoon.card),
        afternoon_bizum: isAfternoonDisabled ? 0 : num(selectedSale.afternoon.bizum),
        afternoon_bonos: isAfternoonDisabled ? 0 : num(selectedSale.afternoon.bonos),
        afternoon_cash_customers: selectedSale.afternoon_customers.cash || 0,
        afternoon_card_customers: selectedSale.afternoon_customers.card || 0,
        afternoon_bizum_customers: selectedSale.afternoon_customers.bizum || 0,
        afternoon_bonos_customers: selectedSale.afternoon_customers.bonos || 0,
        worked: !isDateClosed,
        extended_schedule: extendedSchedule,
      };
      const updated = await apiFetch("/api/daily-sales", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setAllSales((prev) => {
        const idx = prev.findIndex((s) => s.sale_date === updated.sale_date);
        if (idx === -1) return [...prev, updated];
        const copy = prev.slice();
        copy[idx] = updated;
        return copy;
      });
      setDayMessage("Guardado correctamente.");
    } catch (err) {
      setDayMessage(`Error al guardar: ${err.message}`);
    } finally {
      setSavingDay(false);
    }
  };

  const toggleExtendedSchedule = async (checked) => {
    try {
      const res = await apiFetch("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ extended_schedule_enabled: checked }),
      });
      setExtendedScheduleState(!!res.extended_schedule_enabled);
    } catch (err) {
      setGlobalError(err.message);
    }
  };

  const goToPreviousAllowedDay = () => setSelectedDate((p) => getNextAllowedDate(p, -1, extendedSchedule));
  const goToNextAllowedDay = () => setSelectedDate((p) => getNextAllowedDate(p, 1, extendedSchedule));
  const handleDateInputChange = (value) => {
    if (!value) return;
    if (!extendedSchedule && isSunday(value)) return;
    setSelectedDate(normalizeDateForSchedule(value, extendedSchedule));
  };

  // ─── Gastos diarios (CRUD) ───
  const openNewDailyExpense = () => setDailyExpenseModal({ concept: "", amount: "" });
  const openEditDailyExpense = (e) => setDailyExpenseModal({ id: e.id, concept: e.concept, amount: String(e.amount) });
  const closeDailyExpense = () => setDailyExpenseModal(null);

  const submitDailyExpense = async () => {
    if (!dailyExpenseModal) return;
    const concept = dailyExpenseModal.concept.trim();
    const amount = Number(String(dailyExpenseModal.amount).replace(",", "."));
    if (!concept || !Number.isFinite(amount) || amount < 0) {
      setDayMessage("Concepto e importe son obligatorios.");
      return;
    }
    try {
      if (dailyExpenseModal.id) {
        const updated = await apiFetch(`/api/daily-expenses/${dailyExpenseModal.id}`, {
          method: "PUT",
          body: JSON.stringify({ concept, amount }),
        });
        setDailyExpensesForDay((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      } else {
        const created = await apiFetch("/api/daily-expenses", {
          method: "POST",
          body: JSON.stringify({ sale_date: selectedDate, concept, amount }),
        });
        setDailyExpensesForDay((prev) => [created, ...prev]);
      }
      // El backend recalcula totales del día → recargo el día desde allSales
      const fresh = await apiFetch(`/api/daily-sales?date_from=${selectedDate}&date_to=${selectedDate}`);
      if (Array.isArray(fresh) && fresh[0]) {
        setAllSales((prev) => {
          const idx = prev.findIndex((s) => s.sale_date === fresh[0].sale_date);
          if (idx === -1) return [...prev, fresh[0]];
          const copy = prev.slice(); copy[idx] = fresh[0]; return copy;
        });
      }
      closeDailyExpense();
    } catch (err) {
      setDayMessage(`Error: ${err.message}`);
    }
  };

  const deleteDailyExpense = async (id) => {
    if (!confirm("¿Borrar este gasto?")) return;
    try {
      await apiFetch(`/api/daily-expenses/${id}`, { method: "DELETE" });
      setDailyExpensesForDay((prev) => prev.filter((e) => e.id !== id));
      const fresh = await apiFetch(`/api/daily-sales?date_from=${selectedDate}&date_to=${selectedDate}`);
      if (Array.isArray(fresh) && fresh[0]) {
        setAllSales((prev) => {
          const idx = prev.findIndex((s) => s.sale_date === fresh[0].sale_date);
          if (idx === -1) return [...prev, fresh[0]];
          const copy = prev.slice(); copy[idx] = fresh[0]; return copy;
        });
      }
    } catch (err) {
      setDayMessage(`Error al borrar: ${err.message}`);
    }
  };

  // ─── Gastos mensuales (upsert por categoría) ───
  const openMonthlyExpense = (existing) => {
    setMonthlyExpenseModal({
      category: existing?.category || "Otros",
      amount: existing ? String(existing.amount) : "",
    });
  };
  const closeMonthlyExpense = () => setMonthlyExpenseModal(null);
  const submitMonthlyExpense = async () => {
    if (!monthlyExpenseModal) return;
    const amount = Number(String(monthlyExpenseModal.amount).replace(",", "."));
    if (!monthlyExpenseModal.category || !Number.isFinite(amount) || amount < 0) return;
    try {
      const updated = await apiFetch("/api/monthly-expenses", {
        method: "PUT",
        body: JSON.stringify({
          month_key: selectedMonth,
          category: monthlyExpenseModal.category,
          amount,
        }),
      });
      setMonthlyExpenses((prev) => {
        const idx = prev.findIndex((e) => e.month_key === updated.month_key && e.category === updated.category);
        if (idx === -1) return [...prev, updated];
        const copy = prev.slice(); copy[idx] = updated; return copy;
      });
      closeMonthlyExpense();
    } catch (err) {
      setGlobalError(err.message);
    }
  };
  const deleteMonthlyExpense = async (existing) => {
    if (!confirm(`¿Quitar el gasto "${existing.category}" del mes? (se pone a 0)`)) return;
    try {
      const updated = await apiFetch("/api/monthly-expenses", {
        method: "PUT",
        body: JSON.stringify({
          month_key: existing.month_key,
          category: existing.category,
          amount: 0,
        }),
      });
      setMonthlyExpenses((prev) => prev.map((e) =>
        e.month_key === updated.month_key && e.category === updated.category ? updated : e
      ));
    } catch (err) {
      setGlobalError(err.message);
    }
  };

  const logout = () => {
    setToken(null);
    setCurrentUser(null);
    setAllSales([]);
    setMonthlyExpenses([]);
    setDailyExpensesForDay([]);
  };

  // ─── Render ───
  if (authChecking) {
    return <div className="center-screen"><div className="muted">Cargando...</div></div>;
  }

  if (!currentUser) {
    return <LoginScreen onLoggedIn={setCurrentUser} />;
  }

  const dailyProgress = Math.min((selectedDayTotal / DAILY_TARGET) * 100, 100);
  const monthlyProgress = Math.min((viewedMonthSales / MONTHLY_TARGET) * 100, 100);

  // Histórico ordenado para la tabla inferior
  const historyDesc = [...allSales].sort((a, b) => b.sale_date.localeCompare(a.sale_date));

  return (
    <div className="shell">
      <div className="card topbar">
        <div>
          <div className="eyebrow">Zapatería</div>
          <h1>Control de ventas, gastos y rentabilidad</h1>
          <div className="muted" style={{ marginTop: 4 }}>
            Hoy: {formatDate(todayKey)} · Usuario: {currentUser.display_name || currentUser.username}
          </div>
        </div>
        <div className="topbar-actions">
          <span className="kpi-label">{currentUser.role === "admin" ? "Administrador" : "Tienda"}</span>
          <button className="btn-logout" onClick={logout}>Salir</button>
        </div>
      </div>

      {globalError && (
        <div className="error-box dismissible-alert" style={{ marginBottom: 12 }}>
          <span>{globalError}</span>
          <button className="alert-close" onClick={() => setGlobalError("")}>×</button>
        </div>
      )}
      {loading && <div className="muted" style={{ marginBottom: 12 }}>Cargando datos del backend...</div>}

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
            <p className="muted">Datos guardados en PostgreSQL · Desglose por método de pago en mañana y tarde.</p>

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
                shift={selectedSale.morning}
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
                  shift={selectedSale.afternoon}
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

            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
              <button type="button" onClick={saveDay} disabled={savingDay || isDateClosed}>
                {savingDay ? "Guardando..." : "Guardar día"}
              </button>
              {dayMessage && <span className={dayMessage.startsWith("Error") ? "error-box" : "muted"} style={{ padding: "6px 10px" }}>{dayMessage}</span>}
            </div>
          </div>

          <div className="card">
            <h2>Objetivo diario</h2>
            <p className="muted">{formatDate(selectedDate)} · Meta {money(DAILY_TARGET)} · {Math.round((selectedDayTotal / DAILY_TARGET) * 100) || 0}%</p>
            <div className="progress" style={{ marginTop: 10 }}>
              <div className="progress-bar" style={{ width: `${dailyProgress}%` }} />
            </div>
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2>Gastos del día</h2>
                <p className="muted">{formatDate(selectedDate)}</p>
              </div>
              <button type="button" onClick={openNewDailyExpense}>+ Añadir gasto</button>
            </div>
            <table className="basic-table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th style={{ textAlign: "right" }}>Importe</th>
                  <th style={{ textAlign: "center" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {dailyExpensesForDay.length ? dailyExpensesForDay.map((e) => (
                  <tr key={e.id}>
                    <td><strong>{e.concept}</strong></td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{money(e.amount)}</td>
                    <td>
                      <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
                        <button type="button" className="secondary btn-sm" onClick={() => openEditDailyExpense(e)}>Editar</button>
                        <button type="button" className="btn-sm" style={{ background: "#dc2626", color: "#fff" }} onClick={() => deleteDailyExpense(e.id)}>Borrar</button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={3} className="muted" style={{ textAlign: "center", padding: 16 }}>
                    Sin gastos para este día.
                  </td></tr>
                )}
              </tbody>
            </table>
            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <strong>Total gastos día:</strong>
              <span style={{ fontWeight: 700 }}>
                {money(dailyExpensesForDay.reduce((s, e) => s + num(e.amount), 0))}
              </span>
            </div>
          </div>

          <div className="card">
            <h2>Histórico</h2>
            <p className="muted">Todos los días registrados (ordenados de más reciente a más antiguo).</p>
            <div style={{ maxHeight: 420, overflowY: "auto", marginTop: 8 }}>
              <table className="sales-table">
                <thead>
                  <tr>
                    <th rowSpan={2} className="date-col">Fecha</th>
                    <th rowSpan={2}>Día</th>
                    <th colSpan={5} className="morning-col">Mañana</th>
                    <th colSpan={5} className="afternoon-col">Tarde</th>
                    <th rowSpan={2} className="total-col">Total</th>
                    <th rowSpan={2} className="expense-col">Gastos</th>
                    <th rowSpan={2} className="balance-col">Balance</th>
                  </tr>
                  <tr>
                    <th className="morning-col">Efec.</th>
                    <th className="morning-col">Tarj.</th>
                    <th className="morning-col">Bizum</th>
                    <th className="morning-col">Bonos</th>
                    <th className="morning-col">Subt.</th>
                    <th className="afternoon-col">Efec.</th>
                    <th className="afternoon-col">Tarj.</th>
                    <th className="afternoon-col">Bizum</th>
                    <th className="afternoon-col">Bonos</th>
                    <th className="afternoon-col">Subt.</th>
                  </tr>
                </thead>
                <tbody>
                  {historyDesc.length ? historyDesc.map((s) => {
                    const balanceClass = num(s.daily_balance) >= 0 ? "balance-positive" : "balance-negative";
                    return (
                      <tr key={s.sale_date} onClick={() => setSelectedDate(s.sale_date)} style={{ cursor: "pointer" }}>
                        <td className="date-col">{formatDate(s.sale_date)}</td>
                        <td style={{ textTransform: "capitalize" }}>{getWeekdayName(s.sale_date)}</td>
                        <td className="morning-col">{money(s.morning_cash)}</td>
                        <td className="morning-col">{money(s.morning_card)}</td>
                        <td className="morning-col">{money(s.morning_bizum)}</td>
                        <td className="morning-col">{money(s.morning_bonos)}</td>
                        <td className="morning-col"><strong>{money(s.morning_total)}</strong></td>
                        <td className="afternoon-col">{money(s.afternoon_cash)}</td>
                        <td className="afternoon-col">{money(s.afternoon_card)}</td>
                        <td className="afternoon-col">{money(s.afternoon_bizum)}</td>
                        <td className="afternoon-col">{money(s.afternoon_bonos)}</td>
                        <td className="afternoon-col"><strong>{money(s.afternoon_total)}</strong></td>
                        <td className="total-col">{money(s.total_sales)}</td>
                        <td className="expense-col">{money(s.daily_expenses_total)}</td>
                        <td className={`balance-col ${balanceClass}`}>{money(s.daily_balance)}</td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan={15} className="muted" style={{ textAlign: "center", padding: 16 }}>
                      {loading ? "Cargando..." : "No hay datos en el backend."}
                    </td></tr>
                  )}
                </tbody>
              </table>
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
            <h2>Desglose por método de pago</h2>
            <div className="stats-grid" style={{ marginTop: 12 }}>
              {PAYMENT_METHODS.map((m) => {
                const v = viewedMonthMethodTotals[m.key] || 0;
                const pct = viewedMonthSales > 0 ? Math.round((v / viewedMonthSales) * 100) : 0;
                return <StatCard key={m.key} title={m.label} value={money(v)} hint={`${pct}% del total`} />;
              })}
            </div>
          </div>

          <div className="monthly-layout">
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2>Gastos mensuales (por categoría)</h2>
                <button type="button" onClick={() => openMonthlyExpense(null)}>+ Gastos</button>
              </div>
              <table className="basic-table">
                <thead>
                  <tr>
                    <th>Categoría</th>
                    <th style={{ textAlign: "right" }}>Importe</th>
                    <th style={{ textAlign: "center" }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {viewedMonthExpenses.length ? viewedMonthExpenses.map((e) => (
                    <tr key={`${e.month_key}-${e.category}`}>
                      <td><strong>{e.category}</strong></td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{money(e.amount)}</td>
                      <td>
                        <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
                          <button type="button" className="secondary btn-sm" onClick={() => openMonthlyExpense(e)}>Editar</button>
                          <button type="button" className="btn-sm" style={{ background: "#dc2626", color: "#fff" }} onClick={() => deleteMonthlyExpense(e)}>Borrar</button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={3} style={{ textAlign: "center", padding: 24 }} className="muted">
                      Aún no hay gastos mensuales. Pulsa "+ Gastos".
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
        </div>
      )}

      {/* Modal: gasto diario */}
      {dailyExpenseModal && (
        <div className="modal-backdrop" onClick={closeDailyExpense}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>{dailyExpenseModal.id ? "Editar gasto del día" : "Añadir gasto del día"}</h2>
                <p className="muted">{formatDate(selectedDate)}</p>
              </div>
              <button type="button" className="secondary btn-sm" onClick={closeDailyExpense}>✕</button>
            </div>
            <div className="modal-body">
              <label>
                Concepto
                <input
                  value={dailyExpenseModal.concept}
                  onChange={(e) => setDailyExpenseModal((p) => ({ ...p, concept: e.target.value }))}
                  placeholder="Ej. Compra material, factura..."
                  autoFocus
                />
              </label>
              <label>
                Importe
                <input
                  value={dailyExpenseModal.amount}
                  onChange={(e) => setDailyExpenseModal((p) => ({ ...p, amount: e.target.value.replace(/[^0-9.,]/g, "") }))}
                  placeholder="0.00"
                  inputMode="decimal"
                />
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button type="button" className="secondary" onClick={closeDailyExpense}>Cancelar</button>
                <button type="button" onClick={submitDailyExpense}>
                  {dailyExpenseModal.id ? "Guardar cambios" : "Añadir gasto"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: gasto mensual */}
      {monthlyExpenseModal && (
        <div className="modal-backdrop" onClick={closeMonthlyExpense}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Gasto mensual</h2>
                <p className="muted" style={{ textTransform: "capitalize" }}>{getMonthLabel(selectedMonth)}</p>
              </div>
              <button type="button" className="secondary btn-sm" onClick={closeMonthlyExpense}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-2col">
                <label>
                  Categoría
                  <select
                    value={monthlyExpenseModal.category}
                    onChange={(e) => setMonthlyExpenseModal((p) => ({ ...p, category: e.target.value }))}
                  >
                    {expenseCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label>
                  Importe
                  <input
                    value={monthlyExpenseModal.amount}
                    onChange={(e) => setMonthlyExpenseModal((p) => ({ ...p, amount: e.target.value.replace(/[^0-9.,]/g, "") }))}
                    placeholder="0.00"
                    inputMode="decimal"
                  />
                </label>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button type="button" className="secondary" onClick={closeMonthlyExpense}>Cancelar</button>
                <button type="button" onClick={submitMonthlyExpense}>Guardar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
