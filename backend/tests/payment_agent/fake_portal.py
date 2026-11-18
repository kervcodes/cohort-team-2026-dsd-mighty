"""A local fake of the DSD demo payment portals, for the payment agent tests.

`FakePortal` serves `portal_site/` (the page and its script) plus a small JSON
API at /api, like the real portals, from a thread on 127.0.0.1. Each test
builds the portal it needs: its style (`billing`, `review`), the service
accounts behind the one login, their bills and past payments, and traps such
as a declined payment or an API call that never answers.

Every POST /api/payments is kept in `payment_posts`, so a test can prove that
nothing (or exactly one thing) was paid. Helpers, not tests.
"""

import json
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from uuid import uuid4

SITE = Path(__file__).parent / "portal_site"
TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
}

EMAIL = "demo@acme.com"
PASSWORD = "Pw-s3cret-7Hq!demo"  # distinctive, so a leak is easy to find

OUR_ACCOUNT = "2000456700"


def in_days(days: int) -> str:
    return (datetime.now(UTC).date() + timedelta(days=days)).isoformat()


@dataclass
class Account:
    number: str
    name: str = "Alder Creek Workshop"
    id: str = field(default_factory=lambda: f"SA-{uuid4().hex[:8]}")

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "number": self.number,
            "name": self.name,
            "propertyName": f"Property {self.number[-2:]}",
            "address": "125 Industrial Way, Springfield, IL 62701",
        }


@dataclass
class FakePortal:
    accounts: list[Account]
    bills: list[dict[str, Any]] = field(default_factory=list)
    payments: list[dict[str, Any]] = field(default_factory=list)
    billing: str = "direct"  # direct | statement | center
    review: bool = False
    decline: bool = False  # the portal declines every payment
    password: str = PASSWORD  # the one login's password
    hang: set[str] = field(default_factory=set)  # API paths that never answer
    company_extra: dict[str, Any] = field(default_factory=dict)
    site: Path = SITE  # the page and scripts served at /
    payment_posts: list[dict[str, Any]] = field(default_factory=list)
    login_attempts: int = 0
    _server: ThreadingHTTPServer | None = None
    _release: threading.Event = field(default_factory=threading.Event)

    @property
    def url(self) -> str:
        assert self._server is not None
        return f"http://127.0.0.1:{self._server.server_address[1]}/"

    def account(self, number: str) -> Account:
        return next(a for a in self.accounts if a.number == number)

    def add_bill(
        self,
        number: str,
        bill_id: str,
        cents: int,
        *,
        status: str = "unpaid",
        due: str | None = None,
    ) -> dict[str, Any]:
        bill = {
            "id": bill_id,
            "serviceAccountId": self.account(number).id,
            "description": "Monthly grounds maintenance",
            "amountCents": cents,
            "dueDate": due or in_days(14),
            "status": status,
        }
        self.bills.append(bill)
        return bill

    def add_payment(
        self, number: str, bill_id: str, cents: int, *, status: str = "succeeded"
    ) -> dict[str, Any]:
        payment = {
            "id": f"PAY-{uuid4().hex[:10].upper()}",
            "serviceAccountId": self.account(number).id,
            "billId": bill_id,
            "amountCents": cents,
            "method": "ACH ending 6789",
            "status": status,
            "createdAt": datetime.now(UTC).isoformat(),
        }
        self.payments.append(payment)
        return payment

    def company(self) -> dict[str, Any]:
        return {
            "id": "fake-utility",
            "billing": self.billing,
            "review": self.review,
            "addressLabel": "Service address",
            **self.company_extra,
        }

    # Server

    def __enter__(self) -> "FakePortal":
        portal = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args: Any) -> None:
                pass

            def _send(self, status: int, body: bytes, kind: str, **headers) -> None:
                self.send_response(status)
                self.send_header("Content-Type", kind)
                self.send_header("Cache-Control", "no-store")
                for name, value in headers.items():
                    self.send_header(name, value)
                self.end_headers()
                self.wfile.write(body)

            def _json(self, status: int, data: Any, **headers) -> None:
                self._send(
                    status, json.dumps(data).encode(), "application/json", **headers
                )

            def _signed_in(self) -> bool:
                return "session=ok" in (self.headers.get("Cookie") or "")

            def _hold(self, path: str) -> bool:
                if path in portal.hang:
                    portal._release.wait(30)
                    return True
                return False

            def do_GET(self) -> None:
                path = self.path.split("?", 1)[0]
                if self._hold(path):
                    return
                static = portal.site / (path.lstrip("/") or "index.html")
                if path == "/company.js":
                    body = f"window.COMPANY = {json.dumps(portal.company())};"
                    self._send(200, body.encode(), "text/javascript")
                elif static.parent == portal.site and static.is_file():
                    kind = TYPES.get(static.suffix, "application/octet-stream")
                    self._send(200, static.read_bytes(), kind)
                elif path == "/api/account":
                    if not self._signed_in():
                        self._json(401, {"error": "Please sign in to continue."})
                        return
                    self._json(
                        200,
                        {
                            "serviceAccounts": [a.to_json() for a in portal.accounts],
                            "bills": portal.bills,
                            "payments": portal.payments,
                        },
                    )
                else:
                    self._json(404, {"error": "Not found."})

            def do_POST(self) -> None:
                path = self.path.split("?", 1)[0]
                length = int(self.headers.get("Content-Length") or 0)
                data = json.loads(self.rfile.read(length) or b"{}")
                if self._hold(path):
                    return
                if path == "/api/login":
                    portal.login_attempts += 1
                    if data.get("email") == EMAIL and data.get("password") == (
                        portal.password
                    ):
                        self._json(
                            200, {"ok": True}, **{"Set-Cookie": "session=ok; Path=/"}
                        )
                    else:
                        self._json(401, {"error": "Invalid email or password."})
                elif path == "/api/payments":
                    if not self._signed_in():
                        self._json(401, {"error": "Please sign in to continue."})
                        return
                    portal.payment_posts.append(data)
                    self._pay(data)
                else:
                    self._json(404, {"error": "Not found."})

            def _pay(self, data: dict[str, Any]) -> None:
                bill = next(
                    (
                        b
                        for b in portal.bills
                        if b["id"] == data.get("billId")
                        and b["serviceAccountId"] == data.get("serviceAccountId")
                    ),
                    None,
                )
                details = data.get("details") or {}
                if bill is None or bill["status"] == "paid":
                    self._json(409, {"error": "This bill is not payable."})
                    return
                if not details.get("authorized") or not details.get("routingNumber"):
                    self._json(400, {"error": "Payment details are incomplete."})
                    return
                declined = portal.decline or data.get("scenario") == "decline"
                payment = {
                    "id": f"PAY-{uuid4().hex[:10].upper()}",
                    "serviceAccountId": bill["serviceAccountId"],
                    "billId": bill["id"],
                    "amountCents": bill["amountCents"],
                    "method": "ACH ending 6789",
                    "status": "declined" if declined else "succeeded",
                    "createdAt": datetime.now(UTC).isoformat(),
                }
                portal.payments.append(payment)
                if not declined:
                    bill["status"] = "paid"
                self._json(200, {"payment": payment})

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self._release.set()
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
