from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.api.dependencies import get_current_user
from app.core.security import create_access_token, verify_password
from app.db.deps import get_db
from app.models import User
from app.schemas.auth import CurrentUser, LoginRequest, Token

router = APIRouter(prefix='/api/auth', tags=['auth'])


@router.post('/login', response_model=Token)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username, User.is_active.is_(True)).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail='Invalid username or password')
    return Token(access_token=create_access_token(user.username))


@router.get('/me', response_model=CurrentUser)
def me(user: User = Depends(get_current_user)):
    return CurrentUser.model_validate(user, from_attributes=True)
