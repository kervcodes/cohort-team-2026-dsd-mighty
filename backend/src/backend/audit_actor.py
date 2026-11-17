"""Who made a change: tell the database which user an API write is for.

The bill, vendor and user routes write through the service-role client, so the
database sees the service role, never the person. The audit triggers
(migration 20261110180000_create_audit_trail) therefore read the acting user
from the `X-Audit-Actor-Id` header, which PostgREST exposes to the request's
transaction. This module is the one place that sets it: `require_active` calls
`set_actor`, and the admin Supabase client adds the header to every request it
sends. No route or repository handles it.

The actor lives in a ContextVar, and each request is handled in its own
context, so one request's actor never reaches another's. The header is per HTTP
request, hence per database transaction, so a pooled connection cannot carry it
over either.
"""

from contextvars import ContextVar
from uuid import UUID

import httpx

ACTOR_HEADER = "X-Audit-Actor-Id"

_actor: ContextVar[UUID | None] = ContextVar("audit_actor", default=None)


def set_actor(user_id: UUID) -> None:
    """Name `user_id` as the actor for database writes made in this request."""
    _actor.set(user_id)


def current_actor() -> UUID | None:
    return _actor.get()


def attach_actor_header(session: httpx.Client) -> None:
    """Send the current actor, if any, with every request `session` makes."""

    def add_actor_header(request: httpx.Request) -> None:
        # Never forward a header some other code set: the actor is only ever
        # the one `set_actor` named.
        request.headers.pop(ACTOR_HEADER, None)
        actor = _actor.get()
        if actor is not None:
            request.headers[ACTOR_HEADER] = str(actor)

    session.event_hooks["request"].append(add_actor_header)
