from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DailySale(Base):
    __tablename__ = 'daily_sales'

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    sale_date: Mapped[date] = mapped_column(Date, unique=True, index=True)

    # Morning sales by payment method
    morning_cash: Mapped[float] = mapped_column(Float, default=0)
    morning_card: Mapped[float] = mapped_column(Float, default=0)
    morning_bizum: Mapped[float] = mapped_column(Float, default=0)
    morning_bonos: Mapped[float] = mapped_column(Float, default=0)
    morning_total: Mapped[float] = mapped_column(Float, default=0)

    # Morning customers by payment method
    morning_cash_customers: Mapped[int] = mapped_column(Integer, default=0)
    morning_card_customers: Mapped[int] = mapped_column(Integer, default=0)
    morning_bizum_customers: Mapped[int] = mapped_column(Integer, default=0)
    morning_bonos_customers: Mapped[int] = mapped_column(Integer, default=0)
    morning_customers_total: Mapped[int] = mapped_column(Integer, default=0)

    # Afternoon sales by payment method
    afternoon_cash: Mapped[float] = mapped_column(Float, default=0)
    afternoon_card: Mapped[float] = mapped_column(Float, default=0)
    afternoon_bizum: Mapped[float] = mapped_column(Float, default=0)
    afternoon_bonos: Mapped[float] = mapped_column(Float, default=0)
    afternoon_total: Mapped[float] = mapped_column(Float, default=0)

    # Afternoon customers by payment method
    afternoon_cash_customers: Mapped[int] = mapped_column(Integer, default=0)
    afternoon_card_customers: Mapped[int] = mapped_column(Integer, default=0)
    afternoon_bizum_customers: Mapped[int] = mapped_column(Integer, default=0)
    afternoon_bonos_customers: Mapped[int] = mapped_column(Integer, default=0)
    afternoon_customers_total: Mapped[int] = mapped_column(Integer, default=0)

    # Daily totals
    total_sales: Mapped[float] = mapped_column(Float, default=0)
    daily_expenses_total: Mapped[float] = mapped_column(Float, default=0)
    daily_balance: Mapped[float] = mapped_column(Float, default=0)
    customers_total: Mapped[int] = mapped_column(Integer, default=0)

    worked: Mapped[bool] = mapped_column(Boolean, default=True)
    extended_schedule: Mapped[bool] = mapped_column(Boolean, default=False)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)

    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id'), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
