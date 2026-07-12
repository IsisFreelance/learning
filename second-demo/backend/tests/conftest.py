import os

# Set before any `app.*` module is imported by a test file — app.config
# requires these with no defaults, and tests shouldn't depend on the
# developer's real local .env (or its real secrets) just to run.
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://test:test@localhost:5432/test")
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-key")
