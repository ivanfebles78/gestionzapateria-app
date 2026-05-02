from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.attachments import router as attachments_router
from app.api.auth import router as auth_router
from app.api.exports import router as exports_router
from app.api.sales import router as sales_router
from app.core.config import settings
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.db.init_db import init_db
import app.models  # noqa

app = FastAPI(title=settings.APP_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


def _apply_postgres_migrations(connectable) -> None:
    """Migraciones idempotentes para Postgres. Las ejecutamos al arrancar para
    no depender de Alembic en este proyecto pequeño."""
    with connectable.begin() as conn:
        # monthly_expenses: añadir columna name y reemplazar la UQ.
        conn.execute(text(
            "ALTER TABLE monthly_expenses ADD COLUMN IF NOT EXISTS name VARCHAR(150) DEFAULT ''"
        ))
        conn.execute(text(
            "UPDATE monthly_expenses SET name = '' WHERE name IS NULL"
        ))
        conn.execute(text(
            "ALTER TABLE monthly_expenses DROP CONSTRAINT IF EXISTS uq_month_category"
        ))
        conn.execute(text(
            """
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'uq_month_category_name'
                ) THEN
                    ALTER TABLE monthly_expenses
                    ADD CONSTRAINT uq_month_category_name UNIQUE (month_key, category, name);
                END IF;
            END $$;
            """
        ))


@app.on_event('startup')
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    try:
        _apply_postgres_migrations(engine)
    except Exception:
        # Si la migración falla (BD nueva sin la tabla aún o motor distinto),
        # no bloqueamos el arranque. create_all ya habrá puesto el schema actual.
        pass
    try:
        Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    db = SessionLocal()
    try:
        init_db(db)
    finally:
        db.close()


@app.get('/health')
def health():
    return {'status': 'ok'}


app.include_router(auth_router)
app.include_router(sales_router)
app.include_router(attachments_router)
app.include_router(exports_router)
