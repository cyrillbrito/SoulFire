from collections.abc import AsyncIterator
from typing import cast

import pytest
from effect_py import Failure, gen, run_async, run_async_exit, scoped, succeed

from soulfire.bot import SoulFireBot
from soulfire.bot_connect import BotServiceClient
from soulfire.bot_live_connect import BotLiveServiceClient
from soulfire.bot_live_pb2 import (
    BLOCK_FACE_NORTH,
    BOT_ACTION_STATUS_COMPLETED,
    HAND_OFF,
    RESOURCE_PACK_RESPONSE_ACCEPTED,
    AcquireBotControlRequest,
    AcquireBotControlResponse,
    BotActionResult,
    BotControlLease,
    BotEvent,
    InteractBlockRequest,
    InteractBlockResponse,
    ReleaseBotControlRequest,
    ReleaseBotControlResponse,
    RespondResourcePackRequest,
    RespondResourcePackResponse,
    SendChatRequest,
    SendChatResponse,
    SetCreativeSlotRequest,
    SetCreativeSlotResponse,
    SetFlyingRequest,
    SetFlyingResponse,
    SleepRequest,
    SleepResponse,
    StartElytraFlightRequest,
    StartElytraFlightResponse,
    UpdateSignRequest,
    UpdateSignResponse,
    WaitForChunksRequest,
    WaitForChunksResponse,
    WakeRequest,
    WakeResponse,
    WatchBotEventsRequest,
    WriteBookRequest,
    WriteBookResponse,
)
from soulfire.bot_pb2 import (
    BOT_DESIRED_STATE_RUNNING,
    BOT_RUNTIME_STATE_RUNNING,
    BotContainerButtonClickRequest,
    BotContainerButtonClickResponse,
    BotInfoRequest,
    BotInfoResponse,
    BotLiveState,
    BotStatus,
)
from soulfire.common_pb2 import BlockPosition


class FakeBotLiveClient:
    event_request: WatchBotEventsRequest | None = None
    chat_request: SendChatRequest | None = None
    interaction_request: InteractBlockRequest | None = None
    sleep_request: SleepRequest | None = None
    wake_request: WakeRequest | None = None
    sign_request: UpdateSignRequest | None = None
    book_request: WriteBookRequest | None = None
    resource_pack_request: RespondResourcePackRequest | None = None
    flying_request: SetFlyingRequest | None = None
    elytra_request: StartElytraFlightRequest | None = None
    creative_slot_request: SetCreativeSlotRequest | None = None
    chunk_wait_request: WaitForChunksRequest | None = None
    action_headers: list[dict[str, str] | None]

    def __init__(self) -> None:
        self.action_headers = []

    async def _events(self) -> AsyncIterator[BotEvent]:
        yield BotEvent()

    def watch_bot_events(
        self, request: WatchBotEventsRequest, **_kwargs: object
    ) -> AsyncIterator[BotEvent]:
        self.event_request = request
        return self._events()

    async def send_chat(self, request: SendChatRequest, **kwargs: object) -> SendChatResponse:
        self.chat_request = request
        self.action_headers.append(cast(dict[str, str] | None, kwargs.get("headers")))
        return SendChatResponse(
            result=BotActionResult(action_id="action-id", status=BOT_ACTION_STATUS_COMPLETED)
        )

    async def acquire_bot_control(
        self, request: AcquireBotControlRequest, **_kwargs: object
    ) -> AcquireBotControlResponse:
        assert request.instance_id == "instance-id"
        assert request.bot_id == "bot-id"
        return AcquireBotControlResponse(lease=BotControlLease(token="lease-token"))

    async def interact_block(
        self, request: InteractBlockRequest, **_kwargs: object
    ) -> InteractBlockResponse:
        self.interaction_request = request
        return InteractBlockResponse(
            result=BotActionResult(action_id="action-id", status=BOT_ACTION_STATUS_COMPLETED)
        )

    async def sleep(self, request: SleepRequest, **_kwargs: object) -> SleepResponse:
        self.sleep_request = request
        return SleepResponse(
            result=BotActionResult(action_id="action-id", status=BOT_ACTION_STATUS_COMPLETED)
        )

    async def wake(self, request: WakeRequest, **_kwargs: object) -> WakeResponse:
        self.wake_request = request
        return WakeResponse(
            result=BotActionResult(action_id="action-id", status=BOT_ACTION_STATUS_COMPLETED)
        )

    async def update_sign(
        self, request: UpdateSignRequest, **_kwargs: object
    ) -> UpdateSignResponse:
        self.sign_request = request
        return UpdateSignResponse(result=_completed_action())

    async def write_book(self, request: WriteBookRequest, **_kwargs: object) -> WriteBookResponse:
        self.book_request = request
        return WriteBookResponse(result=_completed_action())

    async def respond_resource_pack(
        self, request: RespondResourcePackRequest, **_kwargs: object
    ) -> RespondResourcePackResponse:
        self.resource_pack_request = request
        return RespondResourcePackResponse(result=_completed_action())

    async def set_flying(self, request: SetFlyingRequest, **_kwargs: object) -> SetFlyingResponse:
        self.flying_request = request
        return SetFlyingResponse(result=_completed_action())

    async def start_elytra_flight(
        self, request: StartElytraFlightRequest, **_kwargs: object
    ) -> StartElytraFlightResponse:
        self.elytra_request = request
        return StartElytraFlightResponse(result=_completed_action())

    async def set_creative_slot(
        self, request: SetCreativeSlotRequest, **_kwargs: object
    ) -> SetCreativeSlotResponse:
        self.creative_slot_request = request
        return SetCreativeSlotResponse(result=_completed_action())

    async def wait_for_chunks(
        self, request: WaitForChunksRequest, **_kwargs: object
    ) -> WaitForChunksResponse:
        self.chunk_wait_request = request
        return WaitForChunksResponse(
            center_chunk_x=2,
            center_chunk_z=-3,
            loaded_chunks=25,
            required_chunks=25,
            dimension="minecraft:overworld",
        )

    async def release_bot_control(
        self, request: ReleaseBotControlRequest, **_kwargs: object
    ) -> ReleaseBotControlResponse:
        assert request.token == "lease-token"
        return ReleaseBotControlResponse()


class FakeStartingBotService:
    async def get_bot_info(self, request: BotInfoRequest, **_kwargs: object) -> BotInfoResponse:
        return BotInfoResponse(
            status=BotStatus(
                profile_id=request.bot_id,
                desired_state=BOT_DESIRED_STATE_RUNNING,
                runtime_state=BOT_RUNTIME_STATE_RUNNING,
            )
        )


class FakeJoiningBotLiveClient(FakeBotLiveClient):
    async def _events(self) -> AsyncIterator[BotEvent]:
        yield BotEvent(
            status=BotStatus(
                profile_id="bot-id",
                desired_state=BOT_DESIRED_STATE_RUNNING,
                runtime_state=BOT_RUNTIME_STATE_RUNNING,
            )
        )
        yield BotEvent(snapshot=BotLiveState())


@pytest.mark.asyncio
async def test_bot_scopes_event_stream() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = FakeBotLiveClient()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, service),
        )
        for _event in (yield from bot.events().run_collect()):
            break
        assert service.event_request is not None
        assert service.event_request.instance_id == "instance-id"
        assert service.event_request.bot_id == "bot-id"
        assert service.event_request.filter.include_chat
        assert service.event_request.filter.include_damage
        assert service.event_request.filter.include_inventory
        assert service.event_request.filter.include_lifecycle
        assert service.event_request.filter.include_state_deltas
        assert service.event_request.filter.include_titles

    await run_async(scoped(workflow).or_die())


@pytest.mark.asyncio
async def test_bot_waits_for_usable_player_snapshot() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, FakeStartingBotService()),
            cast(BotLiveServiceClient, FakeJoiningBotLiveClient()),
        )
        status = yield from bot.wait_for_online()
        assert status.runtime_state == BOT_RUNTIME_STATE_RUNNING

    await run_async(scoped(workflow).or_die())


@pytest.mark.asyncio
async def test_bot_scopes_chat_command() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = FakeBotLiveClient()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, service),
        )
        yield from bot.send_chat("hello")
        assert service.chat_request is not None
        assert service.chat_request.instance_id == "instance-id"
        assert service.chat_request.bot_id == "bot-id"
        assert service.chat_request.message == "hello"

    await run_async(scoped(workflow).or_die())


@pytest.mark.asyncio
async def test_bot_scopes_block_interaction_sleep_and_wake() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = FakeBotLiveClient()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, service),
        )
        yield from bot.interact_block(
            BlockPosition(x=1, y=64, z=2), BLOCK_FACE_NORTH, HAND_OFF, sneaking=True
        )
        yield from bot.sleep(BlockPosition(x=3, y=64, z=4))
        yield from bot.wake()
        assert service.interaction_request is not None
        assert service.interaction_request.instance_id == "instance-id"
        assert service.interaction_request.bot_id == "bot-id"
        assert service.interaction_request.position.x == 1
        assert service.interaction_request.face == BLOCK_FACE_NORTH
        assert service.interaction_request.hand == HAND_OFF
        assert service.interaction_request.sneaking
        assert service.sleep_request is not None
        assert service.sleep_request.bed.z == 4
        assert service.wake_request is not None
        assert service.wake_request.bot_id == "bot-id"

    await run_async(scoped(workflow).or_die())


@pytest.mark.asyncio
async def test_bot_attaches_and_clears_an_acquired_control_lease() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = FakeBotLiveClient()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, service),
        )
        lease = yield from bot.acquire_control()
        yield from bot.send_chat("leased")
        yield from lease.release()
        yield from bot.send_chat("unleased")
        assert service.action_headers == [{"X-SoulFire-Control-Token": "lease-token"}, None]

    await run_async(scoped(workflow).or_die())


class FakeButtonBotClient:
    def __init__(self) -> None:
        self.requests: list[BotContainerButtonClickRequest] = []
        self.headers: list[dict[str, str] | None] = []

    async def click_container_button(
        self, request: BotContainerButtonClickRequest, **kwargs: object
    ) -> BotContainerButtonClickResponse:
        self.requests.append(request)
        self.headers.append(cast(dict[str, str] | None, kwargs.get("headers")))
        if request.button_id < 3:
            return BotContainerButtonClickResponse(success=True)
        return BotContainerButtonClickResponse(
            success=False, error="Invalid button ID for this container type"
        )


@pytest.mark.asyncio
async def test_bot_clicks_container_buttons_with_and_without_the_control_lease() -> None:
    service = FakeButtonBotClient()
    bot = SoulFireBot(
        "instance-id",
        "bot-id",
        cast(BotServiceClient, service),
        cast(BotLiveServiceClient, FakeBotLiveClient()),
    )

    @gen
    def workflow():
        yield from bot.click_container_button(1)
        yield from bot.acquire_control()
        yield from bot.click_container_button(2)
        yield from bot.click_container_button(3)

    refused = await run_async_exit(scoped(workflow))
    assert [(r.instance_id, r.bot_id, r.button_id) for r in service.requests] == [
        ("instance-id", "bot-id", 1),
        ("instance-id", "bot-id", 2),
        ("instance-id", "bot-id", 3),
    ]
    assert service.headers == [None] + [{"X-SoulFire-Control-Token": "lease-token"}] * 2
    assert isinstance(refused, Failure)
    assert str(refused.error) == "Invalid button ID for this container type"


@pytest.mark.asyncio
async def test_bot_scopes_rich_player_actions() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = FakeBotLiveClient()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, service),
        )
        yield from bot.update_sign(
            BlockPosition(dimension="minecraft:overworld", x=1, y=64, z=2),
            ["one", "two", "three", "four"],
        )
        yield from bot.write_book(2, ["first", "second"], title="Field notes")
        yield from bot.respond_resource_pack(
            "00000000-0000-0000-0000-000000000042", RESOURCE_PACK_RESPONSE_ACCEPTED
        )
        yield from bot.set_flying(True)
        yield from bot.start_elytra_flight()
        yield from bot.set_creative_slot(36, "minecraft:stone", count=64)
        chunks = yield from bot.wait_for_chunks(2, wait_timeout_ms=12000)
        assert service.sign_request is not None
        assert service.sign_request.instance_id == "instance-id"
        assert service.sign_request.position.dimension == "minecraft:overworld"
        assert service.sign_request.lines == ["one", "two", "three", "four"]
        assert service.book_request is not None
        assert service.book_request.title == "Field notes"
        assert service.resource_pack_request is not None
        assert service.resource_pack_request.response == RESOURCE_PACK_RESPONSE_ACCEPTED
        assert service.flying_request is not None
        assert service.flying_request.flying
        assert service.elytra_request is not None
        assert service.elytra_request.bot_id == "bot-id"
        assert service.creative_slot_request is not None
        assert service.creative_slot_request.item.item_id == "minecraft:stone"
        assert service.creative_slot_request.item.count == 64
        assert service.chunk_wait_request is not None
        assert service.chunk_wait_request.radius_chunks == 2
        assert service.chunk_wait_request.timeout_ms == 12000
        assert chunks.loaded_chunks == 25

    await run_async(scoped(workflow).or_die())


def _completed_action() -> BotActionResult:
    return BotActionResult(action_id="action-id", status=BOT_ACTION_STATUS_COMPLETED)
