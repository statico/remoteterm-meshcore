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


@pytest.mark.asyncio
async def test_unread_counts_seek_per_conversation(test_db):
    """get_unread_counts runs at startup and holds the single DB lock, so every
    message page queued behind it waits. Each statement must seek per
    conversation rather than walk the messages table (seconds on 200k rows).
    """
    from app.repository import ChannelRepository

    await ChannelRepository.upsert(key=CHAN_KEY, name="#test")
    await seed_same_second_ties()
    plans = await plans_for(
        test_db,
        lambda: MessageRepository.get_unread_counts(
            "me", blocked_keys=BLOCKED_KEYS, blocked_names=BLOCKED_NAMES
        ),
    )
    chan, _priv, _channels, _contacts, last_times = plans

    # Channels drive the join; messages is a range seek per channel, and the
    # first-unread subquery is a seek on the same index whose order already
    # matches ORDER BY received_at, id (no sort).
    unread_range = (
        "USING INDEX idx_messages_unread_covering "
        "(type=? AND conversation_key=? AND outgoing=? AND received_at>?)"
    )
    assert chan.index("SCAN c") < chan.index("SEARCH m")
    assert f"SEARCH m {unread_range}" in chan
    first_unread = chan.split("CORRELATED SCALAR SUBQUERY")[1]
    assert f"SEARCH f {unread_range}" in first_unread
    assert "TEMP B-TREE" not in first_unread

    assert (
        "SEARCH m USING INDEX idx_messages_pagination (type=? AND conversation_key=?)"
        in last_times
    )
