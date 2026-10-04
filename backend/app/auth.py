"""Authentication and authorization utilities."""

from datetime import datetime, timezone, timedelta
from typing import Annotated, Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, HTTPException, Header, status
from pydantic import BaseModel

from app import config

ph = PasswordHasher()

ROLE_HIERARCHY = {
    "volunteer": 1,
    "supervisor": 2,
    "admin": 3,
}


class StaffUser(BaseModel):
    id: str
    name: str
    email: str
    role: str


def hash_password(password: str) -> str:
    return ph.hash(password)


def verify_password(password: str, hash_val: str) -> bool:
    try:
        return ph.verify(hash_val, password)
    except VerifyMismatchError:
        return False


def create_access_token(staff_id: str, email: str, name: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=config.JWT_EXPIRY_HOURS)
    payload = {
        "sub": staff_id,
        "email": email,
        "name": name,
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm="HS256")


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, config.JWT_SECRET, algorithms=["HS256"])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_current_staff(authorization: Annotated[str | None, Header()] = None) -> StaffUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization.split(" ", 1)[1]
    payload = decode_access_token(token)
    return StaffUser(
        id=payload["sub"],
        name=payload["name"],
        email=payload["email"],
        role=payload["role"],
    )


def require_role(min_role: str):
    def role_checker(staff: Annotated[StaffUser, Depends(get_current_staff)]) -> StaffUser:
        required_level = ROLE_HIERARCHY.get(min_role, 99)
        user_level = ROLE_HIERARCHY.get(staff.role, 0)
        if user_level < required_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Forbidden: role '{min_role}' or higher required",
            )
        return staff

    return role_checker
