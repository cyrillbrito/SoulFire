import {
  create,
  type DescMessage,
  type MessageInitShape,
  type MessageShape,
} from "@bufbuild/protobuf";
import {
  anyPack,
  anyUnpack,
  timestampFromDate,
} from "@bufbuild/protobuf/wkt";
import type {
  CallOptions,
  Client,
} from "@connectrpc/connect";

import type {
  PathfindGoal,
} from "./generated/soulfire/bot_live_pb.js";
import {
  PathfindOptionsSchema,
} from "./generated/soulfire/bot_live_pb.js";
import { BlockPositionSchema } from "./generated/soulfire/common_pb.js";
import type { EntityReference } from "./generated/soulfire/domain_pb.js";
import {
  ItemSelectorSchema,
} from "./generated/soulfire/inventory_pb.js";
import {
  EntitySelectorSchema,
} from "./generated/soulfire/world_pb.js";
import {
  BrewTaskResultSchema,
  BrewTaskSchema,
  type BrewTaskResult,
  CraftTaskResultSchema,
  CraftTaskSchema,
  type CraftTaskResult,
  SmeltTaskResultSchema,
  SmeltTaskSchema,
  type SmeltTaskResult,
  VillagerTradeTaskResultSchema,
  VillagerTradeTaskSchema,
  type VillagerTradeTaskResult,
} from "./generated/soulfire/recipe_pb.js";
import {
  AttackEntityTaskResultSchema,
  AttackEntityTaskSchema,
  type AttackEntityTaskResult,
  AttackNearestTaskResultSchema,
  AttackNearestTaskSchema,
  type AttackNearestTaskResult,
  AutoArmorTaskResultSchema,
  AutoArmorTaskSchema,
  type AutoArmorTaskResult,
  AutoEatTaskResultSchema,
  AutoEatTaskSchema,
  type AutoEatTaskResult,
  AutoRespawnTaskResultSchema,
  AutoRespawnTaskSchema,
  type AutoRespawnTaskResult,
  AutoTotemTaskResultSchema,
  AutoTotemTaskSchema,
  type AutoTotemTaskResult,
  BuildMirror,
  BuildRotation,
  BuildTaskResultSchema,
  BuildTaskSchema,
  type BuildTaskResult,
  BotTaskConflictPolicy,
  BotTaskDisconnectPolicy,
  BotTaskPriority,
  BotTaskReconnectPolicy,
  BotTaskService,
  BotTaskStatus,
  BreedTaskResultSchema,
  BreedTaskSchema,
  type BreedTaskResult,
  CollectBlocksTaskResultSchema,
  CollectBlocksTaskSchema,
  type CollectBlocksTaskResult,
  ContainerTransferDirection,
  ContainerTransferTaskResultSchema,
  ContainerTransferTaskSchema,
  type ContainerTransferTaskResult,
  ExploreTaskResultSchema,
  ExploreTaskSchema,
  type ExploreTaskResult,
  ExcavateTaskResultSchema,
  ExcavateTaskSchema,
  type ExcavateTaskResult,
  FarmTaskResultSchema,
  FarmTaskSchema,
  type FarmTaskResult,
  FishTaskResultSchema,
  FishTaskSchema,
  type FishTaskResult,
  FollowEntityTaskResultSchema,
  FollowEntityTaskSchema,
  type FollowEntityTaskResult,
  FleeTaskResultSchema,
  FleeTaskSchema,
  type FleeTaskResult,
  GuardTaskResultSchema,
  GuardTaskSchema,
  type GuardTaskResult,
  MaintainLoadoutTaskResultSchema,
  MaintainLoadoutTaskSchema,
  type MaintainLoadoutTaskResult,
  GoToTaskResultSchema,
  GoToTaskSchema,
  type BotTask,
  type BotTaskEvent,
  type GoToTaskResult,
  type ListBotTasksRequestSchema,
  RangedAttackTaskResultSchema,
  RangedAttackTaskSchema,
  type RangedAttackTaskResult,
  SleepTaskResultSchema,
  SleepTaskSchema,
  type SleepTaskResult,
  type StartBotTaskRequestSchema,
} from "./generated/soulfire/task_pb.js";

export type {
  AttackEntityTaskResult,
  AttackNearestTaskResult,
  AutoArmorTaskResult,
  AutoEatTaskResult,
  AutoRespawnTaskResult,
  AutoTotemTaskResult,
  BuildTaskResult,
  BreedTaskResult,
  CollectBlocksTaskResult,
  ContainerTransferTaskResult,
  ExploreTaskResult,
  ExcavateTaskResult,
  FarmTaskResult,
  BrewTaskResult,
  CraftTaskResult,
  FishTaskResult,
  FollowEntityTaskResult,
  FleeTaskResult,
  GuardTaskResult,
  MaintainLoadoutTaskResult,
  RangedAttackTaskResult,
  SleepTaskResult,
  SmeltTaskResult,
  VillagerTradeTaskResult,
};

type ScopedTaskStartRequest = Omit<
  MessageInitShape<typeof StartBotTaskRequestSchema>,
  "$typeName" | "botId" | "deadline" | "input" | "instanceId"
>;

type ScopedTaskListRequest = Omit<
  MessageInitShape<typeof ListBotTasksRequestSchema>,
  "$typeName" | "botId" | "instanceId"
>;

type GuardSubject = Exclude<
  MessageInitShape<typeof GuardTaskSchema>["subject"],
  undefined
>;

/**
 * Options every task takes. Unset, the server uses `conflictPolicy` QUEUE,
 * `priority` NORMAL, `reconnectPolicy` FAIL and `disconnectPolicy` CONTINUE
 * (the `run*` methods default to CANCEL_WITH_CALL).
 */
export interface TaskStartOptions extends ScopedTaskStartRequest {
  call?: CallOptions;
  /**
   * The task ends as TIMED_OUT at this time. Must be in the future.
   */
  deadline?: Date;
}

export interface GoToTaskOptions extends TaskStartOptions {
  path?: MessageInitShape<typeof PathfindOptionsSchema>;
}

export interface FollowEntityTaskOptions extends TaskStartOptions {
  path?: MessageInitShape<typeof PathfindOptionsSchema>;
  /**
   * How long the entity may stay out of sight before the task ends. Defaults to
   * 10, at most 3600.
   */
  targetUnavailableTimeoutSeconds?: number;
}

export interface AttackEntityTaskOptions extends TaskStartOptions {
  path?: MessageInitShape<typeof PathfindOptionsSchema>;
  /**
   * Defaults to 3, at most 6.
   */
  attackRange?: number;
  sprinting?: boolean;
  /**
   * 0 (the default) attacks until the target is defeated.
   */
  maximumAttacks?: number;
  /**
   * How long the target may stay out of sight before the task ends. Defaults to
   * 10, at most 3600.
   */
  targetUnavailableTimeoutSeconds?: number;
  /**
   * Picks the strongest melee weapon (among `weapon` if set). Defaults to true.
   */
  selectBestWeapon?: boolean;
  weapon?: MessageInitShape<typeof ItemSelectorSchema>;
  /**
   * Reselects the previous hotbar slot when the task stops. Defaults to true.
   */
  restoreSelectedSlot?: boolean;
  /**
   * Raises a shield held in the offhand while approaching and between attacks.
   */
  useOffhandShield?: boolean;
}

export interface AttackNearestTaskOptions extends TaskStartOptions {
  /**
   * Search radius around the bot. Defaults to 32, at most 128.
   */
  radius?: number;
  path?: MessageInitShape<typeof PathfindOptionsSchema>;
  /**
   * Defaults to 3, at most 6.
   */
  attackRange?: number;
  sprinting?: boolean;
  /**
   * 0 (the default) means no limit.
   */
  maximumAttacks?: number;
  /**
   * Targets to defeat; 0 means no limit. Defaults to 1 for `attackNearest`, 0
   * for `runAttackNearest`.
   */
  maximumTargets?: number;
  /**
   * How long to wait while nothing matches; 0 (the default) waits forever. At
   * most 3600.
   */
  noTargetTimeoutSeconds?: number;
  /**
   * Ends at once when no target is in sight. Defaults to true for
   * `attackNearest`, false for `runAttackNearest`.
   */
  completeWhenNoTarget?: boolean;
  /**
   * Defaults to true.
   */
  selectBestWeapon?: boolean;
  weapon?: MessageInitShape<typeof ItemSelectorSchema>;
  /**
   * Defaults to true.
   */
  restoreSelectedSlot?: boolean;
}

export interface RangedAttackTaskOptions extends TaskStartOptions {
  path?: MessageInitShape<typeof PathfindOptionsSchema>;
  /**
   * Defaults to 8; less than `maximumRange`.
   */
  minimumRange?: number;
  /**
   * Defaults to 24, at most 64.
   */
  maximumRange?: number;
  /**
   * 0 (the default) fires until the target is defeated.
   */
  maximumShots?: number;
  /**
   * How long the target may stay out of sight before the task ends. Defaults to
   * 10, at most 3600.
   */
  targetUnavailableTimeoutSeconds?: number;
  /**
   * Limits which bow or crossbow may be picked.
   */
  weapon?: MessageInitShape<typeof ItemSelectorSchema>;
  /**
   * Defaults to 20, from 3 to 20. Crossbows use their own charge time.
   */
  bowDrawTicks?: number;
  /**
   * Defaults to true.
   */
  leadTarget?: boolean;
  /**
   * Defaults to true.
   */
  compensateGravity?: boolean;
  /**
   * Defaults to true.
   */
  strafe?: boolean;
  /**
   * Defaults to true.
   */
  restoreSelectedSlot?: boolean;
}

export interface FleeTaskOptions extends TaskStartOptions {
  /**
   * Starts fleeing when a threat is this close. Defaults to 8, at most 128.
   */
  triggerRadius?: number;
  /**
   * How far from the threat counts as safe. Defaults to 16, at most 128; more
   * than `triggerRadius`.
   */
  safeDistance?: number;
  path?: MessageInitShape<typeof PathfindOptionsSchema>;
  /**
   * Seconds the bot must stay safe for an escape to count. Defaults to 2, at
   * most 300.
   */
  safeSeconds?: number;
  /**
   * Ends after an escape instead of watching for more. Defaults to true for
   * `flee`, false for `runFlee`.
   */
  completeWhenSafe?: boolean;
  /**
   * 0 (the default) means no limit.
   */
  maximumEscapes?: number;
}

export interface GuardTaskOptions extends TaskStartOptions {
  /**
   * How far around the guarded position or entity to look for threats. Defaults
   * to 16, at most 128.
   */
  guardRadius?: number;
  /**
   * Stops chasing beyond this distance from what it guards. Defaults to 24, at
   * most 128; at least `guardRadius`.
   */
  maximumPursuitDistance?: number;
  /**
   * How close to what it guards the bot returns. Defaults to 3; less than the
   * pursuit distance.
   */
  returnRadius?: number;
  path?: MessageInitShape<typeof PathfindOptionsSchema>;
  /**
   * Defaults to 3, at most 6.
   */
  attackRange?: number;
  sprinting?: boolean;
  /**
   * 0 (the default) means no limit.
   */
  maximumAttacks?: number;
  /**
   * 0 (the default) means no limit.
   */
  maximumTargets?: number;
  /**
   * Ends once no threat is in range for `clearSeconds`. Defaults to true for
   * `guard` and `protect`, false for `runGuard` and `runProtect`.
   */
  completeWhenClear?: boolean;
  /**
   * Defaults to 3, at most 300.
   */
  clearSeconds?: number;
  /**
   * Defaults to true.
   */
  selectBestWeapon?: boolean;
  weapon?: MessageInitShape<typeof ItemSelectorSchema>;
  /**
   * Defaults to true.
   */
  restoreSelectedSlot?: boolean;
}

export interface SleepTaskOptions extends TaskStartOptions {
  /**
   * Defaults to the nearest loaded bed within `searchRadius`.
   */
  bed?: MessageInitShape<typeof BlockPositionSchema>;
  /**
   * Defaults to 24, at most 32.
   */
  searchRadius?: number;
  path?: MessageInitShape<typeof PathfindOptionsSchema>;
  /**
   * Keeps trying while sleeping isn't possible, such as during the day.
   * Defaults to false for `sleep`, true for `runSleep`.
   */
  waitUntilPossible?: boolean;
  /**
   * Between refused attempts. Defaults to 20, at most 1200.
   */
  retryIntervalTicks?: number;
}

export interface FishTaskOptions extends TaskStartOptions {
  /**
   * 0 fishes until cancelled. Defaults to 1 for `fish`, 0 for `runFish`.
   */
  maximumCatches?: number;
  /**
   * 0 (the default) means no limit.
   */
  maximumFailedCasts?: number;
  /**
   * Limits which fishing rod may be picked.
   */
  rod?: MessageInitShape<typeof ItemSelectorSchema>;
  /**
   * Defaults to 100, at most 1200.
   */
  castTimeoutTicks?: number;
  /**
   * Defaults to 12000, at most 72000.
   */
  biteTimeoutTicks?: number;
  /**
   * Defaults to true for `fish`, false for `runFish`.
   */
  completeWhenNoRod?: boolean;
  /**
   * Defaults to true.
   */
  restoreSelectedSlot?: boolean;
}

export interface FarmTaskOptions extends TaskStartOptions {
  /**
   * Empty (the default) farms every crop SoulFire supports.
   */
  cropIds?: readonly string[];
  /**
   * Defaults to wherever the bot is at each scan.
   */
  center?: MessageInitShape<typeof BlockPositionSchema>;
  /**
   * Defaults to 24, at most 48.
   */
  radius?: number;
  /**
   * 0 farms until cancelled. Defaults to 1 for `farm`, 0 for `runFarm`.
   */
  maximumHarvests?: number;
  /**
   * Defaults to true.
   */
  replant?: boolean;
  /**
   * Ends instead of waiting for a crop to grow. Defaults to true for `farm`,
   * false for `runFarm`.
   */
  completeWhenNoMatureCrops?: boolean;
  path?: MessageInitShape<typeof PathfindOptionsSchema>;
  /**
   * Between scans while nothing is mature. Defaults to 100, at most 72000.
   */
  rescanIntervalTicks?: number;
  /**
   * Defaults to true.
   */
  restoreSelectedSlot?: boolean;
}

export interface BreedTaskOptions extends TaskStartOptions {
  /**
   * Empty (the default) means any animal.
   */
  animals?: MessageInitShape<typeof EntitySelectorSchema>;
  /**
   * Defaults to any food both animals accept.
   */
  food?: MessageInitShape<typeof ItemSelectorSchema>;
  center?: MessageInitShape<typeof BlockPositionSchema>;
  /**
   * Defaults to 24, from 1 to 64.
   */
  radius?: number;
  /**
   * 0 breeds until cancelled. Defaults to 1 for `breed`, 0 for `runBreed`.
   */
  maximumPairs?: number;
  /**
   * Defaults to true for `breed`, false for `runBreed`.
   */
  completeWhenNoPair?: boolean;
  /**
   * Defaults to true for `breed`, false for `runBreed`.
   */
  completeWhenNoFood?: boolean;
  path?: MessageInitShape<typeof PathfindOptionsSchema>;
  /**
   * Between scans while no pair is found. Defaults to 100, at most 72000.
   */
  rescanIntervalTicks?: number;
  /**
   * Defaults to 100, at most 1200.
   */
  breedingTimeoutTicks?: number;
  /**
   * Defaults to true.
   */
  restoreSelectedSlot?: boolean;
}

export interface ExploreTaskOptions extends TaskStartOptions {
  /**
   * Defaults to where the bot is when the task starts.
   */
  origin?: MessageInitShape<typeof BlockPositionSchema>;
  /**
   * Horizontal distance from `origin`. Defaults to 256, from 1 to 4096.
   */
  radius?: number;
  /**
   * Defaults to 64, from 8 to 512.
   */
  waypointSpacing?: number;
  /**
   * 0 explores until every cell is visited or the task is cancelled. Defaults
   * to 1 for `explore`, 0 for `runExplore`.
   */
  maximumWaypoints?: number;
  path?: MessageInitShape<typeof PathfindOptionsSchema>;
  /**
   * Goes back to `origin` after `maximumWaypoints`.
   */
  returnToOrigin?: boolean;
  /**
   * Bots with the same purpose share out the cells. Defaults to "sdk-explore".
   */
  purpose?: string;
}

export interface ContainerTransferSpec {
  selector: MessageInitShape<typeof ItemSelectorSchema>;
  count: number;
  /**
   * Moves what it can instead of failing when there are fewer items, or less
   * room, than `count`.
   */
  allowPartial?: boolean;
}

export interface ContainerTransferTaskOptions extends TaskStartOptions {
  path?: MessageInitShape<typeof PathfindOptionsSchema>;
  /**
   * Closes the container after a successful transfer. Defaults to true. A
   * failed or cancelled task always closes a container it opened.
   */
  closeContainer?: boolean;
}

/**
 * Below `minimumCount`, the bot withdraws up to `targetCount`; above
 * `maximumCount`, it deposits down to `targetCount`.
 */
export interface LoadoutRequirementSpec {
  selector: MessageInitShape<typeof ItemSelectorSchema>;
  minimumCount: number;
  targetCount: number;
  /**
   * Omitted or 0: never deposits.
   */
  maximumCount?: number;
}

export interface MaintainLoadoutTaskOptions extends TaskStartOptions {
  path?: MessageInitShape<typeof PathfindOptionsSchema>;
  /**
   * Defaults to 100, at most 72000.
   */
  checkIntervalTicks?: number;
  /**
   * 0 (the default) keeps going until cancelled.
   */
  maximumRebalances?: number;
  completeWhenSatisfied?: boolean;
  /**
   * Defaults to true.
   */
  closeContainer?: boolean;
}

export interface AutoEatTaskOptions extends TaskStartOptions {
  /**
   * Eats when the food level is at or below this. Defaults to 14, at most 20.
   */
  foodLevel?: number;
  /**
   * Defaults to 20, at most 1200.
   */
  checkIntervalTicks?: number;
  /**
   * 0 (the default) keeps going until cancelled.
   */
  maximumMeals?: number;
  completeWhenNoFood?: boolean;
  /**
   * Defaults to true.
   */
  restoreSelectedSlot?: boolean;
}

export interface AutoRespawnTaskOptions extends TaskStartOptions {
  /**
   * Between death and respawn. At most 12000.
   */
  respawnDelayTicks?: number;
  /**
   * 0 (the default) keeps going until cancelled.
   */
  maximumRespawns?: number;
}

export interface AutoTotemTaskOptions extends TaskStartOptions {
  /**
   * Defaults to 20, at most 1200.
   */
  checkIntervalTicks?: number;
  /**
   * 0 (the default) keeps going until cancelled.
   */
  maximumEquips?: number;
  completeWhenNoTotem?: boolean;
  /**
   * Swaps out another item held in the offhand; otherwise it is left alone.
   */
  replaceOccupiedOffhand?: boolean;
}

export interface AutoArmorTaskOptions extends TaskStartOptions {
  /**
   * Defaults to 20, at most 1200.
   */
  checkIntervalTicks?: number;
  /**
   * 0 (the default) keeps going until cancelled.
   */
  maximumEquips?: number;
  completeWhenNoUpgrade?: boolean;
}

export interface CollectBlocksTaskOptions extends TaskStartOptions {
  /**
   * Block tags to match, besides `blockIds`.
   */
  tags?: readonly string[];
  /**
   * Defaults to 1.
   */
  count?: number;
  /**
   * Defaults to 32, at most 64.
   */
  searchRadius?: number;
  /**
   * Skips blocks with fluid above them, up to the bot's height.
   */
  avoidSubmergedTargets?: boolean;
  /**
   * Only picks blocks the bot can see, checked again after each block.
   */
  requireLineOfSight?: boolean;
  /**
   * Only blocks between these heights; a missing bound is open.
   */
  targetYRange?: Readonly<{
    minimum?: number;
    maximum?: number;
  }>;
  path?: MessageInitShape<typeof PathfindOptionsSchema>;
}

export interface ExcavateTaskOptions extends TaskStartOptions {
  path?: MessageInitShape<typeof PathfindOptionsSchema>;
  /**
   * 0 (the default) clears the whole cuboid.
   */
  maximumBlocks?: number;
}

export interface SchematicBlock {
  offset: {
    x: number;
    y: number;
    z: number;
  };
  blockId: string;
  properties?: Readonly<Record<string, string>>;
}

export interface BuildTaskOptions extends TaskStartOptions {
  /**
   * Defaults to NONE.
   */
  rotation?: BuildRotation;
  /**
   * Defaults to NONE.
   */
  mirror?: BuildMirror;
  /**
   * Block ids that may be placed instead of a block id of the schematic.
   */
  substitutions?: Readonly<Record<string, readonly string[]>>;
  path?: MessageInitShape<typeof PathfindOptionsSchema>;
  /**
   * Defaults to true.
   */
  breakIncorrectBlocks?: boolean;
  /**
   * Defaults to true.
   */
  restoreSelectedSlot?: boolean;
  /**
   * Splits the blocks between bots: this one builds part `partitionIndex` of
   * `partitionCount`. `partitionIndex` defaults to 0 and `partitionCount` to 1.
   */
  partitionIndex?: number;
  partitionCount?: number;
}

export interface CraftTaskOptions extends TaskStartOptions {
  /**
   * A crafting table, for recipes that need one, unless one is already open.
   */
  station?: MessageInitShape<typeof BlockPositionSchema>;
}

export interface SmeltTaskOptions extends TaskStartOptions {
  /**
   * Limits the fuel, which defaults to any valid fuel.
   */
  fuel?: MessageInitShape<typeof ItemSelectorSchema>;
  /**
   * The furnace to use; needed unless a furnace menu is already open.
   */
  station?: MessageInitShape<typeof BlockPositionSchema>;
}

export interface BrewTaskOptions extends TaskStartOptions {
  /**
   * Limits the fuel, which defaults to blaze powder.
   */
  fuel?: MessageInitShape<typeof ItemSelectorSchema>;
  /**
   * The brewing stand to use; needed unless one is already open.
   */
  station?: MessageInitShape<typeof BlockPositionSchema>;
  /**
   * Refuses to brew if the predicted potion no longer matches.
   */
  expectedResult?: MessageInitShape<typeof ItemSelectorSchema>;
}

export interface VillagerTradeTaskOptions extends TaskStartOptions {
  /**
   * Closes the trade menu after a successful task.
   */
  closeWhenDone?: boolean;
  /**
   * Refuses to trade if the offer's result no longer matches.
   */
  expectedResult?: MessageInitShape<typeof ItemSelectorSchema>;
}

export type FollowEntityTarget = Pick<
  EntityReference,
  "connectionEpoch" | "networkId"
> | number;

export type AttackEntityTarget = (
  Pick<EntityReference, "networkId">
  & Partial<Pick<EntityReference, "connectionEpoch" | "uuid">>
) | number;

export interface TaskListOptions extends ScopedTaskListRequest {
  call?: CallOptions;
}

/**
 * Thrown by `SoulFireTask.result` when the task ended other than COMPLETED.
 */
export class SoulFireTaskError extends Error {
  public constructor(public readonly task: BotTask) {
    super(
      task.failure?.message
        ?? `Task ${task.taskId} ended in status ${task.status}`,
    );
    this.name = "SoulFireTaskError";
  }
}

/**
 * A task the bot runs on the server. It keeps running whatever the caller does,
 * until it ends.
 */
export class SoulFireTask<Result extends DescMessage | undefined = undefined> {
  #snapshot: BotTask;

  public constructor(
    private readonly client: Client<typeof BotTaskService>,
    snapshot: BotTask,
    private readonly resultSchema: Result,
    private readonly callOptions: (options?: CallOptions) =>
      CallOptions | undefined,
  ) {
    this.#snapshot = snapshot;
  }

  public get id(): string {
    return this.#snapshot.taskId;
  }

  /**
   * The task as last fetched: `refresh`, `wait` and `cancel` update it.
   */
  public get snapshot(): Readonly<BotTask> {
    return this.#snapshot;
  }

  /**
   * Completed, cancelled, failed or timed out.
   */
  public get terminal(): boolean {
    return isTerminalTaskStatus(this.#snapshot.status);
  }

  public async refresh(options?: CallOptions): Promise<BotTask> {
    this.#snapshot = await this.client.getBotTask(
      { taskId: this.id },
      options,
    );
    return this.#snapshot;
  }

  /**
   * The task's events after `afterRevision`, until it ends. `afterRevision`
   * defaults to the snapshot's.
   */
  public events(options?: {
    afterRevision?: bigint;
    call?: CallOptions;
  }): AsyncIterable<BotTaskEvent> {
    return this.client.watchBotTask(
      {
        taskId: this.id,
        afterRevision: options?.afterRevision ?? this.#snapshot.revision,
        follow: true,
      },
      options?.call,
    );
  }

  /**
   * Resolves when the task ends, however it ends.
   */
  public async wait(options?: {
    call?: CallOptions;
  }): Promise<BotTask> {
    if (this.terminal) {
      return this.#snapshot;
    }
    for await (const event of this.client.watchBotTask(
      {
        taskId: this.id,
        afterRevision: this.#snapshot.revision,
        follow: true,
      },
      options?.call,
    )) {
      if (event.task !== undefined) {
        this.#snapshot = event.task;
      }
    }
    if (!this.terminal) {
      await this.refresh(options?.call);
    }
    return this.#snapshot;
  }

  public async cancel(
    reason = "",
    options?: CallOptions,
  ): Promise<BotTask> {
    this.#snapshot = await this.client.cancelBotTask(
      { taskId: this.id, reason },
      this.callOptions(options),
    );
    return this.#snapshot;
  }

  /**
   * Waits for the end and returns the result. Throws `SoulFireTaskError` unless
   * it completed.
   */
  public async result(options?: {
    call?: CallOptions;
  }): Promise<
    Result extends DescMessage ? MessageShape<Result> : BotTask
  > {
    const task = await this.wait(options);
    if (task.status !== BotTaskStatus.COMPLETED) {
      throw new SoulFireTaskError(task);
    }
    if (this.resultSchema === undefined) {
      return task as Result extends DescMessage
        ? MessageShape<Result>
        : BotTask;
    }
    if (task.result === undefined) {
      throw new SoulFireTaskError({
        ...task,
        failure: {
          $typeName: "soulfire.v1.BotTaskFailure",
          code: "missing_result",
          message: "Completed task did not return a result",
          retryable: false,
        },
      });
    }
    const result = anyUnpack(task.result, this.resultSchema);
    if (result === undefined) {
      throw new SoulFireTaskError({
        ...task,
        failure: {
          $typeName: "soulfire.v1.BotTaskFailure",
          code: "result_type_mismatch",
          message:
            `Task returned ${task.result.typeUrl}, expected ${this.resultSchema.typeName}`,
          retryable: false,
        },
      });
    }
    return result as Result extends DescMessage
      ? MessageShape<Result>
      : BotTask;
  }
}

/**
 * Long jobs the server runs for the bot. Each `x` starts a task and resolves
 * once it's accepted, not when it ends: `await (await tasks.x(...)).result()`
 * waits for its result. Each `runX` starts it and streams its events instead,
 * and the task is cancelled if the stream is.
 */
export class SoulFireTasks {
  public constructor(
    private readonly instanceId: string,
    private readonly botId: string,
    private readonly client: Client<typeof BotTaskService>,
    private readonly callOptions: (options?: CallOptions) =>
      CallOptions | undefined,
  ) {}

  /**
   * Starts a task from its input message. `resultSchema` types `result()`.
   */
  public async start<
    Input extends DescMessage,
    Result extends DescMessage | undefined = undefined,
  >(
    inputSchema: Input,
    input: MessageInitShape<Input>,
    resultSchema?: Result,
    options: TaskStartOptions = {},
  ): Promise<SoulFireTask<Result>> {
    const {
      call,
      deadline,
      ...taskOptions
    } = options;
    const request = create(inputSchema, input);
    const task = await this.client.startBotTask(
      {
        ...taskOptions,
        instanceId: this.instanceId,
        botId: this.botId,
        input: anyPack(inputSchema, request),
        ...(deadline === undefined
          ? {}
          : { deadline: timestampFromDate(deadline) }),
      },
      this.callOptions(call),
    );
    return new SoulFireTask(
      this.client,
      task,
      resultSchema as Result,
      this.callOptions,
    );
  }

  /**
   * Starts a task and streams its events until it ends. Unless
   * `disconnectPolicy` says otherwise, the task is cancelled if the stream is.
   */
  public run<Input extends DescMessage>(
    inputSchema: Input,
    input: MessageInitShape<Input>,
    options: TaskStartOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      call,
      deadline,
      ...taskOptions
    } = options;
    const request = create(inputSchema, input);
    return this.client.runBotTask(
      {
        ...taskOptions,
        instanceId: this.instanceId,
        botId: this.botId,
        input: anyPack(inputSchema, request),
        disconnectPolicy:
          taskOptions.disconnectPolicy
          ?? BotTaskDisconnectPolicy.CANCEL_WITH_CALL,
        ...(deadline === undefined
          ? {}
          : { deadline: timestampFromDate(deadline) }),
      },
      this.callOptions(call),
    );
  }

  /**
   * Moves the bot to `goal` (see `goals`).
   */
  public goTo(
    goal: PathfindGoal,
    options: GoToTaskOptions = {},
  ): Promise<SoulFireTask<typeof GoToTaskResultSchema>> {
    const {
      path,
      ...taskOptions
    } = options;
    return this.start(
      GoToTaskSchema,
      { goal, ...(path === undefined ? {} : { options: path }) },
      GoToTaskResultSchema,
      taskOptions,
    );
  }

  public runGoTo(
    goal: PathfindGoal,
    options: GoToTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      path,
      ...taskOptions
    } = options;
    return this.run(
      GoToTaskSchema,
      { goal, ...(path === undefined ? {} : { options: path }) },
      taskOptions,
    );
  }

  /**
   * Keeps within `distance` of an entity as it moves. `distance` defaults to 3.
   */
  public followEntity(
    target: FollowEntityTarget,
    distance = 3,
    options: FollowEntityTaskOptions = {},
  ): Promise<SoulFireTask<typeof FollowEntityTaskResultSchema>> {
    const {
      path,
      targetUnavailableTimeoutSeconds = 0,
      ...taskOptions
    } = options;
    return this.start(
      FollowEntityTaskSchema,
      {
        target: {
          entityId: typeof target === "number"
            ? target
            : target.networkId,
          radius: distance,
          ...(typeof target === "number"
              || target.connectionEpoch.length === 0
            ? {}
            : { connectionEpoch: target.connectionEpoch }),
        },
        ...(path === undefined ? {} : { options: path }),
        targetUnavailableTimeoutSeconds,
      },
      FollowEntityTaskResultSchema,
      taskOptions,
    );
  }

  /**
   * `distance` defaults to 3.
   */
  public runFollowEntity(
    target: FollowEntityTarget,
    distance = 3,
    options: FollowEntityTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      path,
      targetUnavailableTimeoutSeconds = 0,
      ...taskOptions
    } = options;
    return this.run(
      FollowEntityTaskSchema,
      {
        target: {
          entityId: typeof target === "number"
            ? target
            : target.networkId,
          radius: distance,
          ...(typeof target === "number"
              || target.connectionEpoch.length === 0
            ? {}
            : { connectionEpoch: target.connectionEpoch }),
        },
        ...(path === undefined ? {} : { options: path }),
        targetUnavailableTimeoutSeconds,
      },
      taskOptions,
    );
  }

  /**
   * Chases one entity and attacks it until it's defeated or `maximumAttacks` is
   * reached.
   */
  public attackEntity(
    target: AttackEntityTarget,
    options: AttackEntityTaskOptions = {},
  ): Promise<SoulFireTask<typeof AttackEntityTaskResultSchema>> {
    const {
      path,
      attackRange = 3,
      sprinting = false,
      maximumAttacks = 0,
      targetUnavailableTimeoutSeconds = 0,
      selectBestWeapon = true,
      weapon,
      restoreSelectedSlot = true,
      useOffhandShield = false,
      ...taskOptions
    } = options;
    return this.start(
      AttackEntityTaskSchema,
      {
        target: entityReference(target),
        ...(path === undefined ? {} : { options: path }),
        attackRange,
        sprinting,
        maximumAttacks,
        targetUnavailableTimeoutSeconds,
        selectBestWeapon,
        ...(weapon === undefined ? {} : { weapon }),
        restoreSelectedSlot,
        useOffhandShield,
      },
      AttackEntityTaskResultSchema,
      taskOptions,
    );
  }

  public runAttackEntity(
    target: AttackEntityTarget,
    options: AttackEntityTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      path,
      attackRange = 3,
      sprinting = false,
      maximumAttacks = 0,
      targetUnavailableTimeoutSeconds = 0,
      selectBestWeapon = true,
      weapon,
      restoreSelectedSlot = true,
      useOffhandShield = false,
      ...taskOptions
    } = options;
    return this.run(
      AttackEntityTaskSchema,
      {
        target: entityReference(target),
        ...(path === undefined ? {} : { options: path }),
        attackRange,
        sprinting,
        maximumAttacks,
        targetUnavailableTimeoutSeconds,
        selectBestWeapon,
        ...(weapon === undefined ? {} : { weapon }),
        restoreSelectedSlot,
        useOffhandShield,
      },
      taskOptions,
    );
  }

  /**
   * Attacks the nearest entity matching `selector` within `radius`, then the
   * next, up to `maximumTargets`.
   */
  public attackNearest(
    selector: MessageInitShape<typeof EntitySelectorSchema>,
    options: AttackNearestTaskOptions = {},
  ): Promise<SoulFireTask<typeof AttackNearestTaskResultSchema>> {
    const {
      radius = 32,
      path,
      attackRange = 3,
      sprinting = false,
      maximumAttacks = 0,
      maximumTargets = 1,
      noTargetTimeoutSeconds = 0,
      completeWhenNoTarget = true,
      selectBestWeapon = true,
      weapon,
      restoreSelectedSlot = true,
      ...taskOptions
    } = options;
    return this.start(
      AttackNearestTaskSchema,
      {
        selector,
        radius,
        ...(path === undefined ? {} : { options: path }),
        attackRange,
        sprinting,
        maximumAttacks,
        maximumTargets,
        noTargetTimeoutSeconds,
        completeWhenNoTarget,
        selectBestWeapon,
        ...(weapon === undefined ? {} : { weapon }),
        restoreSelectedSlot,
      },
      AttackNearestTaskResultSchema,
      taskOptions,
    );
  }

  public runAttackNearest(
    selector: MessageInitShape<typeof EntitySelectorSchema>,
    options: AttackNearestTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      radius = 32,
      path,
      attackRange = 3,
      sprinting = false,
      maximumAttacks = 0,
      maximumTargets = 0,
      noTargetTimeoutSeconds = 0,
      completeWhenNoTarget = false,
      selectBestWeapon = true,
      weapon,
      restoreSelectedSlot = true,
      ...taskOptions
    } = options;
    return this.run(
      AttackNearestTaskSchema,
      {
        selector,
        radius,
        ...(path === undefined ? {} : { options: path }),
        attackRange,
        sprinting,
        maximumAttacks,
        maximumTargets,
        noTargetTimeoutSeconds,
        completeWhenNoTarget,
        selectBestWeapon,
        ...(weapon === undefined ? {} : { weapon }),
        restoreSelectedSlot,
      },
      taskOptions,
    );
  }

  /**
   * Shoots an entity with a bow or crossbow from between `minimumRange` and
   * `maximumRange`, leading the target and aiming for the arrow's drop.
   */
  public rangedAttack(
    target: AttackEntityTarget,
    options: RangedAttackTaskOptions = {},
  ): Promise<SoulFireTask<typeof RangedAttackTaskResultSchema>> {
    const { input, taskOptions } = rangedAttackInput(target, options);
    return this.start(
      RangedAttackTaskSchema,
      input,
      RangedAttackTaskResultSchema,
      taskOptions,
    );
  }

  public runRangedAttack(
    target: AttackEntityTarget,
    options: RangedAttackTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const { input, taskOptions } = rangedAttackInput(target, options);
    return this.run(RangedAttackTaskSchema, input, taskOptions);
  }

  /**
   * Moves away from the nearest threat until it is `safeDistance` away.
   */
  public flee(
    threats: MessageInitShape<typeof EntitySelectorSchema>,
    options: FleeTaskOptions = {},
  ): Promise<SoulFireTask<typeof FleeTaskResultSchema>> {
    const {
      triggerRadius = 8,
      safeDistance = 16,
      path,
      safeSeconds = 2,
      completeWhenSafe = true,
      maximumEscapes = 0,
      ...taskOptions
    } = options;
    return this.start(
      FleeTaskSchema,
      {
        threats,
        triggerRadius,
        safeDistance,
        ...(path === undefined ? {} : { options: path }),
        safeSeconds,
        completeWhenSafe,
        maximumEscapes,
      },
      FleeTaskResultSchema,
      taskOptions,
    );
  }

  public runFlee(
    threats: MessageInitShape<typeof EntitySelectorSchema>,
    options: FleeTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      triggerRadius = 8,
      safeDistance = 16,
      path,
      safeSeconds = 2,
      completeWhenSafe = false,
      maximumEscapes = 0,
      ...taskOptions
    } = options;
    return this.run(
      FleeTaskSchema,
      {
        threats,
        triggerRadius,
        safeDistance,
        ...(path === undefined ? {} : { options: path }),
        safeSeconds,
        completeWhenSafe,
        maximumEscapes,
      },
      taskOptions,
    );
  }

  /**
   * Defends `position` from `threats`.
   */
  public guard(
    position: MessageInitShape<typeof BlockPositionSchema>,
    threats: MessageInitShape<typeof EntitySelectorSchema>,
    options: GuardTaskOptions = {},
  ): Promise<SoulFireTask<typeof GuardTaskResultSchema>> {
    return this.startGuard(
      { case: "position", value: position },
      threats,
      true,
      options,
    );
  }

  public runGuard(
    position: MessageInitShape<typeof BlockPositionSchema>,
    threats: MessageInitShape<typeof EntitySelectorSchema>,
    options: GuardTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    return this.runGuardSubject(
      { case: "position", value: position },
      threats,
      false,
      options,
    );
  }

  /**
   * Defends an entity from `threats`.
   */
  public protect(
    entity: AttackEntityTarget,
    threats: MessageInitShape<typeof EntitySelectorSchema>,
    options: GuardTaskOptions = {},
  ): Promise<SoulFireTask<typeof GuardTaskResultSchema>> {
    return this.startGuard(
      { case: "entity", value: entityReference(entity) },
      threats,
      true,
      options,
    );
  }

  public runProtect(
    entity: AttackEntityTarget,
    threats: MessageInitShape<typeof EntitySelectorSchema>,
    options: GuardTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    return this.runGuardSubject(
      { case: "entity", value: entityReference(entity) },
      threats,
      false,
      options,
    );
  }

  private startGuard(
    subject: GuardSubject,
    threats: MessageInitShape<typeof EntitySelectorSchema>,
    completeWhenClearDefault: boolean,
    options: GuardTaskOptions,
  ): Promise<SoulFireTask<typeof GuardTaskResultSchema>> {
    const { input, taskOptions } = guardTaskInput(
      subject,
      threats,
      completeWhenClearDefault,
      options,
    );
    return this.start(
      GuardTaskSchema,
      input,
      GuardTaskResultSchema,
      taskOptions,
    );
  }

  private runGuardSubject(
    subject: GuardSubject,
    threats: MessageInitShape<typeof EntitySelectorSchema>,
    completeWhenClearDefault: boolean,
    options: GuardTaskOptions,
  ): AsyncIterable<BotTaskEvent> {
    const { input, taskOptions } = guardTaskInput(
      subject,
      threats,
      completeWhenClearDefault,
      options,
    );
    return this.run(GuardTaskSchema, input, taskOptions);
  }

  /**
   * Walks to a bed and gets in.
   */
  public sleep(
    options: SleepTaskOptions = {},
  ): Promise<SoulFireTask<typeof SleepTaskResultSchema>> {
    const {
      bed,
      searchRadius = 24,
      path,
      waitUntilPossible = false,
      retryIntervalTicks = 20,
      ...taskOptions
    } = options;
    return this.start(
      SleepTaskSchema,
      {
        ...(bed === undefined ? {} : { bed }),
        searchRadius,
        ...(path === undefined ? {} : { options: path }),
        waitUntilPossible,
        retryIntervalTicks,
      },
      SleepTaskResultSchema,
      taskOptions,
    );
  }

  public runSleep(
    options: SleepTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      bed,
      searchRadius = 24,
      path,
      waitUntilPossible = true,
      retryIntervalTicks = 20,
      ...taskOptions
    } = options;
    return this.run(
      SleepTaskSchema,
      {
        ...(bed === undefined ? {} : { bed }),
        searchRadius,
        ...(path === undefined ? {} : { options: path }),
        waitUntilPossible,
        retryIntervalTicks,
      },
      taskOptions,
    );
  }

  /**
   * Casts, waits for a bite, reels in, and repeats.
   */
  public fish(
    options: FishTaskOptions = {},
  ): Promise<SoulFireTask<typeof FishTaskResultSchema>> {
    const {
      maximumCatches = 1,
      maximumFailedCasts = 0,
      rod,
      castTimeoutTicks = 100,
      biteTimeoutTicks = 12_000,
      completeWhenNoRod = true,
      restoreSelectedSlot = true,
      ...taskOptions
    } = options;
    return this.start(
      FishTaskSchema,
      {
        maximumCatches,
        maximumFailedCasts,
        ...(rod === undefined ? {} : { rod }),
        castTimeoutTicks,
        biteTimeoutTicks,
        completeWhenNoRod,
        restoreSelectedSlot,
      },
      FishTaskResultSchema,
      taskOptions,
    );
  }

  public runFish(
    options: FishTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      maximumCatches = 0,
      maximumFailedCasts = 0,
      rod,
      castTimeoutTicks = 100,
      biteTimeoutTicks = 12_000,
      completeWhenNoRod = false,
      restoreSelectedSlot = true,
      ...taskOptions
    } = options;
    return this.run(
      FishTaskSchema,
      {
        maximumCatches,
        maximumFailedCasts,
        ...(rod === undefined ? {} : { rod }),
        castTimeoutTicks,
        biteTimeoutTicks,
        completeWhenNoRod,
        restoreSelectedSlot,
      },
      taskOptions,
    );
  }

  /**
   * Harvests mature crops around `center` and replants the ones that need it.
   */
  public farm(
    options: FarmTaskOptions = {},
  ): Promise<SoulFireTask<typeof FarmTaskResultSchema>> {
    const {
      cropIds = [],
      center,
      radius = 24,
      maximumHarvests = 1,
      replant = true,
      completeWhenNoMatureCrops = true,
      path,
      rescanIntervalTicks = 100,
      restoreSelectedSlot = true,
      ...taskOptions
    } = options;
    return this.start(
      FarmTaskSchema,
      {
        cropIds: [...cropIds],
        ...(center === undefined ? {} : { center }),
        radius,
        maximumHarvests,
        replant,
        completeWhenNoMatureCrops,
        ...(path === undefined ? {} : { options: path }),
        rescanIntervalTicks,
        restoreSelectedSlot,
      },
      FarmTaskResultSchema,
      taskOptions,
    );
  }

  public runFarm(
    options: FarmTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      cropIds = [],
      center,
      radius = 24,
      maximumHarvests = 0,
      replant = true,
      completeWhenNoMatureCrops = false,
      path,
      rescanIntervalTicks = 100,
      restoreSelectedSlot = true,
      ...taskOptions
    } = options;
    return this.run(
      FarmTaskSchema,
      {
        cropIds: [...cropIds],
        ...(center === undefined ? {} : { center }),
        radius,
        maximumHarvests,
        replant,
        completeWhenNoMatureCrops,
        ...(path === undefined ? {} : { options: path }),
        rescanIntervalTicks,
        restoreSelectedSlot,
      },
      taskOptions,
    );
  }

  /**
   * Feeds pairs of adult animals until the server confirms both are in love
   * mode.
   */
  public breed(
    options: BreedTaskOptions = {},
  ): Promise<SoulFireTask<typeof BreedTaskResultSchema>> {
    const {
      animals = {},
      food,
      center,
      radius = 24,
      maximumPairs = 1,
      completeWhenNoPair = true,
      completeWhenNoFood = true,
      path,
      rescanIntervalTicks = 100,
      breedingTimeoutTicks = 100,
      restoreSelectedSlot = true,
      ...taskOptions
    } = options;
    return this.start(
      BreedTaskSchema,
      {
        animals,
        ...(food === undefined ? {} : { food }),
        ...(center === undefined ? {} : { center }),
        radius,
        maximumPairs,
        completeWhenNoPair,
        completeWhenNoFood,
        ...(path === undefined ? {} : { options: path }),
        rescanIntervalTicks,
        breedingTimeoutTicks,
        restoreSelectedSlot,
      },
      BreedTaskResultSchema,
      taskOptions,
    );
  }

  public runBreed(
    options: BreedTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      animals = {},
      food,
      center,
      radius = 24,
      maximumPairs = 0,
      completeWhenNoPair = false,
      completeWhenNoFood = false,
      path,
      rescanIntervalTicks = 100,
      breedingTimeoutTicks = 100,
      restoreSelectedSlot = true,
      ...taskOptions
    } = options;
    return this.run(
      BreedTaskSchema,
      {
        animals,
        ...(food === undefined ? {} : { food }),
        ...(center === undefined ? {} : { center }),
        radius,
        maximumPairs,
        completeWhenNoPair,
        completeWhenNoFood,
        ...(path === undefined ? {} : { options: path }),
        rescanIntervalTicks,
        breedingTimeoutTicks,
        restoreSelectedSlot,
      },
      taskOptions,
    );
  }

  /**
   * Visits unexplored cells around `origin`.
   */
  public explore(
    options: ExploreTaskOptions = {},
  ): Promise<SoulFireTask<typeof ExploreTaskResultSchema>> {
    const {
      origin,
      radius = 256,
      waypointSpacing = 64,
      maximumWaypoints = 1,
      path,
      returnToOrigin = false,
      purpose = "sdk-explore",
      ...taskOptions
    } = options;
    return this.start(
      ExploreTaskSchema,
      {
        ...(origin === undefined ? {} : { origin }),
        radius,
        waypointSpacing,
        maximumWaypoints,
        ...(path === undefined ? {} : { options: path }),
        returnToOrigin,
        purpose,
      },
      ExploreTaskResultSchema,
      taskOptions,
    );
  }

  public runExplore(
    options: ExploreTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      origin,
      radius = 256,
      waypointSpacing = 64,
      maximumWaypoints = 0,
      path,
      returnToOrigin = false,
      purpose = "sdk-explore",
      ...taskOptions
    } = options;
    return this.run(
      ExploreTaskSchema,
      {
        ...(origin === undefined ? {} : { origin }),
        radius,
        waypointSpacing,
        maximumWaypoints,
        ...(path === undefined ? {} : { options: path }),
        returnToOrigin,
        purpose,
      },
      taskOptions,
    );
  }

  /**
   * Walks to the container, opens it and puts the items in.
   */
  public stash(
    container: MessageInitShape<typeof BlockPositionSchema>,
    operations: readonly ContainerTransferSpec[],
    options: ContainerTransferTaskOptions = {},
  ): Promise<SoulFireTask<typeof ContainerTransferTaskResultSchema>> {
    const { input, taskOptions } = containerTransferInput(
      ContainerTransferDirection.DEPOSIT,
      container,
      operations,
      options,
    );
    return this.start(
      ContainerTransferTaskSchema,
      input,
      ContainerTransferTaskResultSchema,
      taskOptions,
    );
  }

  public runStash(
    container: MessageInitShape<typeof BlockPositionSchema>,
    operations: readonly ContainerTransferSpec[],
    options: ContainerTransferTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const { input, taskOptions } = containerTransferInput(
      ContainerTransferDirection.DEPOSIT,
      container,
      operations,
      options,
    );
    return this.run(ContainerTransferTaskSchema, input, taskOptions);
  }

  /**
   * Walks to the container, opens it and takes the items out.
   */
  public withdraw(
    container: MessageInitShape<typeof BlockPositionSchema>,
    operations: readonly ContainerTransferSpec[],
    options: ContainerTransferTaskOptions = {},
  ): Promise<SoulFireTask<typeof ContainerTransferTaskResultSchema>> {
    const { input, taskOptions } = containerTransferInput(
      ContainerTransferDirection.WITHDRAW,
      container,
      operations,
      options,
    );
    return this.start(
      ContainerTransferTaskSchema,
      input,
      ContainerTransferTaskResultSchema,
      taskOptions,
    );
  }

  public runWithdraw(
    container: MessageInitShape<typeof BlockPositionSchema>,
    operations: readonly ContainerTransferSpec[],
    options: ContainerTransferTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const { input, taskOptions } = containerTransferInput(
      ContainerTransferDirection.WITHDRAW,
      container,
      operations,
      options,
    );
    return this.run(ContainerTransferTaskSchema, input, taskOptions);
  }

  /**
   * Keeps each requirement's count in range by withdrawing from and depositing
   * to `container`.
   */
  public maintainLoadout(
    container: MessageInitShape<typeof BlockPositionSchema>,
    requirements: readonly LoadoutRequirementSpec[],
    options: MaintainLoadoutTaskOptions = {},
  ): Promise<SoulFireTask<typeof MaintainLoadoutTaskResultSchema>> {
    const { input, taskOptions } = maintainLoadoutInput(
      container,
      requirements,
      options,
    );
    return this.start(
      MaintainLoadoutTaskSchema,
      input,
      MaintainLoadoutTaskResultSchema,
      taskOptions,
    );
  }

  public runMaintainLoadout(
    container: MessageInitShape<typeof BlockPositionSchema>,
    requirements: readonly LoadoutRequirementSpec[],
    options: MaintainLoadoutTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const { input, taskOptions } = maintainLoadoutInput(
      container,
      requirements,
      options,
    );
    return this.run(MaintainLoadoutTaskSchema, input, taskOptions);
  }

  /**
   * `maintainLoadout` once: a single rebalance, done when satisfied.
   */
  public balanceLoadout(
    container: MessageInitShape<typeof BlockPositionSchema>,
    requirements: readonly LoadoutRequirementSpec[],
    options: Omit<
      MaintainLoadoutTaskOptions,
      "completeWhenSatisfied" | "maximumRebalances"
    > = {},
  ): Promise<SoulFireTask<typeof MaintainLoadoutTaskResultSchema>> {
    return this.maintainLoadout(container, requirements, {
      ...options,
      maximumRebalances: 1,
      completeWhenSatisfied: true,
    });
  }

  /**
   * Eats when the food level drops to `foodLevel`. An empty `foodItemIds` (the
   * default) eats any safe food.
   */
  public autoEat(
    foodItemIds: readonly string[] = [],
    options: AutoEatTaskOptions = {},
  ): Promise<SoulFireTask<typeof AutoEatTaskResultSchema>> {
    const {
      foodLevel = 14,
      checkIntervalTicks = 20,
      maximumMeals = 0,
      completeWhenNoFood = false,
      restoreSelectedSlot = true,
      ...taskOptions
    } = options;
    return this.start(
      AutoEatTaskSchema,
      {
        foodItemIds: [...foodItemIds],
        foodLevel,
        checkIntervalTicks,
        maximumMeals,
        completeWhenNoFood,
        restoreSelectedSlot,
      },
      AutoEatTaskResultSchema,
      taskOptions,
    );
  }

  /**
   * An empty `foodItemIds` (the default) eats any safe food.
   */
  public runAutoEat(
    foodItemIds: readonly string[] = [],
    options: AutoEatTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      foodLevel = 14,
      checkIntervalTicks = 20,
      maximumMeals = 0,
      completeWhenNoFood = false,
      restoreSelectedSlot = true,
      ...taskOptions
    } = options;
    return this.run(
      AutoEatTaskSchema,
      {
        foodItemIds: [...foodItemIds],
        foodLevel,
        checkIntervalTicks,
        maximumMeals,
        completeWhenNoFood,
        restoreSelectedSlot,
      },
      taskOptions,
    );
  }

  /**
   * Respawns after each death.
   */
  public autoRespawn(
    options: AutoRespawnTaskOptions = {},
  ): Promise<SoulFireTask<typeof AutoRespawnTaskResultSchema>> {
    const {
      respawnDelayTicks = 0,
      maximumRespawns = 0,
      ...taskOptions
    } = options;
    return this.start(
      AutoRespawnTaskSchema,
      { respawnDelayTicks, maximumRespawns },
      AutoRespawnTaskResultSchema,
      taskOptions,
    );
  }

  public runAutoRespawn(
    options: AutoRespawnTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      respawnDelayTicks = 0,
      maximumRespawns = 0,
      ...taskOptions
    } = options;
    return this.run(
      AutoRespawnTaskSchema,
      { respawnDelayTicks, maximumRespawns },
      taskOptions,
    );
  }

  /**
   * Keeps a totem of undying in the offhand.
   */
  public autoTotem(
    options: AutoTotemTaskOptions = {},
  ): Promise<SoulFireTask<typeof AutoTotemTaskResultSchema>> {
    const {
      checkIntervalTicks = 20,
      maximumEquips = 0,
      completeWhenNoTotem = false,
      replaceOccupiedOffhand = false,
      ...taskOptions
    } = options;
    return this.start(
      AutoTotemTaskSchema,
      {
        checkIntervalTicks,
        maximumEquips,
        completeWhenNoTotem,
        replaceOccupiedOffhand,
      },
      AutoTotemTaskResultSchema,
      taskOptions,
    );
  }

  public runAutoTotem(
    options: AutoTotemTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      checkIntervalTicks = 20,
      maximumEquips = 0,
      completeWhenNoTotem = false,
      replaceOccupiedOffhand = false,
      ...taskOptions
    } = options;
    return this.run(
      AutoTotemTaskSchema,
      {
        checkIntervalTicks,
        maximumEquips,
        completeWhenNoTotem,
        replaceOccupiedOffhand,
      },
      taskOptions,
    );
  }

  /**
   * Keeps the best armor the bot has equipped.
   */
  public autoArmor(
    options: AutoArmorTaskOptions = {},
  ): Promise<SoulFireTask<typeof AutoArmorTaskResultSchema>> {
    const {
      checkIntervalTicks = 20,
      maximumEquips = 0,
      completeWhenNoUpgrade = false,
      ...taskOptions
    } = options;
    return this.start(
      AutoArmorTaskSchema,
      { checkIntervalTicks, maximumEquips, completeWhenNoUpgrade },
      AutoArmorTaskResultSchema,
      taskOptions,
    );
  }

  public runAutoArmor(
    options: AutoArmorTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      checkIntervalTicks = 20,
      maximumEquips = 0,
      completeWhenNoUpgrade = false,
      ...taskOptions
    } = options;
    return this.run(
      AutoArmorTaskSchema,
      { checkIntervalTicks, maximumEquips, completeWhenNoUpgrade },
      taskOptions,
    );
  }

  /**
   * Finds, reaches and mines `count` blocks with one of `blockIds` or `tags`.
   */
  public collectBlocks(
    blockIds: readonly string[],
    options: CollectBlocksTaskOptions = {},
  ): Promise<SoulFireTask<typeof CollectBlocksTaskResultSchema>> {
    const {
      tags = [],
      count = 1,
      searchRadius = 32,
      avoidSubmergedTargets = false,
      requireLineOfSight = false,
      targetYRange,
      path,
      ...taskOptions
    } = options;
    return this.start(
      CollectBlocksTaskSchema,
      {
        blockIds: [...blockIds],
        tags: [...tags],
        count,
        searchRadius,
        avoidSubmergedTargets,
        requireLineOfSight,
        ...(targetYRange === undefined ? {} : { targetYRange }),
        ...(path === undefined ? {} : { options: path }),
      },
      CollectBlocksTaskResultSchema,
      taskOptions,
    );
  }

  public runCollectBlocks(
    blockIds: readonly string[],
    options: CollectBlocksTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      tags = [],
      count = 1,
      searchRadius = 32,
      avoidSubmergedTargets = false,
      requireLineOfSight = false,
      targetYRange,
      path,
      ...taskOptions
    } = options;
    return this.run(
      CollectBlocksTaskSchema,
      {
        blockIds: [...blockIds],
        tags: [...tags],
        count,
        searchRadius,
        avoidSubmergedTargets,
        requireLineOfSight,
        ...(targetYRange === undefined ? {} : { targetYRange }),
        ...(path === undefined ? {} : { options: path }),
      },
      taskOptions,
    );
  }

  /**
   * Clears every diggable block in the cuboid from `from` to `to`, both
   * included. At most 32,768 blocks.
   */
  public excavate(
    from: MessageInitShape<typeof BlockPositionSchema>,
    to: MessageInitShape<typeof BlockPositionSchema>,
    options: ExcavateTaskOptions = {},
  ): Promise<SoulFireTask<typeof ExcavateTaskResultSchema>> {
    const {
      path,
      maximumBlocks = 0,
      ...taskOptions
    } = options;
    return this.start(
      ExcavateTaskSchema,
      {
        cornerA: from,
        cornerB: to,
        maximumBlocks,
        ...(path === undefined ? {} : { options: path }),
      },
      ExcavateTaskResultSchema,
      taskOptions,
    );
  }

  public runExcavate(
    from: MessageInitShape<typeof BlockPositionSchema>,
    to: MessageInitShape<typeof BlockPositionSchema>,
    options: ExcavateTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      path,
      maximumBlocks = 0,
      ...taskOptions
    } = options;
    return this.run(
      ExcavateTaskSchema,
      {
        cornerA: from,
        cornerB: to,
        maximumBlocks,
        ...(path === undefined ? {} : { options: path }),
      },
      taskOptions,
    );
  }

  /**
   * Places `blocks`, each at `origin` plus its offset. At most 8192 blocks.
   */
  public build(
    origin: MessageInitShape<typeof BlockPositionSchema>,
    blocks: readonly SchematicBlock[],
    options: BuildTaskOptions = {},
  ): Promise<SoulFireTask<typeof BuildTaskResultSchema>> {
    const { input, taskOptions } = buildInput(origin, blocks, options);
    return this.start(
      BuildTaskSchema,
      input,
      BuildTaskResultSchema,
      taskOptions,
    );
  }

  public runBuild(
    origin: MessageInitShape<typeof BlockPositionSchema>,
    blocks: readonly SchematicBlock[],
    options: BuildTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const { input, taskOptions } = buildInput(origin, blocks, options);
    return this.run(BuildTaskSchema, input, taskOptions);
  }

  /**
   * `recipeId` comes from `recipes.list`, e.g. "display:42". `count` is recipe
   * operations, not output items; it defaults to 1, at most 4096.
   */
  public craft(
    recipeId: string,
    count = 1,
    options: CraftTaskOptions = {},
  ): Promise<SoulFireTask<typeof CraftTaskResultSchema>> {
    const {
      station,
      ...taskOptions
    } = options;
    return this.start(
      CraftTaskSchema,
      {
        recipeId,
        count,
        ...(station === undefined ? {} : { station }),
      },
      CraftTaskResultSchema,
      taskOptions,
    );
  }

  /**
   * `recipeId` comes from `recipes.list`, e.g. "display:42". `count` is recipe
   * operations, not output items; it defaults to 1, at most 4096.
   */
  public runCraft(
    recipeId: string,
    count = 1,
    options: CraftTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      station,
      ...taskOptions
    } = options;
    return this.run(
      CraftTaskSchema,
      {
        recipeId,
        count,
        ...(station === undefined ? {} : { station }),
      },
      taskOptions,
    );
  }

  /**
   * `input` selects items that fit a known cooking recipe. `count` is input
   * items to cook; it defaults to 1, at most 4096.
   */
  public smelt(
    input: MessageInitShape<typeof ItemSelectorSchema>,
    count = 1,
    options: SmeltTaskOptions = {},
  ): Promise<SoulFireTask<typeof SmeltTaskResultSchema>> {
    const {
      fuel,
      station,
      ...taskOptions
    } = options;
    return this.start(
      SmeltTaskSchema,
      {
        input,
        count,
        ...(fuel === undefined ? {} : { fuel }),
        ...(station === undefined ? {} : { station }),
      },
      SmeltTaskResultSchema,
      taskOptions,
    );
  }

  /**
   * `count` is input items to cook; it defaults to 1, at most 4096.
   */
  public runSmelt(
    input: MessageInitShape<typeof ItemSelectorSchema>,
    count = 1,
    options: SmeltTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      fuel,
      station,
      ...taskOptions
    } = options;
    return this.run(
      SmeltTaskSchema,
      {
        input,
        count,
        ...(fuel === undefined ? {} : { fuel }),
        ...(station === undefined ? {} : { station }),
      },
      taskOptions,
    );
  }

  /**
   * Brews `count` potion bottles matching `input`, using one `ingredient` per
   * bottle. `count` defaults to 1, at most 4096.
   */
  public brew(
    input: MessageInitShape<typeof ItemSelectorSchema>,
    ingredient: MessageInitShape<typeof ItemSelectorSchema>,
    count = 1,
    options: BrewTaskOptions = {},
  ): Promise<SoulFireTask<typeof BrewTaskResultSchema>> {
    const {
      fuel,
      station,
      expectedResult,
      ...taskOptions
    } = options;
    return this.start(
      BrewTaskSchema,
      {
        input,
        ingredient,
        count,
        ...(fuel === undefined ? {} : { fuel }),
        ...(station === undefined ? {} : { station }),
        ...(expectedResult === undefined ? {} : { expectedResult }),
      },
      BrewTaskResultSchema,
      taskOptions,
    );
  }

  /**
   * `count` is bottles to brew; it defaults to 1, at most 4096.
   */
  public runBrew(
    input: MessageInitShape<typeof ItemSelectorSchema>,
    ingredient: MessageInitShape<typeof ItemSelectorSchema>,
    count = 1,
    options: BrewTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      fuel,
      station,
      expectedResult,
      ...taskOptions
    } = options;
    return this.run(
      BrewTaskSchema,
      {
        input,
        ingredient,
        count,
        ...(fuel === undefined ? {} : { fuel }),
        ...(station === undefined ? {} : { station }),
        ...(expectedResult === undefined ? {} : { expectedResult }),
      },
      taskOptions,
    );
  }

  /**
   * Trades with the merchant menu the bot has open. `offerIndex` is the
   * zero-based index from `recipes.listVillagerTrades`. `count` defaults to 1,
   * at most 4096.
   */
  public villagerTrade(
    offerIndex: number,
    count = 1,
    options: VillagerTradeTaskOptions = {},
  ): Promise<SoulFireTask<typeof VillagerTradeTaskResultSchema>> {
    const {
      closeWhenDone = false,
      expectedResult,
      ...taskOptions
    } = options;
    return this.start(
      VillagerTradeTaskSchema,
      {
        offerIndex,
        count,
        closeWhenDone,
        ...(expectedResult === undefined ? {} : { expectedResult }),
      },
      VillagerTradeTaskResultSchema,
      taskOptions,
    );
  }

  /**
   * `count` is trades to make; it defaults to 1, at most 4096.
   */
  public runVillagerTrade(
    offerIndex: number,
    count = 1,
    options: VillagerTradeTaskOptions = {},
  ): AsyncIterable<BotTaskEvent> {
    const {
      closeWhenDone = false,
      expectedResult,
      ...taskOptions
    } = options;
    return this.run(
      VillagerTradeTaskSchema,
      {
        offerIndex,
        count,
        closeWhenDone,
        ...(expectedResult === undefined ? {} : { expectedResult }),
      },
      taskOptions,
    );
  }

  /**
   * One of this bot's tasks, by id.
   */
  public async get<Result extends DescMessage | undefined = undefined>(
    taskId: string,
    resultSchema?: Result,
    options?: CallOptions,
  ): Promise<SoulFireTask<Result>> {
    const task = await this.client.getBotTask({ taskId }, options);
    if (task.instanceId !== this.instanceId || task.botId !== this.botId) {
      throw new Error(
        `Task ${taskId} does not belong to bot ${this.botId}`,
      );
    }
    return new SoulFireTask(
      this.client,
      task,
      resultSchema as Result,
      this.callOptions,
    );
  }

  /**
   * This bot's tasks, all pages. Ended tasks only with `includeTerminal`.
   */
  public async list(options: TaskListOptions = {}): Promise<BotTask[]> {
    const { call, ...request } = options;
    const tasks: BotTask[] = [];
    let pageToken = request.pageToken ?? "";
    do {
      const response = await this.client.listBotTasks(
        {
          ...request,
          instanceId: this.instanceId,
          botId: this.botId,
          pageToken,
        },
        call,
      );
      tasks.push(...response.tasks);
      pageToken = response.nextPageToken;
    } while (pageToken.length > 0);
    return tasks;
  }

  /**
   * Events of this bot's tasks, starting with a snapshot of them unless
   * `includeSnapshot` is false.
   */
  public watch(options?: {
    afterSequence?: bigint;
    includeSnapshot?: boolean;
    statuses?: readonly BotTaskStatus[];
    call?: CallOptions;
  }): AsyncIterable<BotTaskEvent> {
    return this.client.watchBotTasks(
      {
        instanceId: this.instanceId,
        botId: this.botId,
        ...(options?.afterSequence === undefined
          ? {}
          : { afterSequence: options.afterSequence }),
        includeSnapshot: options?.includeSnapshot ?? true,
        statuses: options?.statuses === undefined
          ? []
          : [...options.statuses],
      },
      options?.call,
    );
  }
}

function entityReference(target: AttackEntityTarget) {
  return typeof target === "number"
    ? { networkId: target }
    : {
        networkId: target.networkId,
        ...(target.connectionEpoch === undefined
            || target.connectionEpoch.length === 0
          ? {}
          : { connectionEpoch: target.connectionEpoch }),
        ...(target.uuid === undefined || target.uuid.length === 0
          ? {}
          : { uuid: target.uuid }),
      };
}

function guardTaskInput(
  subject: GuardSubject,
  threats: MessageInitShape<typeof EntitySelectorSchema>,
  completeWhenClearDefault: boolean,
  options: GuardTaskOptions,
): {
  input: MessageInitShape<typeof GuardTaskSchema>;
  taskOptions: TaskStartOptions;
} {
  const {
    guardRadius = 16,
    maximumPursuitDistance = 24,
    returnRadius = 3,
    path,
    attackRange = 3,
    sprinting = false,
    maximumAttacks = 0,
    maximumTargets = 0,
    completeWhenClear = completeWhenClearDefault,
    clearSeconds = 3,
    selectBestWeapon = true,
    weapon,
    restoreSelectedSlot = true,
    ...taskOptions
  } = options;
  return {
    input: {
      subject,
      threats,
      guardRadius,
      maximumPursuitDistance,
      returnRadius,
      ...(path === undefined ? {} : { options: path }),
      attackRange,
      sprinting,
      maximumAttacks,
      maximumTargets,
      completeWhenClear,
      clearSeconds,
      selectBestWeapon,
      ...(weapon === undefined ? {} : { weapon }),
      restoreSelectedSlot,
    },
    taskOptions,
  };
}

function rangedAttackInput(
  target: AttackEntityTarget,
  options: RangedAttackTaskOptions,
): {
  input: MessageInitShape<typeof RangedAttackTaskSchema>;
  taskOptions: TaskStartOptions;
} {
  const {
    path,
    minimumRange = 8,
    maximumRange = 24,
    maximumShots = 0,
    targetUnavailableTimeoutSeconds = 10,
    weapon,
    bowDrawTicks = 20,
    leadTarget = true,
    compensateGravity = true,
    strafe = true,
    restoreSelectedSlot = true,
    ...taskOptions
  } = options;
  return {
    input: {
      target: entityReference(target),
      ...(path === undefined ? {} : { options: path }),
      minimumRange,
      maximumRange,
      maximumShots,
      targetUnavailableTimeoutSeconds,
      ...(weapon === undefined ? {} : { weapon }),
      bowDrawTicks,
      leadTarget,
      compensateGravity,
      strafe,
      restoreSelectedSlot,
    },
    taskOptions,
  };
}

function buildInput(
  origin: MessageInitShape<typeof BlockPositionSchema>,
  blocks: readonly SchematicBlock[],
  options: BuildTaskOptions,
): {
  input: MessageInitShape<typeof BuildTaskSchema>;
  taskOptions: TaskStartOptions;
} {
  if (blocks.length === 0) {
    throw new RangeError("blocks must contain at least one placement");
  }
  const {
    rotation = BuildRotation.NONE,
    mirror = BuildMirror.NONE,
    substitutions = {},
    path,
    breakIncorrectBlocks = true,
    restoreSelectedSlot = true,
    partitionIndex = 0,
    partitionCount = 1,
    ...taskOptions
  } = options;
  if (!Number.isInteger(partitionCount) || partitionCount <= 0) {
    throw new RangeError("partitionCount must be a positive integer");
  }
  if (
    !Number.isInteger(partitionIndex)
    || partitionIndex < 0
    || partitionIndex >= partitionCount
  ) {
    throw new RangeError(
      "partitionIndex must be a non-negative integer smaller than partitionCount",
    );
  }
  return {
    input: {
      origin,
      blocks: blocks.map((block) => ({
        offset: block.offset,
        blockId: block.blockId,
        properties: { ...block.properties },
      })),
      rotation,
      mirror,
      substitutions: Object.entries(substitutions).map(
        ([sourceBlockId, replacementBlockIds]) => ({
          sourceBlockId,
          replacementBlockIds: [...replacementBlockIds],
        }),
      ),
      ...(path === undefined ? {} : { options: path }),
      breakIncorrectBlocks,
      restoreSelectedSlot,
      partitionIndex,
      partitionCount,
    },
    taskOptions,
  };
}

function containerTransferInput(
  direction: ContainerTransferDirection,
  container: MessageInitShape<typeof BlockPositionSchema>,
  operations: readonly ContainerTransferSpec[],
  options: ContainerTransferTaskOptions,
): {
  input: MessageInitShape<typeof ContainerTransferTaskSchema>;
  taskOptions: TaskStartOptions;
} {
  const {
    path,
    closeContainer = true,
    ...taskOptions
  } = options;
  return {
    input: {
      container,
      direction,
      operations: operations.map((operation) => ({
        selector: operation.selector,
        count: operation.count,
        allowPartial: operation.allowPartial ?? false,
      })),
      ...(path === undefined ? {} : { options: path }),
      closeContainer,
    },
    taskOptions,
  };
}

function maintainLoadoutInput(
  container: MessageInitShape<typeof BlockPositionSchema>,
  requirements: readonly LoadoutRequirementSpec[],
  options: MaintainLoadoutTaskOptions,
): {
  input: MessageInitShape<typeof MaintainLoadoutTaskSchema>;
  taskOptions: TaskStartOptions;
} {
  if (requirements.length === 0) {
    throw new RangeError("requirements must contain at least one entry");
  }
  for (const requirement of requirements) {
    if (
      requirement.minimumCount < 0
      || requirement.targetCount < requirement.minimumCount
      || requirement.maximumCount !== undefined
      && requirement.maximumCount > 0
      && requirement.maximumCount < requirement.targetCount
    ) {
      throw new RangeError(
        "Each requirement needs minimumCount <= targetCount <= maximumCount when maximumCount is set",
      );
    }
  }
  const {
    path,
    checkIntervalTicks = 100,
    maximumRebalances = 0,
    completeWhenSatisfied = false,
    closeContainer = true,
    ...taskOptions
  } = options;
  return {
    input: {
      container,
      requirements: requirements.map((requirement) => ({
        selector: requirement.selector,
        minimumCount: requirement.minimumCount,
        targetCount: requirement.targetCount,
        maximumCount: requirement.maximumCount ?? 0,
      })),
      ...(path === undefined ? {} : { options: path }),
      checkIntervalTicks,
      maximumRebalances,
      completeWhenSatisfied,
      closeContainer,
    },
    taskOptions,
  };
}

export function isTerminalTaskStatus(status: BotTaskStatus): boolean {
  return status === BotTaskStatus.COMPLETED
    || status === BotTaskStatus.CANCELLED
    || status === BotTaskStatus.FAILED
    || status === BotTaskStatus.TIMED_OUT;
}

export {
  BotTaskConflictPolicy,
  BotTaskDisconnectPolicy,
  BotTaskPriority,
  BotTaskReconnectPolicy,
  BotTaskStatus,
  BuildMirror,
  BuildRotation,
};
export type {
  BotTask,
  BotTaskEvent,
  GoToTaskResult,
};
