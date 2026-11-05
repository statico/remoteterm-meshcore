"""Tests for message pagination using cursor parameters."""

import pytest

from app.repository import MessageRepository

CHAN_KEY = "ABC123DEF456ABC123DEF456ABC12345"
DM_KEY = "aa" * 32


@pytest.mark.asyncio
async def test_cursor_pagination_avoids_overlap(test_db):
    ids = []
    for received_at, text in [(200, "m1"), (200, "m2"), (150, "m3"), (100, "m4")]:
        msg_id = await MessageRepository.create(
            msg_type="CHAN",
            text=text,
            conversation_key=CHAN_KEY,
            sender_timestamp=received_at,
            received_at=received_at,
        )
        assert msg_id is not None
        ids.append(msg_id)

    page1 = await MessageRepository.get_all(
        msg_type="CHAN",
        conversation_key=CHAN_KEY,
        limit=2,
        offset=0,
    )
    assert len(page1) == 2

    oldest = page1[-1]
    page2 = await MessageRepository.get_all(
        msg_type="CHAN",
        conversation_key=CHAN_KEY,
        limit=2,
        offset=0,
        before=oldest.received_at,
        before_id=oldest.id,
    )
    assert len(page2) == 2

    ids_page1 = {m.id for m in page1}
    ids_page2 = {m.id for m in page2}
    assert ids_page1.isdisjoint(ids_page2)


@pytest.mark.asyncio
async def test_empty_page_when_no_messages(test_db):
    """Pagination on a conversation with no messages returns empty list."""
    result = await MessageRepository.get_all(
        msg_type="CHAN",
        conversation_key=CHAN_KEY,
        limit=50,
    )
    assert result == []


@pytest.mark.asyncio
async def test_empty_page_after_oldest_message(test_db):
    """Requesting a page before the oldest message returns empty list."""
    msg_id = await MessageRepository.create(
        msg_type="CHAN",
        text="only message",
        conversation_key=CHAN_KEY,
        sender_timestamp=100,
        received_at=100,
    )
    assert msg_id is not None

    # Use before cursor pointing at the only message — should get nothing
    result = await MessageRepository.get_all(
        msg_type="CHAN",
        conversation_key=CHAN_KEY,
        limit=50,
        before=100,
        before_id=msg_id,
    )
    assert result == []


@pytest.mark.asyncio
async def test_timestamp_tie_uses_id_tiebreaker(test_db):
    """Multiple messages with the same received_at are ordered by id DESC."""
    ids = []
    for text in ["first", "second", "third"]:
        msg_id = await MessageRepository.create(
            msg_type="CHAN",
            text=text,
            conversation_key=CHAN_KEY,
            sender_timestamp=500,
            received_at=500,
        )
        assert msg_id is not None
        ids.append(msg_id)

    # All three at same timestamp; page of 2 should get the two highest IDs
    page1 = await MessageRepository.get_all(
        msg_type="CHAN",
        conversation_key=CHAN_KEY,
        limit=2,
    )
    assert len(page1) == 2
    assert page1[0].id == ids[2]  # "third" (highest id)
    assert page1[1].id == ids[1]  # "second"

    # Cursor from page1's last entry should get the remaining one
    page2 = await MessageRepository.get_all(
        msg_type="CHAN",
        conversation_key=CHAN_KEY,
        limit=2,
        before=page1[-1].received_at,
        before_id=page1[-1].id,
    )
    assert len(page2) == 1
    assert page2[0].id == ids[0]  # "first" (lowest id)


@pytest.mark.asyncio
async def test_conversation_key_isolates_messages(test_db):
    """Messages from different conversations don't leak into each other's pages."""
    other_key = "FF" * 16

    await MessageRepository.create(
        msg_type="CHAN",
        text="chan1",
        conversation_key=CHAN_KEY,
        sender_timestamp=100,
        received_at=100,
    )
    await MessageRepository.create(
        msg_type="CHAN",
        text="chan2",
        conversation_key=other_key,
        sender_timestamp=100,
        received_at=100,
    )

    result = await MessageRepository.get_all(
        msg_type="CHAN",
        conversation_key=CHAN_KEY,
        limit=50,
    )
    assert len(result) == 1
    assert result[0].text == "chan1"


@pytest.mark.asyncio
async def test_limit_respected(test_db):
    """Returned page never exceeds the requested limit."""
    for i in range(10):
        await MessageRepository.create(
            msg_type="CHAN",
            text=f"msg{i}",
            conversation_key=CHAN_KEY,
            sender_timestamp=100 + i,
            received_at=100 + i,
        )

    result = await MessageRepository.get_all(
        msg_type="CHAN",
        conversation_key=CHAN_KEY,
        limit=3,
    )
    assert len(result) == 3


@pytest.mark.asyncio
async def test_full_walk_collects_all_messages(test_db):
    """Walking through all pages collects every message exactly once."""
    total = 7
    for i in range(total):
        await MessageRepository.create(
            msg_type="CHAN",
            text=f"msg{i}",
            conversation_key=CHAN_KEY,
            sender_timestamp=100 + i,
            received_at=100 + i,
        )

    collected_ids: list[int] = []
    before = None
    before_id = None

    for _ in range(total):  # safety bound
        kwargs: dict = {
            "msg_type": "CHAN",
            "conversation_key": CHAN_KEY,
            "limit": 3,
        }
        if before is not None:
            kwargs["before"] = before
            kwargs["before_id"] = before_id
        else:
            kwargs["offset"] = 0

        page = await MessageRepository.get_all(**kwargs)
        if not page:
            break
        collected_ids.extend(m.id for m in page)
        before = page[-1].received_at
        before_id = page[-1].id

    assert len(collected_ids) == total
    assert len(set(collected_ids)) == total  # no duplicates


async def seed_same_second_ties() -> tuple[list[tuple[int, int]], set[int]]:
    """Five messages per second over four seconds; every third is from a blocked name.

    Returns ((received_at, id) per message in insert order, blocked ids).
    """
    rows: list[tuple[int, int]] = []
    blocked: set[int] = set()
    for i in range(20):
        name = "spammer" if i % 3 == 0 else "friend"
        received_at = 1000 + i // 5
        msg_id = await MessageRepository.create(
            msg_type="CHAN",
            text=f"{name}: tie {i}",
            conversation_key=CHAN_KEY,
            sender_timestamp=1000 + i,
            received_at=received_at,
            sender_name=name,
        )
        assert msg_id is not None
        rows.append((received_at, msg_id))
        if name == "spammer":
            blocked.add(msg_id)
    return rows, blocked


@pytest.mark.asyncio
async def test_backward_walk_across_same_second_cursors_with_blocking(test_db):
    rows, blocked = await seed_same_second_ties()
    collected: list[tuple[int, int]] = []
    cursor: dict = {}
    for _ in range(20):
        page = await MessageRepository.get_all(
            msg_type="CHAN",
            conversation_key=CHAN_KEY,
            limit=3,
            blocked_names=["spammer"],
            **cursor,
        )
        if not page:
            break
        collected.extend((m.received_at, m.id) for m in page)
        cursor = {"before": page[-1].received_at, "before_id": page[-1].id}

    assert collected == sorted((r for r in rows if r[1] not in blocked), reverse=True)


@pytest.mark.asyncio
async def test_forward_walk_across_same_second_cursors_with_blocking(test_db):
    rows, blocked = await seed_same_second_ties()
    start = rows[1]  # received_at 1000, not blocked
    collected: list[tuple[int, int]] = []
    cursor = start
    for _ in range(20):
        page = await MessageRepository.get_all(
            msg_type="CHAN",
            conversation_key=CHAN_KEY,
            limit=3,
            after=cursor[0],
            after_id=cursor[1],
            blocked_names=["spammer"],
        )
        if not page:
            break
        collected.extend((m.received_at, m.id) for m in page)
        cursor = (page[-1].received_at, page[-1].id)

    assert collected == sorted(r for r in rows if r[1] not in blocked and r > start)


@pytest.mark.asyncio
async def test_get_around_splits_same_second_ties_by_id(test_db):
    rows, blocked = await seed_same_second_ties()
    visible = [msg_id for _, msg_id in rows if msg_id not in blocked]
    target = rows[7][1]  # middle of the received_at=1001 second, not blocked
    pos = visible.index(target)

    messages, has_older, has_newer = await MessageRepository.get_around(
        target,
        msg_type="CHAN",
        conversation_key=CHAN_KEY,
        context_size=2,
        blocked_names=["spammer"],
    )

    assert [m.id for m in messages] == visible[pos - 2 : pos + 3]
    assert has_older and has_newer
