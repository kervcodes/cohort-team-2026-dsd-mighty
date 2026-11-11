from supabase import Client
from backend.schemas.user import UserAdminUpdate

USER_COLUMNS = "user_id, full_name, email, role, status, created_at"

def get_users(client: Client) -> list[dict]:
    response = (
        client.table("app_users")
        .select(USER_COLUMNS)
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )

    return response.data or []

def get_user_by_id(client:Client,user_id:str)-> dict | None:
    response = (
        client.table("app_users")
        .select(USER_COLUMNS)
        .eq("user_id",user_id)
        .maybe_single()
        .execute()
    )
    return response.data if response else None

def update_user(
    client: Client,
    user_to_be_updated_id: str,
    updater_id: str,
    user_updates: UserAdminUpdate,
) -> dict | None:

    if user_to_be_updated_id == updater_id:
        return None

    payload = user_updates.model_dump(
        mode="json",
        exclude_unset=True,
    )

    response = (
        client.table("app_users")
        .update(payload)
        .eq("user_id", user_to_be_updated_id)
        .neq("user_id", updater_id)
        .select(USER_COLUMNS)
        .execute()
    )

    rows = response.data or []

    return rows[0] if len(rows) == 1 else None