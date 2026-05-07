import os
import secrets
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

    return dirs

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
