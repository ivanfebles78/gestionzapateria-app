from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.monthly_expense import MonthlyExpense
from app.models.recurring_expense_template import RecurringExpenseTemplate
from app.models.user import User


RECURRING_FIXED_CATEGORIES = [
    'Agua y luz',
    'Alarma',
    'Alquiler',
    'Empleado 1',
    'Internet',
    'Seguridad Social',
    'Asociacion Vecinos Santa Cruz',
]


def _seed_users(db: Session) -> None:
    users_to_create = [
        {
            "username": "Ivan",
            "display_name": "Ivan",
            "password": "Nicole@1",
            "role": "admin",
        },
        {
            "username": "Claudia",
            "display_name": "Claudia",
            "password": "Nicole@1",
            "role": "admin",
        },
        {
            "username": "Tienda",
            "display_name": "Tienda",
            "password": "tienda",
            "role": "store",
        },
        {
            "username": "asesor",
            "display_name": "Asesor",
            "password": "asesor",
            "role": "viewer",
        },
    ]

    for item in users_to_create:
        existing = db.query(User).filter(User.username == item["username"]).first()
        if not existing:
            db_user = User(
                username=item["username"],
                display_name=item["display_name"],
                hashed_password=get_password_hash(item["password"]),
                role=item["role"],
                is_active=True,
            )
            db.add(db_user)
        elif item["username"] == "asesor":
            # Garantiza que el usuario asesor mantenga siempre permisos de solo lectura
            # y la contraseña solicitada, incluso si ya existía en la base de datos.
            existing.display_name = item["display_name"]
            existing.hashed_password = get_password_hash(item["password"])
            existing.role = item["role"]
            existing.is_active = True


def _latest_amount_for_category(db: Session, category: str) -> float:
    row = (
        db.query(MonthlyExpense)
        .filter(MonthlyExpense.category == category)
        .order_by(MonthlyExpense.month_key.desc())
        .first()
    )
    return float(row.amount) if row else 0.0


def _seed_recurring_templates(db: Session) -> None:
    """Crea las plantillas recurrentes si aún no existen.

    Para no perder los importes ya introducidos en meses anteriores, intenta
    leer el último importe registrado por categoría en monthly_expenses y lo
    usa como valor inicial de la plantilla. Si nunca se registró, queda en 0.
    """
    has_templates = db.query(RecurringExpenseTemplate).first() is not None
    if has_templates:
        return

    for category in RECURRING_FIXED_CATEGORIES:
        seed_amount = _latest_amount_for_category(db, category)
        db.add(
            RecurringExpenseTemplate(
                category=category,
                amount=seed_amount,
                active=True,
            )
        )


def init_db(db: Session) -> None:
    _seed_users(db)
    _seed_recurring_templates(db)
    db.commit()
