import { create, type MessageInitShape } from "@bufbuild/protobuf";
import type { CallOptions } from "@connectrpc/connect";

import {
  BotLiveStateSchema,
  type BotInventoryStateResponse,
  type BotLiveState,
  type BotStatus,
} from "./generated/soulfire/bot_pb.js";
import {
  BossBarEventKind,
  BotEventFilterSchema,
  EntityEventKind,
  PlayerListEntrySnapshotSchema,
  PlayerListEventKind,
  ResourcePackEventKind,
  ScoreboardEventKind,
  WeatherEventKind,
  type BlockState,
  type BotBossBarEvent,
  type BotEnvironmentEvent,
  type BotEvent,
  type BotGameEvent,
  type BotResourcePackEvent,
  type BotScoreboardEvent,
  type ClockSnapshot,
  type NearbyEntity,
  type PlayerListEntrySnapshot,
  type WatchBotEventsRequestSchema,
} from "./generated/soulfire/bot_live_pb.js";
import type {
  BlockSnapshot,
  EntitySnapshot,
  TextComponent,
} from "./generated/soulfire/domain_pb.js";

const DEFAULT_RECONNECT_DELAY_MS = 250;
const MAX_RECONNECT_DELAY_MS = 5_000;
const SUBSCRIBER_BUFFER_SIZE = 1_024;

export interface BotSessionState {
  /**
   * Like `blocks`, for updates that carried a full snapshot.
   */
  readonly blockSnapshots: ReadonlyMap<string, BlockSnapshot>;
  /**
   * Blocks seen changing since the session opened (block update events), keyed
   * `dimension:x:y:z`.
   */
  readonly blocks: ReadonlyMap<string, BlockState>;
  readonly bossBars: ReadonlyMap<string, BotBossBarState>;
  /**
   * Entities from entity events, by entity id; removed when they despawn.
   */
  readonly entities: ReadonlyMap<number, NearbyEntity>;
  readonly entitySnapshots: ReadonlyMap<number, EntitySnapshot>;
  readonly environment: BotEnvironmentState;
  readonly epoch?: string;
  readonly inventory?: BotInventoryStateResponse;
  readonly player?: BotLiveState;
  readonly playerList: ReadonlyMap<string, PlayerListEntrySnapshot>;
  readonly resourcePacks: ReadonlyMap<string, BotResourcePackEvent>;
  readonly scoreboard: BotScoreboardState;
  readonly sequence: bigint;
  readonly snapshotRevision: bigint;
  readonly status?: BotStatus;
}

export interface BotEnvironmentState {
  readonly clocks: ReadonlyMap<string, ClockSnapshot>;
  readonly gameTime?: bigint;
  readonly lastGameEvent?: BotGameEvent;
  readonly rainLevel?: number;
  readonly raining?: boolean;
  readonly thunderLevel?: number;
}

export interface BotBossBarState {
  readonly bossBarId: string;
  readonly color?: string;
  readonly createWorldFog?: boolean;
  readonly darkenScreen?: boolean;
  readonly name?: TextComponent;
  readonly overlay?: string;
  readonly playMusic?: boolean;
  readonly progress?: number;
}

export interface BotScoreboardObjective {
  readonly displayName?: TextComponent;
  readonly name: string;
  readonly renderType?: string;
}

export interface BotScoreboardScore {
  readonly displayName?: TextComponent;
  readonly objectiveName: string;
  readonly owner: string;
  readonly score: number;
}

export interface BotScoreboardTeam {
  readonly allowFriendlyFire?: boolean;
  readonly collisionRule?: string;
  readonly color?: string;
  readonly displayName?: TextComponent;
  readonly name: string;
  readonly nameTagVisibility?: string;
  readonly players: ReadonlySet<string>;
  readonly prefix?: TextComponent;
  readonly seeFriendlyInvisibles?: boolean;
  readonly suffix?: TextComponent;
}

export interface BotScoreboardState {
  readonly displaySlots: ReadonlyMap<string, string>;
  readonly objectives: ReadonlyMap<string, BotScoreboardObjective>;
  readonly scores: ReadonlyMap<string, BotScoreboardScore>;
  readonly teams: ReadonlyMap<string, BotScoreboardTeam>;
}

export interface BotSessionOptions {
  /**
   * Defaults to every category except sounds, particles and chunks.
   */
  readonly filter?: MessageInitShape<typeof BotEventFilterSchema>;
  /**
   * Defaults to 15, from 5 to 60.
   */
  readonly heartbeatIntervalSeconds?: number;
  /**
   * Closes the session when aborted.
   */
  readonly signal?: AbortSignal;
}

type StreamRequest = Omit<
  MessageInitShape<typeof WatchBotEventsRequestSchema>,
  "$typeName" | "botId" | "instanceId"
>;

export type BotEventStreamFactory = (
  request: StreamRequest,
  options: CallOptions,
) => AsyncIterable<BotEvent>;

/**
 * A bot's event stream and the state it adds up to. After an error it
 * reconnects and resumes where it left off. `await using` closes it.
 */
export class BotSession implements AsyncDisposable {
  readonly #abortController = new AbortController();
  readonly #events = new Set<AsyncQueue<BotEvent>>();
  readonly #stream: BotEventStreamFactory;
  readonly #options: BotSessionOptions;
  #closed = false;
  #ready: Promise<void>;
  #resolveReady: (() => void) | undefined;
  #rejectReady: ((reason: unknown) => void) | undefined;
  #run: Promise<void>;
  #state: BotSessionState = emptyBotSessionState();

  private constructor(
    stream: BotEventStreamFactory,
    options: BotSessionOptions,
  ) {
    this.#stream = stream;
    this.#options = options;
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    this.#run = this.#consume();
    options.signal?.addEventListener("abort", () => this.close(), {
      once: true,
    });
  }

  /**
   * Resolves once the first event has arrived.
   */
  public static async open(
    stream: BotEventStreamFactory,
    options: BotSessionOptions = {},
  ): Promise<BotSession> {
    const session = new BotSession(stream, options);
    await session.#ready;
    return session;
  }

  /**
   * Updated before each event is handed to readers.
   */
  public get state(): BotSessionState {
    return this.#state;
  }

  /**
   * Events from now on. A reader more than 1024 events behind loses the oldest.
   */
  public events(): AsyncIterable<BotEvent> {
    const queue = new AsyncQueue<BotEvent>(SUBSCRIBER_BUFFER_SIZE);
    this.#events.add(queue);
    const events = this.#events;
    return {
      async *[Symbol.asyncIterator]() {
        try {
          yield* queue;
        } finally {
          events.delete(queue);
          queue.close();
        }
      },
    };
  }

  /**
   * The next event for which `predicate` is true; it gets the state including
   * that event. No timeout unless `timeoutMs` is set.
   */
  public async waitFor(
    predicate: (event: BotEvent, state: BotSessionState) => boolean,
    options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
  ): Promise<BotEvent> {
    const abortController = new AbortController();
    const onAbort = () => abortController.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = options.timeoutMs === undefined
      ? undefined
      : setTimeout(
        () => abortController.abort(new Error("Timed out waiting for a bot event")),
        options.timeoutMs,
      );
    try {
      for await (const event of abortable(this.events(), abortController.signal)) {
        if (predicate(event, this.#state)) {
          return event;
        }
      }
      throw abortController.signal.reason
        ?? new Error("Bot session closed before the expected event");
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * The next event of one kind, e.g. `"chat"` or `"damage"`.
   */
  public once(
    eventCase: BotEvent["event"]["case"],
    options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
  ): Promise<BotEvent> {
    return this.waitFor(
      (event) => event.event.case === eventCase,
      options,
    );
  }

  public async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#abortController.abort();
    await this.#run;
    for (const queue of this.#events) {
      queue.close();
    }
    this.#events.clear();
  }

  public [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  async #consume(): Promise<void> {
    let reconnectDelay = DEFAULT_RECONNECT_DELAY_MS;
    while (!this.#closed) {
      try {
        const cursor = this.#state.epoch === undefined
          ? {}
          : {
            afterSequence: this.#state.sequence,
            streamEpoch: this.#state.epoch,
          };
        const request: StreamRequest = {
          ...cursor,
          filter: this.#options.filter ?? defaultFilter(),
          heartbeatIntervalSeconds:
            this.#options.heartbeatIntervalSeconds ?? 15,
        };
        for await (
          const event of this.#stream(request, {
            signal: this.#abortController.signal,
          })
        ) {
          this.#state = reduceBotSessionState(this.#state, event);
          this.#resolveReady?.();
          this.#resolveReady = undefined;
          this.#rejectReady = undefined;
          for (const queue of this.#events) {
            queue.push(event);
          }
          reconnectDelay = DEFAULT_RECONNECT_DELAY_MS;
        }
        if (!this.#closed) {
          await sleep(reconnectDelay, this.#abortController.signal);
        }
      } catch (error) {
        if (this.#closed || this.#abortController.signal.aborted) {
          break;
        }
        if (this.#resolveReady !== undefined) {
          this.#rejectReady?.(error);
          this.#resolveReady = undefined;
          this.#rejectReady = undefined;
          break;
        }
        await sleep(reconnectDelay, this.#abortController.signal);
        reconnectDelay = Math.min(
          reconnectDelay * 2,
          MAX_RECONNECT_DELAY_MS,
        );
      }
    }
  }

}

export function emptyBotSessionState(): BotSessionState {
  return {
    blockSnapshots: new Map(),
    blocks: new Map(),
    bossBars: new Map(),
    entities: new Map(),
    entitySnapshots: new Map(),
    environment: {
      clocks: new Map(),
    },
    playerList: new Map(),
    resourcePacks: new Map(),
    scoreboard: {
      displaySlots: new Map(),
      objectives: new Map(),
      scores: new Map(),
      teams: new Map(),
    },
    sequence: 0n,
    snapshotRevision: 0n,
  };
}

export function reduceBotSessionState(
  state: BotSessionState,
  event: BotEvent,
): BotSessionState {
  const envelope = event.envelope;
  const discontinuity =
    envelope !== undefined
    && state.epoch !== undefined
    && (
      envelope.streamEpoch !== state.epoch
      || envelope.sequence !== state.sequence + 1n
    );
  const current = discontinuity || event.event.case === "resyncRequired"
    ? {
      ...emptyBotSessionState(),
      ...(state.status === undefined ? {} : { status: state.status }),
    }
    : state;
  let player = current.player;
  let inventory = current.inventory;
  let status = current.status;
  let environment = current.environment;
  let scoreboard = current.scoreboard;
  const entities = new Map(current.entities);
  const entitySnapshots = new Map(current.entitySnapshots);
  const blocks = new Map(current.blocks);
  const blockSnapshots = new Map(current.blockSnapshots);
  const bossBars = new Map(current.bossBars);
  const playerList = new Map(current.playerList);
  const resourcePacks = new Map(current.resourcePacks);

  switch (event.event.case) {
    case "snapshot":
      player = event.event.value;
      break;
    case "stateDelta":
      if (player !== undefined) {
        player = mergePlayerState(player, event.event.value);
      }
      break;
    case "status":
      status = event.event.value;
      break;
    case "inventory":
      inventory = event.event.value.state;
      break;
    case "entityEvent": {
      const entity = event.event.value.entity;
      if (entity !== undefined) {
        if (
          event.event.value.kind
          === EntityEventKind.ENTITY_EVENT_DESPAWN
        ) {
          entities.delete(entity.entityId);
          entitySnapshots.delete(entity.entityId);
        } else {
          entities.set(entity.entityId, entity);
          const snapshot = event.event.value.snapshot;
          if (snapshot !== undefined) {
            entitySnapshots.set(entity.entityId, snapshot);
          }
        }
      }
      break;
    }
    case "blockUpdate": {
      const update = event.event.value;
      if (update.position !== undefined) {
        const key = blockKey(update.position);
        blocks.set(key, {
          $typeName: "soulfire.v1.BlockState",
          position: update.position,
          blockId: update.newBlockId,
          properties: update.block?.properties ?? {},
        });
        if (update.block !== undefined) {
          blockSnapshots.set(key, update.block);
        }
      }
      break;
    }
    case "environment":
      environment = reduceEnvironmentState(
        environment,
        event.event.value,
      );
      break;
    case "playerList":
      reducePlayerListState(playerList, event.event.value);
      break;
    case "bossBar":
      reduceBossBarState(bossBars, event.event.value);
      break;
    case "scoreboard":
      scoreboard = reduceScoreboardState(scoreboard, event.event.value);
      break;
    case "resourcePack":
      reduceResourcePackState(resourcePacks, event.event.value);
      break;
    default:
      break;
  }

  return {
    blockSnapshots,
    blocks,
    bossBars,
    entities,
    entitySnapshots,
    environment,
    playerList,
    resourcePacks,
    scoreboard,
    sequence: event.envelope?.sequence ?? current.sequence,
    snapshotRevision:
      event.envelope?.snapshotRevision ?? current.snapshotRevision,
    ...(event.envelope === undefined
      ? {}
      : {
        epoch: event.envelope.streamEpoch,
      }),
    ...(inventory === undefined ? {} : { inventory }),
    ...(player === undefined ? {} : { player }),
    ...(status === undefined ? {} : { status }),
  };
}

function reduceResourcePackState(
  resourcePacks: Map<string, BotResourcePackEvent>,
  event: BotResourcePackEvent,
): void {
  switch (event.kind) {
    case ResourcePackEventKind.RESOURCE_PACK_EVENT_OFFERED:
      if (event.packId !== undefined) {
        resourcePacks.set(event.packId, event);
      }
      break;
    case ResourcePackEventKind.RESOURCE_PACK_EVENT_REMOVED:
      if (event.packId !== undefined) {
        resourcePacks.delete(event.packId);
      }
      break;
    case ResourcePackEventKind.RESOURCE_PACK_EVENT_CLEARED:
      resourcePacks.clear();
      break;
    default:
      break;
  }
}

function reduceEnvironmentState(
  state: BotEnvironmentState,
  event: BotEnvironmentEvent,
): BotEnvironmentState {
  switch (event.change.case) {
    case "time": {
      const clocks = new Map(state.clocks);
      for (const clock of event.change.value.clocks) {
        clocks.set(clock.clockId, clock);
      }
      return {
        ...state,
        clocks,
        gameTime: event.change.value.gameTime,
      };
    }
    case "weather":
      switch (event.change.value.kind) {
        case WeatherEventKind.WEATHER_EVENT_STARTED_RAINING:
          return { ...state, raining: true };
        case WeatherEventKind.WEATHER_EVENT_STOPPED_RAINING:
          return { ...state, raining: false };
        case WeatherEventKind.WEATHER_EVENT_RAIN_LEVEL_CHANGED:
          return event.change.value.level === undefined
            ? state
            : { ...state, rainLevel: event.change.value.level };
        case WeatherEventKind.WEATHER_EVENT_THUNDER_LEVEL_CHANGED:
          return event.change.value.level === undefined
            ? state
            : { ...state, thunderLevel: event.change.value.level };
        default:
          return state;
      }
    case "gameEvent":
      return { ...state, lastGameEvent: event.change.value };
    default:
      return state;
  }
}

function reducePlayerListState(
  state: Map<string, PlayerListEntrySnapshot>,
  event: Extract<BotEvent["event"], { case: "playerList" }>["value"],
): void {
  if (event.kind === PlayerListEventKind.PLAYER_LIST_EVENT_REMOVE) {
    for (const profileId of event.removedProfileIds) {
      state.delete(profileId);
    }
    return;
  }
  for (const entry of event.entries) {
    const previous = state.get(entry.profileId);
    const changed = new Set(entry.changedFields);
    if (previous === undefined || changed.has("add_player")) {
      state.set(entry.profileId, entry);
      continue;
    }
    state.set(entry.profileId, create(PlayerListEntrySnapshotSchema, {
      ...previous,
      changedFields: entry.changedFields,
      ...(changed.has("update_display_name")
        ? { displayName: entry.displayName }
        : {}),
      ...(changed.has("update_game_mode")
        ? { gameMode: entry.gameMode }
        : {}),
      ...(changed.has("update_hat")
        ? { showHat: entry.showHat }
        : {}),
      ...(changed.has("update_latency")
        ? { latencyMs: entry.latencyMs }
        : {}),
      ...(changed.has("update_list_order")
        ? { listOrder: entry.listOrder }
        : {}),
      ...(changed.has("update_listed")
        ? { listed: entry.listed }
        : {}),
    }));
  }
}

function reduceBossBarState(
  state: Map<string, BotBossBarState>,
  event: BotBossBarEvent,
): void {
  if (event.kind === BossBarEventKind.BOSS_BAR_EVENT_REMOVE) {
    state.delete(event.bossBarId);
    return;
  }
  const previous = state.get(event.bossBarId) ?? {
    bossBarId: event.bossBarId,
  };
  state.set(event.bossBarId, {
    ...previous,
    ...(event.color === undefined ? {} : { color: event.color }),
    ...(event.createWorldFog === undefined
      ? {}
      : { createWorldFog: event.createWorldFog }),
    ...(event.darkenScreen === undefined
      ? {}
      : { darkenScreen: event.darkenScreen }),
    ...(event.name === undefined ? {} : { name: event.name }),
    ...(event.overlay === undefined ? {} : { overlay: event.overlay }),
    ...(event.playMusic === undefined
      ? {}
      : { playMusic: event.playMusic }),
    ...(event.progress === undefined ? {} : { progress: event.progress }),
  });
}

function reduceScoreboardState(
  state: BotScoreboardState,
  event: BotScoreboardEvent,
): BotScoreboardState {
  const displaySlots = new Map(state.displaySlots);
  const objectives = new Map(state.objectives);
  const scores = new Map(state.scores);
  const teams = new Map(state.teams);
  const objectiveName = event.objectiveName;
  switch (event.kind) {
    case ScoreboardEventKind.SCOREBOARD_EVENT_OBJECTIVE_ADD:
    case ScoreboardEventKind.SCOREBOARD_EVENT_OBJECTIVE_UPDATE:
      if (objectiveName !== undefined) {
        const previous = objectives.get(objectiveName);
        objectives.set(objectiveName, {
          name: objectiveName,
          ...(previous?.displayName === undefined
            ? {}
            : { displayName: previous.displayName }),
          ...(previous?.renderType === undefined
            ? {}
            : { renderType: previous.renderType }),
          ...(event.displayName === undefined
            ? {}
            : { displayName: event.displayName }),
          ...(event.renderType === undefined
            ? {}
            : { renderType: event.renderType }),
        });
      }
      break;
    case ScoreboardEventKind.SCOREBOARD_EVENT_OBJECTIVE_REMOVE:
      if (objectiveName !== undefined) {
        objectives.delete(objectiveName);
        for (const [slot, displayedObjective] of displaySlots) {
          if (displayedObjective === objectiveName) {
            displaySlots.delete(slot);
          }
        }
        for (const [key, score] of scores) {
          if (score.objectiveName === objectiveName) {
            scores.delete(key);
          }
        }
      }
      break;
    case ScoreboardEventKind.SCOREBOARD_EVENT_DISPLAY_OBJECTIVE:
      if (event.displaySlot !== undefined) {
        if (objectiveName === undefined || objectiveName.length === 0) {
          displaySlots.delete(event.displaySlot);
        } else {
          displaySlots.set(event.displaySlot, objectiveName);
        }
      }
      break;
    case ScoreboardEventKind.SCOREBOARD_EVENT_SCORE_SET:
      if (
        objectiveName !== undefined
        && event.owner !== undefined
        && event.score !== undefined
      ) {
        scores.set(scoreboardScoreKey(objectiveName, event.owner), {
          objectiveName,
          owner: event.owner,
          score: event.score,
          ...(event.displayName === undefined
            ? {}
            : { displayName: event.displayName }),
        });
      }
      break;
    case ScoreboardEventKind.SCOREBOARD_EVENT_SCORE_RESET:
      if (event.owner !== undefined) {
        if (objectiveName !== undefined) {
          scores.delete(scoreboardScoreKey(objectiveName, event.owner));
        } else {
          for (const [key, score] of scores) {
            if (score.owner === event.owner) {
              scores.delete(key);
            }
          }
        }
      }
      break;
    case ScoreboardEventKind.SCOREBOARD_EVENT_TEAM_REMOVE:
      if (event.teamName !== undefined) {
        teams.delete(event.teamName);
      }
      break;
    case ScoreboardEventKind.SCOREBOARD_EVENT_TEAM_ADD:
    case ScoreboardEventKind.SCOREBOARD_EVENT_TEAM_UPDATE:
    case ScoreboardEventKind.SCOREBOARD_EVENT_TEAM_PLAYERS_ADD:
    case ScoreboardEventKind.SCOREBOARD_EVENT_TEAM_PLAYERS_REMOVE:
      reduceScoreboardTeam(teams, event);
      break;
    default:
      break;
  }
  return { displaySlots, objectives, scores, teams };
}

function reduceScoreboardTeam(
  teams: Map<string, BotScoreboardTeam>,
  event: BotScoreboardEvent,
): void {
  if (event.teamName === undefined) {
    return;
  }
  const previous = teams.get(event.teamName);
  const players = new Set(previous?.players ?? []);
  if (
    event.kind === ScoreboardEventKind.SCOREBOARD_EVENT_TEAM_ADD
    || event.kind === ScoreboardEventKind.SCOREBOARD_EVENT_TEAM_UPDATE
  ) {
    players.clear();
    event.players.forEach((player) => players.add(player));
  } else if (
    event.kind === ScoreboardEventKind.SCOREBOARD_EVENT_TEAM_PLAYERS_ADD
  ) {
    event.players.forEach((player) => players.add(player));
  } else {
    event.players.forEach((player) => players.delete(player));
  }
  teams.set(event.teamName, {
    name: event.teamName,
    players,
    ...(previous?.allowFriendlyFire === undefined
      ? {}
      : { allowFriendlyFire: previous.allowFriendlyFire }),
    ...(previous?.collisionRule === undefined
      ? {}
      : { collisionRule: previous.collisionRule }),
    ...(previous?.color === undefined ? {} : { color: previous.color }),
    ...(previous?.displayName === undefined
      ? {}
      : { displayName: previous.displayName }),
    ...(previous?.nameTagVisibility === undefined
      ? {}
      : { nameTagVisibility: previous.nameTagVisibility }),
    ...(previous?.prefix === undefined ? {} : { prefix: previous.prefix }),
    ...(previous?.seeFriendlyInvisibles === undefined
      ? {}
      : { seeFriendlyInvisibles: previous.seeFriendlyInvisibles }),
    ...(previous?.suffix === undefined ? {} : { suffix: previous.suffix }),
    ...(event.allowFriendlyFire === undefined
      ? {}
      : { allowFriendlyFire: event.allowFriendlyFire }),
    ...(event.collisionRule === undefined
      ? {}
      : { collisionRule: event.collisionRule }),
    ...(event.color === undefined ? {} : { color: event.color }),
    ...(event.displayName === undefined
      ? {}
      : { displayName: event.displayName }),
    ...(event.nameTagVisibility === undefined
      ? {}
      : { nameTagVisibility: event.nameTagVisibility }),
    ...(event.prefix === undefined ? {} : { prefix: event.prefix }),
    ...(event.seeFriendlyInvisibles === undefined
      ? {}
      : { seeFriendlyInvisibles: event.seeFriendlyInvisibles }),
    ...(event.suffix === undefined ? {} : { suffix: event.suffix }),
  });
}

function scoreboardScoreKey(objectiveName: string, owner: string): string {
  return `${objectiveName}\u0000${owner}`;
}

function defaultFilter(): MessageInitShape<typeof BotEventFilterSchema> {
  return {
    includeBlockUpdates: true,
    includeBossBars: true,
    includeChat: true,
    includeDamage: true,
    includeEntityEvents: true,
    includeEnvironment: true,
    includeInventory: true,
    includeLifecycle: true,
    includePlayerList: true,
    includeResourcePacks: true,
    includeScoreboard: true,
    includeStateDeltas: true,
    includeTitles: true,
  };
}

function mergePlayerState(
  player: BotLiveState,
  delta: Extract<BotEvent["event"], { case: "stateDelta" }>["value"],
): BotLiveState {
  return create(BotLiveStateSchema, {
    ...player,
    ...(delta.x === undefined ? {} : { x: delta.x }),
    ...(delta.y === undefined ? {} : { y: delta.y }),
    ...(delta.z === undefined ? {} : { z: delta.z }),
    ...(delta.xRot === undefined ? {} : { xRot: delta.xRot }),
    ...(delta.yRot === undefined ? {} : { yRot: delta.yRot }),
    ...(delta.health === undefined ? {} : { health: delta.health }),
    ...(delta.maxHealth === undefined ? {} : { maxHealth: delta.maxHealth }),
    ...(delta.foodLevel === undefined ? {} : { foodLevel: delta.foodLevel }),
    ...(delta.saturationLevel === undefined
      ? {}
      : { saturationLevel: delta.saturationLevel }),
    ...(delta.selectedHotbarSlot === undefined
      ? {}
      : { selectedHotbarSlot: delta.selectedHotbarSlot }),
    ...(delta.dimension === undefined ? {} : { dimension: delta.dimension }),
    ...(delta.experienceLevel === undefined
      ? {}
      : { experienceLevel: delta.experienceLevel }),
    ...(delta.experienceProgress === undefined
      ? {}
      : { experienceProgress: delta.experienceProgress }),
    ...(delta.gameMode === undefined ? {} : { gameMode: delta.gameMode }),
  });
}

function blockKey(position: {
  readonly dimension: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}): string {
  return `${position.dimension}:${position.x}:${position.y}:${position.z}`;
}

async function* abortable<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal,
): AsyncIterable<T> {
  const iterator = source[Symbol.asyncIterator]();
  try {
    while (!signal.aborted) {
      const result = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          );
        }),
      ]);
      if (result.done) {
        return;
      }
      yield result.value;
    }
  } finally {
    await iterator.return?.();
  }
}

async function sleep(durationMs: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, durationMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

class AsyncQueue<T> implements AsyncIterable<T> {
  readonly #limit: number;
  readonly #values: T[] = [];
  readonly #waiting: Array<(result: IteratorResult<T>) => void> = [];
  #closed = false;

  public constructor(limit: number) {
    this.#limit = limit;
  }

  public push(value: T): void {
    if (this.#closed) {
      return;
    }
    const waiting = this.#waiting.shift();
    if (waiting !== undefined) {
      waiting({ done: false, value });
      return;
    }
    if (this.#values.length === this.#limit) {
      this.#values.shift();
    }
    this.#values.push(value);
  }

  public close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    for (const waiting of this.#waiting.splice(0)) {
      waiting({ done: true, value: undefined });
    }
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const result = await this.#next();
      if (result.done) {
        return;
      }
      yield result.value;
    }
  }

  #next(): Promise<IteratorResult<T>> {
    const value = this.#values.shift();
    if (value !== undefined) {
      return Promise.resolve({ done: false, value });
    }
    if (this.#closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve) => this.#waiting.push(resolve));
  }
}
