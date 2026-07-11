"""IP address analysis helpers for the IPAM and inventory-health features.

Pure computation over the existing inventory models — no new tables. Shared so
the duplicate-IP signal is identical in both the per-VLAN IPAM view and the
inventory health report.
"""

from __future__ import annotations

import ipaddress
from typing import Dict, Iterable, List, Optional, Tuple

from app.models.inventory import Host


def parse_network(subnet: Optional[str]) -> Optional[ipaddress.IPv4Network]:
    """Parse a VLAN subnet into a network, or None if absent/invalid."""
    if not subnet:
        return None
    try:
        net = ipaddress.ip_network(subnet, strict=False)
    except ValueError:
        return None
    if isinstance(net, ipaddress.IPv4Network):
        return net
    return None


def parse_address(value: Optional[str]) -> Optional[ipaddress.IPv4Address]:
    """Parse a host IPv4, or None if it is a placeholder (e.g. ``dhcp``) or invalid."""
    if not value:
        return None
    try:
        addr = ipaddress.ip_address(value.strip())
    except ValueError:
        return None
    if isinstance(addr, ipaddress.IPv4Address):
        return addr
    return None


def usable_addresses(net: ipaddress.IPv4Network) -> List[ipaddress.IPv4Address]:
    """Assignable host addresses in a network (handles /31 and /32)."""
    return list(net.hosts())


def group_duplicate_ips(hosts: Iterable[Host]) -> Dict[str, List[Host]]:
    """Return ``{ip: [hosts]}`` for every IPv4 string assigned to more than one host."""
    by_ip: Dict[str, List[Host]] = {}
    for host in hosts:
        addr = parse_address(host.ipv4)
        if addr is None:
            continue
        by_ip.setdefault(str(addr), []).append(host)
    return {ip: members for ip, members in by_ip.items() if len(members) > 1}


def next_free_ip(
    net: ipaddress.IPv4Network, used: Iterable[ipaddress.IPv4Address]
) -> Optional[str]:
    """First usable address in ``net`` not present in ``used``."""
    used_set = set(used)
    for addr in net.hosts():
        if addr not in used_set:
            return str(addr)
    return None


def partition_hosts(
    net: ipaddress.IPv4Network, hosts: Iterable[Host]
) -> Tuple[
    List[Tuple[Host, ipaddress.IPv4Address]],
    List[Host],
    List[Host],
]:
    """Split hosts into (in_subnet, out_of_subnet, unparsed) relative to ``net``."""
    in_subnet: List[Tuple[Host, ipaddress.IPv4Address]] = []
    out_of_subnet: List[Host] = []
    unparsed: List[Host] = []
    for host in hosts:
        addr = parse_address(host.ipv4)
        if addr is None:
            unparsed.append(host)
        elif addr in net:
            in_subnet.append((host, addr))
        else:
            out_of_subnet.append(host)
    return in_subnet, out_of_subnet, unparsed
