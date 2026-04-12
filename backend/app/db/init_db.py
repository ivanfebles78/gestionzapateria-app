from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.user import User


def init_db(db: Session) -> None:
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

    db.commit()