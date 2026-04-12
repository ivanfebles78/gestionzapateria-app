from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.security import get_password_hash
from app.models import AppSetting, User


def init_db(db: Session) -> None:
    users = [
        ('Ivan', 'Iván', 'admin', settings.INIT_ADMIN_PASSWORD),
        ('Claudia', 'Claudia', 'admin', settings.INIT_ADMIN_PASSWORD),
        ('Tienda', 'Tienda', 'store', settings.INIT_STORE_PASSWORD),
    ]

    for username, display_name, role, password in users:
        existing = db.query(User).filter(User.username == username).first()
        if not existing:
            db.add(User(
                username=username,
                display_name=display_name,
                role=role,
                hashed_password=get_password_hash(password),
                is_active=True,
            ))

    setting = db.query(AppSetting).filter(AppSetting.id == 1).first()
    if not setting:
        db.add(AppSetting(id=1, extended_schedule_enabled=False))

    db.commit()
