from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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


@app.on_event('startup')
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    try:
        Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    except Exception:
        # Si Railway no tiene volumen montado todavía, lo dejamos para el primer
        # upload (el endpoint vuelve a intentar crear el directorio).
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
