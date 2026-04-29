from __future__ import annotations

import os
import tempfile


def write_vault_password_file(vault_password: str) -> str:
    fd, path = tempfile.mkstemp(prefix="slim_vault_", suffix=".txt")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(vault_password)
            if not vault_password.endswith("\n"):
                handle.write("\n")
        os.chmod(path, 0o600)
        return path
    except Exception:
        try:
            os.unlink(path)
        except OSError:
            pass
        raise
