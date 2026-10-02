import type {
  DescMessage,
  DescService,
  MessageInitShape,
} from "@bufbuild/protobuf";
import {
  createClient,
  type CallOptions,
  type Client,
  type Interceptor,
  type Transport,
} from "@connectrpc/connect";
import {
  createGrpcWebTransport,
  type GrpcWebTransportOptions,
} from "@connectrpc/connect-web";
import * as HttpClient from "@effect/platform/HttpClient";
import { Context, Effect, Layer, Option, Stream, type Scope } from "effect";
import {
  operationError,
  rpcError,
  SoulFireConnectionError,
  type SoulFireOperationError,
} from "./errors.js";
import { makeEffectHttpClientFetch } from "./platform.js";
import { rpc, rpcStream, withSignal } from "./transport.js";

import { requireCompletedAction } from "./actions.js";
import { SoulFireAdmin } from "./admin.js";
import { SoulFireCamera } from "./camera.js";
import { SoulFireChat } from "./chat.js";
import {
  connectionMetadata,
  SDK_API_VERSION,
  SDK_VERSION,
  type CapabilitySet,
  type ConnectionMetadata,
  type ServerMetadata,
} from "./connection.js";
import { SoulFireFleet } from "./fleet.js";
import {
  BotEventFilterSchema,
  BotLiveService,
  type AttackEntityRequestSchema,
  type BotActionResult,
  type BotControlLease,
  type BotEvent,
  type DigBlockRequestSchema,
  type DismountRequestSchema,
  type FindBlocksRequestSchema,
  type FindBlocksResponse,
  type GetBlockRequestSchema,
  type GetBlockResponse,
  type GoToRequestSchema,
  type InteractBlockRequestSchema,
  type InteractEntityRequestSchema,
  type ListNearbyEntitiesRequestSchema,
  type ListNearbyEntitiesResponse,
  type MountEntityRequestSchema,
  type MountEntityResponse,
  type PathfindProgress,
  type PlaceBlockRequestSchema,
  type ReleaseItemRequestSchema,
  type RespawnRequestSchema,
  type RespondResourcePackRequestSchema,
  type SetCreativeSlotRequestSchema,
  type SetFlyingRequestSchema,
  type SetVehicleControlRequestSchema,
  type SetVehicleControlResponse,
  type SleepRequestSchema,
  type SwingArmRequestSchema,
  type UpdateSignRequestSchema,
  type UseItemRequestSchema,
  type WaitForChunksRequestSchema,
  type WaitForChunksResponse,
  type WriteBookRequestSchema,
} from "./generated/soulfire/bot_live_pb.js";
import {
  BotDesiredState,
  BotService,
  ClickType,
  type BotGetDialogResponse,
  type BotInfoResponse,
  type BotInventoryStateResponse,
  type BotListEntry,
  type BotLiveState,
  type BotRenderPovResponse,
  type BotSetMovementStateRequestSchema,
  type BotStatus,
  type WatchBotStatusesResponse,
} from "./generated/soulfire/bot_pb.js";
import { ChatService } from "./generated/soulfire/chat_pb.js";
import type {
  MinecraftAccountProto,
  ProxyProto,
} from "./generated/soulfire/common_pb.js";
import {
  InstanceEventFilterSchema,
  InstanceLiveService,
  type InstanceEvent,
} from "./generated/soulfire/instance_live_pb.js";
import {
  InstanceService,
  type InstanceInfo,
  type InstanceListResponse_Instance,
  type InstanceUpdateConfigEntryRequestSchema,
  type InstanceUpdateMetaRequestSchema,
} from "./generated/soulfire/instance_pb.js";
import { InventoryService } from "./generated/soulfire/inventory_pb.js";
import {
  LoginService,
  type NextAuthFlowResponse,
} from "./generated/soulfire/login_pb.js";
import {
  MCAuthService,
  type CredentialsAuthRequestSchema,
  type CredentialsAuthResponse,
  type DeviceCodeAuthRequestSchema,
  type DeviceCodeAuthResponse,
  type RefreshRequestSchema,
  type RefreshResponse,
} from "./generated/soulfire/mc-auth_pb.js";
import { PathfinderService } from "./generated/soulfire/pathfinding_pb.js";
import { BotProtocolService } from "./generated/soulfire/protocol_pb.js";
import { RecipeService } from "./generated/soulfire/recipe_pb.js";
import { RegistryService } from "./generated/soulfire/registry_pb.js";
import { SdkService, type SdkIdentity } from "./generated/soulfire/sdk_pb.js";
import { BotTaskService } from "./generated/soulfire/task_pb.js";
import { WorldService } from "./generated/soulfire/world_pb.js";
import type { LocalSoulFireServer } from "./install-types.js";
import { SoulFireInventory } from "./inventory.js";
import { SoulFirePathfinder } from "./pathfinding.js";
import { PluginCatalog } from "./plugins.js";
import { SoulFireProtocol } from "./protocol.js";
import { SoulFireRecipes } from "./recipes.js";
import { SoulFireRegistry } from "./registry.js";
import { BotSession, type BotSessionOptions } from "./session.js";
import { SoulFireTasks } from "./tasks.js";
import { SoulFireWorld } from "./world.js";

export { SoulFireActionError } from "./actions.js";

export type TokenProvider = () =>
  | Promise<string | undefined>
  | string
  | undefined;

export interface SoulFireOptions {
  baseUrl: string;
  token?: string | TokenProvider;
  defaultTimeoutMs?: number;
  fetch?: GrpcWebTransportOptions["fetch"];
  interceptors?: Interceptor[];
  requiredCapabilities?: readonly string[];
  requiredPlugins?: readonly RequiredPluginRequirement[];
  transport?: Transport;
}

export interface RequiredPluginRequirement {
  pluginId: string;
  versionRange?: string;
}

/**
 * Either `botIds` or `count`, not both.
 */
export interface BotSelection {
  botIds?: readonly string[];
  /**
   * Picks this many matching bots, shuffled if the instance's shuffle-accounts
   * setting is on.
   */
  count?: number;
}

export interface LocalServerController {
  readonly info: LocalSoulFireServer;
  close(): Effect.Effect<void>;
  isRunning(): boolean;
  logs(): readonly string[];
  restart(): Effect.Effect<void, SoulFireOperationError>;
  stop(): Effect.Effect<void, SoulFireOperationError>;
}

type ScopedRequest<T extends DescMessage> = Omit<
  MessageInitShape<T>,
  "$typeName" | "botId" | "instanceId"
>;

type InstanceScopedRequest<T extends DescMessage> = Omit<
  MessageInitShape<T>,
  "$typeName" | "id" | "instanceId"
>;

export type BotMovement = ScopedRequest<
  typeof BotSetMovementStateRequestSchema
>;

const DEFAULT_EVENT_FILTER: MessageInitShape<typeof BotEventFilterSchema> = {
  includeChat: true,
  includeDamage: true,
  includeInventory: true,
  includeLifecycle: true,
  includeResourcePacks: true,
  includeStateDeltas: true,
  includeTitles: true,
};

const DEFAULT_INSTANCE_EVENT_FILTER: MessageInitShape<
  typeof InstanceEventFilterSchema
> = {
  botEvents: {
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
  },
};

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (normalized.length === 0) {
    throw new TypeError("SoulFire baseUrl must not be empty");
  }
  return normalized;
}

export class SoulFireClient {
  readonly #transport: Transport;
  readonly #instanceClient: Client<typeof InstanceService>;
  readonly #loginClient: Client<typeof LoginService>;
  readonly #mcAuthClient: Client<typeof MCAuthService>;
  readonly #sdkClient: Client<typeof SdkService>;
  #localServer: LocalServerController | undefined;
  #connection: ConnectionMetadata | undefined;
  #plugins: PluginCatalog | undefined;
  #token: string | TokenProvider | undefined;

  private constructor(
    options: SoulFireOptions,
    localServer?: LocalServerController,
  ) {
    this.#token = options.token;
    this.#localServer = localServer;

    const authInterceptor: Interceptor = (next) => async (request) => {
      const token =
        typeof this.#token === "function" ? await this.#token() : this.#token;
      if (token) {
        request.header.set("Authorization", `Bearer ${token}`);
      }
      return next(request);
    };

    if (options.transport === undefined) {
      const transportOptions: GrpcWebTransportOptions = {
        baseUrl: normalizeBaseUrl(options.baseUrl),
        interceptors: [authInterceptor, ...(options.interceptors ?? [])],
        useBinaryFormat: true,
      };
      if (options.defaultTimeoutMs !== undefined) {
        transportOptions.defaultTimeoutMs = options.defaultTimeoutMs;
      }
      if (options.fetch !== undefined) {
        transportOptions.fetch = options.fetch;
      }
      this.#transport = createGrpcWebTransport(transportOptions);
    } else {
      this.#transport = options.transport;
    }

    this.#instanceClient = createClient(InstanceService, this.#transport);
    this.#loginClient = createClient(LoginService, this.#transport);
    this.#mcAuthClient = createClient(MCAuthService, this.#transport);
    this.#sdkClient = createClient(SdkService, this.#transport);
  }

  /**
   * Connects and checks the server is compatible: its SDK API version,
   * `requiredCapabilities` and `requiredPlugins`.
   */
  public static connect(
    options: SoulFireOptions,
  ): Effect.Effect<SoulFireClient, SoulFireConnectionError, Scope.Scope> {
    return SoulFireClient.unauthenticated(options).pipe(
      Effect.flatMap((client) =>
        client.#handshake(options).pipe(Effect.as(client)),
      ),
      Effect.mapError((cause) => new SoulFireConnectionError({ cause })),
    );
  }

  /**
   * A client that skips that check, for example to log in first.
   */
  public static unauthenticated(
    options: SoulFireOptions,
  ): Effect.Effect<SoulFireClient, SoulFireConnectionError, Scope.Scope> {
    return Effect.acquireRelease(
      Effect.try({
        try: () => new SoulFireClient(options),
        catch: (cause) => new SoulFireConnectionError({ cause }),
      }),
      (client) => client.close(),
    );
  }

  public static connectManaged(
    options: SoulFireOptions,
    localServer: LocalServerController,
  ): Effect.Effect<SoulFireClient, SoulFireConnectionError, Scope.Scope> {
    return Effect.acquireRelease(
      Effect.try({
        try: () => new SoulFireClient(options, localServer),
        catch: (cause) => new SoulFireConnectionError({ cause }),
      }),
      (client) => client.close(),
    ).pipe(
      Effect.tap((client) => client.#handshake(options)),
      Effect.mapError((cause) => new SoulFireConnectionError({ cause })),
    );
  }

  public setToken(token: string | TokenProvider | undefined): void {
    this.#token = token;
  }

  public get localServer(): LocalSoulFireServer | undefined {
    return this.#localServer?.info;
  }

  public get server(): ServerMetadata {
    return this.#requireConnection().server;
  }

  public get identity(): Readonly<SdkIdentity> {
    return this.#requireConnection().identity;
  }

  public get capabilities(): CapabilitySet {
    return this.#requireConnection().capabilities;
  }

  public get limits(): ReadonlyMap<string, bigint> {
    return this.#requireConnection().limits;
  }

  public get plugins(): PluginCatalog {
    if (this.#plugins === undefined) {
      throw new Error(
        "SoulFire connection has not completed its SDK handshake",
      );
    }
    return this.#plugins;
  }

  public get admin(): SoulFireAdmin {
    return new SoulFireAdmin(this.#transport);
  }

  public get localServerLogs(): readonly string[] {
    return this.#localServer?.logs() ?? [];
  }

  public get isLocalServerRunning(): boolean {
    return this.#localServer?.isRunning() ?? false;
  }

  public restartLocalServer(): Effect.Effect<void, SoulFireOperationError> {
    return Effect.try({
      try: () => this.#requireLocalServer(),
      catch: (cause) => operationError("SoulFire.restartLocalServer", cause),
    }).pipe(Effect.flatMap((server) => server.restart()));
  }

  public stopLocalServer(): Effect.Effect<void, SoulFireOperationError> {
    return Effect.try({
      try: () => this.#requireLocalServer(),
      catch: (cause) => operationError("SoulFire.stopLocalServer", cause),
    }).pipe(Effect.flatMap((server) => server.stop()));
  }

  public service<T extends DescService>(service: T): Client<T> {
    return createClient(service, this.#transport);
  }

  /**
   * A handle for `instanceId`, without a request.
   */
  public instance(instanceId: string): SoulFireInstance {
    return new SoulFireInstance(
      instanceId,
      createClient(BotService, this.#transport),
      createClient(BotLiveService, this.#transport),
      this.#instanceClient,
      this.#mcAuthClient,
      createClient(BotTaskService, this.#transport),
      createClient(PathfinderService, this.#transport),
      createClient(ChatService, this.#transport),
      createClient(InventoryService, this.#transport),
      createClient(RecipeService, this.#transport),
      createClient(RegistryService, this.#transport),
      createClient(WorldService, this.#transport),
      createClient(BotProtocolService, this.#transport),
      this.#connection?.capabilities,
      createClient(InstanceLiveService, this.#transport),
    );
  }

  public instances(
    options?: CallOptions,
  ): Effect.Effect<InstanceListResponse_Instance[], SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFire.instances", (signal) =>
        this.#instanceClient.listInstances({}, withSignal(options, signal)),
      );
      return response.instances;
    });
  }

  public createInstance(
    friendlyName: string,
    options?: CallOptions,
  ): Effect.Effect<SoulFireInstance, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFire.createInstance", (signal) =>
        this.#instanceClient.createInstance(
          { friendlyName },
          withSignal(options, signal),
        ),
      );
      return this.instance(response.id);
    });
  }

  public beginLogin(
    email: string,
    options?: CallOptions,
  ): Effect.Effect<NextAuthFlowResponse, SoulFireOperationError> {
    return rpc("SoulFire.beginLogin", (signal) =>
      this.#loginClient.login({ email }, withSignal(options, signal)),
    );
  }

  public completeLogin(
    authFlowToken: string,
    code: string,
    options?: CallOptions,
  ): Effect.Effect<NextAuthFlowResponse, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFire.completeLogin", (signal) =>
        this.#loginClient.emailCode(
          { authFlowToken, code },
          withSignal(options, signal),
        ),
      );
      if (response.next.case === "success") {
        this.setToken(response.next.value.token);
        yield* this.#handshake({
          baseUrl: "",
          token: response.next.value.token,
        });
      }
      return response;
    });
  }

  public close(): Effect.Effect<void> {
    return Effect.suspend(() => {
      const localServer = this.#localServer;
      this.#localServer = undefined;
      return localServer === undefined ? Effect.void : localServer.close();
    });
  }

  #requireLocalServer(): LocalServerController {
    if (this.#localServer === undefined) {
      throw new Error("This client does not manage a local SoulFire server");
    }
    return this.#localServer;
  }

  #requireConnection(): ConnectionMetadata {
    if (this.#connection === undefined) {
      throw new Error(
        "SoulFire connection has not completed its SDK handshake",
      );
    }
    return this.#connection;
  }

  #handshake(
    options: SoulFireOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFire.handshake", (signal) =>
        this.#sdkClient.handshake(
          {
            sdkName: "@soulfiremc/sdk",
            sdkVersion: SDK_VERSION,
            minimumApiVersion: SDK_API_VERSION,
            maximumApiVersion: SDK_API_VERSION,
            requiredCapabilities: [...(options.requiredCapabilities ?? [])],
            requiredPlugins: (options.requiredPlugins ?? []).map((plugin) => ({
              pluginId: plugin.pluginId,
              ...(plugin.versionRange === undefined
                ? {}
                : { versionRange: plugin.versionRange }),
            })),
          },
          { signal },
        ),
      );
      this.#connection = yield* Effect.try({
        try: () => connectionMetadata(response),
        catch: (cause) => operationError("SoulFire.handshake", cause),
      });
      this.#plugins = new PluginCatalog(
        this.#transport,
        this.#connection.plugins,
      );
    });
  }
}

export class SoulFireInstance {
  readonly #botClient: Client<typeof BotService>;
  readonly #botLiveClient: Client<typeof BotLiveService>;
  readonly #instanceClient: Client<typeof InstanceService>;
  readonly #mcAuthClient: Client<typeof MCAuthService> | undefined;
  readonly #taskClient: Client<typeof BotTaskService> | undefined;
  readonly #pathfinderClient: Client<typeof PathfinderService> | undefined;
  readonly #chatClient: Client<typeof ChatService> | undefined;
  readonly #inventoryClient: Client<typeof InventoryService> | undefined;
  readonly #recipeClient: Client<typeof RecipeService> | undefined;
  readonly #registryClient: Client<typeof RegistryService> | undefined;
  readonly #worldClient: Client<typeof WorldService> | undefined;
  readonly #protocolClient: Client<typeof BotProtocolService> | undefined;
  readonly #capabilities: CapabilitySet | undefined;
  readonly #instanceLiveClient: Client<typeof InstanceLiveService> | undefined;

  public constructor(
    public readonly id: string,
    botClient: Client<typeof BotService>,
    botLiveClient: Client<typeof BotLiveService>,
    instanceClient: Client<typeof InstanceService>,
    mcAuthClient?: Client<typeof MCAuthService>,
    taskClient?: Client<typeof BotTaskService>,
    pathfinderClient?: Client<typeof PathfinderService>,
    chatClient?: Client<typeof ChatService>,
    inventoryClient?: Client<typeof InventoryService>,
    recipeClient?: Client<typeof RecipeService>,
    registryClient?: Client<typeof RegistryService>,
    worldClient?: Client<typeof WorldService>,
    protocolClient?: Client<typeof BotProtocolService>,
    capabilities?: CapabilitySet,
    instanceLiveClient?: Client<typeof InstanceLiveService>,
  ) {
    this.#botClient = botClient;
    this.#botLiveClient = botLiveClient;
    this.#taskClient = taskClient;
    this.#pathfinderClient = pathfinderClient;
    this.#instanceClient = instanceClient;
    this.#mcAuthClient = mcAuthClient;
    this.#chatClient = chatClient;
    this.#inventoryClient = inventoryClient;
    this.#recipeClient = recipeClient;
    this.#registryClient = registryClient;
    this.#worldClient = worldClient;
    this.#protocolClient = protocolClient;
    this.#capabilities = capabilities;
    this.#instanceLiveClient = instanceLiveClient;
  }

  public get fleet(): SoulFireFleet {
    return new SoulFireFleet(this, this.#capabilities);
  }

  public bot(botId: string): SoulFireBot {
    return new SoulFireBot(
      this.id,
      botId,
      this.#botClient,
      this.#botLiveClient,
      this.#taskClient,
      this.#pathfinderClient,
      this.#chatClient,
      this.#inventoryClient,
      this.#recipeClient,
      this.#registryClient,
      this.#worldClient,
      this.#protocolClient,
    );
  }

  public info(
    options?: CallOptions,
  ): Effect.Effect<InstanceInfo, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFireInstance.info", (signal) =>
        this.#instanceClient.getInstanceInfo(
          { id: this.id },
          withSignal(options, signal),
        ),
      );
      if (response.result.case !== "info") {
        return yield* Effect.fail(
          operationError(
            "SoulFireInstance.info",
            new Error(`SoulFire did not return instance ${this.id}`),
          ),
        );
      }
      return response.result.value;
    });
  }

  /**
   * Deletes the instance and its data for good. Its bots are stopped first.
   */
  /**
   * Deletes the instance and its data for good. Its bots are stopped first.
   */
  public delete(
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.map(
      rpc("SoulFireInstance.delete", (signal) =>
        this.#instanceClient.deleteInstance(
          { id: this.id },
          withSignal(options, signal),
        ),
      ),
      () => undefined,
    );
  }

  public updateMetadata(
    request: InstanceScopedRequest<typeof InstanceUpdateMetaRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.map(
      rpc("SoulFireInstance.updateMetadata", (signal) =>
        this.#instanceClient.updateInstanceMeta(
          { ...request, id: this.id },
          withSignal(options, signal),
        ),
      ),
      () => undefined,
    );
  }

  public setConfigEntry(
    request: InstanceScopedRequest<
      typeof InstanceUpdateConfigEntryRequestSchema
    >,
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.map(
      rpc("SoulFireInstance.setConfigEntry", (signal) =>
        this.#instanceClient.updateInstanceConfigEntry(
          { ...request, id: this.id },
          withSignal(options, signal),
        ),
      ),
      () => undefined,
    );
  }

  public addAccounts(
    accounts: readonly MinecraftAccountProto[],
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.map(
      rpc("SoulFireInstance.addAccounts", (signal) =>
        this.#instanceClient.addInstanceAccountsBatch(
          { id: this.id, accounts: [...accounts] },
          withSignal(options, signal),
        ),
      ),
      () => undefined,
    );
  }

  public removeAccounts(
    profileIds: readonly string[],
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.map(
      rpc("SoulFireInstance.removeAccounts", (signal) =>
        this.#instanceClient.removeInstanceAccountsBatch(
          { id: this.id, profileIds: [...new Set(profileIds)] },
          withSignal(options, signal),
        ),
      ),
      () => undefined,
    );
  }

  public addProxies(
    proxies: readonly ProxyProto[],
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.map(
      rpc("SoulFireInstance.addProxies", (signal) =>
        this.#instanceClient.addInstanceProxiesBatch(
          { id: this.id, proxies: [...proxies] },
          withSignal(options, signal),
        ),
      ),
      () => undefined,
    );
  }

  public removeProxies(
    addresses: readonly string[],
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.map(
      rpc("SoulFireInstance.removeProxies", (signal) =>
        this.#instanceClient.removeInstanceProxiesBatch(
          { id: this.id, addresses: [...new Set(addresses)] },
          withSignal(options, signal),
        ),
      ),
      () => undefined,
    );
  }

  public loginCredentials(
    request: InstanceScopedRequest<typeof CredentialsAuthRequestSchema>,
    options?: CallOptions,
  ): Stream.Stream<CredentialsAuthResponse, SoulFireOperationError> {
    return Stream.unwrap(
      Effect.gen(this, function* () {
        return rpcStream("SoulFireInstance.loginCredentials", (signal) =>
          this.#requireMcAuthClient().loginCredentials(
            { ...request, instanceId: this.id },
            withSignal(options, signal),
          ),
        );
      }),
    );
  }

  public loginDeviceCode(
    request: InstanceScopedRequest<typeof DeviceCodeAuthRequestSchema>,
    options?: CallOptions,
  ): Stream.Stream<DeviceCodeAuthResponse, SoulFireOperationError> {
    return Stream.unwrap(
      Effect.gen(this, function* () {
        return rpcStream("SoulFireInstance.loginDeviceCode", (signal) =>
          this.#requireMcAuthClient().loginDeviceCode(
            { ...request, instanceId: this.id },
            withSignal(options, signal),
          ),
        );
      }),
    );
  }

  public refreshAccount(
    request: InstanceScopedRequest<typeof RefreshRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<RefreshResponse, SoulFireOperationError> {
    return rpc("SoulFireInstance.refreshAccount", (signal) =>
      this.#requireMcAuthClient().refresh(
        { ...request, instanceId: this.id },
        withSignal(options, signal),
      ),
    );
  }

  /**
   * Every bot of the instance, online or not. Online ones come with their live
   * state, without the inventory.
   */
  public bots(
    options?: CallOptions,
  ): Effect.Effect<BotListEntry[], SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFireInstance.bots", (signal) =>
        this.#botClient.getBotList(
          { instanceId: this.id },
          withSignal(options, signal),
        ),
      );
      return response.bots;
    });
  }

  /**
   * A snapshot of every bot's desired and runtime state, then each change.
   */
  public watchBotStatuses(
    options?: CallOptions,
  ): Stream.Stream<WatchBotStatusesResponse, SoulFireOperationError> {
    return Stream.unwrap(
      Effect.gen(this, function* () {
        return rpcStream("SoulFireInstance.watchBotStatuses", (signal) =>
          this.#botClient.watchBotStatuses(
            { instanceId: this.id },
            withSignal(options, signal),
          ),
        );
      }),
    );
  }

  /**
   * Watches one multiplexed event stream for the selected bots in this
   * instance. The default filter includes every stateful event category while
   * leaving high-volume sounds and particles opt-in.
   */
  public events(
    filter: MessageInitShape<
      typeof InstanceEventFilterSchema
    > = DEFAULT_INSTANCE_EVENT_FILTER,
    options?: CallOptions,
  ): Stream.Stream<InstanceEvent, SoulFireOperationError> {
    return Stream.unwrap(
      Effect.gen(this, function* () {
        if (this.#instanceLiveClient === undefined) {
          return yield* Effect.fail(
            operationError(
              "SoulFireInstance.events",
              new Error("The instance live service is unavailable"),
            ),
          );
        }
        const client = this.#instanceLiveClient;
        return rpcStream("SoulFireInstance.events", (signal) =>
          client.watchInstanceEvents(
            {
              instanceId: this.id,
              filter,
            },
            withSignal(options, signal),
          ),
        );
      }),
    );
  }

  /**
   * Marks bots to run; they connect in the background. `selection` defaults to
   * every bot not marked to run.
   */
  public start(
    selection?: BotSelection,
    options?: CallOptions,
  ): Effect.Effect<BotStatus[], SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const botIds = yield* this.#selectBotIds(
        selection,
        (bot) => bot.status?.desiredState !== BotDesiredState.RUNNING,
        options,
      );
      if (botIds.length === 0) {
        return [];
      }
      const response = yield* rpc("SoulFireInstance.start", (signal) =>
        this.#botClient.setBotsDesiredState(
          {
            instanceId: this.id,
            botIds,
            desiredState: BotDesiredState.RUNNING,
          },
          withSignal(options, signal),
        ),
      );
      return response.bots;
    });
  }

  /**
   * Marks bots as stopped; they disconnect in the background. `selection`
   * defaults to every bot marked to run.
   */
  public stop(
    selection?: BotSelection,
    options?: CallOptions,
  ): Effect.Effect<BotStatus[], SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const botIds = yield* this.#selectBotIds(
        selection,
        (bot) => bot.status?.desiredState === BotDesiredState.RUNNING,
        options,
      );
      if (botIds.length === 0) {
        return [];
      }
      const response = yield* rpc("SoulFireInstance.stop", (signal) =>
        this.#botClient.setBotsDesiredState(
          {
            instanceId: this.id,
            botIds,
            desiredState: BotDesiredState.STOPPED,
          },
          withSignal(options, signal),
        ),
      );
      return response.bots;
    });
  }

  /**
   * Gives bots a fresh connection. `selection` defaults to every bot marked to
   * run.
   */
  public restart(
    selection?: BotSelection,
    options?: CallOptions,
  ): Effect.Effect<BotStatus[], SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const botIds = yield* this.#selectBotIds(
        selection,
        (bot) => bot.status?.desiredState === BotDesiredState.RUNNING,
        options,
      );
      if (botIds.length === 0) {
        return [];
      }
      const response = yield* rpc("SoulFireInstance.restart", (signal) =>
        this.#botClient.restartBots(
          { instanceId: this.id, botIds },
          withSignal(options, signal),
        ),
      );
      return response.bots;
    });
  }

  #selectBotIds(
    selection: BotSelection | undefined,
    countFilter: (bot: BotListEntry) => boolean,
    options: CallOptions | undefined,
  ): Effect.Effect<string[], SoulFireOperationError> {
    return Effect.gen(this, function* () {
      if (selection?.botIds !== undefined && selection.count !== undefined) {
        return yield* Effect.fail(
          operationError(
            "SoulFireInstance.selectBotIds",
            new TypeError("Use either botIds or count, not both"),
          ),
        );
      }
      if (selection?.botIds !== undefined) {
        return [...new Set(selection.botIds)];
      }
      const bots = yield* this.bots(options);
      const candidates = bots.filter(countFilter);
      if (selection?.count === undefined) {
        return candidates.map((bot) => bot.profileId);
      }
      const count = normalizeCount(selection.count);
      if (count === 0) {
        return [];
      }
      if (yield* this.#shuffleAccountsEnabled(options)) {
        shuffle(candidates);
      }
      return candidates.slice(0, count).map((bot) => bot.profileId);
    });
  }

  #shuffleAccountsEnabled(
    options?: CallOptions,
  ): Effect.Effect<boolean, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc(
        "SoulFireInstance.shuffleAccountsEnabled",
        (signal) =>
          this.#instanceClient.getInstanceInfo(
            { id: this.id },
            withSignal(options, signal),
          ),
      );
      if (response.result.case !== "info") {
        return false;
      }
      const accountSettings = response.result.value.config?.settings.find(
        (namespace) => namespace.namespace === "account",
      );
      const shuffleSetting = accountSettings?.entries.find(
        (entry) => entry.key === "shuffle-accounts",
      );
      return (
        shuffleSetting?.value?.kind.case === "boolValue" &&
        shuffleSetting.value.kind.value
      );
    });
  }

  #requireMcAuthClient(): Client<typeof MCAuthService> {
    if (this.#mcAuthClient === undefined) {
      throw new Error("Minecraft authentication is unavailable");
    }
    return this.#mcAuthClient;
  }
}

/**
 * One bot. Methods that resolve to a `BotActionResult` throw
 * `SoulFireActionError` unless the action completed.
 */
export class SoulFireBot {
  #controlToken: string | undefined;

  public constructor(
    public readonly instanceId: string,
    public readonly id: string,
    private readonly botClient: Client<typeof BotService>,
    private readonly liveClient: Client<typeof BotLiveService>,
    private readonly taskClient?: Client<typeof BotTaskService>,
    private readonly pathfinderClient?: Client<typeof PathfinderService>,
    private readonly chatClient?: Client<typeof ChatService>,
    private readonly inventoryClient?: Client<typeof InventoryService>,
    private readonly recipeClient?: Client<typeof RecipeService>,
    private readonly registryClient?: Client<typeof RegistryService>,
    private readonly worldClient?: Client<typeof WorldService>,
    private readonly protocolClient?: Client<typeof BotProtocolService>,
  ) {}

  public get tasks(): SoulFireTasks {
    if (this.taskClient === undefined) {
      throw new Error("The bot task service is unavailable");
    }
    return new SoulFireTasks(
      this.instanceId,
      this.id,
      this.taskClient,
      (options) => this.#actionOptions(options),
    );
  }

  public get pathfinder(): SoulFirePathfinder {
    return new SoulFirePathfinder(
      this.instanceId,
      this.id,
      this.#requiredClient(this.pathfinderClient, "pathfinder"),
      this.tasks,
    );
  }

  public get chat(): SoulFireChat {
    return new SoulFireChat(
      this.instanceId,
      this.id,
      this.#requiredClient(this.chatClient, "chat"),
      (options) => this.#actionOptions(options),
      (filter, options) => this.events(filter, options),
    );
  }

  public get inventory(): SoulFireInventory {
    return new SoulFireInventory(
      this.instanceId,
      this.id,
      this.#requiredClient(this.inventoryClient, "inventory"),
      (options) => this.#actionOptions(options),
    );
  }

  public get recipes(): SoulFireRecipes {
    return new SoulFireRecipes(
      this.instanceId,
      this.id,
      this.#requiredClient(this.recipeClient, "recipe"),
      this.tasks,
    );
  }

  public get registry(): SoulFireRegistry {
    return new SoulFireRegistry(
      this.instanceId,
      this.id,
      this.#requiredClient(this.registryClient, "registry"),
    );
  }

  public get world(): SoulFireWorld {
    return new SoulFireWorld(
      this.instanceId,
      this.id,
      this.#requiredClient(this.worldClient, "world"),
    );
  }

  public get camera(): SoulFireCamera {
    return new SoulFireCamera(this.instanceId, this.id, this.botClient);
  }

  public get protocol(): SoulFireProtocol {
    return new SoulFireProtocol(
      this.instanceId,
      this.id,
      this.#requiredClient(this.protocolClient, "protocol"),
    );
  }

  /**
   * Marks the bot to run; it connects in the background (see `waitForOnline`).
   */
  /**
   * Marks the bot to run; it connects in the background (see `waitForOnline`).
   */
  public start(
    options?: CallOptions,
  ): Effect.Effect<BotStatus, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFireBot.start", (signal) =>
        this.botClient.setBotsDesiredState(
          {
            instanceId: this.instanceId,
            botIds: [this.id],
            desiredState: BotDesiredState.RUNNING,
          },
          withSignal(options, signal),
        ),
      );
      return yield* Effect.try({
        try: () => requiredBotStatus(response.bots, this.id),
        catch: (cause) => operationError("SoulFireBot.start", cause),
      });
    });
  }

  /**
   * Marks the bot as stopped; it disconnects in the background.
   */
  public stop(
    options?: CallOptions,
  ): Effect.Effect<BotStatus, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFireBot.stop", (signal) =>
        this.botClient.setBotsDesiredState(
          {
            instanceId: this.instanceId,
            botIds: [this.id],
            desiredState: BotDesiredState.STOPPED,
          },
          withSignal(options, signal),
        ),
      );
      return yield* Effect.try({
        try: () => requiredBotStatus(response.bots, this.id),
        catch: (cause) => operationError("SoulFireBot.stop", cause),
      });
    });
  }

  /**
   * Gives the bot a fresh connection.
   */
  public restart(
    options?: CallOptions,
  ): Effect.Effect<BotStatus, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFireBot.restart", (signal) =>
        this.botClient.restartBots(
          { instanceId: this.instanceId, botIds: [this.id] },
          withSignal(options, signal),
        ),
      );
      return yield* Effect.try({
        try: () => requiredBotStatus(response.bots, this.id),
        catch: (cause) => operationError("SoulFireBot.restart", cause),
      });
    });
  }

  public status(
    options?: CallOptions,
  ): Effect.Effect<BotStatus, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* this.info(options);
      if (response.status === undefined) {
        return yield* Effect.fail(
          operationError(
            "SoulFireBot.status",
            new Error(`SoulFire did not return status for bot ${this.id}`),
          ),
        );
      }
      return response.status;
    });
  }

  /**
   * Status, and while online the live state with the full inventory.
   */
  public info(
    options?: CallOptions,
  ): Effect.Effect<BotInfoResponse, SoulFireOperationError> {
    return rpc("SoulFireBot.info", (signal) =>
      this.botClient.getBotInfo(
        { instanceId: this.instanceId, botId: this.id },
        withSignal(options, signal),
      ),
    );
  }

  /**
   * Throws if the bot is offline.
   */
  public liveState(
    options?: CallOptions,
  ): Effect.Effect<BotLiveState, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* this.info(options);
      if (response.liveState === undefined) {
        return yield* Effect.fail(
          operationError(
            "SoulFireBot.liveState",
            new Error(`Bot ${this.id} is not online`),
          ),
        );
      }
      return response.liveState;
    });
  }

  /**
   * Resolves once the bot is online, at once if it already is.
   */
  public waitForOnline(options?: {
    call?: CallOptions;
  }): Effect.Effect<BotStatus, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const current = yield* this.info(options?.call);
      if (current.status === undefined)
        return yield* Effect.fail(
          rpcError(
            "bot.waitForOnline",
            new Error("SoulFire did not return bot status"),
          ),
        );
      if (current.liveState !== undefined) return current.status;
      let latestStatus = current.status;
      const snapshot = yield* this.events(undefined, options?.call).pipe(
        Stream.tap((event) =>
          Effect.sync(() => {
            if (event.event.case === "status") latestStatus = event.event.value;
          }),
        ),
        Stream.filter((event) => event.event.case === "snapshot"),
        Stream.runHead,
      );
      if (Option.isNone(snapshot))
        return yield* Effect.fail(
          rpcError(
            "bot.waitForOnline",
            new Error("Bot event stream ended before it came online"),
          ),
        );
      return latestStatus;
    });
  }

  /**
   * The bot's live events. The first is its status; the stream stays open while
   * the bot is stopped and follows it across reconnects. The default filter
   * takes state changes, chat, lifecycle, inventory, damage, resource packs and
   * titles.
   */
  /**
   * The bot's live events. The first is its status; the stream stays open while
   * the bot is stopped and follows it across reconnects. The default filter
   * takes state changes, chat, lifecycle, inventory, damage, resource packs and
   * titles.
   */
  public events(
    filter: MessageInitShape<
      typeof BotEventFilterSchema
    > = DEFAULT_EVENT_FILTER,
    options?: CallOptions,
  ): Stream.Stream<BotEvent, SoulFireOperationError> {
    return Stream.unwrap(
      Effect.gen(this, function* () {
        return rpcStream("SoulFireBot.events", (signal) =>
          this.liveClient.watchBotEvents(
            {
              instanceId: this.instanceId,
              botId: this.id,
              filter,
            },
            withSignal(options, signal),
          ),
        );
      }),
    );
  }

  /**
   * Opens a `BotSession`: the event stream and the state it adds up to.
   */
  public observe(
    options?: BotSessionOptions,
  ): Effect.Effect<BotSession, SoulFireOperationError, Scope.Scope> {
    return BotSession.open(
      (request, options) =>
        rpcStream("bot.observe", (signal) =>
          this.liveClient.watchBotEvents(
            { ...request, instanceId: this.instanceId, botId: this.id },
            withSignal(options, signal),
          ),
        ),
      options,
    );
  }

  /**
   * A chat message, or a command if it starts with `/`.
   */
  /**
   * A chat message, or a command if it starts with `/`.
   */
  public sendChat(
    message: string,
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFireBot.sendChat", (signal) =>
        this.liveClient.sendChat(
          {
            instanceId: this.instanceId,
            botId: this.id,
            message,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      );
      return yield* Effect.try({
        try: () => requireCompletedAction(response.result),
        catch: (cause) => operationError("SoulFireBot.sendChat", cause),
      });
    });
  }

  /**
   * The block at `position`, if its chunk is loaded.
   */
  public getBlock(
    request: ScopedRequest<typeof GetBlockRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<GetBlockResponse, SoulFireOperationError> {
    return rpc("SoulFireBot.getBlock", (signal) =>
      this.liveClient.getBlock(
        {
          ...request,
          instanceId: this.instanceId,
          botId: this.id,
        },
        withSignal(options, signal),
      ),
    );
  }

  /**
   * Blocks with one of `blockIds`, nearest first: `maxCount` of them (at most
   * 256) within `maxDistance` of the bot (at most 128).
   */
  public findBlocks(
    request: ScopedRequest<typeof FindBlocksRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<FindBlocksResponse, SoulFireOperationError> {
    return rpc("SoulFireBot.findBlocks", (signal) =>
      this.liveClient.findBlocks(
        {
          ...request,
          instanceId: this.instanceId,
          botId: this.id,
        },
        withSignal(options, signal),
      ),
    );
  }

  /**
   * Entities within `radius` of the bot (at most 128), only of `entityTypes` if
   * given. Players only with `includePlayers: true`.
   */
  public listNearbyEntities(
    request: ScopedRequest<typeof ListNearbyEntitiesRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<ListNearbyEntitiesResponse, SoulFireOperationError> {
    return rpc("SoulFireBot.listNearbyEntities", (signal) =>
      this.liveClient.listNearbyEntities(
        {
          ...request,
          instanceId: this.instanceId,
          botId: this.id,
        },
        withSignal(options, signal),
      ),
    );
  }

  /**
   * Breaks the block at `position` with what the main hand holds, and resolves
   * once it's broken. `cancel: true` stops a dig in progress instead. Needs the
   * block within reach; times out after a minute.
   */
  public digBlock(
    request: ScopedRequest<typeof DigBlockRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.digBlock", (signal) =>
        this.liveClient.digBlock(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) => operationError("SoulFireBot.digBlock", cause),
        }),
    );
  }

  /**
   * Places the held block against the `face` of `against`, like a right click
   * on it: the new block goes on that side.
   */
  public placeBlock(
    request: ScopedRequest<typeof PlaceBlockRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.placeBlock", (signal) =>
        this.liveClient.placeBlock(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) => operationError("SoulFireBot.placeBlock", cause),
        }),
    );
  }

  /**
   * Right-clicks a block face: doors, buttons, beds, levers. `sneaking` sneaks
   * for this click, so the held item's own use doesn't take over.
   */
  public interactBlock(
    request: ScopedRequest<typeof InteractBlockRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.interactBlock", (signal) =>
        this.liveClient.interactBlock(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) => operationError("SoulFireBot.interactBlock", cause),
        }),
    );
  }

  /**
   * Uses the item in `hand`: eat, drink, throw, draw a bow. `releaseItem` ends
   * it.
   */
  public useItem(
    request: ScopedRequest<typeof UseItemRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.useItem", (signal) =>
        this.liveClient.useItem(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) => operationError("SoulFireBot.useItem", cause),
        }),
    );
  }

  /**
   * Lets go of an item in use: fires a drawn bow, stops eating.
   */
  public releaseItem(
    request: ScopedRequest<typeof ReleaseItemRequestSchema> = {},
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.releaseItem", (signal) =>
        this.liveClient.releaseItem(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) => operationError("SoulFireBot.releaseItem", cause),
        }),
    );
  }

  /**
   * Hits an entity within reach once, by network id.
   */
  public attackEntity(
    request: ScopedRequest<typeof AttackEntityRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.attackEntity", (signal) =>
        this.liveClient.attackEntity(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) => operationError("SoulFireBot.attackEntity", cause),
        }),
    );
  }

  /**
   * Right-clicks an entity within reach: trading, mounting.
   */
  public interactEntity(
    request: ScopedRequest<typeof InteractEntityRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.interactEntity", (signal) =>
        this.liveClient.interactEntity(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) => operationError("SoulFireBot.interactEntity", cause),
        }),
    );
  }

  /**
   * Only the animation.
   */
  public swingArm(
    request: ScopedRequest<typeof SwingArmRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.swingArm", (signal) =>
        this.liveClient.swingArm(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) => operationError("SoulFireBot.swingArm", cause),
        }),
    );
  }

  /**
   * Respawns a dead bot, or leaves the End credits.
   */
  public respawn(
    request: ScopedRequest<typeof RespawnRequestSchema> = {},
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.respawn", (signal) =>
        this.liveClient.respawn(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) => operationError("SoulFireBot.respawn", cause),
        }),
    );
  }

  /**
   * Uses a bed within reach and resolves once the server confirms the bot is
   * sleeping.
   */
  public sleep(
    request: ScopedRequest<typeof SleepRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.sleep", (signal) =>
        this.liveClient.sleep(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) => operationError("SoulFireBot.sleep", cause),
        }),
    );
  }

  public wake(
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.wake", (signal) =>
        this.liveClient.wake(
          {
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) => operationError("SoulFireBot.wake", cause),
        }),
    );
  }

  /**
   * Rides an entity and resolves once the server confirms it.
   */
  public mount(
    request: ScopedRequest<typeof MountEntityRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<MountEntityResponse, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFireBot.mount", (signal) =>
        this.liveClient.mountEntity(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      );
      yield* Effect.try({
        try: () => requireCompletedAction(response.result),
        catch: (cause) => operationError("SoulFireBot.mount", cause),
      });
      return response;
    });
  }

  public dismount(
    request: ScopedRequest<typeof DismountRequestSchema> = {},
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.dismount", (signal) =>
        this.liveClient.dismount(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) => operationError("SoulFireBot.dismount", cause),
        }),
    );
  }

  /**
   * Movement input while controlling a vehicle. It stays until changed; unset
   * fields keep theirs.
   */
  public setVehicleControl(
    request: ScopedRequest<typeof SetVehicleControlRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<SetVehicleControlResponse, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFireBot.setVehicleControl", (signal) =>
        this.liveClient.setVehicleControl(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      );
      yield* Effect.try({
        try: () => requireCompletedAction(response.result),
        catch: (cause) =>
          operationError("SoulFireBot.setVehicleControl", cause),
      });
      return response;
    });
  }

  /**
   * Writes a sign: exactly four `lines` (an empty string clears one), on the
   * front if `frontText`.
   */
  public updateSign(
    request: ScopedRequest<typeof UpdateSignRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.updateSign", (signal) =>
        this.liveClient.updateSign(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) => operationError("SoulFireBot.updateSign", cause),
        }),
    );
  }

  /**
   * Writes the writable book in hotbar slot `inventorySlot` (0-8). A `title`
   * signs it.
   */
  public writeBook(
    request: ScopedRequest<typeof WriteBookRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.writeBook", (signal) =>
        this.liveClient.writeBook(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) => operationError("SoulFireBot.writeBook", cause),
        }),
    );
  }

  public respondResourcePack(
    request: ScopedRequest<typeof RespondResourcePackRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.respondResourcePack", (signal) =>
        this.liveClient.respondResourcePack(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) =>
            operationError("SoulFireBot.respondResourcePack", cause),
        }),
    );
  }

  public setFlying(
    request: ScopedRequest<typeof SetFlyingRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.setFlying", (signal) =>
        this.liveClient.setFlying(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) => operationError("SoulFireBot.setFlying", cause),
        }),
    );
  }

  /**
   * Starts gliding. The bot must be falling with a usable elytra.
   */
  public startElytraFlight(
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.startElytraFlight", (signal) =>
        this.liveClient.startElytraFlight(
          {
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) =>
            operationError("SoulFireBot.startElytraFlight", cause),
        }),
    );
  }

  /**
   * Sets slot 0-45 of the inventory menu; no `item` clears it.
   */
  public setCreativeSlot(
    request: ScopedRequest<typeof SetCreativeSlotRequestSchema>,
    options?: CallOptions,
  ): Effect.Effect<BotActionResult, SoulFireOperationError> {
    return Effect.flatMap(
      rpc("SoulFireBot.setCreativeSlot", (signal) =>
        this.liveClient.setCreativeSlot(
          {
            ...request,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      (response) =>
        Effect.try({
          try: () => requireCompletedAction(response.result),
          catch: (cause) =>
            operationError("SoulFireBot.setCreativeSlot", cause),
        }),
    );
  }

  /**
   * Waits until every chunk within `radiusChunks` of the bot's chunk is loaded:
   * 0 (the default) means its own chunk, and it's at most 16. Times out after
   * `timeoutMs`, which defaults to 30 s, at most 5 min.
   */
  public waitForChunks(
    request: ScopedRequest<typeof WaitForChunksRequestSchema> = {},
    options?: CallOptions,
  ): Effect.Effect<WaitForChunksResponse, SoulFireOperationError> {
    return rpc("SoulFireBot.waitForChunks", (signal) =>
      this.liveClient.waitForChunks(
        {
          ...request,
          instanceId: this.instanceId,
          botId: this.id,
        },
        withSignal(options, signal),
      ),
    );
  }

  /**
   * Pathfinds to `goal`, streaming progress until COMPLETED, FAILED or
   * CANCELLED. A new `goTo` cancels this one. Times out after
   * `options.timeoutSeconds`, which defaults to 5 min, at most 1 h.
   */
  public goTo(
    request: ScopedRequest<typeof GoToRequestSchema>,
    options?: CallOptions,
  ): Stream.Stream<PathfindProgress, SoulFireOperationError> {
    return Stream.unwrap(
      Effect.gen(this, function* () {
        return rpcStream("SoulFireBot.goTo", (signal) =>
          this.liveClient.goTo(
            {
              ...request,
              instanceId: this.instanceId,
              botId: this.id,
            },
            withSignal(this.#actionOptions(options), signal),
          ),
        );
      }),
    );
  }

  /**
   * Cancels the `goTo` in progress.
   */
  public stopPathfinding(
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.map(
      rpc("SoulFireBot.stopPathfinding", (signal) =>
        this.liveClient.stopPathfinding(
          {
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      ),
      () => undefined,
    );
  }

  /**
   * The open menu, or the player's inventory: layout, slots and the carried
   * item.
   */
  public inventoryState(
    options?: CallOptions,
  ): Effect.Effect<BotInventoryStateResponse, SoulFireOperationError> {
    return rpc("SoulFireBot.inventoryState", (signal) =>
      this.botClient.getInventoryState(
        { instanceId: this.instanceId, botId: this.id },
        withSignal(options, signal),
      ),
    );
  }

  /**
   * Clicks `slot` of the open menu like a mouse; -999 clicks outside it,
   * dropping what the cursor holds. `clickType` defaults to LEFT_CLICK.
   * `hotbarSlot` (0-8) is the slot SWAP_HOTBAR swaps with, and defaults to 0.
   */
  public clickInventory(
    slot: number,
    clickType: ClickType = ClickType.LEFT_CLICK,
    hotbarSlot = 0,
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFireBot.clickInventory", (signal) =>
        this.botClient.clickInventorySlot(
          {
            instanceId: this.instanceId,
            botId: this.id,
            slot,
            clickType,
            hotbarSlot,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      );
      yield* Effect.try({
        try: () => requireSuccess(response, "Inventory click failed"),
        catch: (cause) => operationError("SoulFireBot.clickInventory", cause),
      });
    });
  }

  /**
   * Shift-clicks `slot`: its stack moves to the other part of the menu.
   */
  public transferInventorySlot(
    slot: number,
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return this.clickInventory(slot, ClickType.SHIFT_LEFT_CLICK, 0, options);
  }

  /**
   * Drops the stack in `slot`, or only one item when `all` is false. `all`
   * defaults to true.
   */
  public dropInventorySlot(
    slot: number,
    all = true,
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return this.clickInventory(
      slot,
      all ? ClickType.DROP_ALL : ClickType.DROP_ONE,
      0,
      options,
    );
  }

  /**
   * Picks up the stack in `fromSlot` and puts it in `toSlot`; what stays on the
   * cursor goes back.
   */
  public moveInventoryStack(
    fromSlot: number,
    toSlot: number,
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      yield* this.clickInventory(fromSlot, ClickType.LEFT_CLICK, 0, options);
      yield* this.clickInventory(toSlot, ClickType.LEFT_CLICK, 0, options);
      const state = yield* this.inventoryState(options);
      if (state.carriedItem !== undefined && state.carriedItem.count > 0) {
        yield* this.clickInventory(fromSlot, ClickType.LEFT_CLICK, 0, options);
      }
    });
  }

  /**
   * Selects hotbar slot `slot`, from 0 to 8.
   */
  public selectHotbar(
    slot: number,
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFireBot.selectHotbar", (signal) =>
        this.botClient.setHotbarSlot(
          { instanceId: this.instanceId, botId: this.id, slot },
          withSignal(this.#actionOptions(options), signal),
        ),
      );
      yield* Effect.try({
        try: () => requireSuccess(response, "Selecting a hotbar slot failed"),
        catch: (cause) => operationError("SoulFireBot.selectHotbar", cause),
      });
    });
  }

  /**
   * Presses or releases movement keys. Keys left out keep their state, and a
   * pressed key stays pressed until changed or `resetMovement`. Sprinting needs
   * `forward` and a food level of 6 or more.
   */
  public setMovement(
    movement: BotMovement,
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFireBot.setMovement", (signal) =>
        this.botClient.setMovementState(
          {
            ...movement,
            instanceId: this.instanceId,
            botId: this.id,
          },
          withSignal(this.#actionOptions(options), signal),
        ),
      );
      yield* Effect.try({
        try: () => requireSuccess(response, "Updating movement failed"),
        catch: (cause) => operationError("SoulFireBot.setMovement", cause),
      });
    });
  }

  /**
   * Releases every movement key.
   */
  public resetMovement(
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFireBot.resetMovement", (signal) =>
        this.botClient.resetMovement(
          { instanceId: this.instanceId, botId: this.id },
          withSignal(this.#actionOptions(options), signal),
        ),
      );
      yield* Effect.try({
        try: () => requireSuccess(response, "Resetting movement failed"),
        catch: (cause) => operationError("SoulFireBot.resetMovement", cause),
      });
    });
  }

  /**
   * Turns the bot. `yaw` is in degrees: 0 south, 90 west, -90 east, 180 north.
   * `pitch` too: -90 up, 0 level, 90 down.
   */
  public look(
    yaw: number,
    pitch: number,
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFireBot.look", (signal) =>
        this.botClient.setRotation(
          { instanceId: this.instanceId, botId: this.id, yaw, pitch },
          withSignal(this.#actionOptions(options), signal),
        ),
      );
      yield* Effect.try({
        try: () => requireSuccess(response, "Updating rotation failed"),
        catch: (cause) => operationError("SoulFireBot.look", cause),
      });
    });
  }

  public openInventory(
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFireBot.openInventory", (signal) =>
        this.botClient.openInventory(
          { instanceId: this.instanceId, botId: this.id },
          withSignal(this.#actionOptions(options), signal),
        ),
      );
      yield* Effect.try({
        try: () => requireSuccess(response, "Opening inventory failed"),
        catch: (cause) => operationError("SoulFireBot.openInventory", cause),
      });
    });
  }

  public closeContainer(
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFireBot.closeContainer", (signal) =>
        this.botClient.closeContainer(
          { instanceId: this.instanceId, botId: this.id },
          withSignal(this.#actionOptions(options), signal),
        ),
      );
      yield* Effect.try({
        try: () => requireSuccess(response, "Closing container failed"),
        catch: (cause) => operationError("SoulFireBot.closeContainer", cause),
      });
    });
  }

  /**
   * The server dialog on screen (Minecraft 1.21.6+), if any.
   */
  public dialog(
    options?: CallOptions,
  ): Effect.Effect<BotGetDialogResponse, SoulFireOperationError> {
    return rpc("SoulFireBot.dialog", (signal) =>
      this.botClient.getDialog(
        { instanceId: this.instanceId, botId: this.id },
        withSignal(options, signal),
      ),
    );
  }

  /**
   * Same as `camera.capture`.
   */
  public renderPov(
    request: {
      width?: number;
      height?: number;
      maxDistance?: number;
      fov?: number;
      cameraX?: number;
      cameraY?: number;
      cameraZ?: number;
      yRot?: number;
      xRot?: number;
      includeHud?: boolean;
      includeHands?: boolean;
      includeDebugTrace?: boolean;
    } = {},
    options?: CallOptions,
  ): Effect.Effect<BotRenderPovResponse, SoulFireOperationError> {
    return rpc("SoulFireBot.renderPov", (signal) =>
      this.botClient.renderBotPov(
        {
          instanceId: this.instanceId,
          botId: this.id,
          width: request.width ?? 0,
          height: request.height ?? 0,
          ...(request.maxDistance === undefined
            ? {}
            : { maxDistance: request.maxDistance }),
          ...(request.fov === undefined ? {} : { fov: request.fov }),
          ...(request.cameraX === undefined
            ? {}
            : { cameraX: request.cameraX }),
          ...(request.cameraY === undefined
            ? {}
            : { cameraY: request.cameraY }),
          ...(request.cameraZ === undefined
            ? {}
            : { cameraZ: request.cameraZ }),
          ...(request.yRot === undefined ? {} : { yRot: request.yRot }),
          ...(request.xRot === undefined ? {} : { xRot: request.xRot }),
          ...(request.includeHud === undefined
            ? {}
            : { includeHud: request.includeHud }),
          ...(request.includeHands === undefined
            ? {}
            : { includeHands: request.includeHands }),
          includeDebugTrace: request.includeDebugTrace ?? false,
        },
        withSignal(options, signal),
      ),
    );
  }

  /**
   * Takes exclusive control: until the lease ends, only this client can act on
   * the bot. Renew it before it runs out. `ttlSeconds` defaults to 30, from 5
   * to 300.
   */
  public acquireControl(
    ttlSeconds = 30,
    options?: CallOptions,
  ): Effect.Effect<SoulFireBotControlLease, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      if (this.#controlToken !== undefined) {
        return yield* Effect.fail(
          operationError(
            "SoulFireBot.acquireControl",
            new Error(
              `Bot ${this.id} control is already leased by this client`,
            ),
          ),
        );
      }
      const response = yield* rpc("SoulFireBot.acquireControl", (signal) =>
        this.liveClient.acquireBotControl(
          {
            instanceId: this.instanceId,
            botId: this.id,
            ttlSeconds,
          },
          withSignal(options, signal),
        ),
      );
      if (response.lease === undefined) {
        return yield* Effect.fail(
          operationError(
            "SoulFireBot.acquireControl",
            new Error("SoulFire did not return the acquired control lease"),
          ),
        );
      }
      this.#controlToken = response.lease.token;
      return new SoulFireBotControlLease(this, response.lease);
    });
  }

  public acquireControlScoped(
    ttlSeconds = 30,
    options?: CallOptions,
  ): Effect.Effect<
    SoulFireBotControlLease,
    SoulFireOperationError,
    Scope.Scope
  > {
    return Effect.acquireRelease(
      this.acquireControl(ttlSeconds, options),
      (lease) => lease.release().pipe(Effect.orDie),
    );
  }

  renewControl(
    lease: BotControlLease,
    ttlSeconds: number,
    options?: CallOptions,
  ): Effect.Effect<BotControlLease, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const response = yield* rpc("SoulFireBot.renewControl", (signal) =>
        this.liveClient.renewBotControl(
          {
            instanceId: this.instanceId,
            botId: this.id,
            token: lease.token,
            ttlSeconds,
          },
          withSignal(options, signal),
        ),
      );
      if (response.lease === undefined) {
        return yield* Effect.fail(
          operationError(
            "SoulFireBot.renewControl",
            new Error("SoulFire did not return the renewed control lease"),
          ),
        );
      }
      this.#controlToken = response.lease.token;
      return response.lease;
    });
  }

  releaseControl(
    lease: BotControlLease,
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      yield* rpc("SoulFireBot.releaseControl", (signal) =>
        this.liveClient.releaseBotControl(
          {
            instanceId: this.instanceId,
            botId: this.id,
            token: lease.token,
          },
          withSignal(options, signal),
        ),
      );
      if (this.#controlToken === lease.token) {
        this.#controlToken = undefined;
      }
    });
  }

  #actionOptions(options?: CallOptions): CallOptions | undefined {
    if (this.#controlToken === undefined) {
      return options;
    }
    const headers = new Headers(options?.headers);
    headers.set("X-SoulFire-Control-Token", this.#controlToken);
    return { ...options, headers };
  }

  #requiredClient<T>(client: T | undefined, service: string): T {
    if (client === undefined) {
      throw new Error(`The ${service} service is unavailable`);
    }
    return client;
  }
}

/**
 * `await using` releases it.
 */
export class SoulFireBotControlLease {
  #lease: BotControlLease | undefined;

  public constructor(
    private readonly bot: SoulFireBot,
    lease: BotControlLease,
  ) {
    this.#lease = lease;
  }

  public get value(): BotControlLease {
    if (this.#lease === undefined) {
      throw new Error("The bot control lease has been released");
    }
    return this.#lease;
  }

  /**
   * `ttlSeconds` defaults to 30, from 5 to 300.
   */
  /**
   * `ttlSeconds` defaults to 30, from 5 to 300.
   */
  public renew(
    ttlSeconds = 30,
    options?: CallOptions,
  ): Effect.Effect<BotControlLease, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const lease = yield* this.bot.renewControl(
        this.value,
        ttlSeconds,
        options,
      );
      this.#lease = lease;
      return lease;
    });
  }

  public release(
    options?: CallOptions,
  ): Effect.Effect<void, SoulFireOperationError> {
    return Effect.gen(this, function* () {
      const lease = this.#lease;
      if (lease === undefined) {
        return;
      }
      yield* this.bot.releaseControl(lease, options);
      this.#lease = undefined;
    });
  }
}

function normalizeCount(count: number): number {
  if (!Number.isFinite(count)) {
    throw new TypeError("Bot count must be a finite number");
  }
  return Math.max(0, Math.floor(count));
}

function shuffle<T>(values: T[]): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const selectedIndex = Math.floor(Math.random() * (index + 1));
    [values[index], values[selectedIndex]] = [
      values[selectedIndex] as T,
      values[index] as T,
    ];
  }
}

function requiredBotStatus(
  statuses: readonly BotStatus[],
  botId: string,
): BotStatus {
  const status = statuses.find((candidate) => candidate.profileId === botId);
  if (status === undefined) {
    throw new Error(`SoulFire did not return status for bot ${botId}`);
  }
  return status;
}

function requireSuccess(
  response: { success: boolean; error?: string | undefined },
  fallback: string,
): void {
  if (!response.success) {
    throw new Error(response.error ?? fallback);
  }
}

export class SoulFireService extends Context.Tag(
  "@soulfiremc/sdk/SoulFireService",
)<SoulFireService, SoulFireClient>() {}

export const SoulFire = {
  connect: SoulFireClient.connect,
  unauthenticated: SoulFireClient.unauthenticated,
  connectManaged: SoulFireClient.connectManaged,
  connectWithHttpClient(options: SoulFireOptions) {
    return Effect.flatMap(HttpClient.HttpClient, (client) =>
      SoulFireClient.connect({
        ...options,
        fetch: makeEffectHttpClientFetch(client),
      }),
    );
  },
  layer(options: SoulFireOptions) {
    return Layer.scoped(SoulFireService, SoulFireClient.connect(options));
  },
  layerWithHttpClient(options: SoulFireOptions) {
    return Layer.scoped(SoulFireService, this.connectWithHttpClient(options));
  },
};
