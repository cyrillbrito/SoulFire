import type {
  DescMessage,
  MessageInitShape,
} from "@bufbuild/protobuf";
import type { CallOptions, Client } from "@connectrpc/connect";

import {
  RecipeService,
  type CanCraftRequestSchema,
  type CanCraftResponse,
  type ListRecipesRequestSchema,
  type ListRecipesResponse,
  type ListVillagerTradesResponse,
} from "./generated/soulfire/recipe_pb.js";
import type {
  BrewTaskOptions,
  CraftTaskOptions,
  SmeltTaskOptions,
  SoulFireTask,
  SoulFireTasks,
  VillagerTradeTaskOptions,
} from "./tasks.js";
import type {
  BrewTaskResultSchema,
  CraftTaskResultSchema,
  SmeltTaskResultSchema,
  VillagerTradeTaskResultSchema,
} from "./generated/soulfire/recipe_pb.js";
import type { BotTaskEvent } from "./generated/soulfire/task_pb.js";
import type {
  ItemSelectorSchema,
} from "./generated/soulfire/inventory_pb.js";

type RecipeRequest<T extends DescMessage> = Omit<
  MessageInitShape<T>,
  "$typeName" | "scope"
>;

export class SoulFireRecipes {
  public constructor(
    private readonly instanceId: string,
    private readonly botId: string,
    private readonly client: Client<typeof RecipeService>,
    private readonly tasks: SoulFireTasks,
  ) {}

  /**
   * Recipes in the bot's recipe book (the ones it has unlocked), sorted by id.
   * `pageSize` defaults to 100, at most 1000; pass `nextPageToken` back as
   * `pageToken` for the next page.
   */
  public list(
    request: RecipeRequest<typeof ListRecipesRequestSchema> = {},
    options?: CallOptions,
  ): Promise<ListRecipesResponse> {
    return this.client.listRecipes(
      { ...request, scope: this.scope() },
      options,
    );
  }

  /**
   * Whether the player inventory holds the ingredients for `count` crafts of
   * `recipeId`, what is missing, and the station the recipe needs. `count`
   * defaults to 1.
   */
  public canCraft(
    request: RecipeRequest<typeof CanCraftRequestSchema>,
    options?: CallOptions,
  ): Promise<CanCraftResponse> {
    return this.client.canCraft(
      { ...request, scope: this.scope() },
      options,
    );
  }

  /**
   * Offers of the merchant menu the bot has open.
   */
  public listVillagerTrades(
    options?: CallOptions,
  ): Promise<ListVillagerTradesResponse> {
    return this.client.listVillagerTrades(
      { scope: this.scope() },
      options,
    );
  }

  /**
   * Same as `tasks.craft`: `count` is recipe operations, not output items, and
   * defaults to 1.
   */
  public craft(
    recipeId: string,
    count = 1,
    options: CraftTaskOptions = {},
  ): Promise<SoulFireTask<typeof CraftTaskResultSchema>> {
    return this.tasks.craft(recipeId, count, options);
  }

  /**
   * Same as `tasks.runCraft`: `count` is recipe operations, not output items,
   * and defaults to 1.
   */
  public runCraft(
    recipeId: string,
    count = 1,
    options: CraftTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    return this.tasks.runCraft(recipeId, count, options);
  }

  /**
   * Same as `tasks.smelt`: `count` is input items to cook, and defaults to 1.
   */
  public smelt(
    input: MessageInitShape<typeof ItemSelectorSchema>,
    count = 1,
    options: SmeltTaskOptions = {},
  ): Promise<SoulFireTask<typeof SmeltTaskResultSchema>> {
    return this.tasks.smelt(input, count, options);
  }

  /**
   * Same as `tasks.runSmelt`: `count` is input items to cook, and defaults to
   * 1.
   */
  public runSmelt(
    input: MessageInitShape<typeof ItemSelectorSchema>,
    count = 1,
    options: SmeltTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    return this.tasks.runSmelt(input, count, options);
  }

  /**
   * Same as `tasks.brew`: `count` is bottles to brew, and defaults to 1.
   */
  public brew(
    input: MessageInitShape<typeof ItemSelectorSchema>,
    ingredient: MessageInitShape<typeof ItemSelectorSchema>,
    count = 1,
    options: BrewTaskOptions = {},
  ): Promise<SoulFireTask<typeof BrewTaskResultSchema>> {
    return this.tasks.brew(input, ingredient, count, options);
  }

  /**
   * Same as `tasks.runBrew`: `count` is bottles to brew, and defaults to 1.
   */
  public runBrew(
    input: MessageInitShape<typeof ItemSelectorSchema>,
    ingredient: MessageInitShape<typeof ItemSelectorSchema>,
    count = 1,
    options: BrewTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    return this.tasks.runBrew(input, ingredient, count, options);
  }

  /**
   * Same as `tasks.villagerTrade`: `offerIndex` is the zero-based index from
   * `listVillagerTrades`, and `count` defaults to 1.
   */
  public villagerTrade(
    offerIndex: number,
    count = 1,
    options: VillagerTradeTaskOptions = {},
  ): Promise<SoulFireTask<typeof VillagerTradeTaskResultSchema>> {
    return this.tasks.villagerTrade(offerIndex, count, options);
  }

  /**
   * Same as `tasks.runVillagerTrade`: `offerIndex` is the zero-based index from
   * `listVillagerTrades`, and `count` defaults to 1.
   */
  public runVillagerTrade(
    offerIndex: number,
    count = 1,
    options: VillagerTradeTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    return this.tasks.runVillagerTrade(offerIndex, count, options);
  }

  private scope(): { instanceId: string; botId: string } {
    return { instanceId: this.instanceId, botId: this.botId };
  }
}
