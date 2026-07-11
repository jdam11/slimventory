from typing import List, Optional

from pydantic import BaseModel


class IpamUsedIp(BaseModel):
    ip: str
    host_id: int
    host_name: str


class IpamConflict(BaseModel):
    ip: str
    hosts: List[IpamUsedIp]


class IpamDrift(BaseModel):
    host_id: int
    host_name: str
    inventory_ip: str
    observed_ip: str


class IpamVlanSummary(BaseModel):
    vlan_pk: int
    vlan_id: int
    subnet: Optional[str] = None
    description: Optional[str] = None
    scoped: bool
    host_count: int
    total_usable: int
    allocated_count: int
    free_count: int
    utilization_pct: float
    conflict_count: int


class IpamUnparsedHost(BaseModel):
    host_id: int
    host_name: str
    value: Optional[str] = None


class IpamVlanDetail(IpamVlanSummary):
    used: List[IpamUsedIp]
    conflicts: List[IpamConflict]
    out_of_subnet: List[IpamUsedIp]
    unparsed: List[IpamUnparsedHost]
    drift: List[IpamDrift]
    next_free_ip: Optional[str] = None


class IpamSummaryResponse(BaseModel):
    items: List[IpamVlanSummary]
    total: int
