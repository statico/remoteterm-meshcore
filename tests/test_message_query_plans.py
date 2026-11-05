"""Query-plan regression tests for the hot conversation-load queries.

These pin the index each statement seeks so a later rewrite can't silently
fall back to a scan that only shows up on a large database.
"""

import pytest

from app.repository import MessageRepository
from tests.test_message_pagination import CHAN_KEY, seed_same_second_ties

BLOCKED_KEYS = ["bb" * 32]
BLOCKED_NAMES = ["spammer"]


async def plans_for(test_db, call) -> list[str]:
    """Run a repository call and return EXPLAIN QUERY PLAN text for each statement."""
    conn = test_db.conn
    captured: list[tuple[str, list]] = []
    original = conn.execute

    def spy(sql, params=None):
        captured.append((sql, list(params or [])))
        return original(sql, params) if params is not None else original(sql)

    conn.execute = spy
    try:
        await call()
    finally:
        del conn.execute
    plans = []
    for sql, params in captured:
        async with original(f"EXPLAIN QUERY PLAN {sql}", params) as cursor:
            plans.append("\n".join(row[3] for row in await cursor.fetchall()))
    return plans


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("cursor", "bound"),
    [
        ({"before": 1001, "before_id": 10}, "received_at<?"),
        ({"after": 1001, "after_id": 10}, "received_at>?"),
    ],
)
async def test_cursor_pages_seek_the_pagination_index(test_db, cursor, bound):
    """Cursor pages must be an index range, not a walk from the newest/oldest row.

    The expanded "a < ? OR (a = ? AND id < ?)" form with bound params only
    filters inside the (type, conversation_key) range, so deep pages cost
    O(depth) row lookups once a blocked list is set.
    """
    await seed_same_second_ties()
    plans = await plans_for(
        test_db,
        lambda: MessageRepository.get_all(
            msg_type="CHAN",
            conversation_key=CHAN_KEY,
            limit=3,
            blocked_keys=BLOCKED_KEYS,
            blocked_names=BLOCKED_NAMES,
            **cursor,
        ),
    )
    assert len(plans) == 1
    assert "USING INDEX idx_messages_pagination" in plans[0]
    assert bound in plans[0]


@pytest.mark.asyncio
async def test_get_around_context_queries_seek_the_pagination_index(test_db):
    rows, _ = await seed_same_second_ties()
    plans = await plans_for(
        test_db,
        lambda: MessageRepository.get_around(
            rows[7][1],
            msg_type="CHAN",
            conversation_key=CHAN_KEY,
            blocked_keys=BLOCKED_KEYS,
            blocked_names=BLOCKED_NAMES,
        ),
    )
    _target, before, after = plans
    assert "USING INDEX idx_messages_pagination" in before and "received_at<?" in before
    assert "USING INDEX idx_messages_pagination" in after and "received_at>?" in after
