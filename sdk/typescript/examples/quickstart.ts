import { Effect } from "effect";
import { SoulFire } from "../src/index.js";

const program = Effect.scoped(
  Effect.gen(function* () {
    const soulfire = yield* SoulFire.connect({
      baseUrl: "https://soulfire.example.com",
      token: "your-api-token",
    });
    const bot = soulfire.instance("instance-uuid").bot("bot-uuid");
    yield* bot.start();
    yield* bot.waitForOnline();
    yield* bot.chat.send("Hello from SoulFire");
  }),
);

await Effect.runPromise(program);
