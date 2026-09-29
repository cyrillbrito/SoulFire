import type { MessageInitShape } from "@bufbuild/protobuf";
import type { CallOptions, Client } from "@connectrpc/connect";

import { requireCompletedAction } from "./actions.js";
import {
  ChatService,
  type TabCompleteResponse,
} from "./generated/soulfire/chat_pb.js";
import {
  BotEventFilterSchema,
  type BotActionResult,
  type BotChatEvent,
  type BotEvent,
  type ChatSource,
} from "./generated/soulfire/bot_live_pb.js";

export interface ChatMutationOptions {
  call?: CallOptions;
  idempotencyKey?: string;
}

export interface TabCompleteOptions {
  call?: CallOptions;
  cursor?: number;
}

export type ChatMatcher =
  | string
  | RegExp
  | ((event: BotChatEvent) => boolean);

export interface ChatMatch {
  readonly captures: readonly string[];
  readonly event: BotChatEvent;
  readonly groups: Readonly<Record<string, string>>;
}

export interface WatchChatOptions {
  readonly call?: CallOptions;
  readonly sources?: readonly ChatSource[];
}

export interface WaitForChatOptions extends WatchChatOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

type BotEventStream = (
  filter: MessageInitShape<typeof BotEventFilterSchema>,
  options?: CallOptions,
) => AsyncIterable<BotEvent>;

export class SoulFireChat {
  public constructor(
    private readonly instanceId: string,
    private readonly botId: string,
    private readonly client: Client<typeof ChatService>,
    private readonly actionOptions: (options?: CallOptions) =>
      CallOptions | undefined,
    private readonly eventStream?: BotEventStream,
  ) {}

  /**
   * To public chat. `message` can't be blank or longer than 256 characters.
   */
  public async send(
    message: string,
    options: ChatMutationOptions = {},
  ): Promise<BotActionResult> {
    const response = await this.client.sendPublicChat(
      {
        scope: this.scope(),
        message,
        ...(options.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: options.idempotencyKey }),
      },
      this.actionOptions(options.call),
    );
    return requireCompletedAction(response.result);
  }

  /**
   * Runs a command; the leading `/` is optional.
   */
  public async command(
    command: string,
    options: ChatMutationOptions = {},
  ): Promise<BotActionResult> {
    const response = await this.client.sendCommand(
      {
        scope: this.scope(),
        command,
        ...(options.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: options.idempotencyKey }),
      },
      this.actionOptions(options.call),
    );
    return requireCompletedAction(response.result);
  }

  /**
   * Sends `/msg <recipient> <message>`.
   */
  public async whisper(
    recipient: string,
    message: string,
    options: ChatMutationOptions = {},
  ): Promise<BotActionResult> {
    const response = await this.client.sendWhisper(
      {
        scope: this.scope(),
        recipient,
        message,
        ...(options.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: options.idempotencyKey }),
      },
      this.actionOptions(options.call),
    );
    return requireCompletedAction(response.result);
  }

  /**
   * Tab-completion suggestions for `input` (a command if it starts with `/`) at
   * `options.cursor`, which defaults to the end of `input`.
   */
  public complete(
    input: string,
    options: TabCompleteOptions = {},
  ): Promise<TabCompleteResponse> {
    return this.client.tabComplete(
      {
        scope: this.scope(),
        input,
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      },
      options.call,
    );
  }

  /**
   * Chat events matching `matcher`, as they arrive, until the caller stops
   * iterating. A string matches as a substring of the plain text; a RegExp's
   * groups go in `captures` and `groups`. `options.sources` keeps only those
   * sources.
   */
  public async *watch(
    matcher: ChatMatcher,
    options: WatchChatOptions = {},
  ): AsyncIterable<ChatMatch> {
    if (this.eventStream === undefined) {
      throw new Error("The bot event stream is unavailable");
    }

    const sources = options.sources === undefined
      ? undefined
      : new Set(options.sources);
    for await (
      const envelope of this.eventStream(
        { includeChat: true },
        options.call,
      )
    ) {
      if (envelope.event.case !== "chat") {
        continue;
      }
      const event = envelope.event.value;
      if (sources !== undefined && !sources.has(event.source)) {
        continue;
      }
      const match = matchChat(event, matcher);
      if (match !== undefined) {
        yield match;
      }
    }
  }

  /**
   * The next chat event matching `matcher` (as in `watch`). No timeout unless
   * `timeoutMs` is set.
   */
  public async waitFor(
    matcher: ChatMatcher,
    options: WaitForChatOptions = {},
  ): Promise<ChatMatch> {
    const controller = new AbortController();
    const inputSignals = [options.signal, options.call?.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined,
    );
    const forwardAbort = (signal: AbortSignal) => {
      controller.abort(signal.reason);
    };
    const listeners = inputSignals.map((signal) => {
      const listener = () => forwardAbort(signal);
      if (signal.aborted) {
        forwardAbort(signal);
      } else {
        signal.addEventListener("abort", listener, { once: true });
      }
      return { listener, signal };
    });
    let timedOut = false;
    const timeout = options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs);

    try {
      for await (
        const match of this.watch(matcher, {
          ...options,
          call: { ...options.call, signal: controller.signal },
        })
      ) {
        return match;
      }
      throw new Error("The bot event stream ended before chat matched");
    } catch (cause) {
      if (timedOut) {
        throw new Error(
          `Timed out after ${options.timeoutMs} ms waiting for chat`,
          { cause },
        );
      }
      if (options.signal?.aborted) {
        throw options.signal.reason ?? cause;
      }
      if (options.call?.signal?.aborted) {
        throw options.call.signal.reason ?? cause;
      }
      throw cause;
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      for (const { listener, signal } of listeners) {
        signal.removeEventListener("abort", listener);
      }
    }
  }

  private scope(): { instanceId: string; botId: string } {
    return { instanceId: this.instanceId, botId: this.botId };
  }
}

export function matchChat(
  event: BotChatEvent,
  matcher: ChatMatcher,
): ChatMatch | undefined {
  if (typeof matcher === "string") {
    return event.plainText.includes(matcher)
      ? { captures: [], event, groups: {} }
      : undefined;
  }
  if (typeof matcher === "function") {
    return matcher(event) ? { captures: [], event, groups: {} } : undefined;
  }

  matcher.lastIndex = 0;
  const result = matcher.exec(event.plainText);
  if (result === null) {
    return undefined;
  }
  return {
    captures: result.slice(1).map((value) => value ?? ""),
    event,
    groups: { ...result.groups },
  };
}
