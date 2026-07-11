from typing import List, Literal, Optional

from pydantic import BaseModel

Severity = Literal["info", "warn"]


class HealthFinding(BaseModel):
    category: str
    severity: Severity
    message: str
    entity: str
    entity_id: Optional[str] = None
    link: Optional[str] = None


class HealthCounts(BaseModel):
    info: int = 0
    warn: int = 0


class HealthReport(BaseModel):
    counts: HealthCounts
    total: int
    findings: List[HealthFinding]
