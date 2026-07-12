FROM python:3.12-slim

# tesseract-ocr is the actual OCR program pytesseract shells out to;
# tesseract-ocr-eng is its English text data, not bundled by default.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

# This container now shells out to Tesseract (a native C program) on
# attacker-supplied image bytes — run as a non-root user so a bug in
# Tesseract's own image decoding can't do anything beyond this container.
RUN useradd --create-home --shell /bin/bash appuser

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=appuser:appuser . .

USER appuser

# Applies any pending Alembic migrations before starting the server, so a
# new table/column added in the code is never live without also being live
# in the database -- this bit us for real once already (Phase 3 shipped
# with confirmed_products migrated locally but never applied to Neon,
# which 500'd the live confirm endpoint until this was added). Safe to run
# on every startup: alembic upgrade head is a no-op when already current.
# Render sets $PORT at runtime; sh -c is needed so the shell expands it.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
