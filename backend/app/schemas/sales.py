from datetime import date, datetime

from pydantic import BaseModel, Field, computed_field


class DailyExpenseCreate(BaseModel):
    sale_date: date
    concept: str = Field(min_length=1, max_length=255)
    amount: float = Field(ge=0)


class DailyExpenseRead(BaseModel):
    id: int
    sale_date: date
    concept: str
    amount: float
    created_by_user_id: int | None
    created_at: datetime

    class Config:
        from_attributes = True


class DailySaleUpsert(BaseModel):
    sale_date: date

    morning_cash: float = Field(default=0, ge=0)
    morning_card: float = Field(default=0, ge=0)
    morning_bizum: float = Field(default=0, ge=0)
    morning_bonos: float = Field(default=0, ge=0)

    morning_cash_customers: int = Field(default=0, ge=0)
    morning_card_customers: int = Field(default=0, ge=0)
    morning_bizum_customers: int = Field(default=0, ge=0)
    morning_bonos_customers: int = Field(default=0, ge=0)

    afternoon_cash: float = Field(default=0, ge=0)
    afternoon_card: float = Field(default=0, ge=0)
    afternoon_bizum: float = Field(default=0, ge=0)
    afternoon_bonos: float = Field(default=0, ge=0)

    afternoon_cash_customers: int = Field(default=0, ge=0)
    afternoon_card_customers: int = Field(default=0, ge=0)
    afternoon_bizum_customers: int = Field(default=0, ge=0)
    afternoon_bonos_customers: int = Field(default=0, ge=0)

    worked: bool = True
    extended_schedule: bool = False

    @computed_field
    @property
    def morning_total(self) -> float:
        return round(self.morning_cash + self.morning_card + self.morning_bizum + self.morning_bonos, 2)

    @computed_field
    @property
    def afternoon_total(self) -> float:
        return round(self.afternoon_cash + self.afternoon_card + self.afternoon_bizum + self.afternoon_bonos, 2)

    @computed_field
    @property
    def total_sales(self) -> float:
        return round(self.morning_total + self.afternoon_total, 2)

    @computed_field
    @property
    def morning_customers_total(self) -> int:
        return (
            self.morning_cash_customers + self.morning_card_customers +
            self.morning_bizum_customers + self.morning_bonos_customers
        )

    @computed_field
    @property
    def afternoon_customers_total(self) -> int:
        return (
            self.afternoon_cash_customers + self.afternoon_card_customers +
            self.afternoon_bizum_customers + self.afternoon_bonos_customers
        )

    @computed_field
    @property
    def customers_total(self) -> int:
        return self.morning_customers_total + self.afternoon_customers_total


class DailySaleRead(BaseModel):
    id: int
    sale_date: date

    morning_cash: float
    morning_card: float
    morning_bizum: float
    morning_bonos: float
    morning_total: float

    morning_cash_customers: int
    morning_card_customers: int
    morning_bizum_customers: int
    morning_bonos_customers: int
    morning_customers_total: int

    afternoon_cash: float
    afternoon_card: float
    afternoon_bizum: float
    afternoon_bonos: float
    afternoon_total: float

    afternoon_cash_customers: int
    afternoon_card_customers: int
    afternoon_bizum_customers: int
    afternoon_bonos_customers: int
    afternoon_customers_total: int

    total_sales: float
    daily_expenses_total: float
    daily_balance: float
    customers_total: int

    worked: bool
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


class PaymentMethodShare(BaseModel):
    method: str
    amount_total: float
    amount_pct: float
    customers_total: int
    customers_pct: float


class CustomerTrafficSlot(BaseModel):
    slot: str
    customers_total: int


class DashboardStats(BaseModel):
    daily_target_rate: int
    monthly_target_rate: int
    best_weekday: str
    worst_weekday: str
    morning_wins: int
    afternoon_wins: int
    monthly_summaries: list[MonthlySummary]
    payment_method_stats: list[PaymentMethodShare]
    customer_traffic: list[CustomerTrafficSlot]


class SaleChangeLogRead(BaseModel):
    id: int
    sale_date: date
    changed_at: datetime
    changed_by_user_id: int | None
    changed_by_display_name: str
    action: str

    morning_cash: float
    morning_card: float
    morning_bizum: float
    morning_bonos: float
    morning_total: float
    morning_cash_customers: int
    morning_card_customers: int
    morning_bizum_customers: int
    morning_bonos_customers: int
    morning_customers_total: int

    afternoon_cash: float
    afternoon_card: float
    afternoon_bizum: float
    afternoon_bonos: float
    afternoon_total: float
    afternoon_cash_customers: int
    afternoon_card_customers: int
    afternoon_bizum_customers: int
    afternoon_bonos_customers: int
    afternoon_customers_total: int

    total_sales: float
    daily_expenses_total: float
    daily_balance: float
    customers_total: int

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
