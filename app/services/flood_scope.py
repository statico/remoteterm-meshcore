"""Firmware-compatible flood-scope command helpers."""

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import HTTPException
from meshcore import EventType
from meshcore.packets import CommandType

from app.region_scope import normalize_region_scope, resolve_override_scope

logger = logging.getLogger(__name__)

SET_FLOOD_SCOPE_MODE_UNSCOPED = 1
FORCE_UNSCOPED_FRAME = bytes([CommandType.SET_FLOOD_SCOPE.value, SET_FLOOD_SCOPE_MODE_UNSCOPED])

# CMD_SET_FLOOD_SCOPE_KEY mode 1 (the firmware ``send_unscoped`` flag) is companion
# firmware ver 12+. On older firmware the mode-1 frame is rejected, so we fall back
# to resetting the scope override (mode 0, zero key), which makes the radio use its
# configured default scope. True "unscoped while a default scope is set" is not
# achievable pre-v12.
FIRMWARE_VER_UNSCOPED_MODE = 12


def firmware_supports_unscoped_mode(fw_ver: int | None) -> bool:
    """Whether the radio's protocol version supports the mode-1 unscoped command."""
    return fw_ver is not None and fw_ver >= FIRMWARE_VER_UNSCOPED_MODE


async def set_radio_flood_scope(mc, scope: str | None, *, fw_ver: int | None = None) -> Any:
    """Apply the standing radio flood-scope state.

    A non-empty scope is delegated to meshcore_py's mode-0 ``set_flood_scope``. An
    empty scope means explicit unscoped/plain flood:

    - firmware >= 12: use the dedicated mode-1 command (``force_radio_unscoped``).
    - older / unknown firmware: no dedicated unscoped command exists, so reset the
      scope override (mode 0, zero key); the radio falls back to its configured
      default scope. ``fw_ver=None`` (version unknown) is treated conservatively as
      unsupported so we never emit a frame the radio might reject.
    """
    normalized_scope = normalize_region_scope(scope)
    if normalized_scope:
        return await mc.commands.set_flood_scope(normalized_scope)

    if firmware_supports_unscoped_mode(fw_ver):
        return await force_radio_unscoped(mc)

    logger.debug(
        "Radio fw_ver=%s < %d: no dedicated unscoped command; resetting scope override "
        "(radio falls back to its configured default scope)",
        fw_ver,
        FIRMWARE_VER_UNSCOPED_MODE,
    )
    return await mc.commands.set_flood_scope("")


async def force_radio_unscoped(mc) -> Any:
    """Tell the radio to send following flood packets unscoped until mode 0."""

    return await mc.commands.send(FORCE_UNSCOPED_FRAME, [EventType.OK, EventType.ERROR])


@asynccontextmanager
async def temporary_flood_scope(
    *,
    mc,
    override: str | None,
    radio_manager,
    action_label: str,
    error_broadcast_fn=None,
    app_settings_repository=None,
):
    """Apply a tri-state flood-scope override for the duration of the block.

    ``override`` is the persisted per-conversation value: None inherits the global
    scope (the radio is left untouched), "*" forces unscoped/plain flood, and a
    region name scopes the send. The radio's standing scope is always restored on
    the way out, with up to 3 attempts, mirroring the channel send path.
    """
    if app_settings_repository is None:
        from app.repository import AppSettingsRepository

        app_settings_repository = AppSettingsRepository

    desired_scope, scope_explicit = resolve_override_scope(override)

    baseline_scope = ""
    if desired_scope or scope_explicit:
        settings = await app_settings_repository.get()
        baseline_scope = normalize_region_scope(settings.flood_scope)

    apply_scope = desired_scope != baseline_scope and (bool(desired_scope) or scope_explicit)

    try:
        if apply_scope:
            logger.info(
                "Temporarily applying flood_scope %s for %s",
                desired_scope or "(unscoped)",
                action_label,
            )
            override_result = await set_radio_flood_scope(
                mc, desired_scope, fw_ver=radio_manager.firmware_ver_code
            )
            if override_result is not None and override_result.type == EventType.ERROR:
                logger.warning(
                    "Failed to apply flood_scope %r for %s: %s",
                    desired_scope,
                    action_label,
                    override_result.payload,
                )
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Failed to apply regional override {desired_scope!r} before "
                        f"{action_label}: {override_result.payload}"
                    ),
                )
        yield
    finally:
        if apply_scope:
            restored = False
            for attempt in range(3):
                try:
                    restore_result = await set_radio_flood_scope(
                        mc, baseline_scope, fw_ver=radio_manager.firmware_ver_code
                    )
                    if restore_result is not None and restore_result.type == EventType.ERROR:
                        logger.warning(
                            "Attempt %d/3: failed to restore flood_scope after %s: %s",
                            attempt + 1,
                            action_label,
                            restore_result.payload,
                        )
                    else:
                        logger.debug(
                            "Restored baseline flood_scope after %s: %r",
                            action_label,
                            baseline_scope or "(disabled)",
                        )
                        restored = True
                        break
                except Exception:
                    logger.exception(
                        "Attempt %d/3: exception restoring flood_scope after %s",
                        attempt + 1,
                        action_label,
                    )
            if not restored:
                logger.error("All 3 attempts to restore flood_scope failed for %s", action_label)
                if error_broadcast_fn is not None:
                    error_broadcast_fn(
                        "Regional override restore failed",
                        (
                            f"Finished {action_label}, but restoring flood scope failed after "
                            f"3 attempts. The radio may still be region-scoped. "
                            f"Consider rebooting the radio."
                        ),
                    )
