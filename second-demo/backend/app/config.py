from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    frontend_origin: str = "http://localhost:5173"

    supabase_url: str
    supabase_service_role_key: str
    supabase_storage_bucket: str = "intake-photos"

    @field_validator("database_url")
    @classmethod
    def use_psycopg_driver(cls, v: str) -> str:
        # Accepts the plain "postgresql://" URLs every host/dashboard hands
        # out by default and rewrites them for the psycopg (v3) driver this
        # project actually installs — psycopg2 was never added, so a bare
        # "postgresql://" URL would otherwise fail to connect at all.
        if v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+psycopg://", 1)
        return v

    @field_validator("supabase_url")
    @classmethod
    def strip_rest_suffix(cls, v: str) -> str:
        # The dashboard's "Project URL" field and the REST endpoint URL
        # look similar enough to paste the wrong one — normalize either
        # to the bare project URL the SDK actually expects.
        return v.rstrip("/").removesuffix("/rest/v1")


settings = Settings()
