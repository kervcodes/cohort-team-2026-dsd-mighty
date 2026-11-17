from functools import lru_cache

from backend.audit_actor import attach_actor_header
from backend.settings import get_settings
from supabase import Client, ClientOptions, create_client

# One client each per process, shared by every request. They must never hold
# a user session: with persist_session off, a sign-in on a shared client
# cannot leak one user's token into another request.
SHARED_CLIENT_OPTIONS = ClientOptions(persist_session=False, auto_refresh_token=False)


@lru_cache
def get_supabase() -> Client:
    settings = get_settings()
    return create_client(
        settings.supabase_url,
        settings.supabase_publishable_key,
        options=SHARED_CLIENT_OPTIONS,
    )


@lru_cache
def get_admin_supabase() -> Client:
    settings = get_settings()
    client = create_client(
        settings.supabase_url,
        settings.supabase_secret_key,
        options=SHARED_CLIENT_OPTIONS,
    )
    # Its writes carry the signed-in user, for the audit trail (audit_actor).
    attach_actor_header(client.postgrest.session)
    return client
