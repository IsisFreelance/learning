import logging

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.routers.admin import router as admin_router
from app.routers.intake import router as intake_router
from app.routers.products import router as products_router
from app.storage import StorageError

logger = logging.getLogger("app")

app = FastAPI(title="Catalog Intake API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Starlette special-cases a handler registered for the bare `Exception`
# class (or status 500): it gets attached to ServerErrorMiddleware, which
# sits *outside* CORSMiddleware in the stack, so it still can't add a CORS
# header. A handler for a specific exception type like StorageError doesn't
# get that special-casing -- it's registered on ExceptionMiddleware, which
# sits *inside* CORSMiddleware, so the response it returns gets the header
# correctly. That's why this targets StorageError specifically rather than
# Exception generally.
@app.exception_handler(StorageError)
async def storage_error_handler(request: Request, exc: StorageError) -> JSONResponse:
    logger.exception("Storage error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=503, content={"detail": "Failed to load a photo — please try again."})

# Only the multipart upload endpoint legitimately needs a large body, and it
# already enforces its own 15MB cap in validation.py by reading in bounded
# chunks. Every JSON endpoint (confirm, status updates, etc.) has no reason
# to ever see more than a few KB — without this, Starlette buffers the
# entire body into memory before Pydantic validation (and its max_length
# checks) ever run, so a single oversized POST could exhaust the process's
# memory before any per-field validation gets a chance to reject it.
MAX_JSON_BODY_BYTES = 100_000


@app.middleware("http")
async def limit_json_body_size(request: Request, call_next):
    if request.headers.get("content-type", "").startswith("application/json"):
        content_length = request.headers.get("content-length")
        if content_length is not None and int(content_length) > MAX_JSON_BODY_BYTES:
            return JSONResponse(status_code=413, content={"detail": "Request body too large."})
    return await call_next(request)

app.include_router(admin_router)
app.include_router(intake_router)
app.include_router(products_router)


@app.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
