"""Authentication routes."""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr

from app.auth import verify_password, create_access_token
from app.db import get_pool

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str



class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    staff: dict


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest):
    pool = get_pool()
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT * FROM staff WHERE email = %s AND active = true",
            (req.email.lower().strip(),),
        ).fetchone()

    if not row or not verify_password(req.password, row["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    token = create_access_token(
        staff_id=str(row["id"]),
        email=row["email"],
        name=row["name"],
        role=row["role"],
    )

    return LoginResponse(
        access_token=token,
        staff={
            "id": str(row["id"]),
            "email": row["email"],
            "name": row["name"],
            "role": row["role"],
        },
    )
