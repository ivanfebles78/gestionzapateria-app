from collections import defaultdict
from datetime import date
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.dependencies import get_current_user, require_admin
from app.db.deps import get_db
from app.models import AppSetting, DailySale, MonthlyExpense, User
from app.schemas.sales import (
    AppSettingsRead,
    AppSettingsUpdate,
    DailySaleRead,
    DailySaleUpsert,
    DashboardStats,
    MonthlyExpenseRead,
    MonthlyExpenseUpsert,
    MonthlySummary,
)

router = APIRouter(prefix='/api', tags=['business'])
DAILY_TARGET = 500
MONTHLY_TARGET = 12000
WEEKDAY_ORDER = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']


def get_or_create_settings(db: Session) -> AppSetting:
    settings = db.query(AppSetting).filter(AppSetting.id == 1).first()
    if not settings:
        settings = AppSetting(id=1, extended_schedule_enabled=False)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@router.get('/settings', response_model=AppSettingsRead)
def read_settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    settings = get_or_create_settings(db)
    return AppSettingsRead(extended_schedule_enabled=settings.extended_schedule_enabled)


@router.put('/settings', response_model=AppSettingsRead)
def update_settings(
    payload: AppSettingsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    settings = get_or_create_settings(db)
    settings.extended_schedule_enabled = payload.extended_schedule_enabled
    db.commit()
    db.refresh(settings)
    return AppSettingsRead(extended_schedule_enabled=settings.extended_schedule_enabled)


@router.get('/daily-sales', response_model=list[DailySaleRead])
def list_daily_sales(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(DailySale)
    if date_from:
        query = query.filter(DailySale.sale_date >= date_from)
    if date_to:
        query = query.filter(DailySale.sale_date <= date_to)
    return query.order_by(DailySale.sale_date.asc()).all()


@router.put('/daily-sales', response_model=DailySaleRead)
def upsert_daily_sale(
    payload: DailySaleUpsert,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sale = db.query(DailySale).filter(DailySale.sale_date == payload.sale_date).first()
    if not sale:
        sale = DailySale(sale_date=payload.sale_date)
        db.add(sale)

    sale.morning_sales = payload.morning_sales
    sale.afternoon_sales = payload.afternoon_sales
    sale.total_sales = payload.total_sales
    sale.worked = payload.worked
    sale.customers = payload.customers
    sale.extended_schedule = payload.extended_schedule
    sale.updated_by_user_id = user.id
    db.commit()
    db.refresh(sale)
    return sale


@router.get('/monthly-expenses', response_model=list[MonthlyExpenseRead])
def list_monthly_expenses(
    month_key: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(MonthlyExpense)
    if month_key:
        query = query.filter(MonthlyExpense.month_key == month_key)
    return query.order_by(MonthlyExpense.month_key.asc(), MonthlyExpense.category.asc()).all()


@router.put('/monthly-expenses', response_model=MonthlyExpenseRead)
def upsert_monthly_expense(
    payload: MonthlyExpenseUpsert,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    expense = db.query(MonthlyExpense).filter(
        MonthlyExpense.month_key == payload.month_key,
        MonthlyExpense.category == payload.category,
    ).first()
    if not expense:
        expense = MonthlyExpense(month_key=payload.month_key, category=payload.category)
        db.add(expense)
    expense.amount = payload.amount
    db.commit()
    db.refresh(expense)
    return expense


@router.get('/stats/dashboard', response_model=DashboardStats)
def dashboard_stats(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    daily_sales = db.query(DailySale).order_by(DailySale.sale_date.asc()).all()
    expenses = db.query(MonthlyExpense).all()

    monthly_sales_map: dict[str, float] = defaultdict(float)
    weekday_totals: dict[str, float] = defaultdict(float)
    daily_target_hits = 0
    morning_wins = 0
    afternoon_wins = 0

    for sale in daily_sales:
        month_key = sale.sale_date.strftime('%Y-%m')
        monthly_sales_map[month_key] += sale.total_sales
        weekday = sale.sale_date.strftime('%A').lower()
        weekday_es = {
            'monday': 'lunes', 'tuesday': 'martes', 'wednesday': 'miércoles',
            'thursday': 'jueves', 'friday': 'viernes', 'saturday': 'sábado', 'sunday': 'domingo'
        }.get(weekday, weekday)
        weekday_totals[weekday_es] += sale.total_sales
        if sale.total_sales >= DAILY_TARGET:
            daily_target_hits += 1
        if sale.morning_sales > sale.afternoon_sales:
            morning_wins += 1
        elif sale.afternoon_sales > sale.morning_sales:
            afternoon_wins += 1

    monthly_expense_map: dict[str, float] = defaultdict(float)
    for expense in expenses:
        monthly_expense_map[expense.month_key] += expense.amount

    month_keys = sorted(set(monthly_sales_map.keys()) | set(monthly_expense_map.keys()))
    monthly_summaries = []
    monthly_hits = 0
    for month_key in month_keys:
        sales_total = round(monthly_sales_map.get(month_key, 0), 2)
        expenses_total = round(monthly_expense_map.get(month_key, 0), 2)
        balance = round(sales_total - expenses_total, 2)
        progress = int(round((sales_total / MONTHLY_TARGET) * 100)) if MONTHLY_TARGET else 0
        if sales_total >= MONTHLY_TARGET:
            monthly_hits += 1
        monthly_summaries.append(MonthlySummary(
            month_key=month_key,
            sales_total=sales_total,
            expenses_total=expenses_total,
            balance=balance,
            target_progress_pct=progress,
        ))

    sorted_weekdays = [w for w in WEEKDAY_ORDER if w in weekday_totals]
    best_weekday = max(sorted_weekdays, key=lambda w: weekday_totals[w], default='—')
    worst_weekday = min(sorted_weekdays, key=lambda w: weekday_totals[w], default='—')

    return DashboardStats(
        daily_target_rate=int(round((daily_target_hits / len(daily_sales)) * 100)) if daily_sales else 0,
        monthly_target_rate=int(round((monthly_hits / len(month_keys)) * 100)) if month_keys else 0,
        best_weekday=best_weekday,
        worst_weekday=worst_weekday,
        morning_wins=morning_wins,
        afternoon_wins=afternoon_wins,
        monthly_summaries=monthly_summaries,
    )
