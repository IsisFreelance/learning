from supabase import Client, create_client

from app.config import settings

_client: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)
_bucket = _client.storage.from_(settings.supabase_storage_bucket)

SIGNED_URL_EXPIRY_SECONDS = 60 * 60  # 1 hour


def upload_bytes(path: str, content: bytes, content_type: str) -> None:
    _bucket.upload(path, content, file_options={"content-type": content_type})


def create_signed_url(path: str) -> str:
    result = _bucket.create_signed_url(path, SIGNED_URL_EXPIRY_SECONDS)
    return result["signedURL"]
