from app.region_scope import (
    UNSCOPED_OVERRIDE_MARKER,
    is_unscoped,
    normalize_region_scope,
    parse_override_input,
    resolve_override_scope,
)


def test_normalize_region_scope_preserves_regions():
    assert normalize_region_scope("Esperance") == "#Esperance"
    assert normalize_region_scope("#Esperance") == "#Esperance"


def test_normalize_region_scope_unscoped_sentinels():
    assert normalize_region_scope(None) == ""
    assert normalize_region_scope("") == ""
    assert normalize_region_scope("   ") == ""
    assert normalize_region_scope("0") == ""
    assert normalize_region_scope("*") == ""


def test_is_unscoped():
    assert is_unscoped(None) is True
    assert is_unscoped("") is True
    assert is_unscoped("   ") is True
    assert is_unscoped("0") is True
    assert is_unscoped("*") is True
    assert is_unscoped(UNSCOPED_OVERRIDE_MARKER) is True
    assert is_unscoped("Esperance") is False
    assert is_unscoped("#Esperance") is False


def test_unscoped_override_marker_is_recognized_and_not_a_region():
    # The canonical persisted marker must round-trip as unscoped, never as a region.
    assert is_unscoped(UNSCOPED_OVERRIDE_MARKER) is True
    assert normalize_region_scope(UNSCOPED_OVERRIDE_MARKER) == ""


def test_parse_override_input_tri_state():
    # Blank means "clear / inherit the global scope", not "unscoped".
    assert parse_override_input(None) is None
    assert parse_override_input("") is None
    assert parse_override_input("   ") is None
    # Explicit unscoped requests collapse onto the canonical marker.
    assert parse_override_input("*") == UNSCOPED_OVERRIDE_MARKER
    assert parse_override_input("0") == UNSCOPED_OVERRIDE_MARKER
    # Region names are normalized to hashtag form.
    assert parse_override_input("Esperance") == "#Esperance"
    assert parse_override_input("#Esperance") == "#Esperance"


def test_resolve_override_scope_tri_state():
    # None = inherit: the caller must leave the radio's standing scope alone.
    assert resolve_override_scope(None) == ("", False)
    # Marker = explicitly unscoped: blank scope, but the caller must apply it.
    assert resolve_override_scope(UNSCOPED_OVERRIDE_MARKER) == ("", True)
    assert resolve_override_scope("Esperance") == ("#Esperance", True)
    assert resolve_override_scope("#Esperance") == ("#Esperance", True)


def test_parse_override_input_round_trips_through_resolve():
    for raw, expected in [("Esperance", "#Esperance"), ("*", ""), ("", "")]:
        scope, _ = resolve_override_scope(parse_override_input(raw))
        assert scope == expected
