/*
 * SoulFire
 * Copyright (C) 2026  AlexProgrammerDE
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
package com.soulfiremc.server.pathfinding.graph.actions;

import com.soulfiremc.server.pathfinding.SFVec3i;
import com.soulfiremc.server.pathfinding.cost.Costs;
import com.soulfiremc.server.pathfinding.execution.GapJumpAction;
import com.soulfiremc.server.pathfinding.graph.GraphInstructions;
import com.soulfiremc.server.pathfinding.graph.MinecraftGraph;
import com.soulfiremc.server.pathfinding.graph.actions.movement.ActionDirection;
import com.soulfiremc.server.util.SFBlockHelpers;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import net.minecraft.world.level.block.state.BlockState;

import java.util.Collections;
import java.util.List;
import java.util.function.Consumer;

public final class ParkourMovement extends GraphAction implements Cloneable {
  private static final SFVec3i FEET_POSITION_RELATIVE_BLOCK = SFVec3i.ZERO;
  private static final int MAX_GAP_LENGTH = 3;
  private final ParkourDirection direction;
  private final int gapLength;
  private final SFVec3i targetFeetBlock;
  // Mutable
  private boolean landsOnFarmland;

  private ParkourMovement(ParkourDirection direction, int gapLength, SubscriptionConsumer blockSubscribers) {
    super(direction.actionDirection);
    this.direction = direction;
    this.gapLength = gapLength;

    var targetFeetBlock = FEET_POSITION_RELATIVE_BLOCK;
    for (var i = 0; i < gapLength + 1; i++) {
      targetFeetBlock = direction.offset(targetFeetBlock);
    }
    this.targetFeetBlock = targetFeetBlock;

    this.registerRequiredFreeBlocks(blockSubscribers);
    this.registerRequiredUnsafeBlock(blockSubscribers);
    this.registerRequiredSolidBlock(blockSubscribers);
  }

  public static void registerParkourMovements(Consumer<GraphAction> callback, SubscriptionConsumer blockSubscribers) {
    for (var direction : ParkourDirection.VALUES) {
      for (var gapLength = 1; gapLength <= MAX_GAP_LENGTH; gapLength++) {
        callback.accept(new ParkourMovement(direction, gapLength, blockSubscribers));
      }
    }
  }

  private void registerRequiredFreeBlocks(SubscriptionConsumer blockSubscribers) {
    // Make block above the head block free for jump
    blockSubscribers.subscribe(FEET_POSITION_RELATIVE_BLOCK.add(0, 2, 0), MovementFreeSubscription.INSTANCE);

    var current = FEET_POSITION_RELATIVE_BLOCK;
    for (var i = 0; i < gapLength + 1; i++) {
      current = direction.offset(current);
      blockSubscribers.subscribe(current, MovementFreeSubscription.INSTANCE);
      blockSubscribers.subscribe(current.add(0, 1, 0), MovementFreeSubscription.INSTANCE);
      blockSubscribers.subscribe(current.add(0, 2, 0), MovementFreeSubscription.INSTANCE);
    }

    // Long jumps retain forward momentum after landing. Keep the two body
    // cells beyond the landing clear so execution cannot hit a wall and fall
    // back into the gap.
    var overshoot = direction.offset(targetFeetBlock);
    blockSubscribers.subscribe(overshoot, MovementFreeSubscription.INSTANCE);
    blockSubscribers.subscribe(
      overshoot.add(0, 1, 0),
      MovementFreeSubscription.INSTANCE
    );
  }

  private void registerRequiredUnsafeBlock(SubscriptionConsumer blockSubscribers) {
    var current = FEET_POSITION_RELATIVE_BLOCK;
    for (var i = 0; i < gapLength; i++) {
      current = direction.offset(current);
      blockSubscribers.subscribe(current.sub(0, 1, 0), ParkourUnsafeToStandOnSubscription.INSTANCE);
    }
  }

  private void registerRequiredSolidBlock(SubscriptionConsumer blockSubscribers) {
    // Floor block
    blockSubscribers.subscribe(targetFeetBlock.sub(0, 1, 0), MovementSolidSubscription.INSTANCE);
  }

  @Override
  public List<GraphInstructions> getInstructions(MinecraftGraph graph, SFVec3i node) {
    if (
      gapLength > graph.pathConstraint().maximumParkourGap()
        || !hasRecoverableFailureSurface(graph, node)
    ) {
      return Collections.emptyList();
    }
    var absoluteTargetFeetBlock = node.add(targetFeetBlock);

    return Collections.singletonList(new GraphInstructions(
      absoluteTargetFeetBlock,
      0,
      false,
      actionDirection,
      Costs.gapJumpCost(gapLength) + (landsOnFarmland ? Costs.TRAMPLE_FARMLAND : 0),
      List.of(new GapJumpAction(node, absoluteTargetFeetBlock))
    ));
  }

  private boolean hasRecoverableFailureSurface(
    MinecraftGraph graph,
    SFVec3i node
  ) {
    var gapFeet = node;
    for (var gapStep = 1; gapStep <= gapLength; gapStep++) {
      gapFeet = direction.offset(gapFeet);
      var recoverable = false;
      for (
        var fallDistance = 1;
        fallDistance <= graph.pathConstraint().maximumFallDistance();
        fallDistance++
      ) {
        var floor = gapFeet.sub(0, fallDistance + 1, 0);
        if (
          SFBlockHelpers.isStableWalkableFloorBlock(
            graph.snapshot().blockAccessor(),
            floor.toBlockPos(),
            graph.snapshot().blockState(floor)
          )
            && SFBlockHelpers.isBlockFree(
            graph.snapshot().blockState(floor.add(0, 1, 0))
          )
            && SFBlockHelpers.isBlockFree(
            graph.snapshot().blockState(floor.add(0, 2, 0))
          )
        ) {
          recoverable = true;
          break;
        }
      }
      if (!recoverable) {
        return false;
      }
    }
    return true;
  }

  @Override
  public ParkourMovement copy() {
    return this.clone();
  }

  @Override
  public ParkourMovement clone() {
    try {
      return (ParkourMovement) super.clone();
    } catch (CloneNotSupportedException _) {
      throw new InternalError();
    }
  }

  @Getter
  @RequiredArgsConstructor
  public enum ParkourDirection {
    NORTH(new SFVec3i(0, 0, -1), ActionDirection.NORTH),
    SOUTH(new SFVec3i(0, 0, 1), ActionDirection.SOUTH),
    EAST(new SFVec3i(1, 0, 0), ActionDirection.EAST),
    WEST(new SFVec3i(-1, 0, 0), ActionDirection.WEST);

    public static final ParkourDirection[] VALUES = values();
    private final SFVec3i offsetVector;
    private final ActionDirection actionDirection;

    public SFVec3i offset(SFVec3i vector) {
      return vector.add(offsetVector);
    }
  }

  private interface ParkourMovementSubscription extends MinecraftGraph.MovementSubscription<ParkourMovement> {
  }

  private record MovementFreeSubscription() implements ParkourMovementSubscription {
    private static final MovementFreeSubscription INSTANCE = new MovementFreeSubscription();

    @Override
    public MinecraftGraph.SubscriptionSingleResult processBlock(MinecraftGraph graph, SFVec3i key, ParkourMovement parkourMovement,
                                                                BlockState blockState, SFVec3i absoluteKey) {
      if (SFBlockHelpers.isBlockFree(blockState)) {
        return MinecraftGraph.SubscriptionSingleResult.CONTINUE;
      }

      return MinecraftGraph.SubscriptionSingleResult.IMPOSSIBLE;
    }
  }

  private record ParkourUnsafeToStandOnSubscription() implements ParkourMovementSubscription {
    private static final ParkourUnsafeToStandOnSubscription INSTANCE = new ParkourUnsafeToStandOnSubscription();

    @Override
    public MinecraftGraph.SubscriptionSingleResult processBlock(MinecraftGraph graph, SFVec3i key, ParkourMovement parkourMovement,
                                                                BlockState blockState, SFVec3i absoluteKey) {
      // A failed jump over fluid turns a recoverable detour into a drowning
      // hazard. Water and lava have dedicated movement support, so route
      // through or around them instead of treating them as parkour gaps.
      if (!blockState.getFluidState().isEmpty()) {
        return MinecraftGraph.SubscriptionSingleResult.IMPOSSIBLE;
      }

      // We only want to jump over dangerous blocks/gaps
      // such as air gaps, magma, or other unsafe floor blocks.
      if (SFBlockHelpers.isStableWalkableFloorBlock(
        graph.snapshot().blockAccessor(),
        absoluteKey.toBlockPos(),
        blockState
      )) {
        return MinecraftGraph.SubscriptionSingleResult.IMPOSSIBLE;
      }

      return MinecraftGraph.SubscriptionSingleResult.CONTINUE;
    }
  }

  private record MovementSolidSubscription() implements ParkourMovementSubscription {
    private static final MovementSolidSubscription INSTANCE = new MovementSolidSubscription();

    @Override
    public MinecraftGraph.SubscriptionSingleResult processBlock(MinecraftGraph graph, SFVec3i key, ParkourMovement parkourMovement,
                                                                BlockState blockState, SFVec3i absoluteKey) {
      // Block is safe to walk on, no need to check for more
      if (SFBlockHelpers.isStableWalkableFloorBlock(
        graph.snapshot().blockAccessor(),
        absoluteKey.toBlockPos(),
        blockState
      )) {
        // Landing a jump on farmland can trample it
        parkourMovement.landsOnFarmland = SFBlockHelpers.breaksWhenFallenOn(blockState);
        return MinecraftGraph.SubscriptionSingleResult.CONTINUE;
      }

      return MinecraftGraph.SubscriptionSingleResult.IMPOSSIBLE;
    }
  }
}
