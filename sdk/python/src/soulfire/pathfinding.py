from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from effect_py import EffectGen, fn

from .bot_live_pb2 import PathfindGoal, PathfindOptions
from .common_pb2 import BlockPosition, WorldPosition
from .domain_pb2 import EntityReference
from .errors import SoulFireOperationError
from .pathfinding_connect import PathfinderServiceClient
from .pathfinding_pb2 import PathPlan, PlanPathRequest
from .streams import Stream
from .task_pb2 import (
    BOT_TASK_CONFLICT_POLICY_UNSPECIFIED,
    BOT_TASK_PRIORITY_UNSPECIFIED,
    BOT_TASK_RECONNECT_POLICY_UNSPECIFIED,
    BotTaskConflictPolicy,
    BotTaskEvent,
    BotTaskPriority,
    BotTaskReconnectPolicy,
    FollowEntityTaskResult,
    GoToTaskResult,
)
from .tasks import SoulFireTask, SoulFireTasks
from .transport import rpc


@dataclass(frozen=True, slots=True)
class BlockTarget:
    x: int
    y: int
    z: int
    dimension: str = ""


@dataclass(frozen=True, slots=True)
class WorldTarget:
    x: float
    y: float
    z: float
    dimension: str = ""


@dataclass(frozen=True, slots=True)
class EntityTarget:
    network_id: int
    connection_epoch: str = ""


type BlockTargetLike = BlockTarget | BlockPosition
type WorldTargetLike = WorldTarget | WorldPosition
type EntityTargetLike = EntityTarget | EntityReference | int


class SoulFirePathfinder:
    def __init__(
        self, instance_id: str, bot_id: str, client: PathfinderServiceClient, tasks: SoulFireTasks
    ) -> None:
        self._instance_id = instance_id
        self._bot_id = bot_id
        self._client = client
        self._tasks = tasks

    @fn("SoulFirePathfinder.plan")
    def plan(
        self,
        goal: PathfindGoal,
        *,
        options: PathfindOptions | None = None,
        include_descriptions: bool = False,
        headers: dict[str, str] | None = None,
        timeout_ms: int | None = None,
    ) -> EffectGen[PathPlan, SoulFireOperationError]:
        request = PlanPathRequest(
            instance_id=self._instance_id,
            bot_id=self._bot_id,
            goal=goal,
            include_descriptions=include_descriptions,
        )
        if options is not None:
            request.options.CopyFrom(options)
        response = yield from rpc(
            "SoulFirePathfinder.plan",
            lambda: self._client.plan_path(request, headers=headers, timeout_ms=timeout_ms),
        )
        return response.plan

    @fn("SoulFirePathfinder.go_to")
    def go_to(
        self,
        goal: PathfindGoal,
        *,
        options: PathfindOptions | None = None,
        conflict_policy: BotTaskConflictPolicy = BOT_TASK_CONFLICT_POLICY_UNSPECIFIED,
        reconnect_policy: BotTaskReconnectPolicy = BOT_TASK_RECONNECT_POLICY_UNSPECIFIED,
        priority: BotTaskPriority = BOT_TASK_PRIORITY_UNSPECIFIED,
        deadline: datetime | None = None,
        idempotency_key: str | None = None,
        headers: dict[str, str] | None = None,
        timeout_ms: int | None = None,
    ) -> EffectGen[SoulFireTask[GoToTaskResult], SoulFireOperationError]:
        return (
            yield from self._tasks.go_to(
                goal,
                options=options,
                conflict_policy=conflict_policy,
                reconnect_policy=reconnect_policy,
                priority=priority,
                deadline=deadline,
                idempotency_key=idempotency_key,
                headers=headers,
                timeout_ms=timeout_ms,
            )
        )

    def run(
        self,
        goal: PathfindGoal,
        *,
        options: PathfindOptions | None = None,
        reconnect_policy: BotTaskReconnectPolicy = BOT_TASK_RECONNECT_POLICY_UNSPECIFIED,
        deadline: datetime | None = None,
        idempotency_key: str | None = None,
        headers: dict[str, str] | None = None,
        timeout_ms: int | None = None,
    ) -> Stream[BotTaskEvent, SoulFireOperationError]:
        return self._tasks.run_go_to(
            goal,
            options=options,
            reconnect_policy=reconnect_policy,
            deadline=deadline,
            idempotency_key=idempotency_key,
            headers=headers,
            timeout_ms=timeout_ms,
        )

    @fn("SoulFirePathfinder.follow")
    def follow(
        self,
        target: EntityTargetLike,
        *,
        distance: float = 3,
        options: PathfindOptions | None = None,
        target_unavailable_timeout_seconds: int = 0,
        conflict_policy: BotTaskConflictPolicy = BOT_TASK_CONFLICT_POLICY_UNSPECIFIED,
        reconnect_policy: BotTaskReconnectPolicy = BOT_TASK_RECONNECT_POLICY_UNSPECIFIED,
        priority: BotTaskPriority = BOT_TASK_PRIORITY_UNSPECIFIED,
        deadline: datetime | None = None,
        idempotency_key: str | None = None,
        headers: dict[str, str] | None = None,
        timeout_ms: int | None = None,
    ) -> EffectGen[SoulFireTask[FollowEntityTaskResult], SoulFireOperationError]:
        return (
            yield from self._tasks.follow_entity(
                target,
                distance=distance,
                options=options,
                target_unavailable_timeout_seconds=target_unavailable_timeout_seconds,
                conflict_policy=conflict_policy,
                reconnect_policy=reconnect_policy,
                priority=priority,
                deadline=deadline,
                idempotency_key=idempotency_key,
                headers=headers,
                timeout_ms=timeout_ms,
            )
        )

    def run_follow(
        self,
        target: EntityTargetLike,
        *,
        distance: float = 3,
        options: PathfindOptions | None = None,
        target_unavailable_timeout_seconds: int = 0,
        reconnect_policy: BotTaskReconnectPolicy = BOT_TASK_RECONNECT_POLICY_UNSPECIFIED,
        deadline: datetime | None = None,
        idempotency_key: str | None = None,
        headers: dict[str, str] | None = None,
        timeout_ms: int | None = None,
    ) -> Stream[BotTaskEvent, SoulFireOperationError]:
        return self._tasks.run_follow_entity(
            target,
            distance=distance,
            options=options,
            target_unavailable_timeout_seconds=target_unavailable_timeout_seconds,
            reconnect_policy=reconnect_policy,
            deadline=deadline,
            idempotency_key=idempotency_key,
            headers=headers,
            timeout_ms=timeout_ms,
        )


def _block_position(target: BlockTargetLike) -> BlockPosition:
    if isinstance(target, BlockPosition):
        return target
    return BlockPosition(x=target.x, y=target.y, z=target.z, dimension=target.dimension)


def _world_position(target: WorldTargetLike) -> WorldPosition:
    if isinstance(target, WorldPosition):
        return target
    return WorldPosition(x=target.x, y=target.y, z=target.z, dimension=target.dimension)


def _entity_target(target: EntityTargetLike) -> tuple[int, str]:
    if isinstance(target, int):
        return (target, "")
    if isinstance(target, EntityReference):
        return (target.network_id, target.connection_epoch)
    return (target.network_id, target.connection_epoch)


class Goals:
    __slots__ = ()

    def block(self, position: BlockTargetLike, radius: float = 0) -> PathfindGoal:
        return PathfindGoal(
            block=PathfindGoal.BlockGoal(position=_block_position(position), radius=radius)
        )

    def near(self, position: WorldTargetLike, radius: float) -> PathfindGoal:
        return PathfindGoal(
            near=PathfindGoal.NearGoal(position=_world_position(position), radius=radius)
        )

    def entity(self, target: EntityTargetLike, radius: float) -> PathfindGoal:
        network_id, connection_epoch = _entity_target(target)
        return PathfindGoal(
            entity=PathfindGoal.EntityGoal(
                entity_id=network_id, radius=radius, connection_epoch=connection_epoch
            )
        )

    def xz(self, x: float, z: float, *, dimension: str = "", radius: float = 0) -> PathfindGoal:
        return PathfindGoal(xz=PathfindGoal.XZGoal(x=x, z=z, dimension=dimension, radius=radius))

    def y(self, y: int, *, dimension: str = "") -> PathfindGoal:
        return PathfindGoal(y=PathfindGoal.YGoal(y=y, dimension=dimension))

    def break_block(self, position: BlockTargetLike) -> PathfindGoal:
        return PathfindGoal(
            break_block=PathfindGoal.BreakBlockGoal(position=_block_position(position))
        )

    def place_block(self, position: BlockTargetLike) -> PathfindGoal:
        return PathfindGoal(
            place_block=PathfindGoal.PlaceBlockGoal(position=_block_position(position))
        )

    def away_from_position(self, position: WorldTargetLike, radius: float) -> PathfindGoal:
        return PathfindGoal(
            away_from_position=PathfindGoal.AwayFromPositionGoal(
                position=_world_position(position), radius=radius
            )
        )

    def away_from_entity(self, target: EntityTargetLike, radius: float) -> PathfindGoal:
        network_id, connection_epoch = _entity_target(target)
        return PathfindGoal(
            away_from_entity=PathfindGoal.AwayFromEntityGoal(
                entity_id=network_id, radius=radius, connection_epoch=connection_epoch
            )
        )

    def any(self, nested: Sequence[PathfindGoal]) -> PathfindGoal:
        if not nested:
            raise ValueError("A composite path goal needs at least one goal")
        return PathfindGoal(any=PathfindGoal.AnyGoal(goals=nested))


goals = Goals()
__all__ = [
    "BlockTarget",
    "BlockTargetLike",
    "EntityTarget",
    "EntityTargetLike",
    "Goals",
    "SoulFirePathfinder",
    "WorldTarget",
    "WorldTargetLike",
    "goals",
]
