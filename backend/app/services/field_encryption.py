"""Encryption helpers for user-defined variables (app/role/status fields, ansible vars).

Values are stored in the database with the prefix ``ENC::`` to distinguish
encrypted ciphertext from legacy plaintext.  This makes the scheme fully
backward-compatible: a value without the prefix is returned as-is during
decryption.

Sensitivity detection
---------------------
A field is considered *secret* when its name contains any of the keywords in
``SENSITIVE_KEYWORDS`` (case-insensitive substring match).  Admins can also
set the ``is_secret`` flag manually to override the auto-detection.
"""

from typing import Optional

from app.security import decrypt_secret, encrypt_secret

_ENC_PREFIX = "ENC::"

SENSITIVE_KEYWORDS = [
    "password",
    "secret",
    "token",
    "api_key",
    "apikey",
    "credential",
    "private",
    "passwd",
    "license",
    "key",
]


def is_name_sensitive(name: str) -> bool:
    """Return True if *name* contains a keyword that suggests a secret value."""
    lower = name.lower()
    return any(kw in lower for kw in SENSITIVE_KEYWORDS)


def encrypt_field_value(value: str) -> str:
    """Encrypt *value* and return it with the ``ENC::`` prefix."""
    return _ENC_PREFIX + encrypt_secret(value)


def decrypt_field_value(value: Optional[str]) -> Optional[str]:
    """Decrypt *value* if it carries the ``ENC::`` prefix; otherwise return as-is.

    This no-op behaviour for non-prefixed values ensures backward compatibility
    with any plaintext data that existed before encryption was introduced.
    """
    if value is None:
        return None
    if value.startswith(_ENC_PREFIX):
        return decrypt_secret(value[len(_ENC_PREFIX) :])
    return value


def maybe_encrypt(value: Optional[str], is_secret: bool) -> Optional[str]:
    """Encrypt *value* only when *is_secret* is True and *value* is not None.

    If the value is already encrypted (has the prefix), it is returned
    unchanged to avoid double-encryption.
    """
    if not is_secret or value is None:
        return value
    if value.startswith(_ENC_PREFIX):
        return value
    return encrypt_field_value(value)


def mask_value(value: Optional[str]) -> Optional[str]:
    """Return a masked placeholder when the field has a value, else None."""
    if value is None:
        return None
    # Return None for empty string too — treat it as "not set"
    if value == "" or value == _ENC_PREFIX:
        return None
    return "••••••"
