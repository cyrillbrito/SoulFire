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
package com.soulfiremc.server.grpc;

import net.minecraft.client.player.LocalPlayer;
import org.junit.jupiter.api.Test;

import static com.soulfiremc.grpc.generated.BotLifecycleKind.BOT_LIFECYCLE_DIED;
import static com.soulfiremc.grpc.generated.BotLifecycleKind.BOT_LIFECYCLE_RESPAWNED;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

final class BotDeathTrackerTest {
  private final LocalPlayer player = mock(LocalPlayer.class);
  // A respawn replaces the player with a new one
  private final LocalPlayer respawnedPlayer = mock(LocalPlayer.class);

  private void setDying(boolean dying) {
    when(player.isDeadOrDying()).thenReturn(dying);
  }

  @Test
  void reportsADeathSeenOnlyByTheHealth() {
    var tracker = new BotDeathTracker();
    assertNull(tracker.onTick(player));

    setDying(true);
    assertEquals(BOT_LIFECYCLE_DIED, tracker.onTick(player));
    assertNull(tracker.onTick(player));
    assertEquals(BOT_LIFECYCLE_RESPAWNED, tracker.onTick(respawnedPlayer));
  }

  @Test
  void reportsAKillOnceWhenTheBotRespawnsBeforeTheNextTick() {
    var tracker = new BotDeathTracker();
    assertNull(tracker.onTick(player));

    assertTrue(tracker.onKill(player));
    assertFalse(tracker.onKill(player));
    assertEquals(BOT_LIFECYCLE_RESPAWNED, tracker.onTick(respawnedPlayer));
  }

  @Test
  void keepsTheKilledPlayerDeadUntilItIsReplaced() {
    var tracker = new BotDeathTracker();
    assertNull(tracker.onTick(player));

    assertTrue(tracker.onKill(player));
    // The health drop comes a server tick after the kill packet
    assertNull(tracker.onTick(player));
    setDying(true);
    assertNull(tracker.onTick(player));
    assertEquals(BOT_LIFECYCLE_RESPAWNED, tracker.onTick(respawnedPlayer));
  }

  @Test
  void doesNotReportADeathTheTickAlreadyReported() {
    var tracker = new BotDeathTracker();
    assertNull(tracker.onTick(player));

    setDying(true);
    assertEquals(BOT_LIFECYCLE_DIED, tracker.onTick(player));
    assertFalse(tracker.onKill(player));
  }

  @Test
  void firstTickOnlyRecordsTheState() {
    var tracker = new BotDeathTracker();

    setDying(true);
    assertNull(tracker.onTick(player));
    assertEquals(BOT_LIFECYCLE_RESPAWNED, tracker.onTick(respawnedPlayer));
  }
}
