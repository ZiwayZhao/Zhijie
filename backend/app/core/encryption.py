"""Simple Fernet encryption for user API keys.

Uses SECRET_KEY (first 32 bytes, base64-encoded) as the Fernet key.
"""

import base64
import hashlib

from cryptography.fernet import Fernet

from app.core.config import settings

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        # Derive a 32-byte key from SECRET_KEY via SHA-256
        raw = hashlib.sha256(settings.secret_key.encode()).digest()
        key = base64.urlsafe_b64encode(raw)
        _fernet = Fernet(key)
    return _fernet


def encrypt_api_key(plaintext: str) -> str:
    """Encrypt an API key. Returns base64 ciphertext."""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_api_key(ciphertext: str) -> str:
    """Decrypt an API key."""
    return _get_fernet().decrypt(ciphertext.encode()).decode()


def mask_api_key(plaintext: str) -> str:
    """Mask an API key for display: sk-...last4."""
    if len(plaintext) <= 8:
        return "****"
    return f"{plaintext[:3]}...{plaintext[-4:]}"
