from ipaddress import ip_address
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status

from app.dependencies import get_auth_context, get_database
from app.models import AuthContext, LoginEventIn
from app.supabase_rest import SupabaseRestClient


router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me")
async def me(auth: Annotated[AuthContext, Depends(get_auth_context)]) -> dict:
    return auth.user.model_dump(mode="json")


@router.post("/login-events", status_code=status.HTTP_201_CREATED)
async def create_login_event(
    payload: LoginEventIn,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    database: Annotated[SupabaseRestClient, Depends(get_database)],
) -> dict[str, str]:
    forwarded_for = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    raw_ip = forwarded_for or (request.client.host if request.client else "")
    try:
        client_ip = str(ip_address(raw_ip)) if raw_ip else None
    except ValueError:
        client_ip = None
    await database.insert(
        "login_logs",
        auth.access_token,
        {
            "user_id": str(auth.user.id),
            "source": payload.source,
            "ip_address": client_ip,
            "user_agent": request.headers.get("user-agent", "")[:500],
        },
        return_representation=False,
    )
    return {"status": "recorded"}


@router.get("/login-events")
async def list_login_events(
    auth: Annotated[AuthContext, Depends(get_auth_context)],
    database: Annotated[SupabaseRestClient, Depends(get_database)],
) -> list[dict]:
    return await database.select(
        "login_logs",
        auth.access_token,
        columns="id,source,logged_at",
        order="logged_at.desc",
        limit=50,
    )
