from collections import defaultdict
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, require_admin
from app.db.deps import get_db
from app.models import (
    AdminNotification,
    AppSetting,
    DailyExpense,
    DailySale,
    MonthlyExpense,
    RecurringExpenseTemplate,
    SaleChangeLog,
    User,
)
from app.schemas.sales import (
    AdminNotificationRead,
    AppSettingsRead,
    AppSettingsUpdate,
    CustomerTrafficSlot,
    DailyExpenseCreate,
    DailyExpenseRead,
    DailyExpenseUpdate,
    DailySaleRead,
    DailySaleUpsert,
    DashboardStats,
    MonthlyExpenseRead,
    MonthlyExpenseUpdateById,
    MonthlyExpenseUpsert,
    MonthlySummary,
    PaymentMethodShare,
    RecurringExpenseTemplateRead,
    RecurringExpenseTemplateUpsert,
    SaleChangeLogRead,
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


def refresh_daily_totals(db: Session, sale: DailySale) -> None:
    expenses = db.query(DailyExpense).filter(DailyExpense.sale_date == sale.sale_date).all()
    daily_expenses_total = round(sum(item.amount for item in expenses), 2)

    sale.morning_total = round(
        sale.morning_cash + sale.morning_card + sale.morning_bizum + sale.morning_bonos, 2
    )
    sale.afternoon_total = round(
        sale.afternoon_cash + sale.afternoon_card + sale.afternoon_bizum + sale.afternoon_bonos, 2
    )
    sale.total_sales = round(sale.morning_total + sale.afternoon_total, 2)

    sale.morning_customers_total = (
        sale.morning_cash_customers + sale.morning_card_customers +
        sale.morning_bizum_customers + sale.morning_bonos_customers
    )
    sale.afternoon_customers_total = (
        sale.afternoon_cash_customers + sale.afternoon_card_customers +
        sale.afternoon_bizum_customers + sale.afternoon_bonos_customers
    )
    sale.customers_total = sale.morning_customers_total + sale.afternoon_customers_total

    sale.daily_expenses_total = daily_expenses_total
    sale.daily_balance = round(sale.total_sales - sale.daily_expenses_total, 2)


def create_sale_log(db: Session, *, sale: DailySale, user: User, action: str) -> None:
    log = SaleChangeLog(
        sale_date=sale.sale_date,
        changed_at=datetime.utcnow(),
        changed_by_user_id=user.id,
        changed_by_display_name=user.display_name,
        action=action,
        morning_cash=sale.morning_cash,
        morning_card=sale.morning_card,
        morning_bizum=sale.morning_bizum,
        morning_bonos=sale.morning_bonos,
        morning_total=sale.morning_total,
        morning_cash_customers=sale.morning_cash_customers,
        morning_card_customers=sale.morning_card_customers,
        morning_bizum_customers=sale.morning_bizum_customers,
        morning_bonos_customers=sale.morning_bonos_customers,
        morning_customers_total=sale.morning_customers_total,
        afternoon_cash=sale.afternoon_cash,
        afternoon_card=sale.afternoon_card,
        afternoon_bizum=sale.afternoon_bizum,
        afternoon_bonos=sale.afternoon_bonos,
        afternoon_total=sale.afternoon_total,
        afternoon_cash_customers=sale.afternoon_cash_customers,
        afternoon_card_customers=sale.afternoon_card_customers,
        afternoon_bizum_customers=sale.afternoon_bizum_customers,
        afternoon_bonos_customers=sale.afternoon_bonos_customers,
        afternoon_customers_total=sale.afternoon_customers_total,
        total_sales=sale.total_sales,
        daily_expenses_total=sale.daily_expenses_total,
        daily_balance=sale.daily_balance,
        customers_total=sale.customers_total,
    )
    db.add(log)


def create_admin_notification(
    db: Session,
    *,
    title: str,
    message: str,
    user: User,
    sale_date: date | None = None,
    notification_type: str = 'sale_updated',
) -> None:
    notification = AdminNotification(
        type=notification_type,
        title=title,
        message=message,
        sale_date=sale_date,
        is_read=False,
        created_by_user_id=user.id,
        created_at=datetime.utcnow(),
    )
    db.add(notification)


@router.get('/settings', response_model=AppSettingsRead)
def read_settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    settings = get_or_create_settings(db)
    return AppSettingsRead(extended_schedule_enabled=settings.extended_schedule_enabled)


@router.put('/settings', response_model=AppSettingsRead)
def update_settings(payload: AppSettingsUpdate, db: Session = Depends(get_db), user: User = Depends(require_admin)):
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
def upsert_daily_sale(payload: DailySaleUpsert, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if payload.sale_date > date.today():
        raise HTTPException(status_code=400, detail='No se pueden registrar ventas para fechas futuras')

    sale = db.query(DailySale).filter(DailySale.sale_date == payload.sale_date).first()
    already_existed = sale is not None

    if not sale:
        sale = DailySale(sale_date=payload.sale_date)
        db.add(sale)

    sale.morning_cash = payload.morning_cash
    sale.morning_card = payload.morning_card
    sale.morning_bizum = payload.morning_bizum
    sale.morning_bonos = payload.morning_bonos
    sale.morning_cash_customers = payload.morning_cash_customers
    sale.morning_card_customers = payload.morning_card_customers
    sale.morning_bizum_customers = payload.morning_bizum_customers
    sale.morning_bonos_customers = payload.morning_bonos_customers

    sale.afternoon_cash = payload.afternoon_cash
    sale.afternoon_card = payload.afternoon_card
    sale.afternoon_bizum = payload.afternoon_bizum
    sale.afternoon_bonos = payload.afternoon_bonos
    sale.afternoon_cash_customers = payload.afternoon_cash_customers
    sale.afternoon_card_customers = payload.afternoon_card_customers
    sale.afternoon_bizum_customers = payload.afternoon_bizum_customers
    sale.afternoon_bonos_customers = payload.afternoon_bonos_customers

    sale.worked = payload.worked
    sale.extended_schedule = payload.extended_schedule
    sale.updated_by_user_id = user.id
    sale.is_locked = True

    refresh_daily_totals(db, sale)
    create_sale_log(db, sale=sale, user=user, action='update' if already_existed else 'create')

    if already_existed:
        create_admin_notification(
            db,
            title='Día editado',
            message=(
                f'{user.display_name} modificó el día {payload.sale_date.isoformat()} '
                f'(ventas: {sale.total_sales:.2f}, gastos: {sale.daily_expenses_total:.2f}, '
                f'balance: {sale.daily_balance:.2f}, clientes: {sale.customers_total}).'
            ),
            user=user,
            sale_date=payload.sale_date,
            notification_type='daily_sale_edited',
        )

    db.commit()
    db.refresh(sale)
    return sale


@router.post('/daily-sales/{sale_date}/unlock', response_model=DailySaleRead)
def unlock_daily_sale(sale_date: date, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    sale = db.query(DailySale).filter(DailySale.sale_date == sale_date).first()
    if not sale:
        raise HTTPException(status_code=404, detail='Daily sale not found')
    sale.is_locked = False
    sale.updated_by_user_id = user.id
    db.commit()
    db.refresh(sale)
    return sale


@router.post('/daily-sales/{sale_date}/recalculate', response_model=DailySaleRead)
def recalculate_daily_sale(sale_date: date, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Fuerza el recálculo de totales y balance del día desde los registros reales.
    Útil cuando daily_expenses_total quedó desincronizado por algún motivo histórico."""
    sale = db.query(DailySale).filter(DailySale.sale_date == sale_date).first()
    if not sale:
        raise HTTPException(status_code=404, detail='Daily sale not found')
    refresh_daily_totals(db, sale)
    db.commit()
    db.refresh(sale)
    return sale


@router.get('/daily-expenses', response_model=list[DailyExpenseRead])
def list_daily_expenses(sale_date: date | None = Query(default=None), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    query = db.query(DailyExpense)
    if sale_date:
        query = query.filter(DailyExpense.sale_date == sale_date)
    return query.order_by(DailyExpense.created_at.desc()).all()


@router.post('/daily-expenses', response_model=DailyExpenseRead)
def create_daily_expense(payload: DailyExpenseCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if payload.sale_date > date.today():
        raise HTTPException(status_code=400, detail='No se pueden registrar gastos para fechas futuras')

    sale = db.query(DailySale).filter(DailySale.sale_date == payload.sale_date).first()
    if not sale:
        sale = DailySale(sale_date=payload.sale_date, worked=not (payload.sale_date.weekday() == 6), extended_schedule=False)
        db.add(sale)
        db.flush()

    expense = DailyExpense(
        sale_date=payload.sale_date,
        concept=payload.concept.strip(),
        amount=payload.amount,
        created_by_user_id=user.id,
    )
    db.add(expense)
    db.flush()

    refresh_daily_totals(db, sale)
    create_sale_log(db, sale=sale, user=user, action='update')

    create_admin_notification(
        db,
        title='Gasto diario añadido',
        message=f'{user.display_name} añadió un gasto al día {payload.sale_date.isoformat()} por {payload.amount:.2f} € ({payload.concept}).',
        user=user,
        sale_date=payload.sale_date,
        notification_type='daily_expense_added',
    )

    db.commit()
    db.refresh(expense)
    return expense


@router.put('/daily-expenses/{expense_id}', response_model=DailyExpenseRead)
def update_daily_expense(
    expense_id: int,
    payload: DailyExpenseUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    expense = db.query(DailyExpense).filter(DailyExpense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail='Daily expense not found')

    expense.concept = payload.concept.strip()
    expense.amount = payload.amount

    sale = db.query(DailySale).filter(DailySale.sale_date == expense.sale_date).first()
    if sale:
        refresh_daily_totals(db, sale)
        create_sale_log(db, sale=sale, user=user, action='update')

    create_admin_notification(
        db,
        title='Gasto diario editado',
        message=f'{user.display_name} editó un gasto del día {expense.sale_date.isoformat()} ({payload.concept}, {payload.amount:.2f} €).',
        user=user,
        sale_date=expense.sale_date,
        notification_type='daily_expense_edited',
    )

    db.commit()
    db.refresh(expense)
    return expense


@router.delete('/daily-expenses/{expense_id}', status_code=204)
def delete_daily_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    expense = db.query(DailyExpense).filter(DailyExpense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail='Daily expense not found')

    sale_date = expense.sale_date
    concept = expense.concept
    amount_value = expense.amount

    db.delete(expense)
    db.flush()

    sale = db.query(DailySale).filter(DailySale.sale_date == sale_date).first()
    if sale:
        refresh_daily_totals(db, sale)
        create_sale_log(db, sale=sale, user=user, action='update')

    create_admin_notification(
        db,
        title='Gasto diario borrado',
        message=f'{user.display_name} borró un gasto del día {sale_date.isoformat()} ({concept}, {amount_value:.2f} €).',
        user=user,
        sale_date=sale_date,
        notification_type='daily_expense_deleted',
    )

    db.commit()
    return None


def _ensure_recurring_for_month(db: Session, month_key: str) -> None:
    """Crea filas en monthly_expenses para las plantillas activas que aún no
    existan en ese mes (slot fijo, name=''), usando el importe de la plantilla.
    No sobreescribe los valores ya guardados ni los pagos a proveedor (que tienen
    name distinto de '')."""
    if not month_key or len(month_key) != 7:
        return
    templates = db.query(RecurringExpenseTemplate).filter(RecurringExpenseTemplate.active.is_(True)).all()
    if not templates:
        return
    existing = {
        row.category
        for row in db.query(MonthlyExpense.category)
        .filter(MonthlyExpense.month_key == month_key, MonthlyExpense.name == '')
        .all()
    }
    created = False
    for tpl in templates:
        if tpl.category in existing:
            continue
        db.add(MonthlyExpense(month_key=month_key, category=tpl.category, name='', amount=tpl.amount))
        created = True
    if created:
        db.commit()


@router.get('/monthly-expenses', response_model=list[MonthlyExpenseRead])
def list_monthly_expenses(month_key: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if month_key:
        _ensure_recurring_for_month(db, month_key)
    else:
        _ensure_recurring_for_month(db, date.today().strftime('%Y-%m'))
    query = db.query(MonthlyExpense)
    if month_key:
        query = query.filter(MonthlyExpense.month_key == month_key)
    return query.order_by(MonthlyExpense.month_key.asc(), MonthlyExpense.category.asc()).all()


@router.put('/monthly-expenses', response_model=MonthlyExpenseRead)
def upsert_monthly_expense(payload: MonthlyExpenseUpsert, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    name = (payload.name or '').strip()
    if payload.category == 'Pago a proveedor' and not name:
        raise HTTPException(status_code=400, detail='Falta el nombre del proveedor')
    expense = (
        db.query(MonthlyExpense)
        .filter(
            MonthlyExpense.month_key == payload.month_key,
            MonthlyExpense.category == payload.category,
            MonthlyExpense.name == name,
        )
        .first()
    )
    if not expense:
        expense = MonthlyExpense(month_key=payload.month_key, category=payload.category, name=name)
        db.add(expense)
    expense.amount = payload.amount
    db.commit()
    db.refresh(expense)
    return expense


@router.put('/monthly-expenses/{expense_id}', response_model=MonthlyExpenseRead)
def update_monthly_expense_by_id(
    expense_id: int,
    payload: MonthlyExpenseUpdateById,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    expense = db.query(MonthlyExpense).filter(MonthlyExpense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail='Gasto mensual no encontrado')
    new_name = (payload.name or '').strip()
    if expense.category == 'Pago a proveedor' and not new_name:
        raise HTTPException(status_code=400, detail='Falta el nombre del proveedor')
    expense.name = new_name
    expense.amount = payload.amount
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail='Ya existe un gasto con esa categoría y nombre en este mes',
        )
    db.refresh(expense)
    return expense


@router.delete('/monthly-expenses/{expense_id}', status_code=204)
def delete_monthly_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    expense = db.query(MonthlyExpense).filter(MonthlyExpense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail='Gasto mensual no encontrado')
    db.delete(expense)
    db.commit()
    return None


@router.get('/recurring-expenses', response_model=list[RecurringExpenseTemplateRead])
def list_recurring_expenses(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    return db.query(RecurringExpenseTemplate).order_by(RecurringExpenseTemplate.category.asc()).all()


@router.put('/recurring-expenses', response_model=RecurringExpenseTemplateRead)
def upsert_recurring_expense(
    payload: RecurringExpenseTemplateUpsert,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    tpl = (
        db.query(RecurringExpenseTemplate)
        .filter(RecurringExpenseTemplate.category == payload.category)
        .first()
    )
    if not tpl:
        tpl = RecurringExpenseTemplate(category=payload.category)
        db.add(tpl)
    tpl.amount = payload.amount
    tpl.active = payload.active
    db.commit()
    db.refresh(tpl)
    return tpl


@router.delete('/recurring-expenses/{template_id}', status_code=204)
def delete_recurring_expense(
    template_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    tpl = db.query(RecurringExpenseTemplate).filter(RecurringExpenseTemplate.id == template_id).first()
    if not tpl:
        raise HTTPException(status_code=404, detail='Plantilla no encontrada')
    db.delete(tpl)
    db.commit()
    return None


@router.get('/admin/notifications', response_model=list[AdminNotificationRead])
def list_admin_notifications(limit: int = Query(default=20, ge=1, le=100), unread_only: bool = Query(default=False), db: Session = Depends(get_db), user: User = Depends(require_admin)):
    query = db.query(AdminNotification)
    if unread_only:
        query = query.filter(AdminNotification.is_read.is_(False))
    return query.order_by(AdminNotification.created_at.desc()).limit(limit).all()


@router.post('/admin/notifications/{notification_id}/read', response_model=AdminNotificationRead)
def mark_notification_as_read(notification_id: int, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    notification = db.query(AdminNotification).filter(AdminNotification.id == notification_id).first()
    if not notification:
        raise HTTPException(status_code=404, detail='Notification not found')
    notification.is_read = True
    db.commit()
    db.refresh(notification)
    return notification


@router.get('/admin/change-logs', response_model=list[SaleChangeLogRead])
def list_change_logs(limit: int = Query(default=50, ge=1, le=200), sale_date: date | None = Query(default=None), db: Session = Depends(get_db), user: User = Depends(require_admin)):
    query = db.query(SaleChangeLog)
    if sale_date:
        query = query.filter(SaleChangeLog.sale_date == sale_date)
    return query.order_by(SaleChangeLog.changed_at.desc()).limit(limit).all()


@router.get('/stats/dashboard', response_model=DashboardStats)
def dashboard_stats(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    daily_sales = db.query(DailySale).order_by(DailySale.sale_date.asc()).all()
    expenses = db.query(MonthlyExpense).all()
    settings = get_or_create_settings(db)
    extended_schedule_enabled = settings.extended_schedule_enabled

    monthly_sales_map: dict[str, float] = defaultdict(float)
    weekday_totals: dict[str, float] = defaultdict(float)
    daily_target_hits = 0
    morning_wins = 0
    afternoon_wins = 0

    payment_amounts = defaultdict(float)
    payment_customers = defaultdict(int)
    traffic = defaultdict(int)

    for sale in daily_sales:
        month_key = sale.sale_date.strftime('%Y-%m')
        monthly_sales_map[month_key] += sale.total_sales

        weekday = sale.sale_date.strftime('%A').lower()
        weekday_es = {
            'monday': 'lunes', 'tuesday': 'martes', 'wednesday': 'miércoles',
            'thursday': 'jueves', 'friday': 'viernes', 'saturday': 'sábado', 'sunday': 'domingo',
        }.get(weekday, weekday)

        sale_total_for_weekday = sale.total_sales
        if not extended_schedule_enabled:
            if weekday_es == 'domingo':
                continue
            if weekday_es == 'sábado':
                sale_total_for_weekday = sale.morning_total

        weekday_totals[weekday_es] += sale_total_for_weekday

        if sale.total_sales >= DAILY_TARGET:
            daily_target_hits += 1
        if sale.morning_total > sale.afternoon_total:
            morning_wins += 1
        elif sale.afternoon_total > sale.morning_total:
            afternoon_wins += 1

        payment_amounts['Efectivo'] += sale.morning_cash + sale.afternoon_cash
        payment_amounts['Tarjeta'] += sale.morning_card + sale.afternoon_card
        payment_amounts['Bizum'] += sale.morning_bizum + sale.afternoon_bizum
        payment_amounts['Bonos consumo'] += sale.morning_bonos + sale.afternoon_bonos

        payment_customers['Efectivo'] += sale.morning_cash_customers + sale.afternoon_cash_customers
        payment_customers['Tarjeta'] += sale.morning_card_customers + sale.afternoon_card_customers
        payment_customers['Bizum'] += sale.morning_bizum_customers + sale.afternoon_bizum_customers
        payment_customers['Bonos consumo'] += sale.morning_bonos_customers + sale.afternoon_bonos_customers

        traffic[f'{weekday_es} mañana'] += sale.morning_customers_total
        if extended_schedule_enabled or weekday_es != 'sábado':
            traffic[f'{weekday_es} tarde'] += sale.afternoon_customers_total

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

    amount_total = sum(payment_amounts.values())
    customer_total = sum(payment_customers.values())
    payment_method_stats = [
        PaymentMethodShare(
            method=method,
            amount_total=round(payment_amounts[method], 2),
            amount_pct=round((payment_amounts[method] / amount_total) * 100, 2) if amount_total else 0,
            customers_total=payment_customers[method],
            customers_pct=round((payment_customers[method] / customer_total) * 100, 2) if customer_total else 0,
        )
        for method in ['Efectivo', 'Tarjeta', 'Bizum', 'Bonos consumo']
    ]

    customer_traffic = [
        CustomerTrafficSlot(slot=slot, customers_total=count)
        for slot, count in sorted(traffic.items(), key=lambda item: item[1], reverse=True)
    ]

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
        payment_method_stats=payment_method_stats,
        customer_traffic=customer_traffic,
    )
