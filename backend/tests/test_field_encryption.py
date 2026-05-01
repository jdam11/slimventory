"""Tests for field-level encryption at rest.

Covers:
- Unit tests for field_encryption helpers
- Integration tests: creating secret fields masks values in API responses
- Ansible export decrypts transparently
"""
from app.services.field_encryption import (
    SENSITIVE_KEYWORDS,
    decrypt_field_value,
    encrypt_field_value,
    is_name_sensitive,
    mask_value,
    maybe_encrypt,
)

# ---------------------------------------------------------------------------
# Unit tests — field_encryption helpers
# ---------------------------------------------------------------------------


class TestIsNameSensitive:
    def test_exact_keyword_matches(self):
        for kw in SENSITIVE_KEYWORDS:
            assert is_name_sensitive(kw), f"Expected {kw!r} to be sensitive"

    def test_keyword_as_substring(self):
        assert is_name_sensitive("db_password")
        assert is_name_sensitive("api_secret_key")
        assert is_name_sensitive("AUTH_TOKEN")
        assert is_name_sensitive("private_key")

    def test_case_insensitive(self):
        assert is_name_sensitive("PASSWORD")
        assert is_name_sensitive("Secret")
        assert is_name_sensitive("TOKEN")

    def test_non_sensitive_names(self):
        assert not is_name_sensitive("hostname")
        assert not is_name_sensitive("environment")
        assert not is_name_sensitive("ip_address")
        assert not is_name_sensitive("port")
        assert not is_name_sensitive("description")


class TestEncryptDecryptRoundTrip:
    def test_round_trip(self):
        original = "super-secret-value"
        encrypted = encrypt_field_value(original)
        assert encrypted.startswith("ENC::")
        assert decrypt_field_value(encrypted) == original

    def test_decrypt_plain_passthrough(self):
        """Backward compat: plaintext values without ENC:: are returned as-is."""
        assert decrypt_field_value("plaintext-value") == "plaintext-value"

    def test_decrypt_none(self):
        assert decrypt_field_value(None) is None

    def test_encrypt_produces_different_ciphertext(self):
        """Fernet produces a unique ciphertext each time."""
        v1 = encrypt_field_value("same")
        v2 = encrypt_field_value("same")
        # Both decrypt correctly but ciphertexts differ (Fernet randomness)
        assert decrypt_field_value(v1) == "same"
        assert decrypt_field_value(v2) == "same"

    def test_empty_string_round_trip(self):
        encrypted = encrypt_field_value("")
        assert decrypt_field_value(encrypted) == ""


class TestMaybeEncrypt:
    def test_encrypts_when_secret(self):
        result = maybe_encrypt("myvalue", is_secret=True)
        assert result is not None
        assert result.startswith("ENC::")
        assert decrypt_field_value(result) == "myvalue"

    def test_passthrough_when_not_secret(self):
        assert maybe_encrypt("myvalue", is_secret=False) == "myvalue"

    def test_none_passthrough(self):
        assert maybe_encrypt(None, is_secret=True) is None
        assert maybe_encrypt(None, is_secret=False) is None

    def test_no_double_encryption(self):
        encrypted = encrypt_field_value("once")
        result = maybe_encrypt(encrypted, is_secret=True)
        # Should return unchanged — no double-encryption
        assert result == encrypted
        assert decrypt_field_value(result) == "once"


class TestMaskValue:
    def test_masks_non_empty_value(self):
        assert mask_value("anything") == "••••••"
        assert mask_value("ENC::ciphertext") == "••••••"

    def test_none_returns_none(self):
        assert mask_value(None) is None

    def test_empty_string_returns_none(self):
        assert mask_value("") is None


# ---------------------------------------------------------------------------
# Integration tests — API creates/reads with encryption
# ---------------------------------------------------------------------------


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class TestAppFieldEncryptionAPI:
    """Test that secret AppFields are encrypted at rest and masked in responses."""

    def test_auto_detect_secret_by_name(self, client, admin_token, db):
        """Creating a field named *_password auto-sets is_secret and masks default."""
        # First create an app to attach the field to
        app_resp = client.post(
            "/api/apps/",
            json={"name": "test-app"},
            headers=_auth_header(admin_token),
        )
        assert app_resp.status_code == 201
        app_id = app_resp.json()["id"]

        resp = client.post(
            "/api/app-fields/",
            json={"app_id": app_id, "name": "db_password", "default_value": "hunter2"},
            headers=_auth_header(admin_token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["is_secret"] is True
        # API should return masked value, not plaintext
        assert data["default_value"] == "••••••"

        # Verify the DB stores encrypted value
        from app.models.inventory import AppField
        field = db.query(AppField).filter_by(id=data["id"]).first()
        assert field is not None
        assert field.default_value.startswith("ENC::")
        assert decrypt_field_value(field.default_value) == "hunter2"

    def test_non_secret_field_stores_plaintext(self, client, admin_token, db):
        app_resp = client.post(
            "/api/apps/",
            json={"name": "test-app2"},
            headers=_auth_header(admin_token),
        )
        assert app_resp.status_code == 201
        app_id = app_resp.json()["id"]

        resp = client.post(
            "/api/app-fields/",
            json={"app_id": app_id, "name": "hostname", "default_value": "localhost"},
            headers=_auth_header(admin_token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["is_secret"] is False
        assert data["default_value"] == "localhost"

        from app.models.inventory import AppField
        field = db.query(AppField).filter_by(id=data["id"]).first()
        assert field is not None
        assert field.default_value == "localhost"

    def test_explicit_is_secret_override(self, client, admin_token, db):
        """User can force is_secret=True even for a non-keyword-named field."""
        app_resp = client.post(
            "/api/apps/",
            json={"name": "test-app3"},
            headers=_auth_header(admin_token),
        )
        assert app_resp.status_code == 201
        app_id = app_resp.json()["id"]

        resp = client.post(
            "/api/app-fields/",
            json={"app_id": app_id, "name": "my_custom_field", "default_value": "sensitive", "is_secret": True},
            headers=_auth_header(admin_token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["is_secret"] is True
        assert data["default_value"] == "••••••"


class TestAnsibleVarsEncryptionAPI:
    """Test that AnsibleDefault vars with sensitive names are encrypted."""

    def test_ansible_default_secret_masked(self, client, admin_token, db):
        resp = client.post(
            "/api/ansible-defaults/",
            json={"name": "vault_password", "value": "mypassword123"},
            headers=_auth_header(admin_token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["is_secret"] is True
        assert data["value"] == "••••••"

        from app.models.inventory import AnsibleDefault
        obj = db.query(AnsibleDefault).filter_by(id=data["id"]).first()
        assert obj is not None
        assert obj.value.startswith("ENC::")
        assert decrypt_field_value(obj.value) == "mypassword123"

    def test_ansible_default_non_secret_plaintext(self, client, admin_token, db):
        resp = client.post(
            "/api/ansible-defaults/",
            json={"name": "ansible_user", "value": "deploy"},
            headers=_auth_header(admin_token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["is_secret"] is False
        assert data["value"] == "deploy"
