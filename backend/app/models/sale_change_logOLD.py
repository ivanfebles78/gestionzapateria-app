from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SaleChangeLog(Base):
    __tablename__ = 'sale_change_logs'

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    sale_date: Mapped[date] = mapped_column(Date, index=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    changed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id'), nullable=True)
    changed_by_display_name: Mapped[str] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(20), index=True)

    morning_cash: Mapped[float] = mapped_column(Float, default=0)
    morning_card: Mapped[float] = mapped_column(Float, default=0)
    morning_bizum: Mapped[float] = mapped_column(Float, default=0)
    morning_bonos: Mapped[float] = mapped_column(Float, default=0)
    morning_total: Mapped[float] = mapped_column(Float, default=0)

    afternoon_cash: Mapped[float] = mapped_column(Float, default=0)
    afternoon_card: Mapped[float] = mapped_column(Float, default=0)
    afternoon_bizum: Mapped[float] = mapped_column(Float, default=0)
    afternoon_bonos: Mapped[float] = mapped_column(Float, default=0)
    afternoon_total: Mapped[float] = mapped_column(Float, default=0)

    total_sales: Mapped[float] = mapped_column(Float, default=0)
    daily_expenses_total: Mapped[float] = mapped_column(Float, default=0)
    daily_balance: Mapped[float] = mapped_column(Float, default=0)

    customers: Mapped[int | None] = mapped_column(Integer, nullable=True)