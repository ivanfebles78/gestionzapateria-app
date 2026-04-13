from datetime import date, datetime
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class AdminNotification(Base):
    __tablename__ = 'admin_notifications'

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    type: Mapped[str] = mapped_column(String(50), index=True)
    title: Mapped[str] = mapped_column(String(150))
    message: Mapped[str] = mapped_column(Text)
    sale_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id'), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)