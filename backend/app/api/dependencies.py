from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.deps import get_db
from app.models import User


oauth2_scheme = OAuth2PasswordBearer(tokenUrl='/api/auth/login')


def get_current_user(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail='Could not validate credentials',
        headers={'WWW-Authenticate': 'Bearer'},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=['HS256'])
        username = payload.get('sub')
        if not username:
            raise credentials_exception
    except JWTError as exc:
        raise credentials_exception from exc

    user = db.query(User).filter(User.username == username, User.is_active.is_(True)).first()
    if not user:
        raise credentials_exception
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != 'admin':
        raise HTTPException(status_code=403, detail='Admin access required')
    return user


READ_ONLY_ROLES = {'viewer', 'readonly', 'read_only', 'asesor'}


def is_read_only_user(user: User) -> bool:
    return (user.role or '').lower() in READ_ONLY_ROLES


def require_write_access(user: User = Depends(get_current_user)) -> User:
    if is_read_only_user(user):
        raise HTTPException(status_code=403, detail='Este usuario solo tiene permisos de lectura')
    return user


def require_export_access(user: User = Depends(get_current_user)) -> User:
    # Cualquier usuario autenticado puede exportar/descargar. Los usuarios de solo lectura
    # quedan autorizados aquí porque no se modifica ningún dato.
    return user
