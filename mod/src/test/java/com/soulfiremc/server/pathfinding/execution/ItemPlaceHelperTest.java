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

import com.soulfiremc.test.utils.TestBootstrap;
import com.soulfiremc.test.utils.TestPathConstraint;
import net.minecraft.core.Holder;
import net.minecraft.core.component.DataComponentMap;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class ItemPlaceHelperTest {
  private static ItemStack itemStack(Item item) {
    return new ItemStack(Holder.direct(item, DataComponentMap.EMPTY), 1);
  }

  @BeforeAll
  static void bootstrapMinecraft() {
    TestBootstrap.bootstrapForTest();
  }

  @Test
  void reportsWhenNoPathBuildingBlockIsAvailableYet() {
    var selected = ItemPlaceHelper.selectBestPathBuildingItem(
      List.of(itemStack(Items.OAK_STAIRS)),
      TestPathConstraint.INSTANCE
    );

    assertTrue(selected.isEmpty());
  }

  @Test
  void selectsADisposablePathBuildingBlockWhenItArrives() {
    var selected = ItemPlaceHelper.selectBestPathBuildingItem(
      List.of(
        itemStack(Items.OAK_STAIRS),
        itemStack(Items.COBBLESTONE)
      ),
      TestPathConstraint.INSTANCE
    );

    assertEquals(Items.COBBLESTONE, selected.orElseThrow());
  }

  /// The player menu, all empty: 0 craft result, 1-4 grid, 5-8 armor, 9-35
  /// inventory, 36-44 hotbar, 45 off-hand.
  private static List<ItemStack> emptyMenu() {
    var menu = new ArrayList<ItemStack>();
    for (var i = 0; i < 46; i++) {
      menu.add(ItemStack.EMPTY);
    }
    return menu;
  }

  /// Every item mines at hand speed except an axe, which is faster.
  private static int ticks(ItemStack stack) {
    return stack.is(Items.IRON_AXE) ? 5 : 30;
  }

  @Test
  void anEmptyHandIsAnEmptyHotbarSlotNeverTheOffHand() {
    // Holding logs, breaking leaves: nothing beats the bare hand. Taking the
    // empty off-hand as "the empty hand" swapped the logs into it.
    var menu = emptyMenu();
    menu.set(36, itemStack(Items.BIRCH_LOG));

    var slot = ItemPlaceHelper.bestToolSlot(menu, 36, ItemPlaceHelperTest::ticks);

    assertEquals(37, slot);
  }

  @Test
  void aFullHotbarGivesAnEmptyInventorySlotAndAFullInventoryKeepsTheHeldItem() {
    var menu = emptyMenu();
    for (var slot = 36; slot <= 44; slot++) {
      menu.set(slot, itemStack(Items.BIRCH_LOG));
    }
    assertEquals(9, ItemPlaceHelper.bestToolSlot(menu, 40, ItemPlaceHelperTest::ticks));

    for (var slot = 9; slot <= 35; slot++) {
      menu.set(slot, itemStack(Items.DIRT));
    }
    assertEquals(40, ItemPlaceHelper.bestToolSlot(menu, 40, ItemPlaceHelperTest::ticks));
  }

  @Test
  void aFasterToolIsTakenFromTheInventoryButNotFromTheOffHand() {
    var menu = emptyMenu();
    menu.set(36, itemStack(Items.BIRCH_LOG));
    menu.set(20, itemStack(Items.IRON_AXE));
    assertEquals(20, ItemPlaceHelper.bestToolSlot(menu, 36, ItemPlaceHelperTest::ticks));

    menu.set(20, ItemStack.EMPTY);
    menu.set(45, itemStack(Items.IRON_AXE));
    assertNotEquals(45, ItemPlaceHelper.bestToolSlot(menu, 36, ItemPlaceHelperTest::ticks));
  }

  @Test
  void theHeldToolWinsATie() {
    var menu = emptyMenu();
    menu.set(38, itemStack(Items.IRON_AXE));
    menu.set(36, itemStack(Items.IRON_AXE));

    assertEquals(38, ItemPlaceHelper.bestToolSlot(menu, 38, ItemPlaceHelperTest::ticks));
  }
}
