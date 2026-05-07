import os
from datetime import date as date_cls
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user
from app.core.config import settings
from app.db.deps import get_db
from app.models import DailyAttachment, User
from app.schemas.sales import DailyAttachmentRead

router = APIRouter(prefix='/api/daily-attachments', tags=['attachments'])

ALLOWED_KINDS = {'ticket_manana', 'ticket_cierre', 'gasto', 'otro'}
ALLOWED_CONTENT_TYPES = {
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf',
}

EXT_BY_CONTENT_TYPE = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'application/pdf': '.pdf',
}

MONTHS_ES = {
    1: 'enero',
    2: 'febrero',
    3: 'marzo',
    4: 'abril',
    5: 'mayo',
    6: 'junio',
    7: 'julio',
    8: 'agosto',
    9: 'septiembre',
    10: 'octubre',
    11: 'noviembre',
    12: 'diciembre',
}

KIND_FILENAME_PREFIX = {
    'ticket_manana': 'ticket_manana',
    'ticket_cierre': 'ticket_tarde',
    'gasto': 'gasto',
    'otro': 'otro',
}


def _candidate_dirs():
    dirs = []

    upload_dir = getattr(settings, "UPLOAD_DIR", None)
    if upload_dir:
        dirs.append(Path(upload_dir))

    dirs.extend([
        Path("/data/uploads"),
        Path("/app/uploads"),
        Path("uploads"),
    ])

    unique = []
    seen = set()

    for d in dirs:
        key = str(d)
        if key not in seen:
            seen.add(key)
            unique.append(d)

    return unique


def _ensure_upload_dir() -> Path:
    base = Path(getattr(settings, "UPLOAD_DIR", "/data/uploads"))
    base.mkdir(parents=True, exist_ok=True)
    return base


def _safe_extension(filename: str, content_type: str) -> str:
    ext = EXT_BY_CONTENT_TYPE.get(content_type)

    if ext:
        return ext

    _, dot_ext = os.path.splitext(filename or '')
    dot_ext = dot_ext.lower()

    if dot_ext in {'.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.pdf'}:
        return '.jpg' if dot_ext == '.jpeg' else dot_ext

    return '.bin'


def _date_slug_es(value: date_cls) -> str:
    return f"{value.day}{MONTHS_ES[value.month]}{value.year}"


def _build_stored_filename(db: Session, *, sale_date: date_cls, kind: str, ext: str, base_dir: Path) -> str:
    prefix = KIND_FILENAME_PREFIX.get(kind, kind)
    date_slug = _date_slug_es(sale_date)
    base_name = f"{prefix}_{date_slug}"

    existing_db_count = (
        db.query(DailyAttachment)
        .filter(DailyAttachment.sale_date == sale_date, DailyAttachment.kind == kind)
        .count()
    )

    number = existing_db_count + 1

    while True:
        filename = f"{base_name}_{number}{ext}"
        if not (base_dir / filename).exists():
            return filename
        number += 1


@router.get('/debug/files')
def debug_files():
    result = {
        "UPLOAD_DIR": getattr(settings, "UPLOAD_DIR", None),
        "paths": []
    }

    for d in _candidate_dirs():
        item = {
            "path": str(d),
            "exists": d.exists(),
            "files": []
        }

        try:
            if d.exists():
                item["files"] = [f.name for f in d.iterdir() if f.is_file()]
        except Exception as e:
            item["error"] = str(e)

        result["paths"].append(item)

    return result


@router.get('', response_model=list[DailyAttachmentRead])
def list_attachments(
    sale_date: date_cls | None = Query(default=None),
    date_from: date_cls | None = Query(default=None),
    date_to: date_cls | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(DailyAttachment)

    if sale_date:
        query = query.filter(DailyAttachment.sale_date == sale_date)

    if date_from:
        query = query.filter(DailyAttachment.sale_date >= date_from)

    if date_to:
        query = query.filter(DailyAttachment.sale_date <= date_to)

    return query.order_by(DailyAttachment.created_at.desc()).all()


@router.post('', response_model=DailyAttachmentRead)
async def upload_attachment(
    sale_date: date_cls = Form(...),
    kind: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == 'asesor':
        raise HTTPException(status_code=403, detail='Solo lectura')

    if kind not in ALLOWED_KINDS:
        raise HTTPException(status_code=400, detail=f'Tipo de adjunto no soportado: {kind}')

    if sale_date > date_cls.today():
        raise HTTPException(status_code=400, detail='No se pueden subir adjuntos con fecha futura')

    if not file.content_type or file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail=f'Tipo de archivo no soportado: {file.content_type}')

    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    raw = await file.read()

    if len(raw) == 0:
        raise HTTPException(status_code=400, detail='El archivo está vacío')

    if len(raw) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f'Archivo demasiado grande (>{settings.MAX_UPLOAD_SIZE_MB} MB)',
        )

    base_dir = _ensure_upload_dir()
    ext = _safe_extension(file.filename or '', file.content_type)
    stored_filename = _build_stored_filename(
        db,
        sale_date=sale_date,
        kind=kind,
        ext=ext,
        base_dir=base_dir,
    )
    target_path = base_dir / stored_filename

    try:
        with open(target_path, 'wb') as fh:
            fh.write(raw)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f'No se pudo guardar el archivo: {exc}') from exc

    record = DailyAttachment(
        sale_date=sale_date,
        kind=kind,
        original_filename=file.filename or stored_filename,
        stored_filename=stored_filename,
        content_type=file.content_type,
        size_bytes=len(raw),
        uploaded_by_user_id=user.id,
    )

    db.add(record)
    db.commit()
    db.refresh(record)

    return record


@router.get('/{attachment_id}/file')
def download_attachment(
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    record = db.query(DailyAttachment).filter(DailyAttachment.id == attachment_id).first()

    if not record:
        raise HTTPException(status_code=404, detail='Adjunto no encontrado')

    file_path = None

    for base_dir in _candidate_dirs():
        candidate = base_dir / record.stored_filename

        if candidate.is_file():
            file_path = candidate
            break

    if not file_path:
        raise HTTPException(
            status_code=410,
            detail=f'Archivo no encontrado: {record.stored_filename}'
        )

    return FileResponse(
        path=str(file_path),
        media_type=record.content_type or 'application/octet-stream',
        filename=record.original_filename,
    )


@router.delete('/{attachment_id}', status_code=204)
def delete_attachment(
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == 'asesor':
        raise HTTPException(status_code=403, detail='Solo lectura')

    record = db.query(DailyAttachment).filter(DailyAttachment.id == attachment_id).first()

    if not record:
        raise HTTPException(status_code=404, detail='Adjunto no encontrado')

    for base_dir in _candidate_dirs():
        candidate = base_dir / record.stored_filename

        try:
            if candidate.is_file():
                candidate.unlink()
        except Exception:
            pass

    db.delete(record)
    db.commit()

    return None
