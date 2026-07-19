from supabase import Client, create_client

from app.config import settings

_client: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)
_bucket = _client.storage.from_(settings.supabase_storage_bucket)

SIGNED_URL_EXPIRY_SECONDS = 60 * 60  # 1 hour


class StorageError(Exception):
    pass


def upload_bytes(path: str, content: bytes, content_type: str) -> None:
    _bucket.upload(path, content, file_options={"content-type": content_type})


def download_bytes(path: str) -> bytes:
    return _bucket.download(path)


def create_signed_url(path: str) -> str:
    # A page that lists several items signs several URLs at once, and
    # Supabase's storage API occasionally drops a connection mid-request
    # under that kind of burst (seen as httpx.RemoteProtocolError) -- one
    # retry clears most of those transient failures outright; StorageError
    # (caught by a dedicated handler in main.py, unlike a bare Exception)
    # covers the rest with a clean error instead of an opaque one.
    for attempt in (1, 2):
        try:
            result = _bucket.create_signed_url(path, SIGNED_URL_EXPIRY_SECONDS)
            return result["signedURL"]
        except Exception as exc:
            if attempt == 2:
                raise StorageError(f"Failed to create a signed URL for {path!r}.") from exc
