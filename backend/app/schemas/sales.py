from datetime import date, datetime
from pydantic import BaseModel, Field, computed_field


class DailySaleUpsert(BaseModel):
    sale_date: date
    morning_sales: float = Field(default=0, ge=0)
    afternoon_sales: float = Field(default=0, ge=0)
    worked: bool = True
    customers: int | None = Field(default=None, ge=0)
    extended_schedule: bool = False

    @computed_field
    @property
    def total_sales(self) -> float:
        return round(self.morning_sales + self.afternoon_sales, 2)


class DailySaleRead(BaseModel):
    id: int
    sale_date: date
    morning_sales: float
    afternoon_sales: float
    total_sales: float
    worked: bool
    customers: int | None
    extended_schedule: bool
    is_locked: bool

    class Config:
        from_attributes = True


class MonthlyExpenseUpsert(BaseModel):
    month_key: str
    category: str
    amount: float = Field(ge=0)


class MonthlyExpenseRead(BaseModel):
    id: int
    month_key: str
    category: str
    amount: float

    class Config:
        from_attributes = True


class AppSettingsUpdate(BaseModel):
    extended_schedule_enabled: bool


class AppSettingsRead(BaseModel):
    extended_schedule_enabled: bool


class MonthlySummary(BaseModel):
    month_key: str
    sales_total: float
    expenses_total: float
    balance: float
    target_progress_pct: int


class DashboardStats(BaseModel):
    daily_target_rate: int
    monthly_target_rate: int
    best_weekday: str
    worst_weekday: str
    morning_wins: int
    afternoon_wins: int
    monthly_summaries: list[MonthlySummary]


class SaleChangeLogRead(BaseModel):
    id: int
    sale_date: date
    changed_at: datetime
    changed_by_user_id: int | None
    changed_by_display_name: str
    action: str
    morning_sales: float
    afternoon_sales: float
    customers: int | None

    class Config:
        from_attributes = True


class AdminNotificationRead(BaseModel):
    id: int
    type: str
    title: str
    message: str
    sale_date: date | None
    is_read: bool
    created_by_user_id: int | None
    created_at: datetime

    class Config:
        from_attributes = True