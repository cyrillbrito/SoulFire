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
package com.soulfiremc.server.util;

import com.soulfiremc.test.utils.TestBootstrap;
import net.minecraft.core.Holder;
import net.minecraft.core.component.DataComponentMap;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

final class SFInventoryHelpersTest {
  @BeforeAll
  static void setup() {
    TestBootstrap.bootstrapForTest();
  }

  private static List<ItemStack> hotbar(int... filled) {
    var hotbar = new ArrayList<ItemStack>();
    for (var i = 0; i < 9; i++) {
      hotbar.add(ItemStack.EMPTY);
    }
    for (var i : filled) {
      hotbar.set(i, new ItemStack(Holder.direct(Items.BIRCH_LOG, DataComponentMap.EMPTY), 1));
    }
    return hotbar;
  }

  @Test
  void anItemFromTheOffHandComesInThroughAnEmptyHotbarSlot() {
    // An empty held slot takes it; else another empty one, so the held item
    // isn't swapped into the off-hand; only a full hotbar leaves no choice.
    assertEquals(2, SFInventoryHelpers.hotbarForSwapIn(hotbar(0, 1), 2));
    assertEquals(2, SFInventoryHelpers.hotbarForSwapIn(hotbar(0, 1), 0));
    assertEquals(4, SFInventoryHelpers.hotbarForSwapIn(hotbar(0, 1, 2, 3, 5, 6, 7, 8), 0));
    assertEquals(3, SFInventoryHelpers.hotbarForSwapIn(hotbar(0, 1, 2, 3, 4, 5, 6, 7, 8), 3));
  }
}
