import asyncio
from collections.abc import AsyncIterator
from typing import Any, cast

import pytest
from effect_py import fn, from_async, run_async, succeed
from google.protobuf.struct_pb2 import Value

from soulfire.bot_pb2 import (
    BOT_CONNECTION_PHASE_DISCONNECTED,
    BOT_CONNECTION_PHASE_SPAWNED,
    BOT_DESIRED_STATE_RUNNING,
    BOT_DESIRED_STATE_STOPPED,
    BOT_RUNTIME_STATE_RUNNING,
    BOT_RUNTIME_STATE_STOPPED,
    BotListEntry,
    BotLiveState,
    BotStatus,
)
from soulfire.client import SoulFireInstance
from soulfire.common_pb2 import MinecraftAccountProto, SettingsNamespace
from soulfire.fleet import (
    FleetMetadataSelector,
    FleetRadius,
    FleetSelector,
    FleetTaskStartOptions,
    SoulFireFleet,
)
from soulfire.instance_pb2 import InstanceConfig, InstanceInfo
from soulfire.task_pb2 import (
    BOT_TASK_STATUS_COMPLETED,
    AutoRespawnTask,
    AutoRespawnTaskResult,
    BotTask,
    BotTaskEvent,
)
from soulfire.transport import rpc_stream


class FakeTask:
    def __init__(self, bot_id: str) -> None:
        self.bot_id = bot_id

    def events(self, **_options: Any) -> AsyncIterator[BotTaskEvent]:

        async def stream():
            yield BotTaskEvent(
                sequence=1,
                task=BotTask(
                    task_id=f"task-{self.bot_id}",
                    bot_id=self.bot_id,
                    status=BOT_TASK_STATUS_COMPLETED,
                ),
            )

        return rpc_stream("fleet events", stream)

    @fn()
    def result(self, **_options: Any):
        yield from succeed(None)
        return AutoRespawnTaskResult(respawns=1)

    @fn()
    def cancel(self, _reason: str = "", **_options: Any):
        yield from succeed(None)
        return BotTask(
            task_id=f"task-{self.bot_id}", bot_id=self.bot_id, status=BOT_TASK_STATUS_COMPLETED
        )


class FakeTasks:
    active = 0
    maximum_active = 0

    def __init__(self, bot_id: str) -> None:
        self.bot_id = bot_id

    @fn()
    def start(self, _task_input: Any, _result_type: Any, **_options: Any):
        yield from succeed(None)
        type(self).active += 1
        type(self).maximum_active = max(type(self).maximum_active, type(self).active)
        yield from from_async(lambda: asyncio.sleep(0.005))
        type(self).active -= 1
        return FakeTask(self.bot_id)


class FakeBot:
    def __init__(self, bot_id: str, *, asynchronous: bool) -> None:
        self.tasks = FakeTasks(bot_id)


class FakeInstance:
    started: list[str]

    def __init__(self) -> None:
        self.started = []

    @fn()
    def bots(self, **_options: Any):
        yield from succeed(None)
        return _bot_entries()

    @fn()
    def info(self, **_options: Any):
        yield from succeed(None)
        return _instance_info()

    def bot(self, bot_id: str) -> FakeBot:
        return FakeBot(bot_id, asynchronous=True)

    @fn()
    def start(self, *, bot_ids: list[str], **_options: Any):
        yield from succeed(None)
        self.started = bot_ids
        return [
            BotStatus(
                profile_id=bot_id,
                desired_state=BOT_DESIRED_STATE_RUNNING,
                runtime_state=BOT_RUNTIME_STATE_RUNNING,
            )
            for bot_id in bot_ids
        ]


def _selector() -> FleetSelector:
    return FleetSelector(
        online=True,
        dimensions=("minecraft:overworld",),
        minimum_health=10,
        near=FleetRadius(x=0, y=64, z=0, radius=32, dimension="minecraft:overworld"),
        metadata=(FleetMetadataSelector(namespace="fleet", key="role", equals="builder"),),
        order_by="health",
    )


@pytest.mark.asyncio
async def test_async_fleet_selects_distributes_and_runs_typed_tasks() -> None:
    instance = FakeInstance()
    fleet = SoulFireFleet(cast(SoulFireInstance, instance), None)
    selected = await run_async(fleet.select(_selector()).or_die())
    assignments = await run_async(fleet.distribute(["one", "two", "three"], _selector()).or_die())
    await run_async(fleet.start(_selector()).or_die())
    group = await run_async(
        fleet.start_tasks(
            FleetSelector(bot_ids=("healthy", "nearby")),
            lambda _bot, index, _total: AutoRespawnTask(maximum_respawns=index + 1),
            AutoRespawnTaskResult,
            options=FleetTaskStartOptions(concurrency=1),
        ).or_die()
    )
    events = await run_async(group.events().run_collect().or_die())
    report = await run_async(group.results().or_die())
    assert [bot.id for bot in selected] == ["healthy", "nearby"]
    assert [(entry.bot.id, entry.items) for entry in assignments] == [
        ("healthy", ("one", "three")),
        ("nearby", ("two",)),
    ]
    assert instance.started == ["healthy", "nearby"]
    assert FakeTasks.maximum_active == 1
    assert [event.bot.id for event in events] == ["healthy", "nearby"]
    assert not report.rejected
    assert [outcome.value.respawns for outcome in report.fulfilled] == [1, 1]


def _bot_entries() -> list[BotListEntry]:
    return [
        _online_bot("healthy", 20, 4, 4),
        _online_bot("nearby", 14, 8, 8),
        _online_bot("far", 18, 96, 96),
        BotListEntry(
            profile_id="offline",
            is_online=False,
            connection_phase=BOT_CONNECTION_PHASE_DISCONNECTED,
            account_name="offline",
            status=BotStatus(
                profile_id="offline",
                desired_state=BOT_DESIRED_STATE_STOPPED,
                runtime_state=BOT_RUNTIME_STATE_STOPPED,
            ),
        ),
    ]


def _online_bot(profile_id: str, health: float, x: float, z: float) -> BotListEntry:
    return BotListEntry(
        profile_id=profile_id,
        is_online=True,
        connection_phase=BOT_CONNECTION_PHASE_SPAWNED,
        account_name=profile_id,
        status=BotStatus(
            profile_id=profile_id,
            desired_state=BOT_DESIRED_STATE_STOPPED,
            runtime_state=BOT_RUNTIME_STATE_RUNNING,
        ),
        live_state=BotLiveState(
            x=x,
            y=64,
            z=z,
            health=health,
            max_health=20,
            food_level=20,
            dimension="minecraft:overworld",
        ),
    )


def _instance_info() -> InstanceInfo:
    return InstanceInfo(
        config=InstanceConfig(
            accounts=[
                MinecraftAccountProto(
                    profile_id=profile_id,
                    last_known_name=profile_id,
                    type=MinecraftAccountProto.OFFLINE,
                    persistent_metadata=[
                        SettingsNamespace(
                            namespace="fleet",
                            entries=[
                                SettingsNamespace.SettingsEntry(
                                    key="role",
                                    value=Value(
                                        string_value="scout" if profile_id == "far" else "builder"
                                    ),
                                )
                            ],
                        )
                    ],
                )
                for profile_id in ("healthy", "nearby", "far", "offline")
            ]
        )
    )
