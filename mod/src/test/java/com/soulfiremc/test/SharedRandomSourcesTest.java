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
package com.soulfiremc.test;

import com.soulfiremc.test.utils.TestBootstrap;
import net.minecraft.client.particle.SpellParticle;
import net.minecraft.client.resources.SplashManager;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.block.entity.EnchantingTableBlockEntity;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertTrue;

class SharedRandomSourcesTest {
  @Test
  void sharedSourcesSupportConcurrentDraws() throws Exception {
    for (var target : List.of(EnchantingTableBlockEntity.class, SpellParticle.class, SplashManager.class)) {
      var type = Class.forName(target.getName(), true, TestBootstrap.testClassLoader());
      var field = Arrays.stream(type.getDeclaredFields())
        .filter(candidate -> Modifier.isStatic(candidate.getModifiers())
          && RandomSource.class.isAssignableFrom(candidate.getType()))
        .findFirst().orElseThrow();
      field.setAccessible(true);
      var random = (RandomSource) field.get(null);
      var ready = new CountDownLatch(8);
      var start = new CountDownLatch(1);
      try (var executor = Executors.newFixedThreadPool(8)) {
        var tasks = IntStream.range(0, 8).mapToObj(_ -> executor.submit(() -> {
          ready.countDown();
          assertTrue(start.await(10, TimeUnit.SECONDS));
          for (var draw = 0; draw < 10_000; draw++) {
            random.nextInt(40);
            random.nextDouble();
          }
          return null;
        })).toList();
        try {
          assertTrue(ready.await(10, TimeUnit.SECONDS));
        } finally {
          start.countDown();
        }
        for (var task : tasks) {
          task.get(10, TimeUnit.SECONDS);
        }
      }
    }
  }
}
