import { createClient, createRouterTransport } from "@connectrpc/connect";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  WorldService,
  type CanSeeBlockRequest,
  type EstimateDigTimeRequest,
  type EstimateExplosionDamageRequest,
  type RaycastRequest,
} from "../src/generated/soulfire/world_pb.js";
import { SoulFireWorld } from "../src/world.js";

describe("SoulFireWorld", () => {
  it("raycasts from the current player view for cursor helpers", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const requests: RaycastRequest[] = [];
          const transport = createRouterTransport(({ service }) => {
            service(WorldService, {
              raycast(request) {
                requests.push(request);
                return request.includeEntities
                  ? {
                      entity: {
                        entityType: "minecraft:zombie",
                        alive: true,
                      },
                    }
                  : {
                      block: {
                        blockId: "minecraft:stone",
                        diggable: true,
                      },
                    };
              },
            });
          });
          const world = new SoulFireWorld(
            "instance-id",
            "bot-id",
            createClient(WorldService, transport),
          );
          const block = yield* world.blockAtCursor();
          const entity = yield* world.entityAtCursor();
          expect(block?.blockId).toBe("minecraft:stone");
          expect(entity?.entityType).toBe("minecraft:zombie");
          expect(requests).toHaveLength(2);
          expect(requests[0]).toMatchObject({
            instanceId: "instance-id",
            botId: "bot-id",
            maximumDistance: 256,
            includeEntities: false,
          });
          expect(requests[0]?.origin).toBeUndefined();
          expect(requests[0]?.direction).toBeUndefined();
          expect(requests[1]?.maximumDistance).toBe(3.5);
        }),
      ),
    ));

  it("scopes visibility and mining-time estimates", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let visibilityRequest: CanSeeBlockRequest | undefined;
          let digTimeRequest: EstimateDigTimeRequest | undefined;
          const transport = createRouterTransport(({ service }) => {
            service(WorldService, {
              canSeeBlock(request) {
                visibilityRequest = request;
                return {
                  visible: true,
                  distance: 4.5,
                  block: { blockId: "minecraft:stone" },
                };
              },
              estimateDigTime(request) {
                digTimeRequest = request;
                return {
                  diggable: true,
                  ticks: 6,
                  durationMs: 300n,
                  progressPerTick: 0.2,
                  correctToolForDrops: true,
                  block: { blockId: "minecraft:stone" },
                };
              },
            });
          });
          const world = new SoulFireWorld(
            "instance-id",
            "bot-id",
            createClient(WorldService, transport),
          );
          const position = {
            dimension: "minecraft:overworld",
            x: 4,
            y: 63,
            z: 2,
          };
          const visibility = yield* world.canSeeBlock({ position });
          const digTime = yield* world.estimateDigTime({ position });
          expect(visibility.visible).toBe(true);
          expect(digTime).toMatchObject({
            diggable: true,
            ticks: 6,
            durationMs: 300n,
            correctToolForDrops: true,
          });
          expect(visibilityRequest).toMatchObject({
            instanceId: "instance-id",
            botId: "bot-id",
            position,
          });
          expect(digTimeRequest).toMatchObject({
            instanceId: "instance-id",
            botId: "bot-id",
            position,
          });
        }),
      ),
    ));

  it("scopes explosion estimates and preserves mitigation detail", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let received: EstimateExplosionDamageRequest | undefined;
          const transport = createRouterTransport(({ service }) => {
            service(WorldService, {
              estimateExplosionDamage(request) {
                received = request;
                return {
                  damageRadius: 12,
                  exposure: 0.75,
                  rawDamage: 35,
                  damageAfterArmor: 21,
                  damageAfterResistance: 16.8,
                  damageAfterEnchantments: 10.08,
                  absorbedDamage: 4,
                  estimatedHealthDamage: 6.08,
                  armorPoints: 20,
                  armorToughness: 8,
                  resistanceLevel: 1,
                  explosionProtection: 10,
                };
              },
            });
          });
          const world = new SoulFireWorld(
            "instance-id",
            "bot-id",
            createClient(WorldService, transport),
          );
          const estimate = yield* world.estimateExplosionDamage({
            target: {
              connectionEpoch: "00000000-0000-0000-0000-000000000001",
              networkId: 42,
            },
            center: {
              dimension: "minecraft:overworld",
              x: 10,
              y: 64,
              z: -3,
            },
            power: 6,
          });
          expect(received).toMatchObject({
            instanceId: "instance-id",
            botId: "bot-id",
            target: { networkId: 42 },
            power: 6,
          });
          expect(estimate.rawDamage).toBe(35);
          expect(estimate.estimatedHealthDamage).toBeCloseTo(6.08);
          expect(estimate.explosionProtection).toBe(10);
        }),
      ),
    ));
});
