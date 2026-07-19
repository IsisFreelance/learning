import secrets

from fastapi import HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import settings

# 7 days -- long enough that the one admin doesn't need to re-enter the
# password constantly, short enough that a token isn't valid forever if it
# ever leaks.
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

_serializer = URLSafeTimedSerializer(settings.session_secret)


def check_password(password: str) -> bool:
    # Constant-time comparison -- a plain `==` returns as soon as it finds
    # the first mismatched character, which leaks how many leading
    # characters were correct via response timing.
    return secrets.compare_digest(password, settings.admin_password)


def create_session_token() -> str:
    return _serializer.dumps({"admin": True})


def verify_session_token(token: str) -> bool:
    try:
        _serializer.loads(token, max_age=SESSION_MAX_AGE_SECONDS)
        return True
    except (BadSignature, SignatureExpired):
        return False


def require_admin(request: Request) -> None:
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")

    token = auth_header.removeprefix("Bearer ").strip()
    if not verify_session_token(token):
        raise HTTPException(status_code=401, detail="Session expired or invalid — please log in again.")
