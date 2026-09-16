import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add nullable per-contact flood-scope override column.

    Same tri-state as the channel column: NULL inherits the global scope, "*"
    forces unscoped/plain flood, and a "#Region" value scopes DMs to that region.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "contacts" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return
    try:
        await conn.execute("ALTER TABLE contacts ADD COLUMN flood_scope_override TEXT")
        await conn.commit()
    except Exception as e:
        if "duplicate column" in str(e).lower():
            await conn.commit()
        else:
            raise
