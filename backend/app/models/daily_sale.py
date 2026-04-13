from datetime import date, datetime
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class DailySale(Base):
    __tablename__ = 'daily_sales'

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    sale_date: Mapped[date] = mapped_column(Date, unique=True, index=True)
    morning_sales: Mapped[float] = mapped_column(Float, default=0)
    afternoon_sales: Mapped[float] = mapped_column(Float, default=0)
    total_sales: Mapped[float] = mapped_column(Float, default=0)
    worked: Mapped[bool] = mapped_column(Boolean, default=True)
    customers: Mapped[int | None] = mapped_column(Integer, nullable=True)
    extended_schedule: Mapped[bool] = mapped_column(Boolean, default=False)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id'), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)