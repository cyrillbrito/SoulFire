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

import net.minecraft.core.BlockPos;
import net.minecraft.world.phys.Vec3;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SleepTaskProviderTest {
  private static final BlockPos BED = new BlockPos(10, 64, 10);

  @Test
  void acceptsPositionsNextToTheBed() {
    assertTrue(SleepTaskProvider.inSleepRange(new Vec3(10.5, 64, 10.5), BED));
    assertTrue(SleepTaskProvider.inSleepRange(new Vec3(12.5, 64, 8.5), BED));
    assertTrue(SleepTaskProvider.inSleepRange(new Vec3(13, 65.5, 10.5), BED));
  }

  @Test
  void rejectsPositionsTheServerWouldCallTooFarAway() {
    // Within the old 4-block radius of the bed's center, but more than 3
    // blocks from its bottom center on one axis.
    assertFalse(SleepTaskProvider.inSleepRange(new Vec3(14.4, 64, 10.5), BED));
    assertFalse(SleepTaskProvider.inSleepRange(new Vec3(10.5, 64, 6.6), BED));
    // Too high or too low.
    assertFalse(SleepTaskProvider.inSleepRange(new Vec3(10.5, 66.5, 10.5), BED));
    assertFalse(SleepTaskProvider.inSleepRange(new Vec3(10.5, 62, 10.5), BED));
  }
}
