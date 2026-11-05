import json
import time

from app.database import db

# Maximum age for telemetry history entries (30 days)
_MAX_AGE_SECONDS = 30 * 86400

# Maximum entries to keep per node (sanity cap)
_MAX_ENTRIES_PER_NODE = 1000


class _TelemetryHistory:
    """Per-node telemetry history; subclasses pick the table."""

    _table: str

    @classmethod
    async def record(cls, public_key: str, timestamp: int, data: dict) -> None:
        """Insert a telemetry history row and prune stale entries."""
        cutoff = int(time.time()) - _MAX_AGE_SECONDS
        async with db.tx() as conn:
            async with conn.execute(
                f"INSERT INTO {cls._table} (public_key, timestamp, data) VALUES (?, ?, ?)",
                (public_key, timestamp, json.dumps(data)),
            ):
                pass
            async with conn.execute(
                f"DELETE FROM {cls._table} WHERE public_key = ? AND timestamp < ?",
                (public_key, cutoff),
            ):
                pass
            # Keep only the newest _MAX_ENTRIES_PER_NODE.
            async with conn.execute(
                f"""
                DELETE FROM {cls._table}
                WHERE public_key = ? AND id NOT IN (
                    SELECT id FROM {cls._table}
                    WHERE public_key = ?
                    ORDER BY timestamp DESC
                    LIMIT ?
                )
                """,
                (public_key, public_key, _MAX_ENTRIES_PER_NODE),
            ):
                pass

    @classmethod
    async def get_history(cls, public_key: str, since_timestamp: int) -> list[dict]:
        """Return telemetry rows for a node since a given timestamp, ordered ASC."""
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT timestamp, data FROM {cls._table}"
                " WHERE public_key = ? AND timestamp >= ? ORDER BY timestamp ASC",
                (public_key, since_timestamp),
            ) as cursor:
                rows = await cursor.fetchall()
        return [{"timestamp": row["timestamp"], "data": json.loads(row["data"])} for row in rows]

    @classmethod
    async def get_latest(cls, public_key: str) -> dict | None:
        """Return the most recent telemetry row for a node, or None."""
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT timestamp, data FROM {cls._table}"
                " WHERE public_key = ? ORDER BY timestamp DESC LIMIT 1",
                (public_key,),
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        return {"timestamp": row["timestamp"], "data": json.loads(row["data"])}


class RepeaterTelemetryRepository(_TelemetryHistory):
    _table = "repeater_telemetry_history"


class ContactTelemetryRepository(_TelemetryHistory):
    _table = "contact_telemetry_history"
