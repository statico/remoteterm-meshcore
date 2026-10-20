"""Tests for the shared gap between outgoing sends."""

from types import SimpleNamespace

import pytest

from app.services import message_send


class FakeClock:
    def __init__(self):
        self.now = 100.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


class FakeRepo:
    """Reports the previous message as echoed once the clock passes echo_at."""

    def __init__(self, clock: FakeClock, echo_at: float | None = None):
        self.clock = clock
        self.echo_at = echo_at

    async def get_by_id(self, message_id):
        heard = self.echo_at is not None and self.clock.now >= self.echo_at
        return SimpleNamespace(id=message_id, acked=1 if heard else 0)


@pytest.fixture
def clock(monkeypatch):
    clock = FakeClock()

    async def gap() -> float:
        return 4.0

    monkeypatch.setattr(message_send, "_send_gap_seconds", gap)
    monkeypatch.setattr(message_send, "SEND_GAP_QUIET_SECONDS", 2.0)
    monkeypatch.setattr(message_send._time, "monotonic", clock.monotonic)
    monkeypatch.setattr(message_send.asyncio, "sleep", clock.sleep)
    return clock


async def send(repo, message_id=None):
    async with message_send.paced_send(repo) as sent_ids:
        if message_id is not None:
            sent_ids.append(message_id)


@pytest.mark.asyncio
async def test_first_send_does_not_wait(clock):
    await send(FakeRepo(clock), 1)
    assert clock.sleeps == []


@pytest.mark.asyncio
async def test_first_send_waits_for_quiet_air(clock, monkeypatch):
    # A command was just heard; its flood is still being repeated.
    monkeypatch.setattr(message_send, "_last_rx_monotonic", 99.0)
    await send(FakeRepo(clock), 1)
    assert clock.now == pytest.approx(99.0 + message_send.SEND_GAP_QUIET_SECONDS)


@pytest.mark.asyncio
async def test_back_to_back_sends_wait_the_full_gap(clock):
    repo = FakeRepo(clock)
    await send(repo, 1)
    sent_at = clock.now
    await send(repo, 2)
    assert clock.now == pytest.approx(sent_at + 4.0)


@pytest.mark.asyncio
async def test_echo_releases_next_send_once_air_is_quiet(clock, monkeypatch):
    repo = FakeRepo(clock, echo_at=101.0)
    await send(repo, 1)
    # The echo itself was heard at 101.0; nothing heard since.
    monkeypatch.setattr(message_send, "_last_rx_monotonic", 101.0)
    await send(repo, 2)
    # Released 2s of quiet after the echo instead of waiting until 104.0.
    assert clock.now == pytest.approx(103.0)


@pytest.mark.asyncio
async def test_traffic_after_echo_holds_next_send(clock, monkeypatch):
    repo = FakeRepo(clock, echo_at=100.5)
    await send(repo, 1)

    async def sleep_with_traffic(seconds):
        await clock.sleep(seconds)
        if clock.now <= 101.5:  # a farther repeater keeps repeating until 101.5
            message_send._last_rx_monotonic = clock.now

    monkeypatch.setattr(message_send.asyncio, "sleep", sleep_with_traffic)
    await send(repo, 2)
    # 2s of quiet after the last packet heard at 101.5, inside the 104.0 cap.
    assert clock.now == pytest.approx(103.5)


@pytest.mark.asyncio
async def test_send_without_id_waits_full_gap(clock):
    repo = FakeRepo(clock, echo_at=100.0)
    await send(repo)
    await send(repo, 2)
    assert clock.now == pytest.approx(104.0)


@pytest.mark.asyncio
async def test_zero_gap_never_waits(clock, monkeypatch):
    async def gap() -> float:
        return 0.0

    monkeypatch.setattr(message_send, "_send_gap_seconds", gap)
    repo = FakeRepo(clock)
    await send(repo, 1)
    await send(repo, 2)
    assert clock.sleeps == []
