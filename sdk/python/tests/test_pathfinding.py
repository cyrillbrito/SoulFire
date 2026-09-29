from typing import cast

import pytest
from effect_py import gen, run_async, scoped, succeed

from soulfire.bot_live_pb2 import PathfindOptions
from soulfire.pathfinding import BlockTarget, EntityTarget, SoulFirePathfinder, WorldTarget, goals
from soulfire.pathfinding_connect import PathfinderServiceClient
from soulfire.pathfinding_pb2 import (
    PATH_PLAN_STATUS_COMPLETE,
    PathPlan,
    PlanPathRequest,
    PlanPathResponse,
)
from soulfire.tasks import SoulFireTasks


class AsyncPathfinderService:
    request: PlanPathRequest | None = None

    async def plan_path(self, request: PlanPathRequest, **_kwargs: object) -> PlanPathResponse:
        self.request = request
        return PlanPathResponse(
            plan=PathPlan(
                status=PATH_PLAN_STATUS_COMPLETE,
                start={"x": 0, "y": 64, "z": 0, "dimension": "minecraft:overworld"},
            )
        )


class SyncPathfinderService:
    request: PlanPathRequest | None = None

    async def plan_path(self, request: PlanPathRequest, **_kwargs: object) -> PlanPathResponse:
        self.request = request
        return PlanPathResponse(
            plan=PathPlan(
                status=PATH_PLAN_STATUS_COMPLETE,
                start={"x": 0, "y": 64, "z": 0, "dimension": "minecraft:overworld"},
            )
        )


async def test_goal_builders_preserve_typed_targets() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        block = goals.block(BlockTarget(4, 65, -2, "minecraft:overworld"), radius=2)
        entity = goals.away_from_entity(EntityTarget(42, "connection-epoch"), radius=8)
        composite = goals.any(
            [
                block,
                goals.near(WorldTarget(5.5, 64, 1.5), radius=1.25),
                goals.xz(9, -3, dimension="minecraft:overworld"),
                goals.y(72),
                goals.break_block(BlockTarget(1, 2, 3)),
                goals.place_block(BlockTarget(3, 2, 1)),
                entity,
            ]
        )
        assert composite.WhichOneof("goal") == "any"
        assert len(composite.any.goals) == 7
        assert composite.any.goals[0].block.position.dimension == "minecraft:overworld"
        assert composite.any.goals[-1].away_from_entity.connection_epoch == "connection-epoch"

    await run_async(scoped(workflow).or_die())


@pytest.mark.asyncio
async def test_pathfinder_plans_without_starting_a_task() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = AsyncPathfinderService()
        pathfinder = SoulFirePathfinder(
            "instance-id",
            "bot-id",
            cast(PathfinderServiceClient, service),
            cast(SoulFireTasks, object()),
        )
        plan = yield from pathfinder.plan(
            goals.block(BlockTarget(4, 65, -2)),
            options=PathfindOptions(
                search_timeout_seconds=3, sprint=False, minimum_y=63, maximum_y=96
            ),
            include_descriptions=True,
        )
        assert plan.status == PATH_PLAN_STATUS_COMPLETE
        assert service.request is not None
        assert service.request.instance_id == "instance-id"
        assert service.request.bot_id == "bot-id"
        assert service.request.options.search_timeout_seconds == 3
        assert service.request.options.HasField("sprint")
        assert not service.request.options.sprint
        assert service.request.options.minimum_y == 63
        assert service.request.options.maximum_y == 96
        assert service.request.include_descriptions

    await run_async(scoped(workflow).or_die())


async def test_effect_pathfinder_plans_without_starting_a_task() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncPathfinderService()
        pathfinder = SoulFirePathfinder(
            "instance-id",
            "bot-id",
            cast(PathfinderServiceClient, service),
            cast(SoulFireTasks, object()),
        )
        plan = yield from pathfinder.plan(goals.y(72))
        assert plan.status == PATH_PLAN_STATUS_COMPLETE
        assert service.request is not None
        assert service.request.goal.WhichOneof("goal") == "y"
        assert not service.request.HasField("options")

    await run_async(scoped(workflow).or_die())
