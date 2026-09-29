from typing import Any, cast

import pytest
from effect_py import gen, run_async, scoped, succeed

from soulfire.protocol import SoulFireProtocol
from soulfire.protocol_connect import BotProtocolServiceClient
from soulfire.protocol_pb2 import (
    PACKET_DIRECTION_CLIENTBOUND,
    BotProtocolInfo,
    ListPacketSchemasRequest,
    ListPacketSchemasResponse,
    PacketSchema,
    RawPacketEvent,
    SendRawPacketRequest,
    SendRawPacketResponse,
    WatchPacketsRequest,
)


class FakeAsyncProtocolClient:
    schemas_request: ListPacketSchemasRequest | None = None
    watch_request: WatchPacketsRequest | None = None
    send_request: SendRawPacketRequest | None = None

    async def get_protocol_info(self, request: Any, **_options: Any) -> BotProtocolInfo:
        assert request.instance_id == "instance-id"
        assert request.bot_id == "bot-id"
        return BotProtocolInfo(
            minecraft_protocol_version=772, minecraft_version_name="26.2", protocol_state="play"
        )

    async def list_packet_schemas(
        self, request: ListPacketSchemasRequest, **_options: Any
    ) -> ListPacketSchemasResponse:
        self.schemas_request = request
        return ListPacketSchemasResponse(
            packets=[
                PacketSchema(
                    direction=request.direction,
                    name="minecraft:game_event",
                    network_id=31,
                    protocol_state="play",
                )
            ]
        )

    def watch_packets(self, request: WatchPacketsRequest, **_options: Any):
        self.watch_request = request

        async def events():
            yield RawPacketEvent(
                sequence=1, direction=PACKET_DIRECTION_CLIENTBOUND, name="minecraft:game_event"
            )

        return events()

    async def send_raw_packet(
        self, request: SendRawPacketRequest, **_options: Any
    ) -> SendRawPacketResponse:
        self.send_request = request
        return SendRawPacketResponse(
            name=request.expected_name, encoded_bytes=len(request.encoded_packet)
        )


class FakeSyncProtocolClient:
    async def get_protocol_info(self, request: Any, **_options: Any) -> BotProtocolInfo:
        return BotProtocolInfo(
            minecraft_protocol_version=772, minecraft_version_name="26.2", protocol_state="play"
        )

    async def list_packet_schemas(
        self, request: ListPacketSchemasRequest, **_options: Any
    ) -> ListPacketSchemasResponse:
        return ListPacketSchemasResponse(
            packets=[
                PacketSchema(
                    direction=request.direction,
                    name="minecraft:game_event",
                    network_id=31,
                    protocol_state="play",
                )
            ]
        )

    async def watch_packets(self, request: WatchPacketsRequest, **_options: Any):
        for item in [
            RawPacketEvent(sequence=1, direction=request.directions[0], name=request.names[0])
        ]:
            yield item

    async def send_raw_packet(
        self, request: SendRawPacketRequest, **_options: Any
    ) -> SendRawPacketResponse:
        return SendRawPacketResponse(
            name=request.expected_name, encoded_bytes=len(request.encoded_packet)
        )


@pytest.mark.asyncio
async def test_protocol_scopes_queries_streams_and_raw_sends() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        client = FakeAsyncProtocolClient()
        protocol = SoulFireProtocol("instance-id", "bot-id", cast(BotProtocolServiceClient, client))
        info = yield from protocol.info()
        schemas = yield from protocol.schemas(PACKET_DIRECTION_CLIENTBOUND)
        events = list(
            (
                yield from protocol.packets(
                    directions=[PACKET_DIRECTION_CLIENTBOUND],
                    names=["minecraft:game_event"],
                    include_encoded_packet=True,
                    maximum_encoded_bytes=128,
                ).run_collect()
            )
        )
        sent = yield from protocol.send(b"\x01\x02", expected_name="minecraft:game_event")
        assert info.minecraft_protocol_version == 772
        assert schemas[0].network_id == 31
        assert events[0].sequence == 1
        assert sent.encoded_bytes == 2
        assert client.schemas_request is not None
        assert client.schemas_request.instance_id == "instance-id"
        assert client.watch_request is not None
        assert client.watch_request.maximum_encoded_bytes == 128
        assert client.send_request is not None
        assert client.send_request.bot_id == "bot-id"

    await run_async(scoped(workflow).or_die())


async def test_effect_protocol_preserves_filters_and_packet_bytes() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        protocol = SoulFireProtocol(
            "instance-id", "bot-id", cast(BotProtocolServiceClient, FakeSyncProtocolClient())
        )
        events = yield from protocol.packets(
            directions=[PACKET_DIRECTION_CLIENTBOUND], names=["minecraft:game_event"]
        ).run_collect()
        sent = yield from protocol.send(b"\x01\x02", expected_name="minecraft:game_event")
        assert events[0].direction == PACKET_DIRECTION_CLIENTBOUND
        assert events[0].name == "minecraft:game_event"
        assert sent.name == "minecraft:game_event"
        assert sent.encoded_bytes == 2

    await run_async(scoped(workflow).or_die())
