// The bot walks along a straight line of blocks, one block wide, and stops on its last block.
import assert from "node:assert/strict";
import { goals } from "@soulfiremc/sdk/node/promise";
import { blockOf, placeBot, serverPosition, type E2ETest } from "../harness.ts";

/** Where the bot starts (feet). The line is the row of blocks under it, going +x. */
const START = { x: 100, y: 64, z: 0 };
const LENGTH = 20;

export default {
  name: "walk-straight",
  async run({ bot, rcon }) {
    const { x, y, z } = START;
    await rcon(`forceload add ${x - 16} ${z - 16} ${x + LENGTH + 16} ${z + 16}`);
    await rcon(`fill ${x - 2} ${y - 4} ${z - 2} ${x + LENGTH + 2} ${y + 4} ${z + 2} minecraft:air`);
    await rcon(`fill ${x} ${y - 1} ${z} ${x + LENGTH} ${y - 1} ${z} minecraft:stone`);
    await placeBot(bot, { x: x + 0.5, y, z: z + 0.5 });

    const goal = { x: x + LENGTH, y, z };
    await (await bot.pathfinder.goTo(goals.block(goal), { path: { timeoutSeconds: 30 } })).result();

    assert.deepEqual(blockOf(await serverPosition()), goal);
  },
} satisfies E2ETest;
