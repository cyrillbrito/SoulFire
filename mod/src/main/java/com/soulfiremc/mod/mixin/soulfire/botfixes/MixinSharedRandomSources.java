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
package com.soulfiremc.mod.mixin.soulfire.botfixes;

import net.minecraft.client.particle.SpellParticle;
import net.minecraft.client.resources.SplashManager;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.block.entity.EnchantingTableBlockEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/// Bots use these static random sources concurrently while ticking their separate client worlds.
/// Create thread-safe sources so animations and splash selection retain their own random streams.
@Mixin({
  EnchantingTableBlockEntity.class,
  SpellParticle.class,
  SplashManager.class
})
public class MixinSharedRandomSources {
  @Redirect(
    method = "<clinit>",
    at = @At(
      value = "INVOKE",
      target = "Lnet/minecraft/util/RandomSource;"
        + "create()Lnet/minecraft/util/RandomSource;"
    )
  )
  private static RandomSource createSharedRandom() {
    return RandomSource.createThreadSafe();
  }
}
