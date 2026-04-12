from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.auth import router as auth_router
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
