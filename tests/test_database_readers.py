"""The file-database reader pool: reads overlap writes and each other safely."""

import asyncio
import sqlite3

import pytest

from app.database import READER_POOL_SIZE, Database


@pytest.fixture
async def file_db(tmp_path):
    db = Database(str(tmp_path / "pool test.db"))  # space: URI must be quoted
    await db.connect()
    yield db
    await db.disconnect()


COUNT = "SELECT COUNT(*) FROM channels WHERE key IN ('AA', 'BB')"


async def _count(db: Database) -> int:
    async with db.readonly() as conn, conn.execute(COUNT) as cur:
        return (await cur.fetchone())[0]


@pytest.mark.asyncio
async def test_reads_see_committed_writes_and_reject_writes(file_db):
    async with file_db.tx() as conn:
        await conn.execute("INSERT INTO channels (key, name) VALUES ('AA', '#a')")
    assert await _count(file_db) == 1

    with pytest.raises(sqlite3.OperationalError, match="readonly"):
        async with file_db.readonly() as conn:
            await conn.execute("INSERT INTO channels (key, name) VALUES ('BB', '#b')")
    assert await _count(file_db) == 1  # the pool connection is still usable


@pytest.mark.asyncio
async def test_reads_run_while_a_write_is_open_and_keep_one_snapshot(file_db):
    async with file_db.tx() as conn:
        await conn.execute("INSERT INTO channels (key, name) VALUES ('AA', '#a')")

    async with file_db.readonly() as reader:
        async with reader.execute(COUNT) as cur:
            before = (await cur.fetchone())[0]
        # The write lock is free to take while a read is open, and commits.
        async with file_db.tx() as conn:
            await conn.execute("INSERT INTO channels (key, name) VALUES ('BB', '#b')")
        async with reader.execute(COUNT) as cur:
            during = (await cur.fetchone())[0]
    assert (before, during) == (1, 1)
    assert await _count(file_db) == 2

    # More concurrent reads than pool connections queue rather than fail.
    async with file_db.tx():  # held write lock must not block reads
        counts = await asyncio.wait_for(
            asyncio.gather(*(_count(file_db) for _ in range(READER_POOL_SIZE * 3))), 5
        )
    assert counts == [2] * (READER_POOL_SIZE * 3)
