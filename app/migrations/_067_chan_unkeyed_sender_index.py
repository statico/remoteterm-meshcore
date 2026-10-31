import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Index unkeyed channel messages by sender name.

    backfill_channel_sender_key runs once per contact during radio sync; without
    this it scans every CHAN message, which stalls post-connect setup on large DBs.
    """
    col_cursor = await conn.execute("PRAGMA table_info(messages)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if not {"type", "sender_name", "sender_key"} <= columns:
        await conn.commit()
        return
    await conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_messages_chan_sender_name_unkeyed
        ON messages(sender_name) WHERE type = 'CHAN' AND sender_key IS NULL
        """
    )
    await conn.commit()
