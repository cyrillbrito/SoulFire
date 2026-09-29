import asyncio
from collections.abc import AsyncIterator

from effect_py import fork, from_async, gen, join, run_async, scoped

from soulfire.bot_live_pb2 import (
    BOSS_BAR_EVENT_ADD,
    ENTITY_EVENT_SPAWN,
    PLAYER_LIST_EVENT_UPSERT,
    RESOURCE_PACK_EVENT_OFFERED,
    SCOREBOARD_EVENT_OBJECTIVE_ADD,
    SCOREBOARD_EVENT_SCORE_SET,
    WEATHER_EVENT_STARTED_RAINING,
    BlockState,
    BotBlockUpdateEvent,
    BotBossBarEvent,
    BotEntityEvent,
    BotEnvironmentEvent,
    BotEvent,
    BotEventEnvelope,
    BotPlayerListEvent,
    BotResourcePackEvent,
    BotScoreboardEvent,
    BotStateDelta,
    BotWeatherEvent,
    NearbyEntity,
    PlayerListEntrySnapshot,
    WatchBotEventsRequest,
)
from soulfire.bot_pb2 import BotLiveState
from soulfire.common_pb2 import BlockPosition, WorldPosition
from soulfire.domain_pb2 import (
    BlockSnapshot,
    EntityReference,
    EntitySnapshot,
    TextComponent,
)
from soulfire.session import (
    BotSession,
    empty_bot_session_state,
    reduce_bot_session_state,
)
from soulfire.transport import rpc_stream


def event(
    *,
    sequence: int,
    snapshot: BotLiveState | None = None,
    state_delta: BotStateDelta | None = None,
) -> BotEvent:
    return BotEvent(
        envelope=BotEventEnvelope(
            bot_id="bot-id",
            stream_epoch="00000000-0000-0000-0000-000000000001",
            sequence=sequence,
            snapshot_revision=1,
        ),
        **({"snapshot": snapshot} if snapshot is not None else {"state_delta": state_delta}),
    )


async def test_async_session_merges_snapshot_and_delta() -> None:
    release_delta = asyncio.Event()

    async def stream(_: WatchBotEventsRequest) -> AsyncIterator[BotEvent]:
        yield event(
            sequence=1,
            snapshot=BotLiveState(
                x=1,
                y=64,
                z=2,
                health=20,
                max_health=20,
            ),
        )
        await release_delta.wait()
        yield event(
            sequence=2,
            state_delta=BotStateDelta(x=3, health=14),
        )
        await asyncio.Future()

    @gen
    def workflow():
        session = yield from BotSession.open(
            lambda request: rpc_stream("watch", lambda: stream(request))
        )
        assert session.state.player is not None
        assert session.state.player.health == 20
        waiter = yield from fork(session.once("state_delta"))
        yield from from_async(lambda: asyncio.sleep(0))
        release_delta.set()
        yield from join(waiter)
        assert session.state.player is not None
        assert session.state.player.x == 3
        assert session.state.player.y == 64
        assert session.state.player.health == 14
        assert session.state.player.max_health == 20
        assert session.state.sequence == 2

    await run_async(scoped(workflow).or_die())


def test_session_indexes_semantic_world_snapshots() -> None:
    state = reduce_bot_session_state(
        empty_bot_session_state(),
        event(sequence=1, snapshot=BotLiveState()),
    )
    position = BlockPosition(
        dimension="minecraft:overworld",
        x=1,
        y=64,
        z=2,
    )
    state = reduce_bot_session_state(
        state,
        BotEvent(
            envelope=BotEventEnvelope(
                bot_id="bot-id",
                stream_epoch="00000000-0000-0000-0000-000000000001",
                sequence=2,
                snapshot_revision=2,
            ),
            entity_event=BotEntityEvent(
                kind=ENTITY_EVENT_SPAWN,
                entity=NearbyEntity(
                    entity_id=42,
                    entity_type="minecraft:zombie",
                    position=WorldPosition(x=2, y=64, z=3),
                ),
                snapshot=EntitySnapshot(
                    reference=EntityReference(
                        connection_epoch="00000000-0000-0000-0000-000000000002",
                        network_id=42,
                    ),
                    entity_type="minecraft:zombie",
                    health=20,
                ),
            ),
        ),
    )
    state = reduce_bot_session_state(
        state,
        BotEvent(
            envelope=BotEventEnvelope(
                bot_id="bot-id",
                stream_epoch="00000000-0000-0000-0000-000000000001",
                sequence=3,
                snapshot_revision=3,
            ),
            block_update=BotBlockUpdateEvent(
                position=position,
                old_block_id="minecraft:stone",
                new_block_id="minecraft:oak_log",
                block=BlockSnapshot(
                    position=position,
                    block_id="minecraft:oak_log",
                    properties={"axis": "y"},
                ),
            ),
        ),
    )

    assert state.entity_snapshots[42].health == 20
    assert state.block_snapshots["minecraft:overworld:1:64:2"].properties["axis"] == "y"
    assert state.blocks["minecraft:overworld:1:64:2"] == BlockState(
        position=position,
        block_id="minecraft:oak_log",
        properties={"axis": "y"},
    )


def test_session_reduces_environment_social_and_scoreboard_state() -> None:
    state = empty_bot_session_state()
    state = reduce_bot_session_state(
        state,
        BotEvent(
            environment=BotEnvironmentEvent(
                weather=BotWeatherEvent(kind=WEATHER_EVENT_STARTED_RAINING)
            )
        ),
    )
    state = reduce_bot_session_state(
        state,
        BotEvent(
            resource_pack=BotResourcePackEvent(
                kind=RESOURCE_PACK_EVENT_OFFERED,
                pack_id="00000000-0000-0000-0000-000000000044",
                required=True,
                url="https://example.com/pack.zip",
            )
        ),
    )
    state = reduce_bot_session_state(
        state,
        BotEvent(
            player_list=BotPlayerListEvent(
                kind=PLAYER_LIST_EVENT_UPSERT,
                entries=[
                    PlayerListEntrySnapshot(
                        profile_id="00000000-0000-0000-0000-000000000042",
                        profile_name="Alex",
                        latency_ms=42,
                        changed_fields=["add_player"],
                    )
                ],
            )
        ),
    )
    state = reduce_bot_session_state(
        state,
        BotEvent(
            boss_bar=BotBossBarEvent(
                boss_bar_id="00000000-0000-0000-0000-000000000043",
                kind=BOSS_BAR_EVENT_ADD,
                name=TextComponent(plain_text="Raid"),
                progress=0.75,
            )
        ),
    )
    state = reduce_bot_session_state(
        state,
        BotEvent(
            scoreboard=BotScoreboardEvent(
                kind=SCOREBOARD_EVENT_OBJECTIVE_ADD,
                objective_name="kills",
                display_name=TextComponent(plain_text="Kills"),
                render_type="integer",
            )
        ),
    )
    state = reduce_bot_session_state(
        state,
        BotEvent(
            scoreboard=BotScoreboardEvent(
                kind=SCOREBOARD_EVENT_SCORE_SET,
                objective_name="kills",
                owner="Alex",
                score=7,
            )
        ),
    )

    assert state.environment.raining is True
    assert state.player_list["00000000-0000-0000-0000-000000000042"].latency_ms == 42
    assert state.boss_bars["00000000-0000-0000-0000-000000000043"].progress == 0.75
    assert state.scoreboard.objectives["kills"].display_name == TextComponent(plain_text="Kills")
    assert state.scoreboard.scores["kills\0Alex"].score == 7
    assert (
        state.resource_packs["00000000-0000-0000-0000-000000000044"].url
        == "https://example.com/pack.zip"
    )
