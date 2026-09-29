import { Effect } from "effect";
import { SoulFire, type SoulFireOptions } from "../src/index.js";

/** Run one workflow from a request handler, forwarding its cancellation signal. */
export async function announce(
  options: SoulFireOptions,
  instanceId: string,
  botId: string,
  signal: AbortSignal,
): Promise<void> {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const soulfire = yield* SoulFire.connect(options);
        const bot = soulfire.instance(instanceId).bot(botId);
        yield* bot.start();
        yield* bot.waitForOnline();
        yield* bot.chat.send("Hello from an async host");
      }),
    ),
    { signal },
  );
}
