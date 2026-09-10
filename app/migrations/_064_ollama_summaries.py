import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add the Ollama unread-summary settings to app_settings."""
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}

    # Off by default with an empty model: the feature stays inert until an
    # operator points it at a server and picks a model they have pulled.
    for name, ddl in (
        ("ollama_enabled", "INTEGER NOT NULL DEFAULT 0"),
        ("ollama_base_url", "TEXT NOT NULL DEFAULT 'http://localhost:11434'"),
        ("ollama_model", "TEXT NOT NULL DEFAULT ''"),
    ):
        if name not in columns:
            await conn.execute(f"ALTER TABLE app_settings ADD COLUMN {name} {ddl}")

    await conn.commit()
