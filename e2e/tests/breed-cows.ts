// Two adult cows in a small pen, and wheat in the bot's inventory: the breed task feeds both, and
// a calf is born. On the client an animal's age is only -1 (baby) or 1 (adult); the real age stays
// on the server. Before #1019 the task looked for age 0, found no pair, and this test failed.
import { setTimeout as sleep } from "node:timers/promises";
import { BreedCompletionReason } from "@soulfiremc/sdk/generated/soulfire/task_pb";
import { BOT_NAME, placeBot, type E2ETest } from "../harness.ts";

/** The pen's centre, where the bot stands (feet). */
const CENTER = { x: 200, y: 64, z: 0 };
/** Blocks from the centre to the fence. */
const HALF = 3;
/** Marks the two adults, so the calf is the cow without it. */
const TAG = "e2e_breed_parent";
const CALF_TIMEOUT_MS = 30_000;

export default {
  name: "breed-cows",
  async run({ bot, rcon }) {
    const { x, y, z } = CENTER;
    const pen = `x=${x - HALF},y=${y - 1},z=${z - HALF},dx=${2 * HALF},dy=3,dz=${2 * HALF}`;
    const removeCows = () => rcon(`kill @e[type=minecraft:cow,${pen}]`, { check: false });
    await rcon(`forceload add ${x - 16} ${z - 16} ${x + 16} ${z + 16}`);
    await removeCows();
    await rcon(`fill ${x - HALF - 1} ${y - 2} ${z - HALF - 1} ${x + HALF + 1} ${y + 3} ${z + HALF + 1} minecraft:air`);
    await rcon(`fill ${x - HALF} ${y - 1} ${z - HALF} ${x + HALF} ${y - 1} ${z + HALF} minecraft:grass_block`);
    await rcon(`fill ${x - HALF} ${y} ${z - HALF} ${x + HALF} ${y} ${z + HALF} minecraft:oak_fence`);
    await rcon(`fill ${x - HALF + 1} ${y} ${z - HALF + 1} ${x + HALF - 1} ${y} ${z + HALF - 1} minecraft:air`);
    await placeBot(bot, { x: x + 0.5, y, z: z + 0.5 });
    try {
      await rcon(`summon minecraft:cow ${x - 1.5} ${y} ${z + 0.5} {Tags:["${TAG}"]}`);
      await rcon(`summon minecraft:cow ${x + 2.5} ${y} ${z + 0.5} {Tags:["${TAG}"]}`);
      await rcon(`give ${BOT_NAME} minecraft:wheat 8`);
      await waitFor(async () => (await bot.inventory.count({ selector: { itemIds: ["minecraft:wheat"] } })) === 8n, "the bot never had the wheat");
      await waitFor(async () => (await bot.world.queryEntities({ radius: 16, selector: { entityTypes: ["minecraft:cow"] } })).entities.length === 2, "SoulFire never saw both cows");

      const result = await (await bot.tasks.breed({ animals: { entityTypes: ["minecraft:cow"] }, maximumPairs: 1 })).result();
      if (result.pairsStarted !== 1) {
        throw new Error(`the breed task started ${result.pairsStarted} pairs, fed ${result.animalsFed} animals, and ended with ${BreedCompletionReason[result.reason]}`);
      }

      await waitFor(async () => (await rcon(`execute if entity @e[type=minecraft:cow,tag=!${TAG},${pen}]`, { check: false })).startsWith("Test passed"), `no calf within ${CALF_TIMEOUT_MS / 1000}s of feeding both cows`, CALF_TIMEOUT_MS);
    } finally {
      await removeCows();
      await rcon(`clear ${BOT_NAME}`, { check: false });
    }
  },
} satisfies E2ETest;

async function waitFor(check: () => Promise<boolean>, error: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(error);
    await sleep(250);
  }
}
