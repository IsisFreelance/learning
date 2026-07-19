from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth import check_password, create_session_token, require_admin
from app.database import get_db
from app.rate_limit import RateLimitExceeded, check_and_increment, client_ip
from app.schemas import LoginIn, LoginOut

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/login", response_model=LoginOut)
def login(request: Request, body: LoginIn, db: Session = Depends(get_db)):
    try:
        # A tight cap on the one endpoint that guards a single shared
        # password -- everything else in this app relies on this password
        # actually resisting a brute-force guess.
        check_and_increment(db, f"admin-login:{client_ip(request)}", limit=5)
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many login attempts — please wait a few minutes and try again.")

    if not check_password(body.password):
        raise HTTPException(status_code=401, detail="Incorrect password.")

    return LoginOut(token=create_session_token())


@router.get("/me")
def me(_: None = Depends(require_admin)):
    return {"ok": True}
