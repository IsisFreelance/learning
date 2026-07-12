from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    frontend_origin: str = "http://localhost:5173"

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


settings = Settings()
