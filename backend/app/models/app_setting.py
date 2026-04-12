from datetime import datetime
from sqlalchemy import Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class AppSetting(Base):
    __tablename__ = 'app_settings'

    id: Mapped[int] = mapped_column(primary_key=True)
    extended_schedule_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
