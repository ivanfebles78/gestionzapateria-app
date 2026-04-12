from datetime import datetime
from sqlalchemy import DateTime, Float, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class MonthlyExpense(Base):
    __tablename__ = 'monthly_expenses'
    __table_args__ = (UniqueConstraint('month_key', 'category', name='uq_month_category'),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    month_key: Mapped[str] = mapped_column(String(7), index=True)
    category: Mapped[str] = mapped_column(String(100), index=True)
    amount: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
