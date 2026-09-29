import re
from collections.abc import AsyncIterator
from typing import cast

import pytest
from effect_py import gen, run_async, scoped, succeed

from soulfire.bot_live_pb2 import (
    CHAT_SOURCE_PLAYER,
    CHAT_SOURCE_SYSTEM,
    BotChatEvent,
    BotEvent,
    BotEventFilter,
)
from soulfire.chat_connect import ChatServiceClient
from soulfire.semantic import SoulFireChat, match_chat
from soulfire.transport import rpc_stream


async def test_match_chat_preserves_captures_and_named_groups() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        event = BotChatEvent(plain_text="Alex joined with code 4821", source=CHAT_SOURCE_SYSTEM)
        match = match_chat(event, re.compile("(?P<player>\\w+) joined with code (\\d+)"))
        assert match is not None
        assert match.captures == ("Alex", "4821")
        assert match.groups == {"player": "Alex"}

    await run_async(scoped(workflow).or_die())


@pytest.mark.asyncio
async def test_chat_wait_filters_sources() -> None:

    @gen
    def workflow():
        yield from succeed(None)

        async def events(
            event_filter: BotEventFilter, _timeout_ms: int | None
        ) -> AsyncIterator[BotEvent]:
            assert event_filter.include_chat
            yield _chat_event(CHAT_SOURCE_PLAYER)
            yield _chat_event(CHAT_SOURCE_SYSTEM)

        chat = SoulFireChat(
            "instance-id",
            "bot-id",
            cast(ChatServiceClient, object()),
            lambda headers: headers,
            lambda event_filter, timeout: rpc_stream("chat", lambda: events(event_filter, timeout)),
        )
        match = yield from chat.wait_for(
            "authentication accepted", sources=[CHAT_SOURCE_SYSTEM], timeout_ms=100
        )
        assert match.event.source == CHAT_SOURCE_SYSTEM

    await run_async(scoped(workflow).or_die())


def _chat_event(source: int) -> BotEvent:
    return BotEvent(chat=BotChatEvent(plain_text="authentication accepted", source=source))
