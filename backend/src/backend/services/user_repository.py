from supabase import Client


def get_users(client: Client) -> list[dict]:
    response = (
        client.table("app_users")
        .select("user_id, full_name, email, role, status, created_at")
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )

    return response.data or []
