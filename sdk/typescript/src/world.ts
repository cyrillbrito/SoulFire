import type {
  DescMessage,
  MessageInitShape,
} from "@bufbuild/protobuf";
import type { CallOptions, Client } from "@connectrpc/connect";

import {
  WorldService,
  type CanSeeBlockRequestSchema,
  type CanSeeBlockResponse,
  type EstimateExplosionDamageRequestSchema,
  type EstimateExplosionDamageResponse,
  type EstimateDigTimeRequestSchema,
  type EstimateDigTimeResponse,
  type GetWorldBlockRequestSchema,
  type GetWorldBlockResponse,
  type GetWorldEntityRequestSchema,
  type GetWorldEntityResponse,
  type QueryBlocksRequestSchema,
  type QueryBlocksResponse,
  type QueryEntitiesRequestSchema,
  type QueryEntitiesResponse,
  type RaycastRequestSchema,
  type RaycastResponse,
} from "./generated/soulfire/world_pb.js";
import type {
  BlockSnapshot,
  EntitySnapshot,
  PlayerSnapshot,
} from "./generated/soulfire/domain_pb.js";

type BotScoped<T extends DescMessage> = Omit<
  MessageInitShape<T>,
  "$typeName" | "botId" | "instanceId"
>;

type PlayerRaycastRequest = Omit<
  BotScoped<typeof RaycastRequestSchema>,
  "direction" | "origin"
>;

export class SoulFireWorld {
  public constructor(
    private readonly instanceId: string,
    private readonly botId: string,
    private readonly client: Client<typeof WorldService>,
  ) {}

  public async player(options?: CallOptions): Promise<PlayerSnapshot> {
    const response = await this.client.getPlayerSnapshot(
      this.scope(),
      options,
    );
    if (response.player === undefined) {
      throw new Error("SoulFire did not return a player snapshot");
    }
    return response.player;
  }

  public block(
    request: BotScoped<typeof GetWorldBlockRequestSchema>,
    options?: CallOptions,
  ): Promise<GetWorldBlockResponse> {
    return this.client.getWorldBlock(
      { ...request, ...this.scope() },
      options,
    );
  }

  /**
   * Blocks matching `selector` in `region`, in loaded chunks only. `region`
   * defaults to a sphere of radius 16 around the bot; a sphere's radius is at
   * most 128, and a box of more than 4,194,304 blocks is refused. Sorted
   * nearest to the region's center first unless `sort` says otherwise.
   * `pageSize` defaults to 100, at most 500; pass `nextPageToken` back as
   * `pageToken` for the next page.
   */
  public queryBlocks(
    request: BotScoped<typeof QueryBlocksRequestSchema>,
    options?: CallOptions,
  ): Promise<QueryBlocksResponse> {
    return this.client.queryBlocks(
      { ...request, ...this.scope() },
      options,
    );
  }

  public entity(
    request: BotScoped<typeof GetWorldEntityRequestSchema>,
    options?: CallOptions,
  ): Promise<GetWorldEntityResponse> {
    return this.client.getWorldEntity(
      { ...request, ...this.scope() },
      options,
    );
  }

  /**
   * Entities within `radius` of `origin`, the bot itself excluded. `origin`
   * defaults to the bot's position, and `radius` to 32, at most 256. Sorted and
   * paged like `queryBlocks`.
   */
  public queryEntities(
    request: BotScoped<typeof QueryEntitiesRequestSchema>,
    options?: CallOptions,
  ): Promise<QueryEntitiesResponse> {
    return this.client.queryEntities(
      { ...request, ...this.scope() },
      options,
    );
  }

  /**
   * The first thing a ray hits: a block, or an entity (with `includeEntities`)
   * if one is closer. `origin` defaults to the bot's eyes, `direction` to where
   * it looks, and `maximumDistance` to 6, at most 256.
   */
  public raycast(
    request: BotScoped<typeof RaycastRequestSchema>,
    options?: CallOptions,
  ): Promise<RaycastResponse> {
    return this.client.raycast(
      { ...request, ...this.scope() },
      options,
    );
  }

  /**
   * `raycast` from the bot's eyes, along where it looks.
   */
  public raycastFromPlayer(
    request: PlayerRaycastRequest = {},
    options?: CallOptions,
  ): Promise<RaycastResponse> {
    return this.client.raycast(
      { ...request, ...this.scope() },
      options,
    );
  }

  /**
   * The block the bot looks at, or undefined if none is within
   * `maximumDistance`. `maximumDistance` defaults to 256, which is also the
   * most.
   */
  public async blockAtCursor(
    maximumDistance = 256,
    options?: CallOptions,
  ): Promise<BlockSnapshot | undefined> {
    const response = await this.raycastFromPlayer(
      { maximumDistance, includeEntities: false },
      options,
    );
    return response.block;
  }

  /**
   * The entity the bot looks at, or undefined if none is within
   * `maximumDistance` or a block is in the way. `maximumDistance` defaults to
   * 3.5.
   */
  public async entityAtCursor(
    maximumDistance = 3.5,
    options?: CallOptions,
  ): Promise<EntitySnapshot | undefined> {
    const response = await this.raycastFromPlayer(
      { maximumDistance, includeEntities: true },
      options,
    );
    return response.entity;
  }

  /**
   * Damage `target` would take from an explosion of `power` at `center`, after
   * its armor, resistance, enchantments and absorption. The damage radius is
   * twice `power`; `power` must be above 0 and at most 128. Target and center
   * must be observable in the bot's dimension.
   */
  public estimateExplosionDamage(
    request: BotScoped<typeof EstimateExplosionDamageRequestSchema>,
    options?: CallOptions,
  ): Promise<EstimateExplosionDamageResponse> {
    return this.client.estimateExplosionDamage(
      { ...request, ...this.scope() },
      options,
    );
  }

  /**
   * Whether a ray from the bot's eyes to the center of the block reaches it.
   */
  public canSeeBlock(
    request: BotScoped<typeof CanSeeBlockRequestSchema>,
    options?: CallOptions,
  ): Promise<CanSeeBlockResponse> {
    return this.client.canSeeBlock(
      { ...request, ...this.scope() },
      options,
    );
  }

  /**
   * How long the bot would take to break the block with what it holds now,
   * counting its effects, attributes and surroundings.
   */
  public estimateDigTime(
    request: BotScoped<typeof EstimateDigTimeRequestSchema>,
    options?: CallOptions,
  ): Promise<EstimateDigTimeResponse> {
    return this.client.estimateDigTime(
      { ...request, ...this.scope() },
      options,
    );
  }

  private scope(): { instanceId: string; botId: string } {
    return { instanceId: this.instanceId, botId: this.botId };
  }
}
