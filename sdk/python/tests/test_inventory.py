from typing import cast

import pytest
from effect_py import Failure, gen, run_async, scoped, succeed

from soulfire.common_pb2 import BlockPosition
from soulfire.errors import SoulFireContainerClosedError
from soulfire.inventory_connect import InventoryServiceClient
from soulfire.inventory_pb2 import (
    INVENTORY_AREA_CONTAINER,
    INVENTORY_AREA_PLAYER,
    INVENTORY_RECOMMENDATION_KIND_FOOD,
    INVENTORY_RECOMMENDATION_KIND_TOOL,
    ContainerSnapshot,
    GetContainerSnapshotResponse,
    InventoryItemRecommendation,
    InventoryMutationResponse,
    ItemSelector,
    RankInventoryItemsRequest,
    RankInventoryItemsResponse,
    TransferItemsRequest,
)
from soulfire.semantic import SoulFireInventory


class SyncInventoryService:
    def __init__(self) -> None:
        self.transfers: list[TransferItemsRequest] = []
        self.ranking: RankInventoryItemsRequest | None = None

    async def open_block_container(
        self, _request: object, **_kwargs: object
    ) -> InventoryMutationResponse:
        return _response(42, 10)

    async def transfer_items(
        self, request: TransferItemsRequest, **_kwargs: object
    ) -> InventoryMutationResponse:
        self.transfers.append(request)
        return _response(42, request.expected_revision + 1)

    async def close_semantic_container(
        self, _request: object, **_kwargs: object
    ) -> InventoryMutationResponse:
        return _response(0, 13)

    async def rank_inventory_items(
        self, request: RankInventoryItemsRequest, **_kwargs: object
    ) -> RankInventoryItemsResponse:
        self.ranking = request
        return RankInventoryItemsResponse(recommendations=[InventoryItemRecommendation(score=2000)])


class AsyncInventoryService:
    def __init__(self) -> None:
        self.transfers: list[TransferItemsRequest] = []
        self.ranking: RankInventoryItemsRequest | None = None

    async def open_block_container(
        self, _request: object, **_kwargs: object
    ) -> InventoryMutationResponse:
        return _response(42, 10)

    async def transfer_items(
        self, request: TransferItemsRequest, **_kwargs: object
    ) -> InventoryMutationResponse:
        self.transfers.append(request)
        return _response(42, request.expected_revision + 1)

    async def close_semantic_container(
        self, _request: object, **_kwargs: object
    ) -> InventoryMutationResponse:
        return _response(0, 13)

    async def get_container_snapshot(
        self, _request: object, **_kwargs: object
    ) -> GetContainerSnapshotResponse:
        return GetContainerSnapshotResponse(container=ContainerSnapshot(container_id=99))

    async def rank_inventory_items(
        self, request: RankInventoryItemsRequest, **_kwargs: object
    ) -> RankInventoryItemsResponse:
        self.ranking = request
        return RankInventoryItemsResponse(recommendations=[InventoryItemRecommendation(score=40)])


async def test_effect_container_chains_revision_safe_transfers() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncInventoryService()
        inventory = SoulFireInventory(
            "instance-id", "bot-id", cast(InventoryServiceClient, service), lambda headers: headers
        )
        container = yield from inventory.open(BlockPosition(x=1, y=64, z=2))
        yield from container.deposit(ItemSelector(item_ids=["minecraft:cobblestone"]), 32)
        yield from container.withdraw(ItemSelector(item_ids=["minecraft:bread"]), 4)
        assert [request.expected_revision for request in service.transfers] == [10, 11]
        assert getattr(service.transfers[0], "from") == INVENTORY_AREA_PLAYER
        assert service.transfers[0].to == INVENTORY_AREA_CONTAINER
        assert getattr(service.transfers[1], "from") == INVENTORY_AREA_CONTAINER
        assert service.transfers[1].to == INVENTORY_AREA_PLAYER
        yield from container.close()
        assert container.closed

    await run_async(scoped(workflow).or_die())


async def test_effect_best_tool_preserves_ranking_policy() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = SyncInventoryService()
        inventory = SoulFireInventory(
            "instance-id", "bot-id", cast(InventoryServiceClient, service), lambda headers: headers
        )
        recommendation = yield from inventory.best_tool(
            BlockPosition(x=1, y=64, z=2, dimension="minecraft:overworld"),
            prefer_hotbar=True,
            prefer_high_durability=True,
            preferred_enchantment_ids=["minecraft:fortune"],
            excluded_enchantment_ids=["minecraft:vanishing_curse"],
        )
        assert recommendation is not None
        assert recommendation.score == 2000
        assert service.ranking is not None
        assert service.ranking.kind == INVENTORY_RECOMMENDATION_KIND_TOOL
        assert service.ranking.limit == 1
        assert service.ranking.target_block == BlockPosition(
            x=1, y=64, z=2, dimension="minecraft:overworld"
        )
        assert service.ranking.prefer_hotbar
        assert service.ranking.prefer_high_durability
        assert list(service.ranking.preferred_enchantment_ids) == ["minecraft:fortune"]
        assert list(service.ranking.excluded_enchantment_ids) == ["minecraft:vanishing_curse"]

    await run_async(scoped(workflow).or_die())


@pytest.mark.asyncio
async def test_container_detects_replaced_menu() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = AsyncInventoryService()
        inventory = SoulFireInventory(
            "instance-id", "bot-id", cast(InventoryServiceClient, service), lambda headers: headers
        )
        container = yield from inventory.open(BlockPosition(x=1, y=64, z=2))
        result = yield from container.refresh().exit()
        assert isinstance(result, Failure)
        assert isinstance(result.error, SoulFireContainerClosedError)
        assert container.closed

    await run_async(scoped(workflow).or_die())


@pytest.mark.asyncio
async def test_best_food_uses_food_recommendation_kind() -> None:

    @gen
    def workflow():
        yield from succeed(None)
        service = AsyncInventoryService()
        inventory = SoulFireInventory(
            "instance-id", "bot-id", cast(InventoryServiceClient, service), lambda headers: headers
        )
        recommendation = yield from inventory.best_food(
            selector=ItemSelector(item_ids=["minecraft:bread"])
        )
        assert recommendation is not None
        assert recommendation.score == 40
        assert service.ranking is not None
        assert service.ranking.kind == INVENTORY_RECOMMENDATION_KIND_FOOD
        assert list(service.ranking.selector.item_ids) == ["minecraft:bread"]

    await run_async(scoped(workflow).or_die())


def _response(container_id: int, revision: int) -> InventoryMutationResponse:
    return InventoryMutationResponse(
        container=ContainerSnapshot(container_id=container_id, revision=revision)
    )
