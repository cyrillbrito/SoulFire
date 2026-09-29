import type {
  DescMessage,
  MessageInitShape,
} from "@bufbuild/protobuf";
import type { CallOptions, Client } from "@connectrpc/connect";

import {
  InventoryArea,
  InventoryRecommendationKind,
  InventoryService,
  type ContainerSnapshot,
  type CountItemsRequestSchema,
  type EquipItemRequestSchema,
  type FindInventorySlotsRequestSchema,
  type FindInventorySlotsResponse,
  type InventoryMutationResponse,
  type InventoryItemRecommendation,
  type MoveInventoryItemRequestSchema,
  type RankInventoryItemsRequestSchema,
  type RankInventoryItemsResponse,
  type SelectHotbarItemRequestSchema,
  type TossItemsRequestSchema,
  type TransferItemsRequestSchema,
  type UnequipItemRequestSchema,
} from "./generated/soulfire/inventory_pb.js";
import {
  type BlockPositionSchema,
} from "./generated/soulfire/common_pb.js";

type InventoryRequest<T extends DescMessage> = Omit<
  MessageInitShape<T>,
  "$typeName" | "scope"
>;

export interface ContainerMutationOptions {
  call?: CallOptions;
  idempotencyKey?: string;
}

export type InventoryRankOptions = Omit<
  InventoryRequest<typeof RankInventoryItemsRequestSchema>,
  "kind"
>;

export type InventoryRankingOptions = Omit<
  InventoryRankOptions,
  "equipmentSlot" | "targetBlock"
>;

/**
 * A block container opened with `inventory.open`. `await using` closes it.
 */
export class SoulFireContainer implements AsyncDisposable {
  #closed = false;

  public constructor(
    private readonly scope: { instanceId: string; botId: string },
    private readonly client: Client<typeof InventoryService>,
    private readonly actionOptions: (options?: CallOptions) =>
      CallOptions | undefined,
    private current: ContainerSnapshot,
  ) {}

  public get snapshot(): Readonly<ContainerSnapshot> {
    return this.current;
  }

  public get closed(): boolean {
    return this.#closed;
  }

  /**
   * Throws `SoulFireContainerClosedError` if the container was closed in the
   * meantime.
   */
  public async refresh(options?: CallOptions): Promise<ContainerSnapshot> {
    this.requireOpen();
    const response = await this.client.getContainerSnapshot(
      { scope: this.scope },
      options,
    );
    if (
      response.container === undefined
      || response.container.containerId !== this.current.containerId
    ) {
      this.#closed = true;
      throw new SoulFireContainerClosedError(this.current.containerId);
    }
    this.current = response.container;
    return this.current;
  }

  /**
   * Moves `count` items matching `selector` from the player's inventory into
   * the container. Fails if fewer are available or they don't fit.
   */
  public deposit(
    selector: InventoryRequest<typeof TransferItemsRequestSchema>["selector"],
    count: number,
    options: ContainerMutationOptions = {},
  ): Promise<ContainerSnapshot> {
    return this.transfer(
      selector,
      count,
      InventoryArea.PLAYER,
      InventoryArea.CONTAINER,
      options,
    );
  }

  /**
   * Moves `count` items matching `selector` from the container into the
   * player's inventory. Fails if fewer are available or they don't fit.
   */
  public withdraw(
    selector: InventoryRequest<typeof TransferItemsRequestSchema>["selector"],
    count: number,
    options: ContainerMutationOptions = {},
  ): Promise<ContainerSnapshot> {
    return this.transfer(
      selector,
      count,
      InventoryArea.CONTAINER,
      InventoryArea.PLAYER,
      options,
    );
  }

  public async close(
    options: ContainerMutationOptions = {},
  ): Promise<ContainerSnapshot> {
    if (this.#closed) {
      return this.current;
    }
    const response = await this.client.closeSemanticContainer(
      {
        scope: this.scope,
        containerId: this.current.containerId,
        ...(options.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: options.idempotencyKey }),
      },
      this.actionOptions(options.call),
    );
    this.#closed = true;
    this.current = requireContainer(response);
    return this.current;
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async transfer(
    selector: InventoryRequest<typeof TransferItemsRequestSchema>["selector"],
    count: number,
    from: InventoryArea,
    to: InventoryArea,
    options: ContainerMutationOptions,
  ): Promise<ContainerSnapshot> {
    this.requireOpen();
    const response = await this.client.transferItems(
      {
        scope: this.scope,
        selector,
        count,
        from,
        to,
        expectedRevision: this.current.revision,
        ...(options.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: options.idempotencyKey }),
      },
      this.actionOptions(options.call),
    );
    this.current = requireContainer(response);
    return this.current;
  }

  private requireOpen(): void {
    if (this.#closed) {
      throw new SoulFireContainerClosedError(this.current.containerId);
    }
  }
}

export class SoulFireContainerClosedError extends Error {
  public constructor(public readonly containerId: number) {
    super(`Container ${containerId} is already closed`);
    this.name = "SoulFireContainerClosedError";
  }
}

/**
 * The inventory and the menu the bot has open. `move`, `transfer`, `toss`,
 * `selectHotbar`, `equip` and `unequip` take an optional `expectedRevision`:
 * when not 0, they fail with ABORTED if the menu changed since that revision.
 */
export class SoulFireInventory {
  public constructor(
    private readonly instanceId: string,
    private readonly botId: string,
    private readonly client: Client<typeof InventoryService>,
    private readonly actionOptions: (options?: CallOptions) =>
      CallOptions | undefined,
  ) {}

  /**
   * The open menu (the player's inventory when no container is open), with
   * every slot.
   */
  public async snapshot(options?: CallOptions): Promise<ContainerSnapshot> {
    const response = await this.client.getContainerSnapshot(
      { scope: this.scope() },
      options,
    );
    if (response.container === undefined) {
      throw new Error("SoulFire did not return a container snapshot");
    }
    return response.container;
  }

  /**
   * Items matching `selector` in `areas`. No `areas` means container, main,
   * hotbar, armor, offhand and crafting slots.
   */
  public async count(
    request: InventoryRequest<typeof CountItemsRequestSchema>,
    options?: CallOptions,
  ): Promise<bigint> {
    const response = await this.client.countItems(
      { ...request, scope: this.scope() },
      options,
    );
    return response.count;
  }

  /**
   * Slots holding items that match `selector`, in `areas` (the same default as
   * `count`).
   */
  public find(
    request: InventoryRequest<typeof FindInventorySlotsRequestSchema>,
    options?: CallOptions,
  ): Promise<FindInventorySlotsResponse> {
    return this.client.findInventorySlots(
      { ...request, scope: this.scope() },
      options,
    );
  }

  /**
   * Candidates for `kind`, best first, with the factors behind each score.
   * `limit` defaults to 10 (at most 100); `areas` default to main, hotbar,
   * armor and offhand.
   */
  public rank(
    kind: InventoryRecommendationKind,
    options: InventoryRankOptions = {},
    call?: CallOptions,
  ): Promise<RankInventoryItemsResponse> {
    return this.client.rankInventoryItems(
      { ...options, kind, scope: this.scope() },
      call,
    );
  }

  /**
   * The best tool for breaking the block at `targetBlock`.
   */
  public bestTool(
    targetBlock: MessageInitShape<typeof BlockPositionSchema>,
    options: InventoryRankingOptions = {},
    call?: CallOptions,
  ): Promise<InventoryItemRecommendation | undefined> {
    return this.best(
      InventoryRecommendationKind.TOOL,
      { ...options, targetBlock },
      call,
    );
  }

  public bestWeapon(
    options: InventoryRankingOptions = {},
    call?: CallOptions,
  ): Promise<InventoryItemRecommendation | undefined> {
    return this.best(
      InventoryRecommendationKind.MELEE_WEAPON,
      options,
      call,
    );
  }

  public bestArmor(
    equipmentSlot: "head" | "chest" | "legs" | "feet",
    options: InventoryRankingOptions = {},
    call?: CallOptions,
  ): Promise<InventoryItemRecommendation | undefined> {
    return this.best(
      InventoryRecommendationKind.ARMOR,
      { ...options, equipmentSlot },
      call,
    );
  }

  public bestFood(
    options: InventoryRankingOptions = {},
    call?: CallOptions,
  ): Promise<InventoryItemRecommendation | undefined> {
    return this.best(
      InventoryRecommendationKind.FOOD,
      options,
      call,
    );
  }

  public bestScaffold(
    options: InventoryRankingOptions = {},
    call?: CallOptions,
  ): Promise<InventoryItemRecommendation | undefined> {
    return this.best(
      InventoryRecommendationKind.SCAFFOLD,
      options,
      call,
    );
  }

  /**
   * Moves items from `sourceSlot` to `destinationSlot` of the open menu;
   * `count` defaults to the whole stack.
   */
  public move(
    request: InventoryRequest<typeof MoveInventoryItemRequestSchema>,
    options?: CallOptions,
  ): Promise<InventoryMutationResponse> {
    return this.client.moveInventoryItem(
      { ...request, scope: this.scope() },
      this.actionOptions(options),
    );
  }

  /**
   * Moves `count` items matching `selector` from area `from` to area `to`
   * (`PLAYER` is main and hotbar). Fails if fewer are available or they don't
   * fit.
   */
  public transfer(
    request: InventoryRequest<typeof TransferItemsRequestSchema>,
    options?: CallOptions,
  ): Promise<InventoryMutationResponse> {
    return this.client.transferItems(
      { ...request, scope: this.scope() },
      this.actionOptions(options),
    );
  }

  /**
   * Drops `count` items matching `selector` on the ground.
   */
  public toss(
    request: InventoryRequest<typeof TossItemsRequestSchema>,
    options?: CallOptions,
  ): Promise<InventoryMutationResponse> {
    return this.client.tossItems(
      { ...request, scope: this.scope() },
      this.actionOptions(options),
    );
  }

  /**
   * Selects `hotbarSlot` (0-8), or the item matching `selector`: a hotbar slot
   * that holds one, or else a matching item swapped into the selected slot.
   */
  public selectHotbar(
    request: InventoryRequest<typeof SelectHotbarItemRequestSchema>,
    options?: CallOptions,
  ): Promise<InventoryMutationResponse> {
    return this.client.selectHotbarItem(
      { ...request, scope: this.scope() },
      this.actionOptions(options),
    );
  }

  /**
   * Puts an item matching `selector` in `equipmentSlot`: mainhand, offhand,
   * head, chest, legs or feet. Closes an open container first, except for
   * mainhand (which selects it as `selectHotbar` does).
   */
  public equip(
    request: InventoryRequest<typeof EquipItemRequestSchema>,
    options?: CallOptions,
  ): Promise<InventoryMutationResponse> {
    return this.client.equipItem(
      { ...request, scope: this.scope() },
      this.actionOptions(options),
    );
  }

  /**
   * Moves the item in `equipmentSlot` (mainhand, offhand, head, chest, legs or
   * feet) to `destinationArea`: MAIN, HOTBAR or PLAYER. It defaults to PLAYER,
   * the first free main or hotbar slot.
   */
  public unequip(
    request: InventoryRequest<typeof UnequipItemRequestSchema>,
    options?: CallOptions,
  ): Promise<InventoryMutationResponse> {
    return this.client.unequipItem(
      { ...request, scope: this.scope() },
      this.actionOptions(options),
    );
  }

  /**
   * Opens the container block at `position`. Times out after 10 s.
   */
  public async open(
    position: MessageInitShape<typeof BlockPositionSchema>,
    options: ContainerMutationOptions = {},
  ): Promise<SoulFireContainer> {
    const scope = this.scope();
    const response = await this.client.openBlockContainer(
      {
        scope,
        position,
        ...(options.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: options.idempotencyKey }),
      },
      this.actionOptions(options.call),
    );
    return new SoulFireContainer(
      scope,
      this.client,
      this.actionOptions,
      requireContainer(response),
    );
  }

  private async best(
    kind: InventoryRecommendationKind,
    options: Omit<
      InventoryRequest<typeof RankInventoryItemsRequestSchema>,
      "kind"
    >,
    call?: CallOptions,
  ): Promise<InventoryItemRecommendation | undefined> {
    const response = await this.client.rankInventoryItems(
      {
        ...options,
        kind,
        limit: 1,
        scope: this.scope(),
      },
      call,
    );
    return response.recommendations[0];
  }

  private scope(): { instanceId: string; botId: string } {
    return { instanceId: this.instanceId, botId: this.botId };
  }
}

function requireContainer(
  response: InventoryMutationResponse,
): ContainerSnapshot {
  if (response.container === undefined) {
    throw new Error("SoulFire did not return a container snapshot");
  }
  return response.container;
}
