import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Replace the raw_packets(message_id) index with (message_id, timestamp).

    /api/health asks for MIN(timestamp) of undecrypted packets; with only the
    message_id index that walks every undecrypted row while holding the DB.
    """
    col_cursor = await conn.execute("PRAGMA table_info(raw_packets)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if not {"message_id", "timestamp"} <= columns:
        await conn.commit()
        return
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_raw_packets_message_id_ts "
        "ON raw_packets(message_id, timestamp)"
    )
    await conn.execute("DROP INDEX IF EXISTS idx_raw_packets_message_id")
    await conn.commit()
