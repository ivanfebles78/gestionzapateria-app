import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import { apiDownload, apiFetch, apiBlob, ApiError, getToken, setToken } from "./lib/api.js";

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
  "Asociacion Vecinos Santa Cruz",
  "Pago a proveedor",
  "Otros",
];

const PROVIDER_CATEGORY = "Pago a proveedor";

const PAYMENT_METHODS = [
  { key: "cash", label: "Efectivo" },
  { key: "card", label: "Tarjeta" },
  { key: "bizum", label: "Bizum" },
  { key: "bonos", label: "Bonos" },
];

const ATTACHMENT_KINDS = [
  { key: "ticket_manana", label: "Ticket mañana" },
  { key: "ticket_cierre", label: "Ticket cierre" },
  { key: "gasto", label: "Gasto" },
  { key: "otro", label: "Otro" },
];
const ATTACHMENT_KIND_LABEL = Object.fromEntries(ATTACHMENT_KINDS.map((k) => [k.key, k.label]));

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
  return getNextAllowedDate(dateStr, 1, extendedSchedule);
}

function getLatestSelectableDate(extendedSchedule) {
  const today = getTodayKey();
  if (isWorkingDay(today, extendedSchedule)) return today;
  let d = today;
  while (!isWorkingDay(d, extendedSchedule)) d = addDays(d, -1);
  return d;
}

function clampToToday(dateStr, extendedSchedule) {
  const max = getLatestSelectableDate(extendedSchedule);
  let normalized = normalizeDateForSchedule(dateStr, extendedSchedule);
  if (normalized > max) return max;
  return normalized;
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

// Redondea a 2 decimales evitando los artefactos clásicos de coma flotante
// (p.ej. 23.45 + 45.67 = 69.11999999999999 → 69.12).
function round2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function money(n) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(round2(Number(n || 0)));
}

function shiftAmountTotal(shift) {
  if (!shift) return 0;
  return num(shift.cash) + num(shift.card) + num(shift.bizum) + num(shift.bonos);
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// Convierte un DailySale del backend al estado local. El "cierre" se calcula
// sumando mañana + tarde (lo que ve el usuario en el TPV al final del día).
function saleToLocal(sale) {
  const morning = {
    cash: String(sale.morning_cash ?? ""),
    card: String(sale.morning_card ?? ""),
    bizum: String(sale.morning_bizum ?? ""),
    bonos: String(sale.morning_bonos ?? ""),
  };
  const afternoon = {
    cash: String(sale.afternoon_cash ?? ""),
    card: String(sale.afternoon_card ?? ""),
    bizum: String(sale.afternoon_bizum ?? ""),
    bonos: String(sale.afternoon_bonos ?? ""),
  };
  // Solo prerellenamos el cierre si ya había datos de tarde guardados; así, al
  // entrar a un día con solo mañana, el campo queda vacío esperando los
  // totales del TPV al final de la jornada.
  const afternoonHasContent =
    num(sale.afternoon_cash) || num(sale.afternoon_card) || num(sale.afternoon_bizum) || num(sale.afternoon_bonos);
  const closing = afternoonHasContent
    ? {
        cash: String(round2(num(sale.morning_cash) + num(sale.afternoon_cash))),
        card: String(round2(num(sale.morning_card) + num(sale.afternoon_card))),
        bizum: String(round2(num(sale.morning_bizum) + num(sale.afternoon_bizum))),
        bonos: String(round2(num(sale.morning_bonos) + num(sale.afternoon_bonos))),
      }
    : emptyShift();
  return {
    sale_date: sale.sale_date,
    morning,
    afternoon,
    closing,
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
    is_holiday: !!sale.is_holiday,
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
    closing: emptyShift(),
    morning_customers: emptyCustomers(),
    afternoon_customers: emptyCustomers(),
    worked: !isSunday(dateStr),
    extended_schedule: false,
    is_holiday: false,
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

function MorningPanel({ shift, customers, disabled, onChangeAmount, onChangeCustomers }) {
  const total = shiftAmountTotal(shift);
  const customersTotal = (customers?.cash || 0) + (customers?.card || 0) + (customers?.bizum || 0) + (customers?.bonos || 0);
  return (
    <div className="form-block morning">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
        <h3 style={{ margin: 0 }}>Mañana</h3>
        <span style={{ fontWeight: 700, color: "#67e8f9", fontSize: 18 }}>
          {money(total)} <span style={{ color: "var(--muted)", fontSize: 13, fontWeight: 500 }}>· {customersTotal} cliente{customersTotal === 1 ? "" : "s"}</span>
        </span>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {PAYMENT_METHODS.map((m) => (
          <div key={m.key} style={{ display: "grid", gridTemplateColumns: "100px 1fr 90px", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>{m.label}</span>
            <input
              value={shift?.[m.key] ?? ""}
              onChange={(e) => onChangeAmount(m.key, e.target.value)}
              placeholder="0.00 €"
              disabled={disabled}
              inputMode="decimal"
              aria-label={`Importe ${m.label}`}
            />
            <input
              value={customers?.[m.key] ?? 0}
              onChange={(e) => onChangeCustomers(m.key, e.target.value)}
              placeholder="0"
              disabled={disabled}
              inputMode="numeric"
              aria-label={`Clientes ${m.label}`}
              title="Nº de clientes"
              style={{ textAlign: "center" }}
            />
          </div>
        ))}
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 90px", gap: 8, fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          <span></span>
          <span>Importe</span>
          <span style={{ textAlign: "center" }}>Clientes</span>
        </div>
      </div>
    </div>
  );
}

// Cierre del día: el usuario introduce los TOTALES del día (tal y como los da el TPV).
// La tarde se calcula automáticamente como cierre − mañana, por método de pago.
function ClosingPanel({ closing, morning, afternoonCustomers, disabled, onChangeClosing, onChangeAfternoonCustomers, errorByMethod }) {
  const totalClosing = shiftAmountTotal(closing);
  const totalMorning = shiftAmountTotal(morning);
  const derivedAfternoon = Math.max(0, totalClosing - totalMorning);
  const afternoonCustomersTotal = (afternoonCustomers?.cash || 0) + (afternoonCustomers?.card || 0) + (afternoonCustomers?.bizum || 0) + (afternoonCustomers?.bonos || 0);

  return (
    <div className="form-block afternoon">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, flexWrap: "wrap", gap: 6 }}>
        <h3 style={{ margin: 0 }}>Cierre del día (totales del TPV)</h3>
        <span style={{ fontWeight: 700, color: "#67e8f9", fontSize: 18 }}>
          {money(totalClosing)}
        </span>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        Introduce el total del día por método (mañana + tarde). La tarde se calcula automáticamente.
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        {PAYMENT_METHODS.map((m) => {
          const closingVal = num(closing?.[m.key]);
          const morningVal = num(morning?.[m.key]);
          const derived = closingVal - morningVal;
          const hasError = !!errorByMethod?.[m.key];
          return (
            <div key={m.key} style={{ display: "grid", gridTemplateColumns: "100px 1fr 90px", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>{m.label}</span>
              <div>
                <input
                  value={closing?.[m.key] ?? ""}
                  onChange={(e) => onChangeClosing(m.key, e.target.value)}
                  placeholder="Total del día"
                  disabled={disabled}
                  inputMode="decimal"
                  aria-label={`Cierre ${m.label}`}
                  style={hasError ? { borderColor: "rgba(248,113,113,0.6)" } : undefined}
                />
                <div className={hasError ? "muted" : "muted"} style={{ fontSize: 11, marginTop: 4, color: hasError ? "#fca5a5" : "var(--muted)" }}>
                  {hasError
                    ? `El cierre no puede ser menor que la mañana (${money(morningVal)})`
                    : `Tarde calculada: ${money(Math.max(0, derived))}`}
                </div>
              </div>
              <input
                value={afternoonCustomers?.[m.key] ?? 0}
                onChange={(e) => onChangeAfternoonCustomers(m.key, e.target.value)}
                placeholder="0"
                disabled={disabled}
                inputMode="numeric"
                aria-label={`Clientes tarde ${m.label}`}
                title="Nº de clientes de la tarde"
                style={{ textAlign: "center" }}
              />
            </div>
          );
        })}
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 90px", gap: 8, fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          <span></span>
          <span>Total día (TPV)</span>
          <span style={{ textAlign: "center" }}>Clientes tarde</span>
        </div>
      </div>
      <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(34,211,238,0.06)", borderRadius: 8, fontSize: 13 }}>
        <strong>Tarde total: </strong>
        <span style={{ color: "#67e8f9", fontWeight: 700 }}>{money(derivedAfternoon)}</span>
        <span className="muted" style={{ marginLeft: 8 }}>· {afternoonCustomersTotal} cliente{afternoonCustomersTotal === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}

const LOGIN_OPTIONS = [
  { username: "Ivan", label: "Iván" },
  { username: "Claudia", label: "Claudia" },
  { username: "Tienda", label: "Tienda" },
];

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
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
          <img className="logo-img" src="/logo-zapateria.png" alt="Zapatería" style={{ width: 160 }} />
        </div>
        <div style={{ textAlign: "center" }}>
          <div className="eyebrow">Zapatería · Control</div>
          <h1 style={{ marginTop: 8 }}>Acceso a la aplicación</h1>
          <p className="muted" style={{ marginTop: 6 }}>Selecciona el usuario e introduce la contraseña.</p>
        </div>
        <label>
          Usuario
          <select value={username} onChange={(e) => setUsername(e.target.value)} autoFocus>
            <option value="">Selecciona un usuario</option>
            {LOGIN_OPTIONS.map((u) => (
              <option key={u.username} value={u.username}>{u.label}</option>
            ))}
          </select>
        </label>
        <label>
          Contraseña
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" />
        </label>
        {error ? <div className="error-box">{error}</div> : null}
        <button type="submit" disabled={busy || !username}>{busy ? "Entrando..." : "Entrar"}</button>
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

  const [allSales, setAllSales] = useState([]);
  const [monthlyExpenses, setMonthlyExpenses] = useState([]);
  const [recurringTemplates, setRecurringTemplates] = useState([]);

  const [selectedDate, setSelectedDate] = useState(getTodayKey());
  const [selectedSale, setSelectedSale] = useState(emptyLocalSale(getTodayKey()));
  const [dailyExpensesForDay, setDailyExpensesForDay] = useState([]);
  const [attachmentsForDay, setAttachmentsForDay] = useState([]);
  const [savingDay, setSavingDay] = useState(false);
  const [dayMessage, setDayMessage] = useState("");

  // Cambios sin guardar en el formulario del día.
  const [dayDirty, setDayDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState(null); // { execute: () => void }

  // Filtro del histórico por mes ("" = todos).
  const [historyMonthFilter, setHistoryMonthFilter] = useState("");

  const [selectedMonth, setSelectedMonth] = useState(getMonthKey(getTodayKey()));

  const [dailyExpensesModalOpen, setDailyExpensesModalOpen] = useState(false);
  const [dailyExpenseDraft, setDailyExpenseDraft] = useState({ id: null, concept: "", amount: "" });
  const [dailyExpenseError, setDailyExpenseError] = useState("");

  const [monthlyExpenseModal, setMonthlyExpenseModal] = useState(null);

  const [attachmentModal, setAttachmentModal] = useState(null); // null | { kind, file }
  const [attachmentError, setAttachmentError] = useState("");
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const [recurringModal, setRecurringModal] = useState(null); // null | { id, category, amount, active }
  const [recurringError, setRecurringError] = useState("");

  const [exporting, setExporting] = useState(false);

  const [changeLogs, setChangeLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");

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

  useEffect(() => {
    setSelectedDate((prev) => clampToToday(prev, extendedSchedule));
  }, [extendedSchedule]);

  // Plantillas recurrentes (solo admin)
  const reloadRecurringTemplates = useCallback(async () => {
    if (!currentUser || currentUser.role !== "admin") return;
    try {
      const list = await apiFetch("/api/recurring-expenses");
      setRecurringTemplates(Array.isArray(list) ? list : []);
    } catch (err) {
      // No bloqueamos la app si no se pueden cargar.
    }
  }, [currentUser]);

  useEffect(() => {
    reloadRecurringTemplates();
  }, [reloadRecurringTemplates]);

  // Al cambiar de mes en la pestaña mensual, pedir el mes con month_key para
  // que el backend cree (si faltan) las filas de gastos recurrentes.
  useEffect(() => {
    if (!currentUser || currentUser.role !== "admin") return;
    if (tab !== "month") return;
    let alive = true;
    (async () => {
      try {
        const list = await apiFetch(`/api/monthly-expenses?month_key=${encodeURIComponent(selectedMonth)}`);
        if (!alive || !Array.isArray(list)) return;
        setMonthlyExpenses((prev) => {
          const others = prev.filter((e) => e.month_key !== selectedMonth);
          return [...others, ...list];
        });
      } catch (err) {
        // Sin ruido si falla; el usuario ya verá los datos al recargar.
      }
    })();
    return () => { alive = false; };
  }, [tab, selectedMonth, currentUser]);

  const reloadChangeLogs = useCallback(async () => {
    if (!currentUser || currentUser.role !== "admin") return;
    setLogsLoading(true);
    setLogsError("");
    try {
      const list = await apiFetch("/api/admin/change-logs?limit=200");
      setChangeLogs(Array.isArray(list) ? list : []);
    } catch (err) {
      setLogsError(err.message || "Error cargando registro de actividad");
    } finally {
      setLogsLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (tab === "logs") reloadChangeLogs();
  }, [tab, reloadChangeLogs]);

  // ─── Cuando cambia el día seleccionado: venta + gastos diarios + adjuntos ───
  useEffect(() => {
    if (!currentUser) return;
    const found = allSales.find((s) => s.sale_date === selectedDate);
    setSelectedSale(found ? saleToLocal(found) : emptyLocalSale(selectedDate));
    setDayMessage("");
    setDayDirty(false);
    let alive = true;
    (async () => {
      try {
        const [expenses, attachments] = await Promise.all([
          apiFetch(`/api/daily-expenses?sale_date=${encodeURIComponent(selectedDate)}`),
          apiFetch(`/api/daily-attachments?sale_date=${encodeURIComponent(selectedDate)}`),
        ]);
        if (!alive) return;
        setDailyExpensesForDay(Array.isArray(expenses) ? expenses : []);
        setAttachmentsForDay(Array.isArray(attachments) ? attachments : []);
      } catch (err) {
        if (alive) {
          setDailyExpensesForDay([]);
          setAttachmentsForDay([]);
        }
      }
    })();
    return () => { alive = false; };
  }, [selectedDate, allSales, currentUser]);

  const isSelectedDateSaturday = isSaturday(selectedDate);
  const isSelectedDateSunday = isSunday(selectedDate);
  const isHolidayMarked = !!selectedSale.is_holiday;
  const isSundayClosed = !extendedSchedule && isSelectedDateSunday;
  const isAfternoonDisabled = (!extendedSchedule && isSelectedDateSaturday) || isHolidayMarked;
  // isDateClosed deshabilita los inputs del formulario.
  const isDateClosed = isSundayClosed || isHolidayMarked;
  // En domingo cerrado no permitimos guardar (no hay registro de ventas posible).
  // En festivo SÍ permitimos guardar (queremos persistir la marca de festivo).
  const canSaveDay = !isSundayClosed;

  const morningTotal = shiftAmountTotal(selectedSale.morning);

  // Cierre y tarde derivada por método.
  const closingByMethod = selectedSale.closing || emptyShift();
  const closingErrorByMethod = useMemo(() => {
    if (isAfternoonDisabled || isDateClosed) return {};
    const errs = {};
    for (const m of PAYMENT_METHODS) {
      const morningV = num(selectedSale.morning?.[m.key]);
      const closingV = num(closingByMethod?.[m.key]);
      // Solo marcamos error si el cierre está rellenado y es menor que la mañana.
      const closingHasValue = (closingByMethod?.[m.key] ?? "").toString().trim() !== "";
      if (closingHasValue && closingV < morningV - 1e-9) errs[m.key] = true;
    }
    return errs;
  }, [closingByMethod, selectedSale.morning, isAfternoonDisabled, isDateClosed]);
  const hasClosingError = Object.keys(closingErrorByMethod).length > 0;

  const derivedAfternoonByMethod = useMemo(() => {
    const out = { cash: 0, card: 0, bizum: 0, bonos: 0 };
    if (isAfternoonDisabled || isDateClosed) return out;
    for (const m of PAYMENT_METHODS) {
      const morningV = num(selectedSale.morning?.[m.key]);
      const closingV = num(closingByMethod?.[m.key]);
      out[m.key] = round2(Math.max(0, closingV - morningV));
    }
    return out;
  }, [closingByMethod, selectedSale.morning, isAfternoonDisabled, isDateClosed]);

  const afternoonTotal = derivedAfternoonByMethod.cash + derivedAfternoonByMethod.card + derivedAfternoonByMethod.bizum + derivedAfternoonByMethod.bonos;
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

  const viewedMonthSales = monthlySalesByMonth[selectedMonth] || 0;
  const viewedMonthExpensesTotal = monthlyExpensesByMonth[selectedMonth] || 0;
  const viewedMonthBalance = viewedMonthSales - viewedMonthExpensesTotal;
  const viewedMonthExpenses = useMemo(
    () => monthlyExpenses.filter((e) => e.month_key === selectedMonth),
    [monthlyExpenses, selectedMonth]
  );

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

  // ─── Guarda de navegación con cambios sin guardar ───
  // Aviso del navegador al cerrar pestaña / refrescar.
  useEffect(() => {
    if (!dayDirty) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dayDirty]);

  // Cualquier acción de navegación interna pasa por aquí: si hay datos sin
  // guardar, se queda pendiente y mostramos el modal.
  const guardedNav = useCallback((action) => {
    if (dayDirty) {
      setPendingNav({ execute: action });
    } else {
      action();
    }
  }, [dayDirty]);

  const cancelPendingNav = () => setPendingNav(null);

  const discardAndContinue = () => {
    // Reseteamos el formulario a lo que hay en backend.
    const saved = allSales.find((s) => s.sale_date === selectedDate);
    setSelectedSale(saved ? saleToLocal(saved) : emptyLocalSale(selectedDate));
    setDayDirty(false);
    setDayMessage("");
    if (pendingNav) {
      pendingNav.execute();
      setPendingNav(null);
    }
  };

  const saveAndContinue = async () => {
    const ok = await saveDay();
    if (ok && pendingNav) {
      pendingNav.execute();
      setPendingNav(null);
    } else if (!ok) {
      // Error al guardar: cerramos el modal para que el usuario vea el mensaje
      // de error en la tarjeta del día y pueda corregir.
      setPendingNav(null);
    }
  };

  // ─── Acciones ───
  const updateMorningField = (methodKey, value) => {
    const clean = value.replace(/[^0-9.,]/g, "").replace(",", ".");
    setSelectedSale((prev) => ({
      ...prev,
      morning: { ...prev.morning, [methodKey]: clean },
    }));
    setDayDirty(true);
  };

  const updateClosingField = (methodKey, value) => {
    const clean = value.replace(/[^0-9.,]/g, "").replace(",", ".");
    setSelectedSale((prev) => ({
      ...prev,
      closing: { ...(prev.closing || emptyShift()), [methodKey]: clean },
    }));
    setDayDirty(true);
  };

  const updateCustomersField = (shift, methodKey, value) => {
    const clean = value.replace(/[^0-9]/g, "");
    const parsed = clean === "" ? 0 : parseInt(clean, 10);
    const customersKey = `${shift}_customers`;
    setSelectedSale((prev) => ({
      ...prev,
      [customersKey]: { ...(prev[customersKey] || emptyCustomers()), [methodKey]: parsed },
    }));
    setDayDirty(true);
  };

  const updateHolidayFlag = (checked) => {
    setSelectedSale((prev) => ({ ...prev, is_holiday: checked }));
    setDayDirty(true);
  };

  const saveDay = async () => {
    if (hasClosingError) {
      setDayMessage("Error: el cierre no puede ser inferior a la mañana en algún método.");
      return false;
    }
    setSavingDay(true);
    setDayMessage("");
    try {
      const afternoonPayload = isAfternoonDisabled
        ? { cash: 0, card: 0, bizum: 0, bonos: 0 }
        : derivedAfternoonByMethod;
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
        afternoon_cash: afternoonPayload.cash,
        afternoon_card: afternoonPayload.card,
        afternoon_bizum: afternoonPayload.bizum,
        afternoon_bonos: afternoonPayload.bonos,
        afternoon_cash_customers: selectedSale.afternoon_customers.cash || 0,
        afternoon_card_customers: selectedSale.afternoon_customers.card || 0,
        afternoon_bizum_customers: selectedSale.afternoon_customers.bizum || 0,
        afternoon_bonos_customers: selectedSale.afternoon_customers.bonos || 0,
        worked: !isDateClosed && !selectedSale.is_holiday,
        extended_schedule: extendedSchedule,
        is_holiday: !!selectedSale.is_holiday,
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
      setDayDirty(false);
      return true;
    } catch (err) {
      setDayMessage(`Error al guardar: ${err.message}`);
      return false;
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

  const maxSelectableDate = getLatestSelectableDate(extendedSchedule);
  const nextDateCandidate = getNextAllowedDate(selectedDate, 1, extendedSchedule);
  const canGoForward = nextDateCandidate <= maxSelectableDate;

  const goToPreviousAllowedDay = () =>
    guardedNav(() =>
      setSelectedDate((p) => getNextAllowedDate(p, -1, extendedSchedule))
    );
  const goToNextAllowedDay = () =>
    guardedNav(() => {
      setSelectedDate((p) => {
        const next = getNextAllowedDate(p, 1, extendedSchedule);
        return next > maxSelectableDate ? p : next;
      });
    });
  const handleDateInputChange = (value) => {
    if (!value) return;
    guardedNav(() => setSelectedDate(clampToToday(value, extendedSchedule)));
  };

  // ─── Gastos diarios ───
  const openDailyExpensesModal = async () => {
    setDailyExpenseDraft({ id: null, concept: "", amount: "" });
    setDailyExpenseError("");
    setDailyExpensesModalOpen(true);
    try {
      const refreshed = await apiFetch(`/api/daily-sales/${selectedDate}/recalculate`, { method: "POST" });
      if (refreshed) {
        setAllSales((prev) => {
          const idx = prev.findIndex((s) => s.sale_date === refreshed.sale_date);
          if (idx === -1) return [...prev, refreshed];
          const copy = prev.slice(); copy[idx] = refreshed; return copy;
        });
      }
    } catch {/* puede no existir aún el daily_sale */}
  };
  const closeDailyExpensesModal = () => {
    setDailyExpensesModalOpen(false);
    setDailyExpenseDraft({ id: null, concept: "", amount: "" });
    setDailyExpenseError("");
  };
  const startEditDailyExpense = (e) => {
    setDailyExpenseDraft({ id: e.id, concept: e.concept, amount: String(e.amount) });
    setDailyExpenseError("");
  };
  const cancelEditDailyExpense = () => {
    setDailyExpenseDraft({ id: null, concept: "", amount: "" });
    setDailyExpenseError("");
  };

  const refreshDayFromBackend = async () => {
    try {
      const fresh = await apiFetch(`/api/daily-sales?date_from=${selectedDate}&date_to=${selectedDate}`);
      if (Array.isArray(fresh) && fresh[0]) {
        setAllSales((prev) => {
          const idx = prev.findIndex((s) => s.sale_date === fresh[0].sale_date);
          if (idx === -1) return [...prev, fresh[0]];
          const copy = prev.slice(); copy[idx] = fresh[0]; return copy;
        });
      }
    } catch {}
  };

  const submitDailyExpenseDraft = async () => {
    const concept = dailyExpenseDraft.concept.trim();
    const amount = Number(String(dailyExpenseDraft.amount).replace(",", "."));
    if (!concept || !Number.isFinite(amount) || amount < 0) {
      setDailyExpenseError("Concepto e importe son obligatorios.");
      return;
    }
    setDailyExpenseError("");
    try {
      if (dailyExpenseDraft.id) {
        const updated = await apiFetch(`/api/daily-expenses/${dailyExpenseDraft.id}`, {
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
      await refreshDayFromBackend();
      setDailyExpenseDraft({ id: null, concept: "", amount: "" });
    } catch (err) {
      setDailyExpenseError(err.message || "Error al guardar");
    }
  };

  const deleteDailyExpense = async (id) => {
    if (!confirm("¿Borrar este gasto?")) return;
    try {
      await apiFetch(`/api/daily-expenses/${id}`, { method: "DELETE" });
      setDailyExpensesForDay((prev) => prev.filter((e) => e.id !== id));
      if (dailyExpenseDraft.id === id) {
        setDailyExpenseDraft({ id: null, concept: "", amount: "" });
      }
      await refreshDayFromBackend();
    } catch (err) {
      setDailyExpenseError(err.message || "Error al borrar");
    }
  };

  // ─── Gastos mensuales ───
  const openMonthlyExpense = (existing) => {
    setMonthlyExpenseModal({
      id: existing?.id ?? null,
      category: existing?.category || "Otros",
      name: existing?.name || "",
      amount: existing ? String(existing.amount) : "",
      error: "",
    });
  };
  const closeMonthlyExpense = () => setMonthlyExpenseModal(null);
  const submitMonthlyExpense = async () => {
    if (!monthlyExpenseModal) return;
    const amount = Number(String(monthlyExpenseModal.amount).replace(",", "."));
    if (!monthlyExpenseModal.category || !Number.isFinite(amount) || amount < 0) {
      setMonthlyExpenseModal((p) => ({ ...p, error: "Importe inválido." }));
      return;
    }
    const isProvider = monthlyExpenseModal.category === PROVIDER_CATEGORY;
    const name = isProvider ? (monthlyExpenseModal.name || "").trim() : "";
    if (isProvider && !name) {
      setMonthlyExpenseModal((p) => ({ ...p, error: "Indica el nombre del proveedor." }));
      return;
    }
    try {
      let updated;
      if (monthlyExpenseModal.id) {
        // Edición: PUT por id (no cambia categoría, sí name e importe).
        updated = await apiFetch(`/api/monthly-expenses/${monthlyExpenseModal.id}`, {
          method: "PUT",
          body: JSON.stringify({ name, amount }),
        });
      } else {
        updated = await apiFetch("/api/monthly-expenses", {
          method: "PUT",
          body: JSON.stringify({
            month_key: selectedMonth,
            category: monthlyExpenseModal.category,
            name,
            amount,
          }),
        });
      }
      setMonthlyExpenses((prev) => {
        const idx = prev.findIndex((e) => e.id === updated.id);
        if (idx === -1) return [...prev, updated];
        const copy = prev.slice(); copy[idx] = updated; return copy;
      });
      closeMonthlyExpense();
    } catch (err) {
      setMonthlyExpenseModal((p) => ({ ...p, error: err.message || "Error al guardar" }));
    }
  };
  const isFixedSlot = (entry) => {
    if (entry.name) return false;
    return recurringTemplates.some((t) => t.active && t.category === entry.category);
  };
  const deleteMonthlyExpense = async (existing) => {
    const fixed = isFixedSlot(existing);
    const label = existing.name ? `${existing.category} · ${existing.name}` : existing.category;
    const confirmMsg = fixed
      ? `¿Quitar el gasto "${label}" del mes? (se pone a 0; al recargar se volverá a sembrar con el importe de la plantilla)`
      : `¿Borrar el gasto "${label}" del mes?`;
    if (!confirm(confirmMsg)) return;
    try {
      if (fixed) {
        const updated = await apiFetch("/api/monthly-expenses", {
          method: "PUT",
          body: JSON.stringify({
            month_key: existing.month_key,
            category: existing.category,
            name: "",
            amount: 0,
          }),
        });
        setMonthlyExpenses((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      } else {
        await apiFetch(`/api/monthly-expenses/${existing.id}`, { method: "DELETE" });
        setMonthlyExpenses((prev) => prev.filter((e) => e.id !== existing.id));
      }
    } catch (err) {
      setGlobalError(err.message);
    }
  };

  // ─── Plantillas recurrentes ───
  const openRecurringModal = (existing) => {
    setRecurringModal({
      id: existing?.id ?? null,
      category: existing?.category || "",
      amount: existing ? String(existing.amount) : "",
      active: existing ? !!existing.active : true,
    });
    setRecurringError("");
  };
  const closeRecurringModal = () => {
    setRecurringModal(null);
    setRecurringError("");
  };
  const submitRecurringModal = async () => {
    if (!recurringModal) return;
    const category = (recurringModal.category || "").trim();
    const amount = Number(String(recurringModal.amount).replace(",", "."));
    if (!category || !Number.isFinite(amount) || amount < 0) {
      setRecurringError("Categoría e importe son obligatorios.");
      return;
    }
    try {
      const updated = await apiFetch("/api/recurring-expenses", {
        method: "PUT",
        body: JSON.stringify({ category, amount, active: !!recurringModal.active }),
      });
      setRecurringTemplates((prev) => {
        const idx = prev.findIndex((t) => t.category === updated.category);
        if (idx === -1) return [...prev, updated];
        const copy = prev.slice(); copy[idx] = updated; return copy;
      });
      closeRecurringModal();
    } catch (err) {
      setRecurringError(err.message || "Error al guardar la plantilla");
    }
  };
  const deleteRecurringTemplate = async (tpl) => {
    if (!confirm(`¿Borrar la plantilla "${tpl.category}"? Los meses ya guardados no se tocan.`)) return;
    try {
      await apiFetch(`/api/recurring-expenses/${tpl.id}`, { method: "DELETE" });
      setRecurringTemplates((prev) => prev.filter((t) => t.id !== tpl.id));
    } catch (err) {
      setGlobalError(err.message);
    }
  };

  // ─── Adjuntos ───
  const openAttachmentModal = () => {
    setAttachmentModal({ kind: "ticket_cierre", file: null });
    setAttachmentError("");
  };
  const closeAttachmentModal = () => {
    setAttachmentModal(null);
    setAttachmentError("");
    setAttachmentBusy(false);
  };
  const submitAttachment = async () => {
    if (!attachmentModal?.file) {
      setAttachmentError("Selecciona o haz una foto.");
      return;
    }
    setAttachmentBusy(true);
    setAttachmentError("");
    try {
      const fd = new FormData();
      fd.append("sale_date", selectedDate);
      fd.append("kind", attachmentModal.kind);
      fd.append("file", attachmentModal.file);
      const created = await apiFetch("/api/daily-attachments", { method: "POST", body: fd });
      setAttachmentsForDay((prev) => [created, ...prev]);
      closeAttachmentModal();
    } catch (err) {
      setAttachmentError(err.message || "Error al subir el adjunto");
    } finally {
      setAttachmentBusy(false);
    }
  };
  const deleteAttachment = async (att) => {
    if (!confirm(`¿Borrar el adjunto "${att.original_filename}"?`)) return;
    try {
      await apiFetch(`/api/daily-attachments/${att.id}`, { method: "DELETE" });
      setAttachmentsForDay((prev) => prev.filter((a) => a.id !== att.id));
    } catch (err) {
      setGlobalError(err.message);
    }
  };
  const viewAttachment = async (att) => {
    // Como el endpoint requiere Authorization, descargamos como blob y
    // abrimos un object URL en pestaña nueva para visualizar inline.
    try {
      const blob = await apiBlob(`/api/daily-attachments/${att.id}/file`);
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      // Liberamos el object URL un poco más tarde para no romper la pestaña.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (!win) {
        // Pop-up bloqueado: caemos a descarga.
        await apiDownload(`/api/daily-attachments/${att.id}/file`, att.original_filename);
      }
    } catch (err) {
      setGlobalError(err.message || "No se pudo abrir el adjunto");
    }
  };

  // ─── Exportaciones ───
  const exportSalesXlsx = async () => {
    setExporting(true);
    try {
      await apiDownload(
        `/api/exports/sales.xlsx?month_key=${encodeURIComponent(selectedMonth)}`,
        `ventas_${selectedMonth}.xlsx`,
      );
    } catch (err) {
      setGlobalError(err.message || "Error exportando ventas");
    } finally {
      setExporting(false);
    }
  };
  const exportAttachmentsZip = async () => {
    setExporting(true);
    try {
      await apiDownload(
        `/api/exports/attachments.zip?month_key=${encodeURIComponent(selectedMonth)}`,
        `adjuntos_${selectedMonth}.zip`,
      );
    } catch (err) {
      setGlobalError(err.message || "Error exportando adjuntos");
    } finally {
      setExporting(false);
    }
  };

  const performLogout = () => {
    setToken(null);
    setCurrentUser(null);
    setAllSales([]);
    setMonthlyExpenses([]);
    setDailyExpensesForDay([]);
    setAttachmentsForDay([]);
    setRecurringTemplates([]);
    setDayDirty(false);
  };
  const logout = () => guardedNav(performLogout);

  // Lista de meses disponibles para el filtro del histórico. Debe declararse
  // antes de los early returns para no romper el orden de hooks de React.
  const availableHistoryMonths = useMemo(() => {
    const set = new Set();
    for (const s of allSales) {
      if (!extendedSchedule && isSunday(s.sale_date)) continue;
      set.add(getMonthKey(s.sale_date));
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [allSales, extendedSchedule]);

  // ─── Render ───
  if (authChecking) {
    return <div className="center-screen"><div className="muted">Cargando...</div></div>;
  }

  if (!currentUser) {
    return <LoginScreen onLoggedIn={setCurrentUser} />;
  }

  const dailyProgress = Math.min((selectedDayTotal / DAILY_TARGET) * 100, 100);
  const monthlyProgress = Math.min((viewedMonthSales / MONTHLY_TARGET) * 100, 100);

  const historyDesc = [...allSales]
    .filter((s) => extendedSchedule || !isSunday(s.sale_date))
    .filter((s) => !historyMonthFilter || getMonthKey(s.sale_date) === historyMonthFilter)
    .sort((a, b) => b.sale_date.localeCompare(a.sale_date));

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
        <button className={tab === "day" ? "active" : ""} onClick={() => guardedNav(() => setTab("day"))}>Resumen diario</button>
        {currentUser.role === "admin" && (
          <button className={tab === "month" ? "active" : ""} onClick={() => guardedNav(() => setTab("month"))}>Resumen mensual</button>
        )}
        {currentUser.role === "admin" && (
          <button className={tab === "stats" ? "active" : ""} onClick={() => guardedNav(() => setTab("stats"))}>Estadísticas</button>
        )}
        {currentUser.role === "admin" && (
          <button className={tab === "logs" ? "active" : ""} onClick={() => guardedNav(() => setTab("logs"))}>Registro de actividad</button>
        )}
      </div>

      {tab === "day" && (
        <div className="stack">
          <div className="card">
            <h2>Registro de ventas por día</h2>
            <p className="muted">Introduce las ventas de la mañana y, al cerrar, los totales del TPV. La tarde se calcula sola.</p>

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

            <div style={{ marginTop: 16, fontSize: 20, fontWeight: 700, color: "#67e8f9", textTransform: "capitalize" }}>
              {getWeekdayName(selectedDate)} · {formatDate(selectedDate)}
            </div>
            <div className="date-nav" style={{ marginTop: 8 }}>
              <button type="button" className="secondary nav-btn" onClick={goToPreviousAllowedDay}>‹</button>
              <input
                type="date"
                className="date-input"
                value={selectedDate}
                onChange={(e) => handleDateInputChange(e.target.value)}
                max={maxSelectableDate}
                style={{ flex: "0 0 auto", width: 160 }}
              />
              <button type="button" className="secondary nav-btn" onClick={goToNextAllowedDay} disabled={!canGoForward} title={canGoForward ? "" : "No se pueden ver días futuros"}>›</button>
              <button type="button" className="secondary btn-sm" onClick={() => guardedNav(() => setSelectedDate(clampToToday(todayKey, extendedSchedule)))}>Hoy</button>
              <button type="button" className="secondary btn-sm" onClick={() => guardedNav(() => setSelectedDate(clampToToday(addDays(todayKey, -7), extendedSchedule)))}>-7d</button>
              <button type="button" className="secondary btn-sm" onClick={() => guardedNav(() => setSelectedDate(clampToToday(addDays(todayKey, -14), extendedSchedule)))}>-14d</button>
            </div>

            {!extendedSchedule && (
              <div className="success-box" style={{ marginTop: 14, background: "rgba(245,158,11,0.12)", color: "#fbbf24", borderColor: "rgba(245,158,11,0.25)" }}>
                Horario normal: domingos omitidos y sábados tarde deshabilitada.
              </div>
            )}
            {isSundayClosed && (
              <div className="error-box" style={{ marginTop: 12 }}>Este día está cerrado en horario normal.</div>
            )}

            {!isSundayClosed && (
              <div className="section-block" style={{ marginTop: 14 }}>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    className="toggle-checkbox"
                    checked={isHolidayMarked}
                    onChange={(e) => updateHolidayFlag(e.target.checked)}
                  />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                  Festivo (no se registran ventas este día)
                </label>
              </div>
            )}
            {isHolidayMarked && (
              <div className="success-box" style={{ marginTop: 8, background: "rgba(168,85,247,0.12)", color: "#d8b4fe", borderColor: "rgba(168,85,247,0.25)" }}>
                Día marcado como festivo. Al guardar se almacenarán los importes a 0 y se excluirá de las estadísticas.
              </div>
            )}

            <div className="form-2col" style={{ marginTop: 16 }}>
              <MorningPanel
                shift={selectedSale.morning}
                customers={selectedSale.morning_customers}
                disabled={isDateClosed}
                onChangeAmount={updateMorningField}
                onChangeCustomers={(method, value) => updateCustomersField("morning", method, value)}
              />
              {isAfternoonDisabled ? (
                <div className="form-block">
                  <h3 style={{ margin: 0 }}>Cierre del día</h3>
                  <p className="muted" style={{ marginTop: 8 }}>Sábado tarde deshabilitado en horario normal.</p>
                </div>
              ) : (
                <ClosingPanel
                  closing={selectedSale.closing}
                  morning={selectedSale.morning}
                  afternoonCustomers={selectedSale.afternoon_customers}
                  disabled={isDateClosed}
                  onChangeClosing={updateClosingField}
                  onChangeAfternoonCustomers={(method, value) => updateCustomersField("afternoon", method, value)}
                  errorByMethod={closingErrorByMethod}
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
              <button type="button" onClick={saveDay} disabled={savingDay || !canSaveDay || hasClosingError}>
                {savingDay ? "Guardando..." : "Guardar día"}
              </button>
              {hasClosingError && (
                <span className="error-box" style={{ padding: "6px 10px", marginBottom: 0 }}>
                  Revisa los totales del cierre: alguno es menor que la mañana.
                </span>
              )}
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2>Gastos del día</h2>
                <p className="muted">
                  {formatDate(selectedDate)} ·{" "}
                  {dailyExpensesForDay.length
                    ? `${dailyExpensesForDay.length} gasto${dailyExpensesForDay.length === 1 ? "" : "s"} · Total ${money(dailyExpensesForDay.reduce((s, e) => s + num(e.amount), 0))}`
                    : "Sin gastos registrados"}
                </p>
              </div>
              <button type="button" onClick={openDailyExpensesModal}>Gastos</button>
            </div>
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2>Adjuntos del día</h2>
                <p className="muted">
                  {formatDate(selectedDate)} ·{" "}
                  {attachmentsForDay.length
                    ? `${attachmentsForDay.length} archivo${attachmentsForDay.length === 1 ? "" : "s"}`
                    : "Sin adjuntos"}
                </p>
              </div>
              <button type="button" onClick={openAttachmentModal}>Adjuntar imagen</button>
            </div>
            {attachmentsForDay.length > 0 && (
              <div className="attachments-list" style={{ marginTop: 12 }}>
                {attachmentsForDay.map((att) => (
                  <div key={att.id} className="attachment-row">
                    <div className="attachment-meta">
                      <strong>{att.original_filename}</strong>
                      <span className="muted">
                        {ATTACHMENT_KIND_LABEL[att.kind] || att.kind} · {formatBytes(att.size_bytes)} · {new Date(att.created_at).toLocaleString("es-ES")}
                      </span>
                    </div>
                    <div className="attachment-actions">
                      <button type="button" className="secondary btn-sm" onClick={() => viewAttachment(att)}>Ver imagen</button>
                      <button type="button" className="btn-sm" style={{ background: "#dc2626", color: "#fff" }} onClick={() => deleteAttachment(att)}>Borrar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2>Histórico</h2>
                <p className="muted">
                  {historyMonthFilter
                    ? `${getMonthLabel(historyMonthFilter)} · ${historyDesc.length} día${historyDesc.length === 1 ? "" : "s"}`
                    : `Todos los días registrados · ${historyDesc.length} día${historyDesc.length === 1 ? "" : "s"}`}
                </p>
              </div>
              <label style={{ minWidth: 200 }}>
                Filtrar por mes
                <select
                  value={historyMonthFilter}
                  onChange={(e) => setHistoryMonthFilter(e.target.value)}
                >
                  <option value="">Todos los meses</option>
                  {availableHistoryMonths.map((mk) => (
                    <option key={mk} value={mk} style={{ textTransform: "capitalize" }}>{getMonthLabel(mk)}</option>
                  ))}
                </select>
              </label>
            </div>
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
                      <tr key={s.sale_date} onClick={() => guardedNav(() => setSelectedDate(s.sale_date))} style={{ cursor: "pointer", opacity: s.is_holiday ? 0.55 : 1 }}>
                        <td className="date-col">{formatDate(s.sale_date)}</td>
                        <td style={{ textTransform: "capitalize" }}>
                          {getWeekdayName(s.sale_date)}
                          {s.is_holiday && <span className="holiday-chip">Festivo</span>}
                        </td>
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
                <input type="month" className="date-input" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} style={{ flex: "0 0 auto", width: 160 }} />
                <button type="button" className="secondary nav-btn" onClick={() => setSelectedMonth((p) => addMonths(p, 1))}>›</button>
                <button type="button" className="secondary btn-sm" onClick={() => setSelectedMonth(currentMonthKey)}>Mes actual</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              <button type="button" onClick={exportSalesXlsx} disabled={exporting}>Exportar ventas (Excel)</button>
              <button type="button" className="secondary" onClick={exportAttachmentsZip} disabled={exporting}>Exportar imágenes (ZIP)</button>
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
              <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
                Las categorías fijas se rellenan automáticamente cada mes con el importe de la plantilla. Puedes editarlas aquí solo para este mes.
              </p>
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
                    <tr key={e.id}>
                      <td>
                        <strong>{e.category}</strong>
                        {e.name ? <span className="muted" style={{ marginLeft: 6 }}>· {e.name}</span> : null}
                      </td>
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

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <div>
                <h2>Plantillas de gastos fijos</h2>
                <p className="muted" style={{ fontSize: 13 }}>
                  Estas categorías se replican automáticamente en cada mes nuevo con el importe indicado.
                </p>
              </div>
              <button type="button" onClick={() => openRecurringModal(null)}>+ Plantilla</button>
            </div>
            <table className="basic-table">
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th style={{ textAlign: "right" }}>Importe</th>
                  <th style={{ textAlign: "center" }}>Activa</th>
                  <th style={{ textAlign: "center" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {recurringTemplates.length ? recurringTemplates.map((tpl) => (
                  <tr key={tpl.id}>
                    <td><strong>{tpl.category}</strong></td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{money(tpl.amount)}</td>
                    <td style={{ textAlign: "center" }}>{tpl.active ? "Sí" : "No"}</td>
                    <td>
                      <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
                        <button type="button" className="secondary btn-sm" onClick={() => openRecurringModal(tpl)}>Editar</button>
                        <button type="button" className="btn-sm" style={{ background: "#dc2626", color: "#fff" }} onClick={() => deleteRecurringTemplate(tpl)}>Borrar</button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={4} style={{ textAlign: "center", padding: 24 }} className="muted">
                    No hay plantillas configuradas todavía.
                  </td></tr>
                )}
              </tbody>
            </table>
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

      {tab === "logs" && currentUser.role === "admin" && (
        <div className="stack">
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2>Registro de actividad</h2>
                <p className="muted">Historial de creaciones y modificaciones de los días (últimos 200 registros).</p>
              </div>
              <button type="button" className="secondary btn-sm" onClick={reloadChangeLogs} disabled={logsLoading}>
                {logsLoading ? "Cargando..." : "Recargar"}
              </button>
            </div>
            {logsError && <div className="error-box" style={{ marginTop: 12 }}>{logsError}</div>}
            <div style={{ maxHeight: 560, overflowY: "auto", marginTop: 12 }}>
              <table className="basic-table">
                <thead>
                  <tr>
                    <th>Fecha y hora</th>
                    <th>Usuario</th>
                    <th>Acción</th>
                    <th>Día</th>
                    <th style={{ textAlign: "right" }}>Ventas</th>
                    <th style={{ textAlign: "right" }}>Gastos día</th>
                    <th style={{ textAlign: "right" }}>Balance</th>
                    <th style={{ textAlign: "right" }}>Clientes</th>
                  </tr>
                </thead>
                <tbody>
                  {changeLogs.length ? changeLogs.map((log) => {
                    const isCreate = log.action === "create";
                    const balance = num(log.daily_balance);
                    return (
                      <tr key={log.id}>
                        <td>{new Date(log.changed_at).toLocaleString("es-ES")}</td>
                        <td>{log.changed_by_display_name || "—"}</td>
                        <td>
                          <span className={isCreate ? "log-chip-create" : "log-chip-update"}>
                            {isCreate ? "create" : "update"}
                          </span>
                        </td>
                        <td>{formatDate(log.sale_date)}</td>
                        <td style={{ textAlign: "right" }}>{money(log.total_sales)}</td>
                        <td style={{ textAlign: "right" }}>{money(log.daily_expenses_total)}</td>
                        <td style={{ textAlign: "right", color: balance >= 0 ? "#86efac" : "#fca5a5", fontWeight: 700 }}>
                          {money(balance)}
                        </td>
                        <td style={{ textAlign: "right" }}>{log.customers_total ?? 0}</td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 24 }}>
                      {logsLoading ? "Cargando registro..." : "Sin actividad registrada."}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: gestión de gastos del día */}
      {dailyExpensesModalOpen && (
        <div className="modal-backdrop" onClick={closeDailyExpensesModal}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Gastos del día</h2>
                <p className="muted" style={{ textTransform: "capitalize" }}>{formatDate(selectedDate)} · {getWeekdayName(selectedDate)}</p>
              </div>
              <button type="button" className="secondary btn-sm" onClick={closeDailyExpensesModal}>✕</button>
            </div>
            <div className="modal-body">
              <div>
                <h3 style={{ marginBottom: 8 }}>Gastos registrados</h3>
                <table className="basic-table">
                  <thead>
                    <tr>
                      <th>Concepto</th>
                      <th style={{ textAlign: "right" }}>Importe</th>
                      <th style={{ textAlign: "center" }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyExpensesForDay.length ? dailyExpensesForDay.map((e) => (
                      <tr key={e.id} style={dailyExpenseDraft.id === e.id ? { background: "rgba(34,211,238,0.08)" } : undefined}>
                        <td><strong>{e.concept}</strong></td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{money(e.amount)}</td>
                        <td>
                          <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
                            <button type="button" className="secondary btn-sm" onClick={() => startEditDailyExpense(e)}>Editar</button>
                            <button type="button" className="btn-sm" style={{ background: "#dc2626", color: "#fff" }} onClick={() => deleteDailyExpense(e.id)}>Borrar</button>
                          </div>
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={3} className="muted" style={{ textAlign: "center", padding: 16 }}>
                        Aún no hay gastos para este día.
                      </td></tr>
                    )}
                  </tbody>
                </table>
                {dailyExpensesForDay.length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end", gap: 12 }}>
                    <strong>Total:</strong>
                    <span style={{ fontWeight: 700 }}>
                      {money(dailyExpensesForDay.reduce((s, e) => s + num(e.amount), 0))}
                    </span>
                  </div>
                )}
              </div>

              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                <h3 style={{ marginBottom: 8 }}>
                  {dailyExpenseDraft.id ? "Editar gasto" : "Añadir nuevo gasto"}
                </h3>
                <div className="form-2col">
                  <label>
                    Concepto
                    <input
                      value={dailyExpenseDraft.concept}
                      onChange={(e) => setDailyExpenseDraft((p) => ({ ...p, concept: e.target.value }))}
                      placeholder="Ej. Compra material, factura..."
                    />
                  </label>
                  <label>
                    Importe
                    <input
                      value={dailyExpenseDraft.amount}
                      onChange={(e) => setDailyExpenseDraft((p) => ({ ...p, amount: e.target.value.replace(/[^0-9.,]/g, "") }))}
                      placeholder="0.00"
                      inputMode="decimal"
                    />
                  </label>
                </div>
                {dailyExpenseError && <div className="error-box" style={{ marginTop: 10 }}>{dailyExpenseError}</div>}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
                  {dailyExpenseDraft.id && (
                    <button type="button" className="secondary" onClick={cancelEditDailyExpense}>Cancelar edición</button>
                  )}
                  <button type="button" onClick={submitDailyExpenseDraft}>
                    {dailyExpenseDraft.id ? "Guardar cambios" : "Añadir gasto"}
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <button type="button" className="secondary" onClick={closeDailyExpensesModal}>Cerrar</button>
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
                <h2>{monthlyExpenseModal.id ? "Editar gasto mensual" : "Nuevo gasto mensual"}</h2>
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
                    onChange={(e) => setMonthlyExpenseModal((p) => ({ ...p, category: e.target.value, error: "" }))}
                    disabled={!!monthlyExpenseModal.id}
                  >
                    {expenseCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label>
                  Importe
                  <input
                    value={monthlyExpenseModal.amount}
                    onChange={(e) => setMonthlyExpenseModal((p) => ({ ...p, amount: e.target.value.replace(/[^0-9.,]/g, ""), error: "" }))}
                    placeholder="0.00"
                    inputMode="decimal"
                  />
                </label>
              </div>
              {monthlyExpenseModal.category === PROVIDER_CATEGORY && (
                <label style={{ marginTop: 12 }}>
                  Nombre del proveedor
                  <input
                    value={monthlyExpenseModal.name || ""}
                    onChange={(e) => setMonthlyExpenseModal((p) => ({ ...p, name: e.target.value, error: "" }))}
                    placeholder="Ej. Acme S.L."
                  />
                  <span className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    Puedes registrar varios pagos a proveedor en el mismo mes; cada uno necesita un nombre distinto.
                  </span>
                </label>
              )}
              {monthlyExpenseModal.error && (
                <div className="error-box" style={{ marginTop: 10 }}>{monthlyExpenseModal.error}</div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button type="button" className="secondary" onClick={closeMonthlyExpense}>Cancelar</button>
                <button type="button" onClick={submitMonthlyExpense}>Guardar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: plantilla recurrente */}
      {recurringModal && (
        <div className="modal-backdrop" onClick={closeRecurringModal}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Plantilla de gasto fijo</h2>
                <p className="muted">Se replicará en cada mes nuevo con el importe indicado.</p>
              </div>
              <button type="button" className="secondary btn-sm" onClick={closeRecurringModal}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-2col">
                <label>
                  Categoría
                  <input
                    value={recurringModal.category}
                    onChange={(e) => setRecurringModal((p) => ({ ...p, category: e.target.value }))}
                    placeholder="Ej. Alquiler"
                  />
                </label>
                <label>
                  Importe
                  <input
                    value={recurringModal.amount}
                    onChange={(e) => setRecurringModal((p) => ({ ...p, amount: e.target.value.replace(/[^0-9.,]/g, "") }))}
                    placeholder="0.00"
                    inputMode="decimal"
                  />
                </label>
              </div>
              <label className="toggle-label" style={{ marginTop: 12 }}>
                <input
                  type="checkbox"
                  className="toggle-checkbox"
                  checked={!!recurringModal.active}
                  onChange={(e) => setRecurringModal((p) => ({ ...p, active: e.target.checked }))}
                />
                <span className="toggle-track"><span className="toggle-thumb" /></span>
                Plantilla activa (se replicará en meses nuevos)
              </label>
              {recurringError && <div className="error-box" style={{ marginTop: 10 }}>{recurringError}</div>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button type="button" className="secondary" onClick={closeRecurringModal}>Cancelar</button>
                <button type="button" onClick={submitRecurringModal}>Guardar plantilla</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: cambios sin guardar */}
      {pendingNav && (
        <div className="modal-backdrop" onClick={cancelPendingNav}>
          <div className="modal-panel" style={{ width: "min(480px, 96vw)" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Cambios sin guardar</h2>
                <p className="muted">Tienes datos del día sin guardar. ¿Qué quieres hacer?</p>
              </div>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14 }}>
                Si continúas sin guardar, los cambios introducidos en {formatDate(selectedDate)} se perderán.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                <button type="button" className="secondary" onClick={cancelPendingNav} disabled={savingDay}>Cancelar</button>
                <button
                  type="button"
                  className="secondary"
                  style={{ background: "#7f1d1d", color: "#fff", borderColor: "#7f1d1d" }}
                  onClick={discardAndContinue}
                  disabled={savingDay}
                >
                  Descartar y continuar
                </button>
                <button type="button" onClick={saveAndContinue} disabled={savingDay || hasClosingError}>
                  {savingDay ? "Guardando..." : "Guardar y continuar"}
                </button>
              </div>
              {hasClosingError && (
                <div className="error-box" style={{ marginTop: 8 }}>
                  No se puede guardar: el cierre es inferior a la mañana en algún método. Revisa los datos o descarta los cambios.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: subir adjunto */}
      {attachmentModal && (
        <div className="modal-backdrop" onClick={closeAttachmentModal}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Adjuntar imagen</h2>
                <p className="muted" style={{ textTransform: "capitalize" }}>{formatDate(selectedDate)} · {getWeekdayName(selectedDate)}</p>
              </div>
              <button type="button" className="secondary btn-sm" onClick={closeAttachmentModal}>✕</button>
            </div>
            <div className="modal-body">
              <label>
                Tipo de adjunto
                <select
                  value={attachmentModal.kind}
                  onChange={(e) => setAttachmentModal((p) => ({ ...p, kind: e.target.value }))}
                >
                  {ATTACHMENT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                </select>
              </label>
              <div>
                <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500 }}>
                  Imagen o PDF (máx. 15 MB)
                </span>
                {/* Inputs ocultos: la cámara fuerza la captura en móvil; el otro
                    abre el selector de archivos normal (galería o disco). */}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: "none" }}
                  onChange={(e) => setAttachmentModal((p) => ({ ...p, file: e.target.files?.[0] || null }))}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  style={{ display: "none" }}
                  onChange={(e) => setAttachmentModal((p) => ({ ...p, file: e.target.files?.[0] || null }))}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => cameraInputRef.current?.click()}>
                    Hacer foto
                  </button>
                  <button type="button" className="secondary" onClick={() => fileInputRef.current?.click()}>
                    Elegir archivo
                  </button>
                </div>
                <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                  En móvil, "Hacer foto" abre la cámara directamente. En ordenador abre el selector de archivos.
                </p>
              </div>
              {attachmentModal.file && (
                <div className="muted" style={{ fontSize: 12 }}>
                  Seleccionado: <strong>{attachmentModal.file.name}</strong> · {formatBytes(attachmentModal.file.size)}
                </div>
              )}
              {attachmentError && <div className="error-box" style={{ marginTop: 10 }}>{attachmentError}</div>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button type="button" className="secondary" onClick={closeAttachmentModal} disabled={attachmentBusy}>Cancelar</button>
                <button type="button" onClick={submitAttachment} disabled={attachmentBusy || !attachmentModal.file}>
                  {attachmentBusy ? "Subiendo..." : "Subir"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
