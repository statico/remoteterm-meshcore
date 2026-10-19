import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add the minimum gap between outgoing message sends to app_settings."""
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return
    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "send_gap_seconds" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN send_gap_seconds REAL NOT NULL DEFAULT 10"
        )
    await conn.commit()
