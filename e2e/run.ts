// Runs the end-to-end tests: starts the Minecraft server and SoulFire, then each test in turn.
//
//   bun run test                      every test in tests/
//   bun run test walk-straight        only those named
//   bun run test --fresh              a new Minecraft server (and world) instead of the running one
//   bun run test --stop               remove the Minecraft server at the end
//
// SOULFIRE_E2E_JAR runs another SoulFire jar (e.g. one built from upstream, to compare).
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  E2E_DIR,
  type E2ETest,
  rcon,
  saveMinecraftLog,
  soulfireJar,
  startMinecraft,
  startSoulFire,
  stopMinecraft,
} from "./harness.ts";

const { values: flags, positionals: names } = parseArgs({
  allowPositionals: true,
  options: {
    fresh: { type: "boolean", default: false },
    stop: { type: "boolean", default: false },
  },
});

const tests: E2ETest[] = [];
for (const file of readdirSync(path.join(E2E_DIR, "tests")).filter((f) => f.endsWith(".ts")).sort()) {
  tests.push((await import(path.join(E2E_DIR, "tests", file))).default);
}
if (!tests.length) throw new Error("no tests in tests/");
const selected = names.length ? tests.filter((t) => names.includes(t.name)) : tests;
const unknown = names.filter((n) => !tests.some((t) => t.name === n));
if (unknown.length) throw new Error(`no such test: ${unknown.join(", ")} (have: ${tests.map((t) => t.name).join(", ")})`);

const jar = soulfireJar();
if (!existsSync(jar)) throw new Error(`no SoulFire jar at ${jar}: run ./gradlew :dedicated-launcher:uberJar, or set SOULFIRE_E2E_JAR`);

const runDir = path.join(E2E_DIR, "runs", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(runDir, { recursive: true });
console.log(`[e2e] logs in ${path.relative(process.cwd(), runDir)}`);

let failed = 0;
let soulfire: Awaited<ReturnType<typeof startSoulFire>> | undefined;
try {
  const started = Date.now();
  const minecraft = await startMinecraft({ fresh: flags.fresh });
  soulfire = await startSoulFire(jar, minecraft, path.join(runDir, "soulfire.log"));
  console.log(`[e2e] set up in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

  for (const test of selected) {
    const t0 = Date.now();
    try {
      await test.run({ bot: soulfire.bot, rcon });
      console.log(`  ok    ${test.name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      failed++;
      console.log(`  FAIL  ${test.name} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n        ${String(e instanceof Error ? e.message : e).replace(/\n/g, "\n        ")}`);
    }
  }
} finally {
  // Every step runs even if one before it fails.
  const report = (step: string) => (e: unknown) => console.log(`[e2e] ${step} failed: ${e instanceof Error ? e.message : e}`);
  await soulfire?.stop().catch(report("stopping SoulFire"));
  await saveMinecraftLog(path.join(runDir, "minecraft.log")).catch(report("saving the Minecraft log"));
  if (flags.stop) await stopMinecraft();
}
console.log(`\n${selected.length - failed}/${selected.length} passed`);
process.exit(failed ? 1 : 0);
