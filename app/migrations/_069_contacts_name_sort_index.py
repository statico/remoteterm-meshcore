import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Index contacts by their list sort key.

    GET /contacts pages ORDER BY COALESCE(name, public_key); without this every
    page sorts the whole table before applying LIMIT/OFFSET.
    """
    col_cursor = await conn.execute("PRAGMA table_info(contacts)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if {"name", "public_key"} <= columns:
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_contacts_name_sort "
            "ON contacts(COALESCE(name, public_key))"
        )
    await conn.commit()
