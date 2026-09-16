"""Helpers for normalizing MeshCore flood-scope / region names."""

# Canonical persisted marker for "force unscoped/plain flood". Stored verbatim in
# the per-channel ``flood_scope_override`` column to mean "this channel is unscoped
# even if a global region is set" — distinct from NULL, which means "inherit global".
UNSCOPED_OVERRIDE_MARKER = "*"

# All values that denote explicit unscoped/plain flood, matching firmware parity.
_UNSCOPED_SENTINELS = {"", "0", UNSCOPED_OVERRIDE_MARKER}


def is_unscoped(scope: str | None) -> bool:
    """True if ``scope`` denotes an explicit unscoped/plain-flood request.

    Note: an empty string counts as unscoped here. Callers that need to treat
    blank as "no opinion / inherit" (e.g. the channel-override API) must check for
    blank *before* calling this.
    """
    return (scope or "").strip() in _UNSCOPED_SENTINELS


def normalize_region_scope(scope: str | None) -> str:
    """Normalize a user-facing region scope into MeshCore's internal form.

    Region names are user-facing plain strings like ``Esperance``. Internally,
    MeshCore still expects hashtag-style names like ``#Esperance``.

    Backward compatibility / firmware parity:
    - blank/None stays unscoped (``""``)
    - ``"0"`` and ``"*"`` also mean explicit unscoped/plain flood
    - existing leading ``#`` is preserved
    """

    stripped = (scope or "").strip()
    if stripped in _UNSCOPED_SENTINELS:
        return ""
    if stripped.startswith("#"):
        return stripped
    return f"#{stripped}"


def parse_override_input(raw: str | None) -> str | None:
    """Parse a user-supplied override into the persisted tri-state value.

    Shared by the channel and contact override endpoints:
    - blank       -> ``None``: clear the override, inherit the global scope
    - ``"*"``/``"0"`` -> ``UNSCOPED_OVERRIDE_MARKER``: force unscoped even over a global
    - region name -> ``"#Region"``: scope this conversation

    NOTE: at this layer blank means "clear/inherit", so blank is checked *before*
    ``is_unscoped()`` (which also treats ``""`` as unscoped).
    """
    stripped = (raw or "").strip()
    if stripped == "":
        return None
    if is_unscoped(stripped):
        return UNSCOPED_OVERRIDE_MARKER
    return normalize_region_scope(stripped)


def resolve_override_scope(override: str | None) -> tuple[str, bool]:
    """Map a persisted tri-state override to ``(desired_scope, explicit)``.

    ``explicit`` is False only for ``None`` (inherit), where the caller must leave
    the radio's standing scope untouched. An explicit unscoped override yields
    ``("", True)`` so the caller knows to force plain flood.
    """
    if override is None:
        return "", False
    if is_unscoped(override):
        return "", True
    return normalize_region_scope(override), True
