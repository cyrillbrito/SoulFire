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
package com.soulfiremc.server.task;

import com.soulfiremc.server.bot.BotConnection;
import com.soulfiremc.server.bot.ControlPriority;
import com.soulfiremc.server.bot.ControlResource;
import com.soulfiremc.server.bot.ControlStopReason;
import com.soulfiremc.server.bot.ControlTask;
import com.soulfiremc.server.util.SFInventoryHelpers;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.InventoryMenu;
import net.minecraft.world.item.ItemStack;
import org.checkerframework.checker.nullness.qual.Nullable;

import java.util.OptionalInt;
import java.util.Set;
import java.util.function.Predicate;

public final class TaskInventorySupport {
  private static final int INVENTORY_SYNC_TICKS = 2;

  private TaskInventorySupport() {
  }

  static OptionalInt findInventorySlot(
    BotConnection bot,
    Predicate<ItemStack> selector
  ) {
    var player = bot.minecraft().player;
    if (player == null) {
      return OptionalInt.empty();
    }

    return SFInventoryHelpers.findMatchingSlotForAction(
      player.getInventory(),
      player.inventoryMenu,
      selector
    );
  }

  static boolean ensureHolding(
    BotConnection bot,
    Predicate<ItemStack> selector
  ) {
    var player = bot.minecraft().player;
    var gameMode = bot.minecraft().gameMode;
    if (player == null || gameMode == null) {
      return false;
    }
    if (selector.test(player.getMainHandItem())) {
      return true;
    }

    var slot = SFInventoryHelpers.findMatchingSlotForAction(
      player.getInventory(),
      player.inventoryMenu,
      selector
    );
    if (slot.isEmpty()) {
      return false;
    }

    var inventorySlot = slot.getAsInt();
    if (SFInventoryHelpers.isSelectableHotbarSlot(inventorySlot)) {
      player.getInventory().setSelectedSlot(
        SFInventoryHelpers.toHotbarIndex(inventorySlot)
      );
      return true;
    }
    if (player.hasContainerOpen()) {
      return false;
    }

    if (inventorySlot == InventoryMenu.SHIELD_SLOT) {
      // Through an empty hotbar slot: a swap with the held one would put
      // what you hold into the off-hand.
      var hotbar = SFInventoryHelpers.hotbarForSwapIn(player.getInventory());
      swapWithHotbar(bot, inventorySlot, hotbar);
      player.getInventory().setSelectedSlot(hotbar);
    } else {
      swapWithSelectedHotbar(bot, inventorySlot);
    }
    return selector.test(player.getMainHandItem());
  }

  public static ControlTask swapSlotsViaSelectedHotbar(
    BotConnection bot,
    String description,
    ControlPriority priority,
    Set<ControlResource> resources,
    int firstSlot,
    int secondSlot
  ) {
    return new PacedInventorySwapTask(
      bot,
      description,
      priority,
      resources,
      firstSlot,
      secondSlot
    );
  }

  static void swapWithSelectedHotbar(BotConnection bot, int slot) {
    var player = bot.minecraft().player;
    if (player == null) {
      throw new IllegalStateException(
        "Bot player is unavailable"
      );
    }
    swapWithHotbar(bot, slot, player.getInventory().getSelectedSlot());
  }

  static void swapWithHotbar(
    BotConnection bot,
    int slot,
    int hotbar
  ) {
    withPlayerInventory(bot, (player, gameMode) ->
      swapWithHotbar(
        player,
        gameMode,
        slot,
        hotbar
      ));
  }

  private static void withPlayerInventory(
    BotConnection bot,
    InventoryOperation operation
  ) {
    var player = bot.minecraft().player;
    var gameMode = bot.minecraft().gameMode;
    if (player == null || gameMode == null) {
      throw new IllegalStateException(
        "Bot player or game mode is unavailable"
      );
    }
    if (player.hasContainerOpen()) {
      throw new IllegalStateException(
        "The bot already has a container open"
      );
    }
    if (!player.inventoryMenu.getCarried().isEmpty()) {
      throw new IllegalStateException(
        "The bot must not be carrying an item on the inventory cursor"
      );
    }

    player.sendOpenInventory();
    try {
      operation.run(player, gameMode);
      if (!player.inventoryMenu.getCarried().isEmpty()) {
        throw new IllegalStateException(
          "Inventory swap left an item on the inventory cursor"
        );
      }
    } finally {
      player.closeContainer();
    }
  }

  private static void swapWithHotbar(
    LocalPlayer player,
    MultiPlayerGameMode gameMode,
    int slot,
    int hotbar
  ) {
    gameMode.handleContainerInput(
      player.inventoryMenu.containerId,
      slot,
      hotbar,
      ContainerInput.SWAP,
      player
    );
  }

  private static final class PacedInventorySwapTask
    implements ControlTask {
    private final BotConnection bot;
    private final String taskDescription;
    private final ControlPriority taskPriority;
    private final Set<ControlResource> taskResources;
    private final int firstSlot;
    private final int secondSlot;
    private int selectedHotbar;
    private int currentStep;
    private int waitTicks;
    private boolean inventoryOpened;
    private boolean done;

    private PacedInventorySwapTask(
      BotConnection bot,
      String taskDescription,
      ControlPriority taskPriority,
      Set<ControlResource> taskResources,
      int firstSlot,
      int secondSlot
    ) {
      this.bot = bot;
      this.taskDescription = taskDescription;
      this.taskPriority = taskPriority;
      this.taskResources = Set.copyOf(taskResources);
      this.firstSlot = firstSlot;
      this.secondSlot = secondSlot;
    }

    @Override
    public void tick() {
      if (done || waitTicks-- > 0) {
        return;
      }
      var player = bot.minecraft().player;
      var gameMode = bot.minecraft().gameMode;
      if (player == null || gameMode == null) {
        throw new IllegalStateException(
          "Bot player or game mode is unavailable"
        );
      }

      switch (currentStep) {
        case 0 -> openInventory(player);
        case 1 -> swapWithHotbar(
          player,
          gameMode,
          firstSlot,
          selectedHotbar
        );
        case 2 -> swapWithHotbar(
          player,
          gameMode,
          secondSlot,
          selectedHotbar
        );
        case 3 -> swapWithHotbar(
          player,
          gameMode,
          firstSlot,
          selectedHotbar
        );
        case 4 -> finish(player);
        default -> throw new IllegalStateException(
          "Unknown inventory swap step: " + currentStep
        );
      }
      currentStep++;
      waitTicks = INVENTORY_SYNC_TICKS;
    }

    private void openInventory(LocalPlayer player) {
      if (player.hasContainerOpen()) {
        throw new IllegalStateException(
          "The bot already has a container open"
        );
      }
      if (!player.inventoryMenu.getCarried().isEmpty()) {
        throw new IllegalStateException(
          "The bot must not be carrying an item on the inventory cursor"
        );
      }
      selectedHotbar = player.getInventory().getSelectedSlot();
      player.sendOpenInventory();
      inventoryOpened = true;
    }

    private void finish(LocalPlayer player) {
      try {
        if (!player.inventoryMenu.getCarried().isEmpty()) {
          throw new IllegalStateException(
            "Inventory swap left an item on the inventory cursor"
          );
        }
      } finally {
        closeInventory(player);
      }
      done = true;
    }

    private void closeInventory(LocalPlayer player) {
      if (inventoryOpened) {
        inventoryOpened = false;
        player.closeContainer();
      }
    }

    @Override
    public boolean isDone() {
      return done;
    }

    @Override
    public ControlPriority priority() {
      return taskPriority;
    }

    @Override
    public Set<ControlResource> resources() {
      return taskResources;
    }

    @Override
    public void onStopped(
      ControlStopReason reason,
      @Nullable Throwable cause
    ) {
      var player = bot.minecraft().player;
      if (player != null) {
        closeInventory(player);
      }
      done = true;
    }

    @Override
    public String description() {
      return taskDescription;
    }
  }

  @FunctionalInterface
  private interface InventoryOperation {
    void run(
      LocalPlayer player,
      MultiPlayerGameMode gameMode
    );
  }
}
