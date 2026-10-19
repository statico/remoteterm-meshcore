"""Tests for the bot execution module."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.fanout.bot_exec import (
    execute_bot_code,
    process_bot_response,
)


class TestExecuteBotCode:
    """Test bot code execution."""

    def test_valid_code_returning_string(self):
        """Bot code that returns a string works correctly."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, is_outgoing):
    return f"Hello, {sender_name}!"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
        )
        assert result == "Hello, Alice!"

    def test_valid_code_returning_none(self):
        """Bot code that returns None works correctly."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, is_outgoing):
    return None
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
        )
        assert result is None

    def test_empty_string_response_treated_as_none(self):
        """Bot returning empty/whitespace string is treated as None."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, is_outgoing):
    return "   "
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
        )
        assert result is None

    def test_code_with_syntax_error(self):
        """Bot code with syntax error returns None."""
        code = """
def bot(sender_name:
    return "broken"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
        )
        assert result is None

    def test_code_without_bot_function(self):
        """Code that doesn't define 'bot' function returns None."""
        code = """
def my_function():
    return "hello"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
        )
        assert result is None

    def test_bot_not_callable(self):
        """Code where 'bot' is not callable returns None."""
        code = """
bot = "I'm a string, not a function"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
        )
        assert result is None

    def test_bot_function_raises_exception(self):
        """Bot function that raises exception returns None."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, is_outgoing):
    raise ValueError("oops!")
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
        )
        assert result is None

    def test_bot_returns_non_string(self):
        """Bot function returning non-string returns None."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, is_outgoing):
    return 42
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
        )
        assert result is None

    def test_empty_code_returns_none(self):
        """Empty bot code returns None."""
        result = execute_bot_code(
            code="",
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
        )
        assert result is None

    def test_whitespace_only_code_returns_none(self):
        """Whitespace-only bot code returns None."""
        result = execute_bot_code(
            code="   \n\t  ",
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
        )
        assert result is None

    def test_bot_receives_all_parameters(self):
        """Bot function receives all expected parameters including is_outgoing."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, is_outgoing):
    parts = [
        f"name={sender_name}",
        f"key={sender_key}",
        f"msg={message_text}",
        f"dm={is_dm}",
        f"ch_key={channel_key}",
        f"ch_name={channel_name}",
        f"ts={sender_timestamp}",
        f"path={path}",
        f"outgoing={is_outgoing}",
    ]
    return "|".join(parts)
"""
        result = execute_bot_code(
            code=code,
            sender_name="Bob",
            sender_key="def456",
            message_text="Test",
            is_dm=False,
            channel_key="AABBCCDD",
            channel_name="#test",
            sender_timestamp=12345,
            path="001122",
            is_outgoing=True,
        )
        assert (
            result
            == "name=Bob|key=def456|msg=Test|dm=False|ch_key=AABBCCDD|ch_name=#test|ts=12345|path=001122|outgoing=True"
        )

    def test_is_outgoing_defaults_to_false(self):
        """is_outgoing defaults to False when not specified."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, is_outgoing):
    return f"outgoing={is_outgoing}"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
        )
        assert result == "outgoing=False"

    def test_is_outgoing_true_passed_correctly(self):
        """is_outgoing=True is passed to bot function."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, is_outgoing):
    if is_outgoing:
        return None
    return "reply"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
            is_outgoing=True,
        )
        assert result is None

    def test_legacy_8_param_bot_still_works(self):
        """Legacy bot with 8 parameters (no is_outgoing) still works."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path):
    return f"Hello, {sender_name}!"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
            is_outgoing=True,
        )
        assert result == "Hello, Alice!"

    def test_legacy_bot_with_kwargs_receives_is_outgoing(self):
        """Legacy bot using **kwargs receives is_outgoing."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, **kwargs):
    return f"outgoing={kwargs.get('is_outgoing', 'missing')}"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
            is_outgoing=True,
        )
        assert result == "outgoing=True"

    def test_new_10_param_bot_receives_path_bytes_per_hop(self):
        """Bots that declare path_bytes_per_hop receive it positionally."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, is_outgoing, path_bytes_per_hop):
    return f"bytes={path_bytes_per_hop}"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path="aabb",
            path_bytes_per_hop=2,
        )
        assert result == "bytes=2"

    def test_9_param_bot_with_path_bytes_only_receives_it(self):
        """Bots may opt into path_bytes_per_hop without also declaring is_outgoing."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, path_bytes_per_hop):
    return f"bytes={path_bytes_per_hop}"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path="aabb",
            is_outgoing=True,
            path_bytes_per_hop=2,
        )
        assert result == "bytes=2"

    def test_legacy_bot_with_kwargs_receives_path_bytes_per_hop(self):
        """Bots using **kwargs receive the new path_bytes_per_hop field."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, **kwargs):
    return f"bytes={kwargs.get('path_bytes_per_hop', 'missing')}"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path="aabb",
            path_bytes_per_hop=2,
        )
        assert result == "bytes=2"

    def test_pure_kwargs_bot_receives_core_fields_and_optional_extras(self):
        """Pure **kwargs bots are first-class and receive the full payload by keyword."""
        code = """
def bot(**kwargs):
    return (
        f"{kwargs.get('sender_name')}|{kwargs.get('message_text')}|"
        f"{kwargs.get('is_outgoing')}|{kwargs.get('path_bytes_per_hop')}"
    )
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path="aabb",
            is_outgoing=True,
            path_bytes_per_hop=2,
        )
        assert result == "Alice|Hi|True|2"

    def test_kwargs_bot_receives_region(self):
        """Bots using **kwargs receive the region of a scoped channel message (#300)."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, **kwargs):
    return f"region={kwargs.get('region', 'missing')}"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Someone",
            sender_key=None,
            message_text="Hi",
            is_dm=False,
            channel_key="AABBCCDD",
            channel_name="#general",
            sender_timestamp=None,
            path=None,
            region="EU",
        )
        assert result == "region=EU"

    def test_named_region_param_bot_receives_region(self):
        """Bots may opt into region by naming the parameter (with a default)."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, region=None):
    return f"region={region}"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Someone",
            sender_key=None,
            message_text="Hi",
            is_dm=False,
            channel_key="AABBCCDD",
            channel_name="#general",
            sender_timestamp=None,
            path=None,
            region="US",
        )
        assert result == "region=US"

    def test_required_keyword_only_region_param_is_supported(self):
        """A required keyword-only `region` parameter is accepted (allow-set parity)."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, *, region):
    return f"region={region}"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Someone",
            sender_key=None,
            message_text="Hi",
            is_dm=False,
            channel_key="AABBCCDD",
            channel_name="#general",
            sender_timestamp=None,
            path=None,
            region="EU",
        )
        assert result == "region=EU"

    def test_kwargs_bot_receives_none_region_for_unscoped_message(self):
        """region is delivered as None (not absent) for DMs / unscoped flood."""
        code = """
def bot(**kwargs):
    return f"region={kwargs.get('region', 'missing')}"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
        )
        assert result == "region=None"

    def test_legacy_positional_bot_unaffected_by_region(self):
        """Historical positional bots keep binding unchanged; region is never passed positionally."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, is_outgoing):
    return f"ok:{message_text}"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
            is_outgoing=False,
            region="EU",
        )
        assert result == "ok:Hi"

    def test_kwargs_bot_receives_scoped(self):
        """Bots using **kwargs receive `scoped` for a region-scoped message (#300)."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, **kwargs):
    return f"scoped={kwargs.get('scoped', 'missing')}"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Someone",
            sender_key=None,
            message_text="Hi",
            is_dm=False,
            channel_key="AABBCCDD",
            channel_name="#general",
            sender_timestamp=None,
            path=None,
            region="EU",
            scoped=True,
        )
        assert result == "scoped=True"

    def test_named_scoped_param_bot_receives_scoped(self):
        """Bots may opt into `scoped` by naming the parameter (with a default)."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, scoped=False):
    return f"scoped={scoped}"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Someone",
            sender_key=None,
            message_text="Hi",
            is_dm=False,
            channel_key="AABBCCDD",
            channel_name="#general",
            sender_timestamp=None,
            path=None,
            scoped=True,
        )
        assert result == "scoped=True"

    def test_scoped_true_region_none_disambiguates_unknown_region(self):
        """scoped=True with region=None means 'scoped but region unknown' (#300.1)."""
        code = """
def bot(**kwargs):
    return f"scoped={kwargs.get('scoped')},region={kwargs.get('region')}"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Someone",
            sender_key=None,
            message_text="Hi",
            is_dm=False,
            channel_key="AABBCCDD",
            channel_name="#general",
            sender_timestamp=None,
            path=None,
            region=None,
            scoped=True,
        )
        assert result == "scoped=True,region=None"

    def test_scoped_defaults_false_for_unscoped_message(self):
        """scoped is delivered as False (not absent) for plain/unscoped flood."""
        code = """
def bot(**kwargs):
    return f"scoped={kwargs.get('scoped', 'missing')}"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
        )
        assert result == "scoped=False"

    def test_legacy_positional_bot_unaffected_by_scoped(self):
        """Historical positional bots keep binding unchanged; scoped is never passed positionally."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, is_outgoing):
    return f"ok:{message_text}"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
            is_outgoing=False,
            region="EU",
            scoped=True,
        )
        assert result == "ok:Hi"

    def test_dict_return_with_region_produces_bot_reply(self):
        """A {"region", "message"} return becomes a BotReply with a normalized scope (#300)."""
        from app.fanout.bot_exec import BotReply

        code = """
def bot(**kwargs):
    return {"region": "EU", "message": "scoped hi"}
"""
        result = execute_bot_code(
            code=code,
            sender_name="Someone",
            sender_key=None,
            message_text="Hi",
            is_dm=False,
            channel_key="AABBCCDD",
            channel_name="#general",
            sender_timestamp=None,
            path=None,
        )
        assert isinstance(result, BotReply)
        assert result.messages == ["scoped hi"]
        assert result.flood_scope_override == "#EU"

    def test_dict_return_with_message_list_drops_empties(self):
        """The dict 'message' may be a list; blank entries are dropped."""
        from app.fanout.bot_exec import BotReply

        code = """
def bot(**kwargs):
    return {"region": "EU", "message": ["a", "  ", "b"]}
"""
        result = execute_bot_code(
            code=code,
            sender_name="Someone",
            sender_key=None,
            message_text="Hi",
            is_dm=False,
            channel_key="AABBCCDD",
            channel_name="#general",
            sender_timestamp=None,
            path=None,
        )
        assert isinstance(result, BotReply)
        assert result.messages == ["a", "b"]
        assert result.flood_scope_override == "#EU"

    def test_dict_return_region_none_is_explicit_unscoped(self):
        """region=None means 'send unscoped' (empty override), distinct from 'use default'."""
        from app.fanout.bot_exec import BotReply

        code = """
def bot(**kwargs):
    return {"region": None, "message": "hi"}
"""
        result = execute_bot_code(
            code=code,
            sender_name="Someone",
            sender_key=None,
            message_text="Hi",
            is_dm=False,
            channel_key="AABBCCDD",
            channel_name="#general",
            sender_timestamp=None,
            path=None,
        )
        assert isinstance(result, BotReply)
        assert result.flood_scope_override == ""

    def test_dict_return_without_region_uses_channel_default(self):
        """A dict with no 'region' key defers to the channel's persisted override (None)."""
        from app.fanout.bot_exec import BotReply

        code = """
def bot(**kwargs):
    return {"message": "hi"}
"""
        result = execute_bot_code(
            code=code,
            sender_name="Someone",
            sender_key=None,
            message_text="Hi",
            is_dm=False,
            channel_key="AABBCCDD",
            channel_name="#general",
            sender_timestamp=None,
            path=None,
        )
        assert isinstance(result, BotReply)
        assert result.flood_scope_override is None

    def test_dict_return_invalid_message_returns_none(self):
        """A dict whose 'message' is not str/list is rejected (no reply)."""
        code = """
def bot(**kwargs):
    return {"region": "EU", "message": 123}
"""
        result = execute_bot_code(
            code=code,
            sender_name="Someone",
            sender_key=None,
            message_text="Hi",
            is_dm=False,
            channel_key="AABBCCDD",
            channel_name="#general",
            sender_timestamp=None,
            path=None,
        )
        assert result is None

    def test_dict_return_empty_message_returns_none(self):
        """A dict with no usable message text yields no reply."""
        code = """
def bot(**kwargs):
    return {"region": "EU", "message": "   "}
"""
        result = execute_bot_code(
            code=code,
            sender_name="Someone",
            sender_key=None,
            message_text="Hi",
            is_dm=False,
            channel_key="AABBCCDD",
            channel_name="#general",
            sender_timestamp=None,
            path=None,
        )
        assert result is None

    def test_channel_message_with_none_sender_key(self):
        """Channel messages correctly pass None for sender_key."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, is_outgoing):
    if sender_key is None and not is_dm:
        return "channel message detected"
    return "unexpected"
"""
        result = execute_bot_code(
            code=code,
            sender_name="Someone",
            sender_key=None,  # Channel messages don't have sender key
            message_text="Test",
            is_dm=False,
            channel_key="AABBCCDD",
            channel_name="#general",
            sender_timestamp=None,
            path=None,
        )
        assert result == "channel message detected"

    def test_bot_returns_list_of_strings(self):
        """Bot function returning list of strings works correctly."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, is_outgoing):
    return ["First message", "Second message", "Third message"]
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
        )
        assert result == ["First message", "Second message", "Third message"]

    def test_bot_returns_empty_list(self):
        """Bot function returning empty list is treated as None."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, is_outgoing):
    return []
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
        )
        assert result is None

    def test_bot_returns_list_with_empty_strings_filtered(self):
        """Bot function returning list filters out empty/whitespace strings."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, is_outgoing):
    return ["Valid", "", "  ", "Also valid", None, 42]
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
        )
        # Only valid non-empty strings should remain
        assert result == ["Valid", "Also valid"]

    def test_bot_returns_list_all_empty_treated_as_none(self):
        """Bot function returning list of all empty strings is treated as None."""
        code = """
def bot(sender_name, sender_key, message_text, is_dm, channel_key, channel_name, sender_timestamp, path, is_outgoing):
    return ["", "   ", ""]
"""
        result = execute_bot_code(
            code=code,
            sender_name="Alice",
            sender_key="abc123",
            message_text="Hi",
            is_dm=True,
            channel_key=None,
            channel_name=None,
            sender_timestamp=None,
            path=None,
        )
        assert result is None


class TestBotCodeValidation:
    """Test bot code syntax validation via fanout router."""

    def test_valid_code_passes(self):
        """Valid Python code passes validation."""
        from app.routers.fanout import _validate_bot_config

        # Should not raise
        _validate_bot_config(
            {
                "code": (
                    "def bot(sender_name, sender_key, message_text, is_dm, channel_key, "
                    "channel_name, sender_timestamp, path):\n    return 'hello'"
                )
            }
        )

    def test_pure_kwargs_code_passes(self):
        """Pure **kwargs bots are valid."""
        from app.routers.fanout import _validate_bot_config

        _validate_bot_config({"code": "def bot(**kwargs):\n    return kwargs.get('message_text')"})

    def test_timeout_must_be_in_range(self):
        """timeout is optional; when set it must be 1-120 seconds."""
        from fastapi import HTTPException

        from app.routers.fanout import _validate_bot_config

        code = "def bot(**kwargs):\n    return None"
        for ok in (None, "", 1, 30, 120):
            _validate_bot_config({"code": code, "timeout": ok})
        for bad in (0, 121, "30", True):
            with pytest.raises(HTTPException):
                _validate_bot_config({"code": code, "timeout": bad})

    def test_syntax_error_raises(self):
        """Syntax error in code raises HTTPException."""
        from fastapi import HTTPException

        from app.routers.fanout import _validate_bot_config

        with pytest.raises(HTTPException) as exc_info:
            _validate_bot_config({"code": "def bot(:\n    return 'broken'"})

        assert exc_info.value.status_code == 400
        assert "syntax error" in exc_info.value.detail.lower()

    def test_empty_code_raises(self):
        """Empty code raises HTTPException."""
        from fastapi import HTTPException

        from app.routers.fanout import _validate_bot_config

        with pytest.raises(HTTPException) as exc_info:
            _validate_bot_config({"code": ""})

        assert exc_info.value.status_code == 400
        assert "empty" in exc_info.value.detail.lower()

    def test_missing_code_raises(self):
        """Missing code key raises HTTPException."""
        from fastapi import HTTPException

        from app.routers.fanout import _validate_bot_config

        with pytest.raises(HTTPException) as exc_info:
            _validate_bot_config({})

        assert exc_info.value.status_code == 400

    def test_missing_bot_function_raises(self):
        """Code must define a callable bot() function."""
        from fastapi import HTTPException

        from app.routers.fanout import _validate_bot_config

        with pytest.raises(HTTPException) as exc_info:
            _validate_bot_config({"code": "def helper():\n    return 'hello'"})

        assert exc_info.value.status_code == 400
        assert "callable bot() function" in exc_info.value.detail

    def test_unsupported_signature_raises(self):
        """Unsupported bot signatures are rejected with guidance."""
        from fastapi import HTTPException

        from app.routers.fanout import _validate_bot_config

        with pytest.raises(HTTPException) as exc_info:
            _validate_bot_config(
                {
                    "code": (
                        "def bot(sender_name, sender_key, message_text, is_dm, channel_key, "
                        "channel_name, sender_timestamp, path, *, extra_required):\n"
                        "    return extra_required"
                    )
                }
            )

        assert exc_info.value.status_code == 400
        assert "signature is not supported" in exc_info.value.detail.lower()


class TestBotListResponses:
    """Test bot functionality for list responses."""

    @pytest.mark.asyncio
    async def test_list_response_sends_multiple_messages(self):
        """List response should send multiple messages in order."""
        sent_messages = []

        async def mock_send(request):
            sent_messages.append(request.text)
            mock_message = MagicMock()
            mock_message.model_dump.return_value = {}
            return mock_message

        with (
            patch("app.fanout.bot_exec.asyncio.sleep", new_callable=AsyncMock),
            patch("app.routers.messages.send_direct_message", side_effect=mock_send),
            patch("app.websocket.broadcast_event"),
        ):
            await process_bot_response(
                response=["First", "Second", "Third"],
                is_dm=True,
                sender_key="a" * 64,
                channel_key=None,
            )

            assert sent_messages == ["First", "Second", "Third"]

    @pytest.mark.asyncio
    async def test_long_channel_reply_is_split_to_fit(self):
        """Replies over the byte limit are split on words, leaving room for the name."""
        sent_messages = []

        async def mock_send(request):
            sent_messages.append(request.text)

        long_text = " ".join(["word"] * 60)  # 299 bytes
        with (
            patch("app.fanout.bot_exec.asyncio.sleep", new_callable=AsyncMock),
            patch("app.routers.messages.current_radio_name", return_value="Bot"),
            patch("app.routers.messages.send_channel_message", side_effect=mock_send),
        ):
            await process_bot_response(
                response=long_text, is_dm=False, sender_key="a" * 64, channel_key="AB" * 16
            )

        assert len(sent_messages) == 2
        assert all(len(m.encode()) <= 156 - 3 - 2 for m in sent_messages)
        assert " ".join(sent_messages) == long_text

    @pytest.mark.asyncio
    async def test_string_response_still_works(self):
        """Single string response should still work after list support added."""
        sent_messages = []

        async def mock_send(request):
            sent_messages.append(request.text)
            mock_message = MagicMock()
            mock_message.model_dump.return_value = {}
            return mock_message

        with (
            patch("app.fanout.bot_exec.asyncio.sleep", new_callable=AsyncMock),
            patch("app.routers.messages.send_direct_message", side_effect=mock_send),
            patch("app.websocket.broadcast_event"),
        ):
            await process_bot_response(
                response="Just one message",
                is_dm=True,
                sender_key="a" * 64,
                channel_key=None,
            )

            assert sent_messages == ["Just one message"]


class TestBotReplyRouting:
    """A BotReply's region scopes channel replies and is ignored for DMs (#300)."""

    @pytest.mark.asyncio
    async def test_bot_reply_region_scopes_channel_send(self):
        from app.fanout.bot_exec import BotReply

        sent = {}

        async def mock_send(request):
            sent["request"] = request
            mock_message = MagicMock()
            mock_message.model_dump.return_value = {}
            return mock_message

        with (
            patch("app.fanout.bot_exec.asyncio.sleep", new_callable=AsyncMock),
            patch("app.routers.messages.send_channel_message", side_effect=mock_send),
            patch("app.websocket.broadcast_event"),
        ):
            await process_bot_response(
                response=BotReply(messages=["scoped hi"], flood_scope_override="#EU"),
                is_dm=False,
                sender_key="",
                channel_key="AABBCCDD",
            )

        request = sent["request"]
        assert request.channel_key == "AABBCCDD"
        assert request.text == "scoped hi"
        assert request.flood_scope_override == "#EU"

    @pytest.mark.asyncio
    async def test_bot_reply_all_messages_share_region(self):
        from app.fanout.bot_exec import BotReply

        overrides = []

        async def mock_send(request):
            overrides.append(request.flood_scope_override)
            mock_message = MagicMock()
            mock_message.model_dump.return_value = {}
            return mock_message

        with (
            patch("app.fanout.bot_exec.asyncio.sleep", new_callable=AsyncMock),
            patch("app.routers.messages.send_channel_message", side_effect=mock_send),
            patch("app.websocket.broadcast_event"),
        ):
            await process_bot_response(
                response=BotReply(messages=["a", "b"], flood_scope_override="#EU"),
                is_dm=False,
                sender_key="",
                channel_key="AABBCCDD",
            )

        assert overrides == ["#EU", "#EU"]

    @pytest.mark.asyncio
    async def test_bot_reply_region_ignored_for_dm(self):
        from app.fanout.bot_exec import BotReply

        sent = {}

        async def mock_send(request):
            sent["request"] = request
            mock_message = MagicMock()
            mock_message.model_dump.return_value = {}
            return mock_message

        with (
            patch("app.fanout.bot_exec.asyncio.sleep", new_callable=AsyncMock),
            patch("app.routers.messages.send_direct_message", side_effect=mock_send),
            patch("app.websocket.broadcast_event"),
        ):
            await process_bot_response(
                response=BotReply(messages=["hi"], flood_scope_override="#EU"),
                is_dm=True,
                sender_key="a" * 64,
                channel_key=None,
            )

        request = sent["request"]
        assert request.text == "hi"
        # SendDirectMessageRequest has no scope field; region is simply ignored.
        assert not hasattr(request, "flood_scope_override")


def test_split_text_respects_multibyte_and_unbroken_runs():
    from app.services.message_send import split_text

    assert split_text("short", 10) == ["short"]
    assert split_text("", 10) == []
    assert split_text("abcdefghij", 4) == ["abcd", "efgh", "ij"]
    # Never cuts a multi-byte character in half.
    assert all(len(c.encode()) <= 5 for c in split_text("ééééé", 5))
    assert "".join(split_text("ééééé", 5)) == "ééééé"


@pytest.mark.asyncio
async def test_dict_reply_routes_to_dm_or_channel():
    """{"dm": key} and {"channel": key} redirect the reply away from the origin."""
    from app.fanout.bot_exec import _coerce_bot_dict_reply

    sent = []

    async def capture(text, is_dm, sender_key, channel_key, scope):
        sent.append((text, is_dm, sender_key, channel_key))

    with (
        patch("app.fanout.bot_exec._send_single_bot_message", side_effect=capture),
        patch("app.routers.messages.current_radio_name", return_value="Bot"),
    ):
        dm = _coerce_bot_dict_reply({"message": "hi", "dm": "cc" * 32})
        await process_bot_response(dm, False, "", "AB" * 16)
        chan = _coerce_bot_dict_reply({"message": "yo", "channel": "ef" * 16})
        await process_bot_response(chan, True, "dd" * 32, None)

    assert sent == [("hi", True, "cc" * 32, "AB" * 16), ("yo", False, "dd" * 32, "EF" * 16)]
    assert _coerce_bot_dict_reply({"message": "x", "dm": "a", "channel": "b"}) is None
