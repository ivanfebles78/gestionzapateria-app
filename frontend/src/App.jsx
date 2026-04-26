import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Euro, Lock, LogOut, TrendingUp, Wallet, CalendarDays, Users, Target, Store, ChevronLeft, ChevronRight, Plus, Pencil, Trash2, X } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, BarChart, Bar, PieChart, Pie, Cell } from "recharts";

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

function formatDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("es-ES");
}

function getTodayKey() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekdayIndex(dateStr) {
  return new Date(`${dateStr}T12:00:00`).getDay();
}

function isSunday(dateStr) {
  return getWeekdayIndex(dateStr) === 0;
}

function isSaturday(dateStr) {
  return getWeekdayIndex(dateStr) === 6;
}

function isWorkingDay(dateStr, extendedSchedule) {
  if (extendedSchedule) return true;
  return !isSunday(dateStr);
}

function getNextAllowedDate(dateStr, direction, extendedSchedule) {
  let nextDate = dateStr;
  do {
    nextDate = addDays(nextDate, direction);
  } while (!isWorkingDay(nextDate, extendedSchedule));
  return nextDate;
}

function normalizeDateForSchedule(dateStr, extendedSchedule) {
  if (isWorkingDay(dateStr, extendedSchedule)) return dateStr;
  return getNextAllowedDate(dateStr, -1, extendedSchedule);
}

function getMonthKey(dateStr) {
  return dateStr.slice(0, 7);
}

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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthKeyToDateInput(monthKey) {
  return `${monthKey}-01`;
}

function dateInputToMonthKey(dateStr) {
  return dateStr.slice(0, 7);
}

function getWeekdayName(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("es-ES", { weekday: "long" });
}

function createDefaultState() {
  const today = getTodayKey();
  return {
    salesByDay: {
      [today]: {
        morning: "",
        afternoon: "",
      },
    },
    expensesByMonth: {},
    settings: {
      extendedSchedule: false,
    },
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

function getMonthlySalesMap(salesByDay) {
  const result = {};
  for (const [date, values] of Object.entries(salesByDay)) {
    const monthKey = getMonthKey(date);
    const total = amount(values.morning) + amount(values.afternoon);
    result[monthKey] = (result[monthKey] || 0) + total;
  }
  return result;
}

function normalizeExpenseRecords(expenses) {
  if (!expenses) return [];

  if (Array.isArray(expenses)) {
    return expenses
      .filter(Boolean)
      .map((expense, index) => ({
        id: expense.id || `expense-${Date.now()}-${index}`,
        category: expense.category || expense.concept || "Otros",
        description: expense.description || "",
        amount: String(expense.amount ?? expense.value ?? ""),
      }));
  }

  // Compatibilidad con datos antiguos: antes se guardaba un importe por categoría.
  // Lo convertimos en registros independientes para poder editar/borrar sin duplicar sumas.
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
  return normalizeExpenseRecords(expenses).reduce((sum, expense) => sum + amount(expense.amount), 0);
}

function getAllMonthKeys(state) {
  const salesMonths = Object.keys(getMonthlySalesMap(state.salesByDay || {}));
  const expenseMonths = Object.keys(state.expensesByMonth || {});
  return [...new Set([...salesMonths, ...expenseMonths])].sort();
}

function getStats(state) {
  const salesEntries = Object.entries(state.salesByDay || {}).sort(([a], [b]) => a.localeCompare(b));
  const monthlySales = getMonthlySalesMap(state.salesByDay || {});
  const monthKeys = getAllMonthKeys(state);

  const monthlyData = monthKeys.map((monthKey) => {
    const sales = monthlySales[monthKey] || 0;
    const expenses = getMonthlyExpensesTotal(state.expensesByMonth?.[monthKey] || {});
    const balance = sales - expenses;
    return {
      monthKey,
      month: getMonthLabel(monthKey),
      ventas: sales,
      gastos: expenses,
      beneficio: balance,
      cumpleObjetivo: sales >= MONTHLY_TARGET,
      porcentajeObjetivo: MONTHLY_TARGET ? Math.round((sales / MONTHLY_TARGET) * 100) : 0,
    };
  });

  let daysMeetingTarget = 0;
  let morningWins = 0;
  let afternoonWins = 0;
  const weekdayTotals = {};

  const dailyData = salesEntries.map(([date, values]) => {
    const morning = amount(values.morning);
    const afternoon = amount(values.afternoon);
    const total = morning + afternoon;
    const weekday = getWeekdayName(date);
    weekdayTotals[weekday] = (weekdayTotals[weekday] || 0) + total;
    if (total >= DAILY_TARGET) daysMeetingTarget += 1;
    if (morning > afternoon) morningWins += 1;
    if (afternoon > morning) afternoonWins += 1;
    return {
      date,
      fecha: formatDate(date),
      weekday,
      morning,
      afternoon,
      total,
      cumpleObjetivo: total >= DAILY_TARGET,
      porcentajeObjetivo: DAILY_TARGET ? Math.round((total / DAILY_TARGET) * 100) : 0,
    };
  });

  const bestWeekday = Object.entries(weekdayTotals).sort((a, b) => b[1] - a[1])[0];
  const worstWeekday = Object.entries(weekdayTotals).sort((a, b) => a[1] - b[1])[0];

  const totalDays = dailyData.length;
  const totalMonthly = monthlyData.length;
  const monthsMeetingTarget = monthlyData.filter((m) => m.cumpleObjetivo).length;

  return {
    dailyData,
    monthlyData,
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

function StatCard({ title, value, hint, icon: Icon }) {
  return (
    <Card className="rounded-2xl border-white/10 bg-white/5 backdrop-blur">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-400">{title}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
            {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
          </div>
          <div className="rounded-xl bg-white/10 p-3">
            <Icon className="h-5 w-5 text-cyan-300" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    const user = USERS.find((u) => u.username === username && u.password === password);
    if (!user) {
      setError("Usuario o contraseña incorrectos.");
      return;
    }
    setError("");
    onLogin(user);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1e3a8a_0%,#0f172a_35%,#020617_100%)] text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6 py-10">
        <div className="grid w-full items-center gap-8 lg:grid-cols-2">
          <div>
            <Badge className="mb-4 rounded-full bg-cyan-500/20 px-4 py-1 text-cyan-200 hover:bg-cyan-500/20">
              Zapatería · Control de ventas y gastos
            </Badge>
            <h1 className="text-4xl font-semibold leading-tight md:text-5xl">
              Panel inteligente para controlar la rentabilidad de la tienda
            </h1>
            <p className="mt-4 max-w-xl text-base text-slate-300">
              Registra las ventas del día, controla los gastos mensuales y analiza tendencias para tomar mejores decisiones.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <Card className="rounded-2xl border-white/10 bg-white/5"><CardContent className="p-4 text-sm text-slate-200">Ventas diarias</CardContent></Card>
              <Card className="rounded-2xl border-white/10 bg-white/5"><CardContent className="p-4 text-sm text-slate-200">Balance mensual</CardContent></Card>
              <Card className="rounded-2xl border-white/10 bg-white/5"><CardContent className="p-4 text-sm text-slate-200">Estadísticas</CardContent></Card>
            </div>
          </div>

          <Card className="rounded-3xl border-white/10 bg-white/10 shadow-2xl backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white"><Lock className="h-5 w-5" /> Acceso a la aplicación</CardTitle>
              <CardDescription className="text-slate-300">Selecciona el usuario e introduce la contraseña.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-slate-200">Usuario</Label>
                  <select
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-white outline-none"
                  >
                    <option value="" className="bg-slate-900">Selecciona un usuario</option>
                    {USERS.map((user) => (
                      <option key={user.username} value={user.username} className="bg-slate-900">
                        {user.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-200">Contraseña</Label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Introduce la contraseña" className="border-white/10 bg-slate-950/40 text-white placeholder:text-slate-500" />
                </div>
                {error ? <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</div> : null}
                <Button type="submit" className="w-full rounded-xl bg-cyan-500 text-slate-950 hover:bg-cyan-400">Entrar</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [appState, setAppState] = useState(createDefaultState());
  const [currentUser, setCurrentUser] = useState(null);
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

  useEffect(() => {
    saveState(appState);
  }, [appState]);

  useEffect(() => {
    setSelectedDate((prev) => normalizeDateForSchedule(prev, extendedSchedule));
  }, [extendedSchedule]);

  const selectedMonthKey = getMonthKey(selectedDate);
  const selectedDaySales = appState.salesByDay?.[selectedDate] || { morning: "", afternoon: "" };
  const selectedDayTotal = amount(selectedDaySales.morning) + amount(selectedDaySales.afternoon);
  const isSelectedDateSunday = isSunday(selectedDate);
  const isSelectedDateSaturday = isSaturday(selectedDate);
  const isAfternoonDisabled = !extendedSchedule && isSelectedDateSaturday;
  const isDateClosed = !extendedSchedule && isSelectedDateSunday;

  const viewedMonthExpenses = appState.expensesByMonth?.[selectedMonth] || [];
  const viewedMonthExpenseRecords = normalizeExpenseRecords(viewedMonthExpenses);
  const viewedMonthSales = getMonthlySalesMap(appState.salesByDay || {})[selectedMonth] || 0;
  const viewedMonthExpensesTotal = getMonthlyExpensesTotal(viewedMonthExpenses);
  const viewedMonthBalance = viewedMonthSales - viewedMonthExpensesTotal;

  const stats = useMemo(() => getStats(appState), [appState]);

  const monthlyComparisonData = stats.monthlyData.map((m) => ({
    mes: m.month,
    ventas: m.ventas,
    gastos: m.gastos,
    beneficio: m.beneficio,
  }));

  const weekdayData = (() => {
    const map = {};
    stats.dailyData.forEach((d) => {
      map[d.weekday] = (map[d.weekday] || 0) + d.total;
    });
    return Object.entries(map).map(([name, total]) => ({ name, total }));
  })();

  const shiftData = [
    { name: "Mañana gana", value: stats.overview.morningWins },
    { name: "Tarde gana", value: stats.overview.afternoonWins },
  ];

  const updateSelectedDateSales = (field, value) => {
    const clean = value.replace(/[^0-9.,]/g, "").replace(",", ".");
    setAppState((prev) => ({
      ...prev,
      salesByDay: {
        ...prev.salesByDay,
        [selectedDate]: {
          ...(prev.salesByDay?.[selectedDate] || { morning: "", afternoon: "" }),
          [field]: clean,
        },
      },
    }));
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
        ? currentExpenses.map((expense) => (expense.id === editingExpenseId ? nextExpense : expense))
        : [...currentExpenses, nextExpense];

      return {
        ...prev,
        expensesByMonth: {
          ...prev.expensesByMonth,
          [selectedMonth]: nextExpenses,
        },
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
          [selectedMonth]: currentExpenses.filter((expense) => expense.id !== expenseId),
        },
      };
    });
  };

  const toggleExtendedSchedule = (checked) => {
    setAppState((prev) => ({
      ...prev,
      settings: {
        ...(prev.settings || {}),
        extendedSchedule: checked,
      },
    }));
  };

  const goToPreviousAllowedDay = () => {
    setSelectedDate((prev) => getNextAllowedDate(prev, -1, extendedSchedule));
  };

  const goToNextAllowedDay = () => {
    setSelectedDate((prev) => getNextAllowedDate(prev, 1, extendedSchedule));
  };

  const handleDateInputChange = (value) => {
    setSelectedDate(normalizeDateForSchedule(value, extendedSchedule));
  };

  if (!currentUser) {
    return <LoginScreen onLogin={setCurrentUser} />;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#0f172a_0%,#020617_60%,#000_100%)] text-white">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-cyan-300">
              <Store className="h-5 w-5" />
              <span className="text-sm font-medium uppercase tracking-[0.2em]">Zapatería</span>
            </div>
            <h1 className="mt-2 text-3xl font-semibold">Control de ventas, gastos y rentabilidad</h1>
            <p className="mt-1 text-sm text-slate-400">Hoy: {formatDate(todayKey)} · Usuario: {currentUser.displayName}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge className="rounded-full bg-white/10 px-4 py-2 text-slate-200 hover:bg-white/10">
              {currentUser.role === "admin" ? "Administrador" : "Tienda"}
            </Badge>
            <Button variant="outline" onClick={() => setCurrentUser(null)} className="rounded-xl border-white/10 bg-transparent text-white hover:bg-white/10">
              <LogOut className="mr-2 h-4 w-4" /> Salir
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Ventas del día seleccionado" value={money(selectedDayTotal)} hint={`${formatDate(selectedDate)} · Objetivo diario: ${money(DAILY_TARGET)}`} icon={Euro} />
          <StatCard title="Ventas del mes actual" value={money(getMonthlySalesMap(appState.salesByDay || {})[currentMonthKey] || 0)} hint={getMonthLabel(currentMonthKey)} icon={TrendingUp} />
          <StatCard title="Gastos del mes actual" value={money(getMonthlyExpensesTotal(appState.expensesByMonth?.[currentMonthKey] || {}))} hint="Acumulado mensual" icon={Wallet} />
          <StatCard title="Balance del mes actual" value={money((getMonthlySalesMap(appState.salesByDay || {})[currentMonthKey] || 0) - getMonthlyExpensesTotal(appState.expensesByMonth?.[currentMonthKey] || {}))} hint={((getMonthlySalesMap(appState.salesByDay || {})[currentMonthKey] || 0) - getMonthlyExpensesTotal(appState.expensesByMonth?.[currentMonthKey] || {})) >= 0 ? "Resultado positivo" : "Resultado negativo"} icon={BarChart3} />
        </div>

        <Tabs defaultValue="resumen-diario" className="mt-6">
          <TabsList className={`grid w-full rounded-2xl bg-white/5 p-1 ${currentUser.role === "admin" ? "grid-cols-3" : "grid-cols-1 max-w-md"}`}>
            <TabsTrigger value="resumen-diario" className="rounded-xl">Resumen diario</TabsTrigger>
            {currentUser.role === "admin" ? <TabsTrigger value="mes" className="rounded-xl">Resumen mensual</TabsTrigger> : null}
            {currentUser.role === "admin" ? <TabsTrigger value="stats" className="rounded-xl">Estadísticas</TabsTrigger> : null}
          </TabsList>

          <TabsContent value="resumen-diario" className="mt-6">
            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <Card className="rounded-3xl border-white/10 bg-white/5 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-white">Registro de ventas por día</CardTitle>
                  <CardDescription className="text-slate-400">Puedes moverte entre días anteriores o seleccionar una fecha concreta. Los domingos se omiten salvo que se habilite el horario extendido.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {currentUser.role === "admin" ? (
                    <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                      <div>
                        <p className="text-sm font-medium text-white">Habilitar horario extendido</p>
                        <p className="text-xs text-slate-400">Permite trabajar domingos y sábados por la tarde.</p>
                      </div>
                      <label className="flex items-center gap-3 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          checked={extendedSchedule}
                          onChange={(e) => toggleExtendedSchedule(e.target.checked)}
                          className="h-4 w-4 rounded border-white/20 bg-slate-900"
                        />
                        Activado
                      </label>
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/30 p-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" onClick={goToPreviousAllowedDay} className="rounded-xl border-white/10 bg-transparent text-white hover:bg-white/10">
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Input type="date" value={selectedDate} onChange={(e) => handleDateInputChange(e.target.value)} className="w-[180px] rounded-xl border-white/10 bg-slate-950/40 text-white" />
                      <Button type="button" variant="outline" onClick={goToNextAllowedDay} className="rounded-xl border-white/10 bg-transparent text-white hover:bg-white/10">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="outline" onClick={() => setSelectedDate(normalizeDateForSchedule(todayKey, extendedSchedule))} className="rounded-xl border-white/10 bg-transparent text-white hover:bg-white/10">Hoy</Button>
                      <Button type="button" variant="outline" onClick={() => setSelectedDate(normalizeDateForSchedule(addDays(todayKey, -7), extendedSchedule))} className="rounded-xl border-white/10 bg-transparent text-white hover:bg-white/10">Hace 7 días</Button>
                      <Button type="button" variant="outline" onClick={() => setSelectedDate(normalizeDateForSchedule(addDays(todayKey, -14), extendedSchedule))} className="rounded-xl border-white/10 bg-transparent text-white hover:bg-white/10">Hace 14 días</Button>
                    </div>
                  </div>

                  {!extendedSchedule ? (
                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
                      Horario normal activo: los domingos se omiten y los sábados por la tarde quedan deshabilitados.
                    </div>
                  ) : null}

                  {isDateClosed ? (
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
                      Este día está cerrado en horario normal.
                    </div>
                  ) : null}

                  <div className="grid gap-5 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label className="text-slate-200">Ventas mañana</Label>
                      <Input
                        value={selectedDaySales.morning}
                        onChange={(e) => updateSelectedDateSales("morning", e.target.value)}
                        placeholder="0.00"
                        disabled={isDateClosed}
                        className="h-12 rounded-xl border-white/10 bg-slate-950/40 text-white disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-200">Ventas tarde</Label>
                      <Input
                        value={isAfternoonDisabled ? "" : selectedDaySales.afternoon}
                        onChange={(e) => updateSelectedDateSales("afternoon", e.target.value)}
                        placeholder={isAfternoonDisabled ? "No disponible" : "0.00"}
                        disabled={isDateClosed || isAfternoonDisabled}
                        className="h-12 rounded-xl border-white/10 bg-slate-950/40 text-white disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-200">Total ventas</Label>
                      <Input value={money(selectedDayTotal)} readOnly className="h-12 rounded-xl border-cyan-500/20 bg-cyan-500/10 text-cyan-100" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-white/10 bg-white/5 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-white">Objetivo diario</CardTitle>
                  <CardDescription className="text-slate-400">{formatDate(selectedDate)} · Meta establecida: {money(DAILY_TARGET)}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-5">
                    <div className="mb-3 flex items-center justify-between text-sm text-slate-300">
                      <span>Progreso</span>
                      <span>{Math.round((selectedDayTotal / DAILY_TARGET) * 100) || 0}%</span>
                    </div>
                    <div className="h-4 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${Math.min((selectedDayTotal / DAILY_TARGET) * 100, 100)}%` }} />
                    </div>
                    <div className="mt-4">
                      {selectedDayTotal >= DAILY_TARGET ? (
                        <Badge className="bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20">Objetivo diario alcanzado</Badge>
                      ) : (
                        <Badge className="bg-amber-500/20 text-amber-300 hover:bg-amber-500/20">Faltan {money(Math.max(DAILY_TARGET - selectedDayTotal, 0))}</Badge>
                      )}
                    </div>
                    <div className="mt-4 text-sm text-slate-400">
                      Mes del día seleccionado: <span className="capitalize text-slate-200">{getMonthLabel(selectedMonthKey)}</span>
                    </div>
                    <div className="mt-2 text-sm text-slate-400 capitalize">
                      Día de la semana: <span className="text-slate-200">{getWeekdayName(selectedDate)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {currentUser.role === "admin" ? (
            <TabsContent value="mes" className="mt-6">
              <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm text-slate-400">Mes seleccionado</p>
                  <p className="text-lg font-semibold capitalize text-white">{getMonthLabel(selectedMonth)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={() => setSelectedMonth((prev) => addMonths(prev, -1))} className="rounded-xl border-white/10 bg-transparent text-white hover:bg-white/10">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-[180px] rounded-xl border-white/10 bg-slate-950/40 text-white"
                  />
                  <Button type="button" variant="outline" onClick={() => setSelectedMonth((prev) => addMonths(prev, 1))} className="rounded-xl border-white/10 bg-transparent text-white hover:bg-white/10">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setSelectedMonth(currentMonthKey)} className="rounded-xl border-white/10 bg-transparent text-white hover:bg-white/10">
                    Mes actual
                  </Button>
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <Card className="rounded-3xl border-white/10 bg-white/5 backdrop-blur">
                  <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <CardTitle className="text-white">Gastos del mes seleccionado</CardTitle>
                        <CardDescription className="text-slate-400">{getMonthLabel(selectedMonth)}</CardDescription>
                      </div>
                      <Button type="button" onClick={openNewExpenseModal} className="rounded-xl bg-cyan-500 text-slate-950 hover:bg-cyan-400">
                        <Plus className="mr-2 h-4 w-4" /> Gastos
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/20">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-white/10 hover:bg-transparent">
                            <TableHead className="text-slate-300">Categoría</TableHead>
                            <TableHead className="text-slate-300">Detalle</TableHead>
                            <TableHead className="text-right text-slate-300">Importe</TableHead>
                            <TableHead className="text-center text-slate-300">Acciones</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {viewedMonthExpenseRecords.length ? viewedMonthExpenseRecords.map((expense) => (
                            <TableRow key={expense.id} className="border-white/10 text-slate-200 hover:bg-white/5">
                              <TableCell className="font-medium text-white">{expense.category}</TableCell>
                              <TableCell className="text-slate-300">{expense.description || "—"}</TableCell>
                              <TableCell className="text-right font-semibold text-white">{money(expense.amount)}</TableCell>
                              <TableCell>
                                <div className="flex justify-center gap-2">
                                  <Button type="button" variant="outline" onClick={() => openEditExpenseModal(expense)} className="rounded-xl border-white/10 bg-transparent text-white hover:bg-white/10">
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button type="button" variant="outline" onClick={() => deleteExpense(expense.id)} className="rounded-xl border-red-500/20 bg-red-500/10 text-red-200 hover:bg-red-500/20">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )) : (
                            <TableRow className="border-white/10">
                              <TableCell colSpan={4} className="py-8 text-center text-slate-400">
                                Todavía no hay gastos registrados para este mes. Pulsa “Gastos” para añadir el primero.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid gap-6">
                  <Card className="rounded-3xl border-white/10 bg-white/5 backdrop-blur">
                    <CardHeader>
                      <CardTitle className="text-white">Resultado del mes</CardTitle>
                      <CardDescription className="text-slate-400">Resumen económico del mes seleccionado</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                        <p className="text-sm text-slate-400">Facturación</p>
                        <p className="mt-2 text-2xl font-semibold text-white">{money(viewedMonthSales)}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                        <p className="text-sm text-slate-400">Gastos</p>
                        <p className="mt-2 text-2xl font-semibold text-white">{money(viewedMonthExpensesTotal)}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 sm:col-span-2">
                        <p className="text-sm text-slate-400">Beneficio / Balance</p>
                        <p className={`mt-2 text-3xl font-semibold ${viewedMonthBalance >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                          {money(viewedMonthBalance)}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="rounded-3xl border-white/10 bg-white/5 backdrop-blur">
                    <CardHeader>
                      <CardTitle className="text-white">Objetivo mensual</CardTitle>
                      <CardDescription className="text-slate-400">Meta establecida: {money(MONTHLY_TARGET)}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="mb-3 flex items-center justify-between text-sm text-slate-300">
                        <span>Progreso mensual</span>
                        <span>{Math.round((viewedMonthSales / MONTHLY_TARGET) * 100) || 0}%</span>
                      </div>
                      <div className="h-4 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${Math.min((viewedMonthSales / MONTHLY_TARGET) * 100, 100)}%` }} />
                      </div>
                      <div className="mt-4">
                        {viewedMonthSales >= MONTHLY_TARGET ? (
                          <Badge className="bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20">Objetivo mensual alcanzado</Badge>
                        ) : (
                          <Badge className="bg-amber-500/20 text-amber-300 hover:bg-amber-500/20">Faltan {money(Math.max(MONTHLY_TARGET - viewedMonthSales, 0))}</Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>
          ) : null}

          {currentUser.role === "admin" ? (
            <TabsContent value="stats" className="mt-6 space-y-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatCard title="% días con objetivo" value={`${stats.overview.dailyTargetRate}%`} hint={`${stats.overview.daysMeetingTarget} días alcanzados`} icon={Target} />
                <StatCard title="% meses con objetivo" value={`${stats.overview.monthlyTargetRate}%`} hint={`${stats.overview.monthsMeetingTarget} meses alcanzados`} icon={CalendarDays} />
                <StatCard title="Día más fuerte" value={stats.overview.bestWeekday} hint={money(stats.overview.bestWeekdayAmount)} icon={TrendingUp} />
                <StatCard title="Día más débil" value={stats.overview.worstWeekday} hint={money(stats.overview.worstWeekdayAmount)} icon={Users} />
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <Card className="rounded-3xl border-white/10 bg-white/5 backdrop-blur">
                  <CardHeader>
                    <CardTitle className="text-white">Evolución mensual</CardTitle>
                    <CardDescription className="text-slate-400">Ventas, gastos y beneficio por mes</CardDescription>
                  </CardHeader>
                  <CardContent className="h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={monthlyComparisonData}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                        <XAxis dataKey="mes" stroke="#94a3b8" />
                        <YAxis stroke="#94a3b8" />
                        <Tooltip />
                        <Line type="monotone" dataKey="ventas" stroke="#22d3ee" strokeWidth={3} />
                        <Line type="monotone" dataKey="gastos" stroke="#f59e0b" strokeWidth={3} />
                        <Line type="monotone" dataKey="beneficio" stroke="#4ade80" strokeWidth={3} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="rounded-3xl border-white/10 bg-white/5 backdrop-blur">
                  <CardHeader>
                    <CardTitle className="text-white">Ventas por día de la semana</CardTitle>
                    <CardDescription className="text-slate-400">Acumulado histórico por día</CardDescription>
                  </CardHeader>
                  <CardContent className="h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={weekdayData}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                        <XAxis dataKey="name" stroke="#94a3b8" />
                        <YAxis stroke="#94a3b8" />
                        <Tooltip />
                        <Bar dataKey="total" fill="#60a5fa" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
                <Card className="rounded-3xl border-white/10 bg-white/5 backdrop-blur">
                  <CardHeader>
                    <CardTitle className="text-white">¿Cuándo se vende más?</CardTitle>
                    <CardDescription className="text-slate-400">Comparativa mañana vs tarde</CardDescription>
                  </CardHeader>
                  <CardContent className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={shiftData} dataKey="value" nameKey="name" outerRadius={90} label>
                          <Cell fill="#22d3ee" />
                          <Cell fill="#c084fc" />
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="rounded-3xl border-white/10 bg-white/5 backdrop-blur">
                  <CardHeader>
                    <CardTitle className="text-white">Histórico diario</CardTitle>
                    <CardDescription className="text-slate-400">Objetivo diario: {money(DAILY_TARGET)}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="max-h-[320px] overflow-auto rounded-2xl border border-white/10 bg-slate-950/20">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-white/10 hover:bg-transparent">
                            <TableHead className="text-slate-300">Fecha</TableHead>
                            <TableHead className="text-slate-300">Día</TableHead>
                            <TableHead className="text-slate-300">Mañana</TableHead>
                            <TableHead className="text-slate-300">Tarde</TableHead>
                            <TableHead className="text-slate-300">Total</TableHead>
                            <TableHead className="text-slate-300">Objetivo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {stats.dailyData.length ? stats.dailyData.map((row) => (
                            <TableRow key={row.date} className="border-white/10 text-slate-200 hover:bg-white/5">
                              <TableCell className="text-slate-200">{row.fecha}</TableCell>
                              <TableCell className="capitalize text-slate-200">{row.weekday}</TableCell>
                              <TableCell className="text-slate-100">{money(row.morning)}</TableCell>
                              <TableCell className="text-slate-100">{money(row.afternoon)}</TableCell>
                              <TableCell className="font-medium text-white">{money(row.total)}</TableCell>
                              <TableCell>
                                {row.cumpleObjetivo ? (
                                  <Badge className="bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20">Sí</Badge>
                                ) : (
                                  <Badge className="bg-red-500/20 text-red-300 hover:bg-red-500/20">No</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          )) : (
                            <TableRow className="border-white/10">
                              <TableCell colSpan={6} className="text-center text-slate-400">Todavía no hay datos suficientes.</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          ) : null}
        </Tabs>

        {isExpenseModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
            <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-2xl">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-white">{editingExpenseId ? "Editar gasto" : "Añadir nuevo gasto"}</h2>
                  <p className="mt-1 text-sm text-slate-400">{getMonthLabel(selectedMonth)} · Corrige cualquier gasto sin duplicar importes.</p>
                </div>
                <Button type="button" variant="outline" onClick={closeExpenseModal} className="rounded-xl border-white/10 bg-transparent text-white hover:bg-white/10">
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-slate-200">Categoría</Label>
                  <select
                    value={expenseForm.category}
                    onChange={(e) => setExpenseForm((prev) => ({ ...prev, category: e.target.value }))}
                    className="flex h-11 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-white outline-none"
                  >
                    {expenseCategories.map((category) => (
                      <option key={category} value={category} className="bg-slate-900">{category}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-200">Importe</Label>
                  <Input
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm((prev) => ({ ...prev, amount: e.target.value.replace(/[^0-9.,]/g, "") }))}
                    placeholder="0.00"
                    className="h-11 rounded-xl border-white/10 bg-slate-950/40 text-white"
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label className="text-slate-200">Detalle / proveedor</Label>
                  <Input
                    value={expenseForm.description}
                    onChange={(e) => setExpenseForm((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Ej. Pago proveedor calzado, factura, alquiler..."
                    className="h-11 rounded-xl border-white/10 bg-slate-950/40 text-white"
                  />
                </div>
              </div>

              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={closeExpenseModal} className="rounded-xl border-white/10 bg-transparent text-white hover:bg-white/10">Cancelar</Button>
                <Button type="button" onClick={saveExpense} className="rounded-xl bg-cyan-500 text-slate-950 hover:bg-cyan-400">
                  {editingExpenseId ? "Guardar cambios" : "Añadir gasto"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
