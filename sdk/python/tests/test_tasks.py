from collections.abc import AsyncIterator, Iterator
from datetime import datetime
from typing import cast

import pytest
from effect_py import Failure, gen, run_async, scoped, succeed
from google.protobuf.any_pb2 import Any as AnyMessage

from soulfire.bot import SoulFireBot
from soulfire.bot_connect import BotServiceClient
from soulfire.bot_live_connect import BotLiveServiceClient
from soulfire.bot_live_pb2 import PathfindOptions
from soulfire.common_pb2 import BlockPosition
from soulfire.domain_pb2 import ENTITY_CATEGORY_HOSTILE
from soulfire.errors import SoulFireValidationError
from soulfire.inventory_pb2 import ItemSelector
from soulfire.pathfinding import EntityTarget
from soulfire.recipe_pb2 import BrewTask, CraftTask, SmeltTask, VillagerTradeTask
from soulfire.task_connect import BotTaskServiceClient
from soulfire.task_pb2 import (
    BOT_TASK_DISCONNECT_POLICY_CANCEL_WITH_CALL,
    BOT_TASK_STATUS_COMPLETED,
    BOT_TASK_STATUS_RUNNING,
    BUILD_MIRROR_X,
    BUILD_ROTATION_CLOCKWISE_90,
    CONTAINER_TRANSFER_DIRECTION_WITHDRAW,
    AttackEntityTask,
    AttackNearestTask,
    AutoArmorTask,
    AutoEatTask,
    AutoRespawnTask,
    AutoTotemTask,
    BotTask,
    BotTaskEvent,
    BreedTask,
    BuildTask,
    CollectBlocksTask,
    ContainerTransferTask,
    ExcavateTask,
    ExploreTask,
    FarmTask,
    FishTask,
    FleeTask,
    FollowEntityTask,
    GoToTask,
    GoToTaskResult,
    GuardTask,
    MaintainLoadoutTask,
    RangedAttackTask,
    SleepTask,
    StartBotTaskRequest,
)
from soulfire.tasks import ContainerTransferSpec, LoadoutRequirementSpec, SchematicBlock
from soulfire.world_pb2 import EntitySelector, IntRange


class AsyncTaskService:
    request: StartBotTaskRequest | None = None

    async def start_bot_task(self, request: StartBotTaskRequest, **_kwargs: object) -> BotTask:
        self.request = request
        return BotTask(
            task_id="task-id",
            instance_id=request.instance_id,
            bot_id=request.bot_id,
            task_type=request.input.type_url,
            status=BOT_TASK_STATUS_RUNNING,
            revision=1,
        )

    def watch_bot_task(self, _request: object, **_kwargs: object) -> AsyncIterator[BotTaskEvent]:

        async def stream() -> AsyncIterator[BotTaskEvent]:
            packed = AnyMessage()
            packed.Pack(GoToTaskResult())
            yield BotTaskEvent(
                task=BotTask(
                    task_id="task-id",
                    instance_id="instance-id",
                    bot_id="bot-id",
                    status=BOT_TASK_STATUS_COMPLETED,
                    result=packed,
                    revision=2,
                )
            )

        return stream()

    def run_bot_task(
        self, request: StartBotTaskRequest, **_kwargs: object
    ) -> AsyncIterator[BotTaskEvent]:
        self.request = request

        async def stream() -> AsyncIterator[BotTaskEvent]:
            yield BotTaskEvent(
                task=BotTask(
                    task_id="task-id",
                    instance_id=request.instance_id,
                    bot_id=request.bot_id,
                    status=BOT_TASK_STATUS_COMPLETED,
                )
            )

        return stream()


class SyncTaskService:
    request: StartBotTaskRequest | None = None

    async def start_bot_task(self, request: StartBotTaskRequest, **_kwargs: object) -> BotTask:
        self.request = request
        return BotTask(
            task_id="task-id",
            instance_id=request.instance_id,
            bot_id=request.bot_id,
            task_type=request.input.type_url,
            status=BOT_TASK_STATUS_RUNNING,
            revision=1,
        )

    async def watch_bot_task(self, _request: object, **_kwargs: object) -> Iterator[BotTaskEvent]:
        packed = AnyMessage()
        packed.Pack(GoToTaskResult())
        yield BotTaskEvent(
            task=BotTask(
                task_id="task-id",
                instance_id="instance-id",
                bot_id="bot-id",
                status=BOT_TASK_STATUS_COMPLETED,
                result=packed,
                revision=2,
            )
        )

    async def run_bot_task(
        self, request: StartBotTaskRequest, **_kwargs: object
    ) -> Iterator[BotTaskEvent]:
        self.request = request
        yield BotTaskEvent(
            task=BotTask(
                task_id="task-id",
                instance_id=request.instance_id,
                bot_id=request.bot_id,
                status=BOT_TASK_STATUS_COMPLETED,
            )
        )


@pytest.mark.asyncio
async def test_task_decodes_typed_result() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = AsyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        task = yield from bot.tasks.start(GoToTask(), GoToTaskResult)
        result = yield from task.result()
        assert isinstance(result, GoToTaskResult)
        assert service.request is not None
        unpacked = GoToTask()
        assert service.request.input.Unpack(unpacked)

    await run_async(scoped(workflow).or_die())


async def test_effect_task_decodes_typed_result() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        task = yield from bot.tasks.start(GoToTask(), GoToTaskResult)
        result = yield from task.result()
        assert isinstance(result, GoToTaskResult)
        assert service.request is not None
        unpacked = GoToTask()
        assert service.request.input.Unpack(unpacked)

    await run_async(scoped(workflow).or_die())


async def test_effect_follow_task_preserves_connection_scoped_target() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.follow_entity(
            EntityTarget(42, "connection-epoch"), distance=2.5, target_unavailable_timeout_seconds=7
        )
        assert service.request is not None
        unpacked = FollowEntityTask()
        assert service.request.input.Unpack(unpacked)
        assert unpacked.target.entity_id == 42
        assert unpacked.target.connection_epoch == "connection-epoch"
        assert unpacked.target.radius == 2.5
        assert unpacked.target_unavailable_timeout_seconds == 7

    await run_async(scoped(workflow).or_die())


async def test_effect_attack_task_preserves_combat_policy() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.attack_entity(
            EntityTarget(42, "connection-epoch"),
            attack_range=3.5,
            sprinting=True,
            maximum_attacks=4,
            target_unavailable_timeout_seconds=6,
            weapon=ItemSelector(tags=["minecraft:swords"]),
            restore_selected_slot=True,
            use_offhand_shield=True,
        )
        assert service.request is not None
        unpacked = AttackEntityTask()
        assert service.request.input.Unpack(unpacked)
        assert unpacked.target.network_id == 42
        assert unpacked.target.connection_epoch == "connection-epoch"
        assert unpacked.attack_range == 3.5
        assert unpacked.sprinting
        assert unpacked.maximum_attacks == 4
        assert unpacked.target_unavailable_timeout_seconds == 6
        assert unpacked.select_best_weapon
        assert list(unpacked.weapon.tags) == ["minecraft:swords"]
        assert unpacked.restore_selected_slot
        assert unpacked.use_offhand_shield

    await run_async(scoped(workflow).or_die())


async def test_effect_ranged_attack_preserves_trajectory_and_spacing_policy() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.ranged_attack(
            EntityTarget(42, "connection-epoch"),
            minimum_range=10,
            maximum_range=32,
            maximum_shots=6,
            target_unavailable_timeout_seconds=8,
            weapon=ItemSelector(item_ids=["minecraft:bow"]),
            bow_draw_ticks=18,
            lead_target=True,
            compensate_gravity=True,
            strafe=True,
            restore_selected_slot=True,
            options=PathfindOptions(allow_mining=False, allow_placing=False),
        )
        assert service.request is not None
        unpacked = RangedAttackTask()
        assert service.request.input.Unpack(unpacked)
        assert unpacked.target.network_id == 42
        assert unpacked.target.connection_epoch == "connection-epoch"
        assert unpacked.minimum_range == 10
        assert unpacked.maximum_range == 32
        assert unpacked.maximum_shots == 6
        assert unpacked.target_unavailable_timeout_seconds == 8
        assert list(unpacked.weapon.item_ids) == ["minecraft:bow"]
        assert unpacked.bow_draw_ticks == 18
        assert unpacked.lead_target
        assert unpacked.compensate_gravity
        assert unpacked.strafe
        assert unpacked.restore_selected_slot
        assert not unpacked.options.allow_mining
        assert not unpacked.options.allow_placing

    await run_async(scoped(workflow).or_die())


async def test_effect_attack_nearest_preserves_selector_and_hunt_policy() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.attack_nearest(
            EntitySelector(entity_types=["minecraft:zombie"]),
            radius=48,
            maximum_targets=3,
            complete_when_no_target=False,
            weapon=ItemSelector(tags=["minecraft:swords"]),
        )
        assert service.request is not None
        unpacked = AttackNearestTask()
        assert service.request.input.Unpack(unpacked)
        assert list(unpacked.selector.entity_types) == ["minecraft:zombie"]
        assert unpacked.radius == 48
        assert unpacked.maximum_targets == 3
        assert not unpacked.complete_when_no_target
        assert unpacked.select_best_weapon
        assert list(unpacked.weapon.tags) == ["minecraft:swords"]
        assert unpacked.restore_selected_slot

    await run_async(scoped(workflow).or_die())


async def test_effect_flee_preserves_threat_and_safety_policy() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.flee(
            EntitySelector(categories=[ENTITY_CATEGORY_HOSTILE]),
            trigger_radius=8,
            safe_distance=20,
            safe_seconds=3,
            complete_when_safe=True,
            maximum_escapes=2,
        )
        assert service.request is not None
        unpacked = FleeTask()
        assert service.request.input.Unpack(unpacked)
        assert list(unpacked.threats.categories) == [ENTITY_CATEGORY_HOSTILE]
        assert unpacked.trigger_radius == 8
        assert unpacked.safe_distance == 20
        assert unpacked.safe_seconds == 3
        assert unpacked.complete_when_safe
        assert unpacked.maximum_escapes == 2

    await run_async(scoped(workflow).or_die())


async def test_effect_guard_supports_positions_and_connection_scoped_entities() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.guard(
            BlockPosition(x=10, y=64, z=-5),
            EntitySelector(categories=[ENTITY_CATEGORY_HOSTILE]),
            guard_radius=18,
            maximum_pursuit_distance=30,
            maximum_targets=4,
            weapon=ItemSelector(tags=["minecraft:swords"]),
        )
        assert service.request is not None
        unpacked = GuardTask()
        assert service.request.input.Unpack(unpacked)
        assert unpacked.WhichOneof("subject") == "position"
        assert (unpacked.position.x, unpacked.position.y, unpacked.position.z) == (10, 64, -5)
        assert list(unpacked.threats.categories) == [ENTITY_CATEGORY_HOSTILE]
        assert unpacked.guard_radius == 18
        assert unpacked.maximum_pursuit_distance == 30
        assert unpacked.maximum_targets == 4
        assert unpacked.complete_when_clear
        assert unpacked.select_best_weapon
        assert list(unpacked.weapon.tags) == ["minecraft:swords"]
        assert unpacked.restore_selected_slot
        yield from bot.tasks.protect(
            EntityTarget(42, "connection-epoch"), EntitySelector(entity_types=["minecraft:zombie"])
        )
        assert service.request is not None
        assert service.request.input.Unpack(unpacked)
        assert unpacked.WhichOneof("subject") == "entity"
        assert unpacked.entity.network_id == 42
        assert unpacked.entity.connection_epoch == "connection-epoch"
        assert list(unpacked.threats.entity_types) == ["minecraft:zombie"]

    await run_async(scoped(workflow).or_die())


async def test_effect_sleep_task_preserves_discovery_and_retry_policy() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.sleep(
            BlockPosition(x=10, y=64, z=-5),
            search_radius=30,
            wait_until_possible=True,
            retry_interval_ticks=40,
            options=PathfindOptions(allow_mining=False, allow_placing=False),
        )
        assert service.request is not None
        unpacked = SleepTask()
        assert service.request.input.Unpack(unpacked)
        assert unpacked.bed == BlockPosition(x=10, y=64, z=-5)
        assert unpacked.search_radius == 30
        assert unpacked.wait_until_possible
        assert unpacked.retry_interval_ticks == 40
        assert not unpacked.options.allow_mining
        assert not unpacked.options.allow_placing

    await run_async(scoped(workflow).or_die())


async def test_effect_fish_task_preserves_rod_and_catch_policy() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.fish(
            maximum_catches=3,
            maximum_failed_casts=4,
            rod=ItemSelector(item_ids=["minecraft:fishing_rod"]),
            cast_timeout_ticks=80,
            bite_timeout_ticks=6000,
            complete_when_no_rod=True,
            restore_selected_slot=True,
        )
        assert service.request is not None
        unpacked = FishTask()
        assert service.request.input.Unpack(unpacked)
        assert unpacked.maximum_catches == 3
        assert unpacked.maximum_failed_casts == 4
        assert list(unpacked.rod.item_ids) == ["minecraft:fishing_rod"]
        assert unpacked.cast_timeout_ticks == 80
        assert unpacked.bite_timeout_ticks == 6000
        assert unpacked.complete_when_no_rod
        assert unpacked.restore_selected_slot

    await run_async(scoped(workflow).or_die())


async def test_effect_farm_task_preserves_crop_and_replant_policy() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.farm(
            ["minecraft:wheat", "minecraft:carrots"],
            center=BlockPosition(x=12, y=64, z=-4, dimension="minecraft:overworld"),
            radius=18,
            maximum_harvests=24,
            replant=True,
            complete_when_no_mature_crops=False,
            options=PathfindOptions(allow_mining=False, allow_placing=False),
            rescan_interval_ticks=80,
            restore_selected_slot=True,
        )
        assert service.request is not None
        unpacked = FarmTask()
        assert service.request.input.Unpack(unpacked)
        assert list(unpacked.crop_ids) == ["minecraft:wheat", "minecraft:carrots"]
        assert unpacked.center == BlockPosition(x=12, y=64, z=-4, dimension="minecraft:overworld")
        assert unpacked.radius == 18
        assert unpacked.maximum_harvests == 24
        assert unpacked.replant
        assert not unpacked.complete_when_no_mature_crops
        assert not unpacked.options.allow_mining
        assert not unpacked.options.allow_placing
        assert unpacked.rescan_interval_ticks == 80
        assert unpacked.restore_selected_slot

    await run_async(scoped(workflow).or_die())


async def test_effect_breed_task_preserves_animal_and_food_policy() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.breed(
            EntitySelector(entity_types=["minecraft:cow"]),
            food=ItemSelector(item_ids=["minecraft:wheat"]),
            center=BlockPosition(x=20, y=64, z=8, dimension="minecraft:overworld"),
            radius=20,
            maximum_pairs=4,
            complete_when_no_pair=False,
            complete_when_no_food=True,
            options=PathfindOptions(allow_mining=False, allow_placing=False),
            rescan_interval_ticks=60,
            breeding_timeout_ticks=120,
            restore_selected_slot=True,
        )
        assert service.request is not None
        unpacked = BreedTask()
        assert service.request.input.Unpack(unpacked)
        assert list(unpacked.animals.entity_types) == ["minecraft:cow"]
        assert list(unpacked.food.item_ids) == ["minecraft:wheat"]
        assert unpacked.center == BlockPosition(x=20, y=64, z=8, dimension="minecraft:overworld")
        assert unpacked.radius == 20
        assert unpacked.maximum_pairs == 4
        assert not unpacked.complete_when_no_pair
        assert unpacked.complete_when_no_food
        assert not unpacked.options.allow_mining
        assert not unpacked.options.allow_placing
        assert unpacked.rescan_interval_ticks == 60
        assert unpacked.breeding_timeout_ticks == 120
        assert unpacked.restore_selected_slot

    await run_async(scoped(workflow).or_die())


async def test_effect_explore_task_preserves_frontier_policy() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.explore(
            origin=BlockPosition(x=0, y=64, z=0, dimension="minecraft:overworld"),
            radius=512,
            waypoint_spacing=64,
            maximum_waypoints=6,
            options=PathfindOptions(allow_mining=False, allow_placing=False),
            return_to_origin=True,
            purpose="village-scouting",
        )
        assert service.request is not None
        unpacked = ExploreTask()
        assert service.request.input.Unpack(unpacked)
        assert unpacked.origin == BlockPosition(x=0, y=64, z=0, dimension="minecraft:overworld")
        assert unpacked.radius == 512
        assert unpacked.waypoint_spacing == 64
        assert unpacked.maximum_waypoints == 6
        assert not unpacked.options.allow_mining
        assert not unpacked.options.allow_placing
        assert unpacked.return_to_origin
        assert unpacked.purpose == "village-scouting"

    await run_async(scoped(workflow).or_die())


async def test_effect_container_withdrawal_preserves_transfer_policy() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.withdraw(
            BlockPosition(x=30, y=65, z=-12, dimension="minecraft:overworld"),
            [
                ContainerTransferSpec(
                    selector=ItemSelector(item_ids=["minecraft:bread"]), count=16
                ),
                ContainerTransferSpec(
                    selector=ItemSelector(tags=["minecraft:coals"]), count=8, allow_partial=True
                ),
            ],
            options=PathfindOptions(allow_mining=False, allow_placing=False),
            close_container=True,
        )
        assert service.request is not None
        unpacked = ContainerTransferTask()
        assert service.request.input.Unpack(unpacked)
        assert unpacked.container == BlockPosition(
            x=30, y=65, z=-12, dimension="minecraft:overworld"
        )
        assert unpacked.direction == CONTAINER_TRANSFER_DIRECTION_WITHDRAW
        assert list(unpacked.operations[0].selector.item_ids) == ["minecraft:bread"]
        assert unpacked.operations[0].count == 16
        assert not unpacked.operations[0].allow_partial
        assert list(unpacked.operations[1].selector.tags) == ["minecraft:coals"]
        assert unpacked.operations[1].count == 8
        assert unpacked.operations[1].allow_partial
        assert not unpacked.options.allow_mining
        assert not unpacked.options.allow_placing
        assert unpacked.close_container

    await run_async(scoped(workflow).or_die())


async def test_effect_maintain_loadout_preserves_semantic_inventory_bounds() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.maintain_loadout(
            BlockPosition(x=14, y=64, z=-9, dimension="minecraft:overworld"),
            [
                LoadoutRequirementSpec(
                    ItemSelector(item_ids=["minecraft:bread"]),
                    minimum_count=8,
                    target_count=16,
                    maximum_count=24,
                ),
                LoadoutRequirementSpec(
                    ItemSelector(tags=["minecraft:arrows"]), minimum_count=32, target_count=64
                ),
            ],
            options=PathfindOptions(allow_placing=False),
            check_interval_ticks=80,
            maximum_rebalances=5,
            close_container=True,
        )
        assert service.request is not None
        unpacked = MaintainLoadoutTask()
        assert service.request.input.Unpack(unpacked)
        assert unpacked.container.x == 14
        assert len(unpacked.requirements) == 2
        assert list(unpacked.requirements[0].selector.item_ids) == ["minecraft:bread"]
        assert unpacked.requirements[0].minimum_count == 8
        assert unpacked.requirements[0].target_count == 16
        assert unpacked.requirements[0].maximum_count == 24
        assert list(unpacked.requirements[1].selector.tags) == ["minecraft:arrows"]
        assert unpacked.requirements[1].minimum_count == 32
        assert unpacked.requirements[1].target_count == 64
        assert unpacked.check_interval_ticks == 80
        assert unpacked.maximum_rebalances == 5
        assert unpacked.close_container

    await run_async(scoped(workflow).or_die())


async def test_effect_auto_eat_task_preserves_food_policy() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.auto_eat(
            ["minecraft:bread", "minecraft:cooked_beef"],
            food_level=12,
            check_interval_ticks=10,
            maximum_meals=3,
            complete_when_no_food=True,
            restore_selected_slot=False,
        )
        assert service.request is not None
        unpacked = AutoEatTask()
        assert service.request.input.Unpack(unpacked)
        assert list(unpacked.food_item_ids) == ["minecraft:bread", "minecraft:cooked_beef"]
        assert unpacked.food_level == 12
        assert unpacked.check_interval_ticks == 10
        assert unpacked.maximum_meals == 3
        assert unpacked.complete_when_no_food
        assert not unpacked.restore_selected_slot

    await run_async(scoped(workflow).or_die())


async def test_effect_auto_respawn_task_preserves_respawn_policy() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.auto_respawn(respawn_delay_ticks=15, maximum_respawns=2)
        assert service.request is not None
        unpacked = AutoRespawnTask()
        assert service.request.input.Unpack(unpacked)
        assert unpacked.respawn_delay_ticks == 15
        assert unpacked.maximum_respawns == 2

    await run_async(scoped(workflow).or_die())


async def test_effect_equipment_tasks_preserve_monitor_policies() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.auto_totem(
            check_interval_ticks=8,
            maximum_equips=2,
            complete_when_no_totem=True,
            replace_occupied_offhand=True,
        )
        assert service.request is not None
        totem = AutoTotemTask()
        assert service.request.input.Unpack(totem)
        assert totem.check_interval_ticks == 8
        assert totem.maximum_equips == 2
        assert totem.complete_when_no_totem
        assert totem.replace_occupied_offhand
        yield from bot.tasks.auto_armor(
            check_interval_ticks=12, maximum_equips=4, complete_when_no_upgrade=True
        )
        assert service.request is not None
        armor = AutoArmorTask()
        assert service.request.input.Unpack(armor)
        assert armor.check_interval_ticks == 12
        assert armor.maximum_equips == 4
        assert armor.complete_when_no_upgrade

    await run_async(scoped(workflow).or_die())


async def test_effect_collect_blocks_task_preserves_selectors_and_path_policy() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.collect_blocks(
            ["minecraft:oak_log"],
            tags=["minecraft:logs"],
            count=6,
            search_radius=48,
            avoid_submerged_targets=True,
            require_line_of_sight=True,
            target_y_range=IntRange(minimum=60, maximum=96),
            options=PathfindOptions(
                allow_mining=True,
                allow_placing=False,
                avoid_fluids=True,
                minimum_y=63,
                maximum_y=96,
            ),
        )
        assert service.request is not None
        task = CollectBlocksTask()
        assert service.request.input.Unpack(task)
        assert list(task.block_ids) == ["minecraft:oak_log"]
        assert list(task.tags) == ["minecraft:logs"]
        assert task.count == 6
        assert task.search_radius == 48
        assert task.avoid_submerged_targets
        assert task.require_line_of_sight
        assert task.target_y_range == IntRange(minimum=60, maximum=96)
        assert task.options.allow_mining
        assert not task.options.allow_placing
        assert task.options.avoid_fluids
        assert task.options.minimum_y == 63
        assert task.options.maximum_y == 96

    await run_async(scoped(workflow).or_die())


async def test_effect_excavate_task_preserves_corners_limit_and_path_policy() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.excavate(
            BlockPosition(x=1, y=62, z=3, dimension="minecraft:overworld"),
            BlockPosition(x=8, y=65, z=10, dimension="minecraft:overworld"),
            maximum_blocks=128,
            options=PathfindOptions(allow_placing=True, search_timeout_seconds=15),
        )
        assert service.request is not None
        task = ExcavateTask()
        assert service.request.input.Unpack(task)
        assert task.corner_a.x == 1
        assert task.corner_a.y == 62
        assert task.corner_b.x == 8
        assert task.corner_b.z == 10
        assert task.maximum_blocks == 128
        assert task.options.allow_placing
        assert task.options.search_timeout_seconds == 15

    await run_async(scoped(workflow).or_die())


async def test_effect_build_task_preserves_schematic_transforms_and_partition() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.build(
            BlockPosition(x=100, y=64, z=-20, dimension="minecraft:overworld"),
            [
                SchematicBlock(
                    0, 0, 0, "minecraft:oak_stairs", {"facing": "north", "half": "bottom"}
                ),
                SchematicBlock(1, 0, 0, "minecraft:oak_planks"),
            ],
            rotation=BUILD_ROTATION_CLOCKWISE_90,
            mirror=BUILD_MIRROR_X,
            substitutions={"minecraft:oak_planks": ["minecraft:spruce_planks"]},
            break_incorrect_blocks=True,
            partition_index=1,
            partition_count=2,
        )
        assert service.request is not None
        task = BuildTask()
        assert service.request.input.Unpack(task)
        assert task.origin.x == 100
        assert task.origin.z == -20
        assert len(task.blocks) == 2
        assert task.blocks[0].block_id == "minecraft:oak_stairs"
        assert task.blocks[0].properties["facing"] == "north"
        assert task.rotation == BUILD_ROTATION_CLOCKWISE_90
        assert task.mirror == BUILD_MIRROR_X
        assert task.substitutions[0].source_block_id == "minecraft:oak_planks"
        assert list(task.substitutions[0].replacement_block_ids) == ["minecraft:spruce_planks"]
        assert task.break_incorrect_blocks
        assert task.partition_index == 1
        assert task.partition_count == 2

    await run_async(scoped(workflow).or_die())


async def test_effect_craft_task_preserves_operation_count_and_station() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.craft(
            "display:42",
            count=3,
            station=BlockPosition(x=12, y=64, z=-4, dimension="minecraft:overworld"),
        )
        assert service.request is not None
        task = CraftTask()
        assert service.request.input.Unpack(task)
        assert task.recipe_id == "display:42"
        assert task.count == 3
        assert task.station == BlockPosition(x=12, y=64, z=-4, dimension="minecraft:overworld")

    await run_async(scoped(workflow).or_die())


async def test_effect_smelt_task_preserves_input_fuel_and_station() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        station = BlockPosition(x=12, y=64, z=-4, dimension="minecraft:overworld")
        yield from bot.tasks.smelt(
            ItemSelector(item_ids=["minecraft:raw_iron"]),
            count=8,
            fuel=ItemSelector(tags=["minecraft:coals"]),
            station=station,
        )
        assert service.request is not None
        task = SmeltTask()
        assert service.request.input.Unpack(task)
        assert list(task.input.item_ids) == ["minecraft:raw_iron"]
        assert task.count == 8
        assert list(task.fuel.tags) == ["minecraft:coals"]
        assert task.station == station

    await run_async(scoped(workflow).or_die())


async def test_effect_brew_task_preserves_mix_and_output_policy() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        station = BlockPosition(x=12, y=64, z=-4, dimension="minecraft:overworld")
        yield from bot.tasks.brew(
            ItemSelector(fingerprint="water-potion"),
            ItemSelector(item_ids=["minecraft:nether_wart"]),
            count=3,
            fuel=ItemSelector(item_ids=["minecraft:blaze_powder"]),
            station=station,
            expected_result=ItemSelector(fingerprint="awkward-potion"),
        )
        assert service.request is not None
        task = BrewTask()
        assert service.request.input.Unpack(task)
        assert task.input.fingerprint == "water-potion"
        assert list(task.ingredient.item_ids) == ["minecraft:nether_wart"]
        assert task.count == 3
        assert list(task.fuel.item_ids) == ["minecraft:blaze_powder"]
        assert task.station == station
        assert task.expected_result.fingerprint == "awkward-potion"

    await run_async(scoped(workflow).or_die())


async def test_effect_villager_trade_preserves_exact_offer_policy() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        yield from bot.tasks.villager_trade(
            4,
            count=3,
            expected_result=ItemSelector(item_ids=["minecraft:ender_pearl"]),
            close_when_done=True,
        )
        assert service.request is not None
        task = VillagerTradeTask()
        assert service.request.input.Unpack(task)
        assert task.offer_index == 4
        assert task.count == 3
        assert list(task.expected_result.item_ids) == ["minecraft:ender_pearl"]
        assert task.close_when_done

    await run_async(scoped(workflow).or_die())


@pytest.mark.asyncio
async def test_run_stream_is_call_owned_by_default() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = AsyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        updates = list((yield from bot.tasks.run(GoToTask()).run_collect()))
        assert len(updates) == 1
        assert service.request is not None
        assert service.request.disconnect_policy == BOT_TASK_DISCONNECT_POLICY_CANCEL_WITH_CALL

    await run_async(scoped(workflow).or_die())


async def test_task_deadline_must_be_timezone_aware() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncTaskService()
        bot = SoulFireBot(
            "instance-id",
            "bot-id",
            cast(BotServiceClient, object()),
            cast(BotLiveServiceClient, object()),
            cast(BotTaskServiceClient, service),
        )
        result = yield from bot.tasks.start(
            GoToTask(), GoToTaskResult, deadline=datetime(2026, 1, 1)
        ).exit()
        assert isinstance(result, Failure)
        assert isinstance(result.error, SoulFireValidationError)
        assert service.request is None

    await run_async(scoped(workflow).or_die())
