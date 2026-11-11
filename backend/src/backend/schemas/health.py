from typing import Literal

from pydantic import BaseModel


class HealthRead(BaseModel):
    status: Literal["ok", "error"]
    database: Literal["ok", "unreachable"]
    commit: str | None  # the deployed git commit, or None outside Render
