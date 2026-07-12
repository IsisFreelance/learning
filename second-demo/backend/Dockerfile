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

# Render sets $PORT at runtime; sh -c is needed so the shell expands it.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
