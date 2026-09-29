// The end-to-end harness: a real Minecraft server (Docker) with a void world, SoulFire started from
// a local jar, and one bot on that server. Tests build their scene with server commands (RCON),
// drive the bot through the SDK and check the result.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, appendFileSync, constants, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { create } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { SoulFire, type SoulFireBot, type SoulFireInstance } from "@soulfiremc/sdk/node/promise";
import {
  MinecraftAccountProto_AccountTypeProto,
  MinecraftAccountProto_OfflineJavaDataSchema,
  MinecraftAccountProtoSchema,
  SettingsNamespace_SettingsEntrySchema,
  SettingsNamespaceSchema,
} from "@soulfiremc/sdk/generated/soulfire/common_pb";

const run = promisify(execFile);

export const E2E_DIR = import.meta.dirname;
const REPO_DIR = path.dirname(E2E_DIR);

// ---- Minecraft server ------------------------------------------------------------------------

/** Kept between runs (unless --fresh), so a run doesn't wait for the server to start. */
const CONTAINER = "soulfire-e2e";
/** The image the beat-game smoke uses. */
const IMAGE = "itzg/minecraft-server:2026.3.2-java25";
/** SoulFire's native version, so the bot needs no protocol translation. */
export const MINECRAFT_VERSION = "26.3";
/** Not 25565, so a server someone runs for play keeps its port. */
const MINECRAFT_PORT = Number(process.env.SOULFIRE_E2E_MINECRAFT_PORT ?? 25566);
/** A flat world of one air layer: nothing exists that a test didn't build. */
const VOID_WORLD = JSON.stringify({ layers: [{ block: "minecraft:air", height: 1 }], biome: "minecraft:the_void" });
/** First start downloads the server jar and generates the world. */
const MINECRAFT_START_TIMEOUT_MS = 5 * 60_000;

/** Command output that means the command failed (RCON itself still succeeds). */
const RCON_ERROR = /Unknown or incomplete command|Incorrect argument|Expected |Invalid |That position is not loaded|No player was found|Unknown |Could not /;

/**
 * Runs a server command and returns its output. Throws when the output says the command failed,
 * unless `check` is false (for commands whose failure is the answer, like `execute if`).
 */
export async function rcon(command: string, { check = true } = {}): Promise<string> {
  const { stdout } = await run("docker", ["exec", CONTAINER, "rcon-cli", command]);
  const out = stdout.trim();
  if (check && RCON_ERROR.test(out)) throw new Error(`/${command}: ${out}`);
  return out;
}

async function containerRunning() {
  const r = await run("docker", ["inspect", "--format", "{{.State.Running}}", CONTAINER]).catch(() => null);
  return r?.stdout.trim() === "true";
}

/** The host address the running container publishes the server on, e.g. `127.0.0.1:25566`. */
async function publishedAddress() {
  const r = await run("docker", ["port", CONTAINER, "25565/tcp"]).catch(() => null);
  return r?.stdout.trim();
}

/** Starts the server, or reuses the one left running by an earlier run (on the same port). */
export async function startMinecraft({ fresh }: { fresh: boolean }) {
  if (fresh || ((await containerRunning()) && (await publishedAddress()) !== `127.0.0.1:${MINECRAFT_PORT}`)) {
    await stopMinecraft();
  }
  if (await containerRunning()) {
    console.log(`[minecraft] reusing container ${CONTAINER}`);
  } else {
    console.log(`[minecraft] starting ${IMAGE} (Minecraft ${MINECRAFT_VERSION}, void world)...`);
    await run("docker", [
      "run", "--detach", "--rm", "--name", CONTAINER,
      "--publish", `127.0.0.1:${MINECRAFT_PORT}:25565`,
      ...env({
        EULA: "TRUE",
        TYPE: "VANILLA",
        VERSION: MINECRAFT_VERSION,
        MEMORY: "2G",
        ONLINE_MODE: "FALSE",
        ENFORCE_SECURE_PROFILE: "FALSE",
        ENABLE_RCON: "TRUE",
        RCON_PASSWORD: "soulfire-e2e",
        LEVEL_TYPE: "minecraft:flat",
        GENERATOR_SETTINGS: VOID_WORLD,
        GENERATE_STRUCTURES: "FALSE",
        DIFFICULTY: "peaceful",
        MODE: "survival",
        SPAWN_PROTECTION: "0",
        VIEW_DISTANCE: "6",
        SIMULATION_DISTANCE: "6",
      }),
      IMAGE,
    ]);
  }
  const started = Date.now();
  for (;;) {
    if (await rcon("list").then(() => true, () => false)) break;
    if (!(await containerRunning())) throw new Error(`container ${CONTAINER} stopped; see \`docker logs ${CONTAINER}\``);
    if (Date.now() - started > MINECRAFT_START_TIMEOUT_MS) throw new Error("Minecraft server did not start in time");
    await sleep(1000);
  }
  console.log(`[minecraft] ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  await prepareWorld();
  return { host: "127.0.0.1", port: MINECRAFT_PORT };
}

export async function stopMinecraft() {
  await run("docker", ["rm", "--force", CONTAINER]).catch(() => {});
}

export async function saveMinecraftLog(file: string) {
  const { stdout, stderr } = await run("docker", ["logs", CONTAINER], { maxBuffer: 64 * 1024 * 1024 }).catch(() => ({ stdout: "", stderr: "" }));
  appendFileSync(file, stdout + stderr);
}

/** A world where nothing changes on its own, and a pad to spawn on (the void kills). */
async function prepareWorld() {
  for (const rule of ["advance_time false", "advance_weather false", "spawn_mobs false", "random_tick_speed 0", "respawn_radius 0", "show_advancement_messages false"]) {
    await rcon(`gamerule ${rule}`);
  }
  await rcon("time set noon");
  await rcon("weather clear");
  await rcon("forceload add -16 -16 15 15");
  await rcon("fill -2 63 -2 2 63 2 minecraft:stone");
  await rcon("setworldspawn 0 64 0");
}

function env(vars: Record<string, string>) {
  return Object.entries(vars).flatMap(([k, v]) => ["--env", `${k}=${v}`]);
}

// ---- SoulFire --------------------------------------------------------------------------------

/** The jar `./gradlew :dedicated-launcher:uberJar` builds, unless SOULFIRE_E2E_JAR names another. */
export function soulfireJar() {
  if (process.env.SOULFIRE_E2E_JAR) return path.resolve(process.env.SOULFIRE_E2E_JAR);
  const version = readFileSync(path.join(REPO_DIR, "gradle.properties"), "utf8").match(/^maven_version=(.+)$/m)?.[1];
  return path.join(REPO_DIR, "dedicated-launcher", "build", "libs", `SoulFireDedicated-${version}.jar`);
}

/** Java 25: SOULFIRE_E2E_JAVA, else the `java` on PATH. */
function javaPath() {
  if (process.env.SOULFIRE_E2E_JAVA) return process.env.SOULFIRE_E2E_JAVA;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(dir, "java");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error("no java on PATH; set SOULFIRE_E2E_JAVA");
}

const INSTANCE_NAME = "e2e";
export const BOT_NAME = "E2EBot";

/** Settings for the bot: nothing acts on its own. */
const BOT_SETTINGS: Record<string, Record<string, ReturnType<typeof value>>> = {
  "client-settings": { "render-distance": value(6) },
  "auto-eat": { enabled: value(false) },
  "auto-armor": { enabled: value(false) },
  "auto-totem": { enabled: value(false) },
  "auto-jump": { enabled: value(false) },
  "anti-afk": { enabled: value(false) },
  "auto-respawn": { enabled: value(false) },
  "auto-reconnect": { enabled: value(false) },
};

/**
 * Starts SoulFire from the jar, points a fresh instance at the Minecraft server, and brings the bot
 * in. SoulFire's console goes to `logFile`. If a step after the start fails, SoulFire is stopped.
 */
export async function startSoulFire(jarPath: string, minecraft: { host: string; port: number }, logFile: string) {
  console.log(`[soulfire] starting ${path.relative(REPO_DIR, jarPath)}...`);
  const started = Date.now();
  const directory = path.join(E2E_DIR, ".soulfire");
  mkdirSync(directory, { recursive: true });
  const soulfire = await SoulFire.install({
    directory,
    jarPath,
    javaPath: javaPath(),
    javaArgs: ["-Xms1G", "-Xmx4G"],
    startupTimeoutMs: 180_000,
    onLog: (line) => appendFileSync(logFile, line + "\n"),
  });
  console.log(`[soulfire] ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  try {
    return await startBot(soulfire, minecraft);
  } catch (e) {
    await soulfire.close().catch(() => {});
    throw e;
  }
}

/** Points a fresh instance at the Minecraft server and brings the bot in. */
async function startBot(soulfire: Awaited<ReturnType<typeof SoulFire.install>>, minecraft: { host: string; port: number }) {
  // SoulFire keeps its instances in its database: start from a clean one each run.
  for (const old of await soulfire.instances()) {
    if (old.friendlyName === INSTANCE_NAME) await soulfire.instance(old.id).delete();
  }
  const instance: SoulFireInstance = await soulfire.createInstance(INSTANCE_NAME);
  await instance.setConfigEntry({ namespace: "bot", key: "address", value: value(`${minecraft.host}:${minecraft.port}`) });
  const profileId = offlineUuid(BOT_NAME);
  await instance.addAccounts([
    create(MinecraftAccountProtoSchema, {
      type: MinecraftAccountProto_AccountTypeProto.OFFLINE,
      profileId,
      lastKnownName: BOT_NAME,
      accountData: { case: "offlineJavaData", value: create(MinecraftAccountProto_OfflineJavaDataSchema) },
      config: Object.entries(BOT_SETTINGS).map(([namespace, entries]) =>
        create(SettingsNamespaceSchema, {
          namespace,
          entries: Object.entries(entries).map(([key, v]) => create(SettingsNamespace_SettingsEntrySchema, { key, value: v })),
        }),
      ),
    }),
  ]);

  const joined = Date.now();
  const bot: SoulFireBot = instance.bot(profileId);
  await bot.start();
  await bot.waitForOnline({ call: { timeoutMs: 120_000 } });
  console.log(`[soulfire] ${BOT_NAME} online in ${((Date.now() - joined) / 1000).toFixed(1)}s`);

  return {
    bot,
    async stop() {
      await bot.stop().catch(() => {});
      await instance.delete().catch(() => {});
      await soulfire.close();
    },
  };
}

// ---- what tests use --------------------------------------------------------------------------

export type Pos = { x: number; y: number; z: number };

export interface TestContext {
  bot: SoulFireBot;
  rcon: typeof rcon;
}

/** A test: `run` builds its scene, drives the bot and throws when the check fails. */
export interface E2ETest {
  name: string;
  run(t: TestContext): Promise<void>;
}

/**
 * Moves the bot to `at` (feet position) with an empty inventory and no effects, and waits until
 * SoulFire sees it there with the chunks around it loaded.
 */
export async function placeBot(bot: SoulFireBot, at: Pos, yaw = 0) {
  await rcon(`clear ${BOT_NAME}`, { check: false }); // "No items were found" when already empty
  await rcon(`effect clear ${BOT_NAME}`, { check: false });
  await rcon(`tp ${BOT_NAME} ${at.x} ${at.y} ${at.z} ${yaw} 0`);
  const deadline = Date.now() + 10_000;
  for (;;) {
    const p = (await bot.world.player()).position;
    if (p && Math.abs(p.x - at.x) < 0.01 && Math.abs(p.y - at.y) < 0.01 && Math.abs(p.z - at.z) < 0.01) break;
    if (Date.now() > deadline) throw new Error(`bot not at ${JSON.stringify(at)} after teleport (at ${JSON.stringify(p)})`);
    await sleep(100);
  }
  await bot.waitForChunks({ radiusChunks: 2, timeoutMs: 10_000 }, { timeoutMs: 15_000 });
}

/** The bot's position as the server has it (not as SoulFire believes it is). */
export async function serverPosition(): Promise<Pos> {
  const out = await rcon(`data get entity ${BOT_NAME} Pos`);
  const m = out.match(/\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/);
  if (!m) throw new Error(`unexpected Pos output: ${out}`);
  return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
}

/** The block a position is in. */
export const blockOf = (p: Pos): Pos => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });

// ---- helpers ---------------------------------------------------------------------------------

/** The UUID the server gives an offline-mode player of that name. */
function offlineUuid(name: string) {
  const b = createHash("md5").update(`OfflinePlayer:${name}`, "utf8").digest();
  b[6] = (b[6]! & 0x0f) | 0x30;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function value(v: string | number | boolean) {
  const kind =
    typeof v === "string" ? { case: "stringValue" as const, value: v }
    : typeof v === "number" ? { case: "numberValue" as const, value: v }
    : { case: "boolValue" as const, value: v };
  return create(ValueSchema, { kind });
}
