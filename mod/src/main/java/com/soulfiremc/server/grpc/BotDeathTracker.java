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

import com.soulfiremc.grpc.generated.BotLifecycleKind;
import net.minecraft.client.player.LocalPlayer;
import org.checkerframework.checker.nullness.qual.Nullable;

/// Whether a bot is dead, for the lifecycle events of one event stream.
///
/// Two signals feed it: the kill packet (network thread) and the player's health on each tick
/// (game thread). The kill packet is the one that is always there: with auto respawn the bot can
/// be alive again before the next tick looks. The health can drop a server tick after the kill
/// packet, so the killed player stays dead until a respawn replaces it. Players are compared by
/// identity: a respawn makes a new player object with the same entity id.
final class BotDeathTracker {
  /// Null until the first tick
  private @Nullable Boolean dead;
  private @Nullable LocalPlayer killedPlayer;

  /// A kill packet for this player.
  ///
  /// @return whether to report the death (not reported yet)
  synchronized boolean onKill(LocalPlayer player) {
    killedPlayer = player;
    var alreadyDead = Boolean.TRUE.equals(dead);
    dead = true;
    return !alreadyDead;
  }

  /// A tick, with the current player.
  ///
  /// @return the change to report, or null (none, or the first tick)
  synchronized @Nullable BotLifecycleKind onTick(LocalPlayer player) {
    if (killedPlayer != player) {
      killedPlayer = null;
    }
    var nowDead = player.isDeadOrDying() || killedPlayer != null;
    var previous = dead;
    dead = nowDead;
    if (previous == null || previous == nowDead) {
      return null;
    }
    return nowDead ? BotLifecycleKind.BOT_LIFECYCLE_DIED : BotLifecycleKind.BOT_LIFECYCLE_RESPAWNED;
  }

  /// The bot connected again or disconnected.
  synchronized void reset() {
    dead = null;
    killedPlayer = null;
  }
}
