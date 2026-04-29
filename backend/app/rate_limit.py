from fastapi import Request
from slowapi import Limiter

from .config import settings


def get_client_ip(request: Request) -> str:
    """Extract the real client IP from trusted proxy headers.

    Only trusts X-Real-IP when the direct connection comes from a known
    proxy (Docker-internal networks).  Otherwise falls back to the TCP
    peer address so external clients cannot spoof their IP to bypass
    rate limits.
    """
    peer = request.client.host if request.client else "127.0.0.1"
    trusted_proxies = settings.TRUSTED_PROXY_CIDRS
    if trusted_proxies:
        import ipaddress

        try:
            peer_addr = ipaddress.ip_address(peer)
            is_trusted = any(peer_addr in ipaddress.ip_network(cidr, strict=False) for cidr in trusted_proxies)
        except ValueError:
            is_trusted = False
        if is_trusted:
            return request.headers.get("X-Real-IP") or peer
    return peer


limiter = Limiter(key_func=get_client_ip, enabled=not settings.TESTING)
