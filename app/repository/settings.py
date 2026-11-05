import json
import logging
import time
from typing import Any, TypedDict, Unpack

import aiosqlite

from app.database import db
from app.models import DEFAULT_SEND_GAP_SECONDS, AppSettings
from app.path_utils import bucket_path_hash_widths, bucket_region_scope, parse_packet_envelope
from app.telemetry_interval import DEFAULT_TELEMETRY_INTERVAL_HOURS

logger = logging.getLogger(__name__)

SECONDS_1H = 3600
SECONDS_24H = 86400
SECONDS_72H = 259200
SECONDS_7D = 604800


_SETTINGS_COLUMNS = tuple(AppSettings.model_fields)
_JSON_COLUMNS = frozenset(
    {
        "last_message_times",
        "known_regions",
        "blocked_keys",
        "blocked_names",
        "discovery_blocked_types",
        "tracked_telemetry_repeaters",
        "tracked_telemetry_contacts",
    }
)
_DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"


class SettingsUpdate(TypedDict, total=False):
    max_radio_contacts: int | None
    auto_decrypt_dm_on_advert: bool | None
    last_message_times: dict[str, int] | None
    advert_interval: int | None
    last_advert_time: int | None
    flood_scope: str | None
    known_regions: list[str] | None
    blocked_keys: list[str] | None
    blocked_names: list[str] | None
    discovery_blocked_types: list[int] | None
    tracked_telemetry_repeaters: list[str] | None
    tracked_telemetry_contacts: list[str] | None
    auto_resend_channel: bool | None
    telemetry_interval_hours: int | None
    telemetry_routed_hourly: bool | None
    ollama_enabled: bool | None
    ollama_base_url: str | None
    ollama_model: str | None
    send_gap_seconds: float | None


def _column(row: Any, name: str) -> Any:
    """Read a column, treating one missing from a partially migrated row as NULL."""
    try:
        return row[name]
    except (KeyError, IndexError):
        return None


def _json_column(row: Any, name: str, default: Any) -> Any:
    raw = _column(row, name)
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError) as e:
        logger.warning("Failed to parse %s JSON, using default: %s", name, e)
        return default


def _number_column(row: Any, name: str, cast: type, default: Any) -> Any:
    raw = _column(row, name)
    if raw is None:
        return default
    try:
        return cast(raw)
    except (TypeError, ValueError):
        return default


class AppSettingsRepository:
    """Repository for app_settings table (single-row pattern).

    Public methods acquire the DB lock exactly once. ``toggle_*`` helpers that
    need a read-modify-write do so inside a single ``db.tx()`` — the internal
    ``_get_in_conn`` / ``_apply_updates`` helpers run under the caller's
    already-held lock and must NEVER call ``db.tx()`` or ``db.readonly()``.
    """

    @staticmethod
    async def _get_in_conn(conn: aiosqlite.Connection) -> AppSettings:
        """Load settings using an already-acquired connection.

        Used by the public ``get()`` and by multi-step operations
        (``toggle_blocked_key``, ``toggle_blocked_name``) to avoid re-entering
        the non-reentrant DB lock.
        """
        async with conn.execute(
            f"SELECT {', '.join(_SETTINGS_COLUMNS)} FROM app_settings WHERE id = 1"
        ) as cursor:
            row = await cursor.fetchone()

        if not row:
            # Should not happen after migration, but handle gracefully
            return AppSettings()

        return AppSettings(
            max_radio_contacts=row["max_radio_contacts"],
            auto_decrypt_dm_on_advert=bool(row["auto_decrypt_dm_on_advert"]),
            last_message_times=_json_column(row, "last_message_times", {}),
            advert_interval=_column(row, "advert_interval") or 0,
            last_advert_time=_column(row, "last_advert_time") or 0,
            flood_scope=_column(row, "flood_scope") or "",
            known_regions=_json_column(row, "known_regions", []),
            blocked_keys=_json_column(row, "blocked_keys", []),
            blocked_names=_json_column(row, "blocked_names", []),
            discovery_blocked_types=_json_column(row, "discovery_blocked_types", []),
            tracked_telemetry_repeaters=_json_column(row, "tracked_telemetry_repeaters", []),
            tracked_telemetry_contacts=_json_column(row, "tracked_telemetry_contacts", []),
            auto_resend_channel=bool(_column(row, "auto_resend_channel")),
            telemetry_interval_hours=_number_column(
                row, "telemetry_interval_hours", int, DEFAULT_TELEMETRY_INTERVAL_HOURS
            ),
            telemetry_routed_hourly=bool(_column(row, "telemetry_routed_hourly")),
            ollama_enabled=bool(_column(row, "ollama_enabled")),
            ollama_base_url=_column(row, "ollama_base_url") or _DEFAULT_OLLAMA_BASE_URL,
            ollama_model=_column(row, "ollama_model") or "",
            send_gap_seconds=_number_column(
                row, "send_gap_seconds", float, DEFAULT_SEND_GAP_SECONDS
            ),
        )

    @staticmethod
    async def _apply_updates(conn: aiosqlite.Connection, fields: SettingsUpdate) -> None:
        """Apply field updates using an already-acquired connection.

        ``None`` values are skipped. Emits a single UPDATE statement inside the
        caller's transaction. Does NOT commit — the caller's ``db.tx()`` handles that.
        """
        updates = {k: v for k, v in fields.items() if v is not None}
        unknown = updates.keys() - set(_SETTINGS_COLUMNS)
        if unknown:
            raise TypeError(f"Unknown app setting(s): {sorted(unknown)}")
        if not updates:
            return
        params = [
            json.dumps(v) if k in _JSON_COLUMNS else int(v) if isinstance(v, bool) else v
            for k, v in updates.items()
        ]
        assignments = ", ".join(f"{k} = ?" for k in updates)
        async with conn.execute(f"UPDATE app_settings SET {assignments} WHERE id = 1", params):
            pass

    @staticmethod
    async def get() -> AppSettings:
        """Get the current app settings.

        Always returns settings - creates default row if needed (migration handles initial row).
        """
        async with db.readonly() as conn:
            return await AppSettingsRepository._get_in_conn(conn)

    @staticmethod
    async def update(**fields: Unpack[SettingsUpdate]) -> AppSettings:
        """Update app settings. Only provided (non-None) fields are updated."""
        async with db.tx() as conn:
            await AppSettingsRepository._apply_updates(conn, fields)
            return await AppSettingsRepository._get_in_conn(conn)

    @staticmethod
    async def toggle_blocked_key(key: str) -> AppSettings:
        """Toggle a public key in the blocked list. Keys are normalized to lowercase.

        Read-modify-write is atomic under a single ``db.tx()`` lock — two
        concurrent toggles for the same key cannot produce an inconsistent
        intermediate state.
        """
        normalized = key.lower()
        async with db.tx() as conn:
            settings = await AppSettingsRepository._get_in_conn(conn)
            if normalized in settings.blocked_keys:
                new_keys = [k for k in settings.blocked_keys if k != normalized]
            else:
                new_keys = settings.blocked_keys + [normalized]
            await AppSettingsRepository._apply_updates(conn, {"blocked_keys": new_keys})
            return await AppSettingsRepository._get_in_conn(conn)

    @staticmethod
    async def toggle_blocked_name(name: str) -> AppSettings:
        """Toggle a display name in the blocked list.

        Same atomicity guarantee as ``toggle_blocked_key``.
        """
        async with db.tx() as conn:
            settings = await AppSettingsRepository._get_in_conn(conn)
            if name in settings.blocked_names:
                new_names = [n for n in settings.blocked_names if n != name]
            else:
                new_names = settings.blocked_names + [name]
            await AppSettingsRepository._apply_updates(conn, {"blocked_names": new_names})
            return await AppSettingsRepository._get_in_conn(conn)

    @staticmethod
    async def get_vapid_keys() -> tuple[str, str]:
        """Return (private_key_pem, public_key_b64url) from app_settings.

        These are internal-only columns not exposed via the AppSettings model.
        """
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT vapid_private_key, vapid_public_key FROM app_settings WHERE id = 1"
            ) as cursor:
                row = await cursor.fetchone()
        if row and row["vapid_private_key"] and row["vapid_public_key"]:
            return row["vapid_private_key"], row["vapid_public_key"]
        return "", ""

    @staticmethod
    async def set_vapid_keys(private_key: str, public_key: str) -> None:
        """Persist auto-generated VAPID key pair to app_settings."""
        async with db.tx() as conn:
            await conn.execute(
                "UPDATE app_settings SET vapid_private_key = ?, vapid_public_key = ? WHERE id = 1",
                (private_key, public_key),
            )

    @staticmethod
    async def get_push_conversations() -> list[str]:
        """Return the global list of push-enabled conversation state keys.

        Internal-only column, not exposed via the AppSettings model.
        """
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT push_conversations FROM app_settings WHERE id = 1"
            ) as cursor:
                row = await cursor.fetchone()
        if row and row["push_conversations"]:
            try:
                return json.loads(row["push_conversations"])
            except (json.JSONDecodeError, TypeError):
                return []
        return []

    @staticmethod
    async def toggle_push_conversation(key: str) -> list[str]:
        """Add or remove a conversation state key from the global push list.

        Atomic read-modify-write under a single ``db.tx()`` lock.
        """
        async with db.tx() as conn:
            async with conn.execute(
                "SELECT push_conversations FROM app_settings WHERE id = 1"
            ) as cursor:
                row = await cursor.fetchone()
            current: list[str] = []
            if row and row["push_conversations"]:
                try:
                    current = json.loads(row["push_conversations"])
                except (json.JSONDecodeError, TypeError):
                    current = []
            if key in current:
                current = [k for k in current if k != key]
            else:
                current.append(key)
            await conn.execute(
                "UPDATE app_settings SET push_conversations = ? WHERE id = 1",
                (json.dumps(current),),
            )
        return current


class StatisticsRepository:
    @staticmethod
    async def get_database_message_totals() -> dict[str, int]:
        """Return message totals needed by lightweight debug surfaces."""
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT
                    SUM(CASE WHEN type = 'PRIV' THEN 1 ELSE 0 END) AS total_dms,
                    SUM(CASE WHEN type = 'CHAN' THEN 1 ELSE 0 END) AS total_channel_messages,
                    SUM(CASE WHEN outgoing = 1 THEN 1 ELSE 0 END) AS total_outgoing
                FROM messages
                """
            ) as cursor:
                row = await cursor.fetchone()
        assert row is not None
        return {
            "total_dms": row["total_dms"] or 0,
            "total_channel_messages": row["total_channel_messages"] or 0,
            "total_outgoing": row["total_outgoing"] or 0,
        }

    @staticmethod
    async def _activity_counts(*, contact_type: int, exclude: bool = False) -> dict[str, int]:
        """Get time-windowed counts for contacts/repeaters heard."""
        now = int(time.time())
        op = "!=" if exclude else "="
        async with db.readonly() as conn:
            async with conn.execute(
                f"""
                SELECT
                    SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS last_hour,
                    SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS last_24_hours,
                    SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS last_week
                FROM contacts
                WHERE type {op} ? AND last_seen IS NOT NULL
                """,
                (now - SECONDS_1H, now - SECONDS_24H, now - SECONDS_7D, contact_type),
            ) as cursor:
                row = await cursor.fetchone()
        assert row is not None  # Aggregate query always returns a row
        return {
            "last_hour": row["last_hour"] or 0,
            "last_24_hours": row["last_24_hours"] or 0,
            "last_week": row["last_week"] or 0,
        }

    @staticmethod
    async def _known_channels_active() -> dict[str, int]:
        """Count known channel keys with any traffic in each time window.

        Channel keys are stored canonically as uppercase hex, so we can avoid
        the old UPPER(...) join and aggregate per known channel directly.
        """
        now = int(time.time())
        async with db.readonly() as conn:
            async with conn.execute(
                """
                WITH known AS (
                    SELECT conversation_key, MAX(received_at) AS last_received_at
                    FROM messages
                    WHERE type = 'CHAN'
                      AND conversation_key IN (SELECT key FROM channels)
                    GROUP BY conversation_key
                )
                SELECT
                    SUM(CASE WHEN last_received_at >= ? THEN 1 ELSE 0 END) AS last_hour,
                    SUM(CASE WHEN last_received_at >= ? THEN 1 ELSE 0 END) AS last_24_hours,
                    SUM(CASE WHEN last_received_at >= ? THEN 1 ELSE 0 END) AS last_week
                FROM known
                """,
                (now - SECONDS_1H, now - SECONDS_24H, now - SECONDS_7D),
            ) as cursor:
                row = await cursor.fetchone()
        assert row is not None
        return {
            "last_hour": row["last_hour"] or 0,
            "last_24_hours": row["last_24_hours"] or 0,
            "last_week": row["last_week"] or 0,
        }

    @staticmethod
    async def _packets_per_hour_72h() -> list[dict[str, int]]:
        """Return packet counts bucketed by hour for the last 72 hours."""
        now = int(time.time())
        cutoff = now - SECONDS_72H
        # Bucket timestamps to the start of each hour
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT (timestamp / 3600) * 3600 AS hour_ts, COUNT(*) AS count
                FROM raw_packets
                WHERE timestamp >= ?
                GROUP BY hour_ts
                ORDER BY hour_ts
                """,
                (cutoff,),
            ) as cursor:
                rows = await cursor.fetchall()
        return [{"timestamp": row["hour_ts"], "count": row["count"]} for row in rows]

    @staticmethod
    async def _packet_shape_24h() -> tuple[dict[str, int | float], dict[str, int | float]]:
        """Bucket the last 24h of raw packets by hop hash width and region scope.

        Both buckets come from one fetch so the snapshot only scans the packet
        table once. Returns ``(path_hash_width, region_scope)``.
        """
        now = int(time.time())
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT data FROM raw_packets WHERE timestamp >= ?",
                (now - SECONDS_24H,),
            ) as cursor:
                rows = await cursor.fetchall()
        return bucket_path_hash_widths(rows), bucket_region_scope(rows)

    @staticmethod
    async def _region_scope_senders_24h() -> dict[str, int | float]:
        """Count distinct channel-message senders who scoped at least one send.

        Sender attribution requires having decrypted the message, so this only
        covers channels we hold keys for — a narrower population than the
        packet-level count, but a self-validating one: a message we decrypted is
        provably not a corrupt capture, so this number needs no noise floor.

        Scoping is read from ``messages.transport_code`` where present, falling
        back to the linked raw packet for rows stored before region tagging
        existed. Senders are keyed by ``sender_key`` where resolved, falling back
        to ``sender_name`` — one physical operator may run several nodes, hence
        "senders" rather than "users".
        """
        now = int(time.time())
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT m.id, m.sender_key, m.sender_name, m.transport_code, p.data
                FROM messages m
                LEFT JOIN raw_packets p ON p.message_id = m.id
                WHERE m.type = 'CHAN' AND m.outgoing = 0 AND m.received_at >= ?
                """,
                (now - SECONDS_24H,),
            ) as cursor:
                rows = await cursor.fetchall()

        senders: set[str] = set()
        scoped_senders: set[str] = set()
        for row in rows:
            identity = row["sender_key"] or row["sender_name"]
            if not identity:
                continue
            senders.add(identity)

            if row["transport_code"] is not None:
                scoped_senders.add(identity)
                continue
            raw = row["data"]
            if raw is None:
                continue
            envelope = parse_packet_envelope(bytes(raw))
            if envelope is not None and envelope.transport_codes is not None:
                scoped_senders.add(identity)

        total = len(senders)
        scoped = len(scoped_senders)
        return {
            "total_senders": total,
            "scoped_senders": scoped,
            "scoped_senders_pct": (scoped / total) * 100 if total else 0.0,
        }

    @staticmethod
    async def get_all() -> dict:
        """Aggregate all statistics from existing tables.

        Each helper acquires its own lock; there's no requirement that the
        whole snapshot be atomic. If we ever wanted a consistent snapshot
        we'd batch all queries into a single ``db.readonly()`` and use
        ``_in_conn`` helpers, but statistics are intentionally approximate.
        """
        now = int(time.time())

        async with db.readonly() as conn:
            # Top 5 busiest channels in last 24h
            async with conn.execute(
                """
                SELECT m.conversation_key, COALESCE(c.name, m.conversation_key) AS channel_name,
                       COUNT(*) AS message_count
                FROM messages m
                LEFT JOIN channels c ON m.conversation_key = c.key
                WHERE m.type = 'CHAN' AND m.received_at >= ?
                GROUP BY m.conversation_key
                ORDER BY COUNT(*) DESC
                LIMIT 5
                """,
                (now - SECONDS_24H,),
            ) as cursor:
                rows = await cursor.fetchall()
            busiest_channels_24h = [
                {
                    "channel_key": row["conversation_key"],
                    "channel_name": row["channel_name"],
                    "message_count": row["message_count"],
                }
                for row in rows
            ]

            # Entity counts
            async with conn.execute(
                "SELECT COUNT(*) AS cnt FROM contacts WHERE type != 2"
            ) as cursor:
                row = await cursor.fetchone()
            assert row is not None
            contact_count: int = row["cnt"]

            async with conn.execute(
                "SELECT COUNT(*) AS cnt FROM contacts WHERE type = 2"
            ) as cursor:
                row = await cursor.fetchone()
            assert row is not None
            repeater_count: int = row["cnt"]

            async with conn.execute("SELECT COUNT(*) AS cnt FROM channels") as cursor:
                row = await cursor.fetchone()
            assert row is not None
            channel_count: int = row["cnt"]

            # Packet split
            async with conn.execute(
                """
                SELECT COUNT(*) AS total,
                       SUM(CASE WHEN message_id IS NOT NULL THEN 1 ELSE 0 END) AS decrypted
                FROM raw_packets
                """
            ) as cursor:
                pkt_row = await cursor.fetchone()
            assert pkt_row is not None
            total_packets = pkt_row["total"] or 0
            decrypted_packets = pkt_row["decrypted"] or 0
            undecrypted_packets = total_packets - decrypted_packets

        # These each acquire their own lock. The snapshot isn't atomic across
        # them — fine for stats, which are approximate by nature.
        message_totals = await StatisticsRepository.get_database_message_totals()
        contacts_heard = await StatisticsRepository._activity_counts(contact_type=2, exclude=True)
        repeaters_heard = await StatisticsRepository._activity_counts(contact_type=2)
        known_channels_active = await StatisticsRepository._known_channels_active()
        path_hash_width_24h, region_scope = await StatisticsRepository._packet_shape_24h()
        region_scope.update(await StatisticsRepository._region_scope_senders_24h())
        packets_per_hour_72h = await StatisticsRepository._packets_per_hour_72h()

        return {
            "busiest_channels_24h": busiest_channels_24h,
            "contact_count": contact_count,
            "repeater_count": repeater_count,
            "channel_count": channel_count,
            "total_packets": total_packets,
            "decrypted_packets": decrypted_packets,
            "undecrypted_packets": undecrypted_packets,
            "total_dms": message_totals["total_dms"],
            "total_channel_messages": message_totals["total_channel_messages"],
            "total_outgoing": message_totals["total_outgoing"],
            "contacts_heard": contacts_heard,
            "repeaters_heard": repeaters_heard,
            "known_channels_active": known_channels_active,
            "path_hash_width_24h": path_hash_width_24h,
            "region_scope_24h": region_scope,
            "packets_per_hour_72h": packets_per_hour_72h,
        }
