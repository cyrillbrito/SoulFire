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
package com.soulfiremc.server.pathfinding.execution;

import com.soulfiremc.server.bot.BotConnection;
import com.soulfiremc.server.pathfinding.SFVec3i;
import com.soulfiremc.server.pathfinding.cost.Costs;
import com.soulfiremc.server.pathfinding.graph.constraint.PathConstraint;
import com.soulfiremc.server.util.BlockItems;
import com.soulfiremc.server.util.SFInventoryHelpers;
import com.soulfiremc.server.util.SFItemHelpers;
import lombok.extern.slf4j.Slf4j;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.InventoryMenu;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Blocks;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.ToIntFunction;

@Slf4j
public final class ItemPlaceHelper {
  private ItemPlaceHelper() {
  }

  public static Optional<SelectedPlacementItem> placeBestBlockInHand(
    BotConnection connection,
    PathConstraint pathConstraint
  ) {
    var player = connection.minecraft().player;
    var playerInventory = player.inventoryMenu;

    var bestItem = selectBestPathBuildingItem(
      playerInventory.slots.stream().map(slot -> slot.getItem()).toList(),
      pathConstraint
    );
    if (bestItem.isEmpty()) {
      return Optional.empty();
    }

    var selectedItem = bestItem.orElseThrow();
    var slot = SFInventoryHelpers.findMatchingSlotForAction(player.getInventory(), playerInventory,
        candidate -> candidate.getItem() == selectedItem)
      .orElseThrow(() -> new IllegalStateException("Failed to find item stack to use"));
    if (slot == InventoryMenu.SHIELD_SLOT) {
      return Optional.of(new SelectedPlacementItem(
        InteractionHand.OFF_HAND,
        selectedItem
      ));
    }
    placeInHand(connection.minecraft().gameMode, player, slot);
    return Optional.of(new SelectedPlacementItem(
      InteractionHand.MAIN_HAND,
      selectedItem
    ));
  }

  public record SelectedPlacementItem(
    InteractionHand hand,
    Item item
  ) {
    public boolean isReady(LocalPlayer player, PathConstraint constraint) {
      var held = player.getItemInHand(hand);
      return held.getItem() == item && constraint.isPlaceable(held);
    }
  }

  static Optional<Item> selectBestPathBuildingItem(
    Iterable<ItemStack> items,
    PathConstraint pathConstraint
  ) {
    Item bestItem = null;
    var bestPriority = Integer.MAX_VALUE;
    var bestDestroyTime = 0F;
    for (var slotItemStack : items) {
      if (
        slotItemStack.isEmpty()
          || !pathConstraint.isPlaceable(slotItemStack)
      ) {
        continue;
      }

      var slotItem = slotItemStack.getItem();
      var blockType = BlockItems.getBlock(slotItem);
      if (blockType.isEmpty()) {
        continue;
      }

      var destroyTime = blockType.get().defaultDestroyTime();
      var priority = SFItemHelpers.isDisposableFullBlockItem(slotItemStack)
        ? 0
        : 1;
      if (
        bestItem == null
          || priority < bestPriority
          || (
            priority == bestPriority
              && destroyTime < bestDestroyTime
          )
      ) {
        bestItem = slotItem;
        bestPriority = priority;
        bestDestroyTime = destroyTime;
      }
    }

    return Optional.ofNullable(bestItem);
  }

  public static boolean placeBestToolInHand(BotConnection connection, SFVec3i blockPosition) {
    var player = connection.minecraft().player;
    var level = connection.minecraft().level;
    var blockState = level.getBlockState(blockPosition.toBlockPos());
    if (blockState.getBlock() == Blocks.VOID_AIR) {
      throw new IllegalStateException("Block at %s is not loaded".formatted(blockPosition));
    }

    var slot = bestToolSlot(
      player.inventoryMenu.slots.stream().map(Slot::getItem).toList(),
      SFInventoryHelpers.getSelectedSlot(player.getInventory()),
      stack -> Costs.getRequiredMiningTicks(player, stack, blockState).ticks()
    );
    placeInHand(connection.minecraft().gameMode, player, slot);
    return true;
  }

  /// The player-menu slot to hold for mining (`menuItems` indexed like the
  /// player menu, `selectedSlot` the held hotbar slot in it): the fastest item
  /// in the hotbar or the inventory, else an empty hand, else what is held (a
  /// full inventory: anything that isn't a faster tool mines at hand speed).
  /// An empty slot beats a tool that is no faster, to spare its durability.
  ///
  /// Never the off-hand, the armor or the crafting grid. Taking the off-hand
  /// (even an empty one, as "the empty hand") swaps what you hold into it:
  /// the logs you were chopping, which every log picked up after then tops
  /// up, out of reach of deposits.
  static int bestToolSlot(
    List<ItemStack> menuItems,
    int selectedSlot,
    ToIntFunction<ItemStack> miningTicks
  ) {
    var candidates = mainHandCandidates(selectedSlot);
    var bestSlot = -1;
    var bestCost = miningTicks.applyAsInt(ItemStack.EMPTY);
    for (var slot : candidates) {
      var stack = menuItems.get(slot);
      if (stack.isEmpty()) {
        continue;
      }
      var cost = miningTicks.applyAsInt(stack);
      if (cost < bestCost) {
        bestCost = cost;
        bestSlot = slot;
      }
    }
    if (bestSlot >= 0) {
      return bestSlot;
    }
    for (var slot : candidates) {
      if (menuItems.get(slot).isEmpty()) {
        return slot;
      }
    }
    return selectedSlot;
  }

  /// The slots an item for the main hand is taken from, in order: the held
  /// one, the rest of the hotbar, the inventory.
  private static List<Integer> mainHandCandidates(int selectedSlot) {
    var slots = new ArrayList<Integer>();
    slots.add(selectedSlot);
    for (var slot = InventoryMenu.USE_ROW_SLOT_START; slot < InventoryMenu.USE_ROW_SLOT_END; slot++) {
      if (slot != selectedSlot) {
        slots.add(slot);
      }
    }
    for (var slot = InventoryMenu.INV_SLOT_START; slot < InventoryMenu.INV_SLOT_END; slot++) {
      slots.add(slot);
    }
    return slots;
  }

  private static void placeInHand(MultiPlayerGameMode gameMode, LocalPlayer player, int slot) {
    if (player.hasContainerOpen()) {
      log.debug("Closing foreign container before selecting a pathfinding item");
      player.closeContainer();
    }

    if (SFInventoryHelpers.getSelectedSlot(player.getInventory()) == slot) {
      return;
    } else if (SFInventoryHelpers.isSelectableHotbarSlot(slot)) {
      player.getInventory().setSelectedSlot(SFInventoryHelpers.toHotbarIndex(slot));
    } else {
      player.sendOpenInventory();
      gameMode.handleContainerInput(
        player.inventoryMenu.containerId,
        slot,
        player.getInventory().getSelectedSlot(),
        ContainerInput.SWAP,
        player
      );
      player.closeContainer();
    }
  }
}
