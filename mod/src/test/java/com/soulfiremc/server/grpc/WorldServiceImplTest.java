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

import com.soulfiremc.grpc.generated.QuerySort;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import net.minecraft.core.BlockPos;
import net.minecraft.world.phys.Vec3;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class WorldServiceImplTest {
  private static final List<QuerySort> SORTS = List.of(QuerySort.QUERY_SORT_UNSPECIFIED,
    QuerySort.QUERY_SORT_NEAREST, QuerySort.QUERY_SORT_FARTHEST, QuerySort.QUERY_SORT_XYZ);
  private static final WorldServiceImpl.QueryBounds BOX = new WorldServiceImpl.QueryBounds(
    -8, 58, -8, 8, 70, 8, new Vec3(0.5, 64.5, 0.5), Double.POSITIVE_INFINITY);
  /// A sphere of radius 9 around (0.3, 64.6, 0.8), bounded as WorldServiceImpl.bounds does it.
  private static final WorldServiceImpl.QueryBounds SPHERE = new WorldServiceImpl.QueryBounds(
    -9, 55, -9, 10, 74, 10, new Vec3(0.3, 64.6, 0.8), 81);

  @Test
  void armorReductionUsesVanillaDamageDependentFloor() {
    assertEquals(
      12.0F,
      WorldServiceImpl.damageAfterArmor(20.0F, 20.0F, 0.0F),
      1.0E-5F);
    assertEquals(
      84.0F,
      WorldServiceImpl.damageAfterArmor(100.0F, 20.0F, 0.0F),
      1.0E-5F);
  }

  @Test
  void armorToughnessPreservesMoreEffectiveArmorForLargeHits() {
    assertEquals(
      8.0F,
      WorldServiceImpl.damageAfterArmor(20.0F, 20.0F, 8.0F),
      1.0E-5F);
  }

  @Test
  void blockPagesAreSlicesOfOneSortOfEveryMatch() {
    var random = new Random(1);
    for (var bounds : List.of(BOX, SPHERE)) {
      var matching = new HashSet<BlockPos>();
      forEach(bounds, position -> {
        if (random.nextInt(3) > 0) {
          matching.add(position);
        }
      });
      for (var sort : SORTS) {
        // 0 means the default of 100, and 1000 is cut to 500.
        for (var size : List.of(0, 1, 7, 100, 500, 1000)) {
          assertEquals(
            slices(sortedOnce(bounds, sort, matching), size == 0 ? 100 : Math.min(size, 500)),
            readAll(bounds, sort, size, matching),
            sort + " in pages of " + size);
        }
      }
    }
  }

  @Test
  void returnedBlocksThatStopMatchingDoNotMakeTheNextPageSkipBlocks() {
    for (var sort : SORTS) {
      var matching = everything(BOX);
      var first = WorldServiceImpl.blockPage(BOX, sort, 50, "", matching::contains);
      var removed = first.values().subList(0, 10).stream().map(WorldServiceImpl.BlockMatch::position).toList();
      removed.forEach(matching::remove);
      var rest = readFrom(sort, first.nextToken(), matching);
      var stable = new HashSet<>(matching);
      first.values().forEach(match -> stable.remove(match.position()));
      assertEquals(stable, Set.copyOf(rest), sort.toString());
      assertEquals(stable.size(), rest.size(), sort + ": a block came back twice");
    }
  }

  @Test
  void newMatchesBeforeThePageEndDoNotMakeTheNextPageRepeatBlocks() {
    for (var sort : SORTS) {
      var all = sortedOnce(BOX, sort, everything(BOX));
      var matching = new HashSet<>(all);
      var added = all.subList(1, 11);
      added.forEach(matching::remove);
      var first = WorldServiceImpl.blockPage(BOX, sort, 50, "", matching::contains);
      matching.addAll(added);
      var rest = readFrom(sort, first.nextToken(), matching);
      var expected = new HashSet<>(all);
      added.forEach(expected::remove);
      first.values().forEach(match -> expected.remove(match.position()));
      assertEquals(expected, Set.copyOf(rest), sort.toString());
      assertEquals(expected.size(), rest.size(), sort + ": a block came back twice");
    }
  }

  @Test
  void blockPagesCheckFewBlocksPastThePage() {
    var bounds = new WorldServiceImpl.QueryBounds(
      0, 0, 0, 31, 31, 31, new Vec3(16, 16, 16), Double.POSITIVE_INFINITY);
    var checked = new int[1];
    WorldServiceImpl.blockPage(bounds, QuerySort.QUERY_SORT_NEAREST, 100, "", _ -> {
      checked[0]++;
      return true;
    });
    assertTrue(checked[0] < 32 * 32 * 32 / 4, checked[0] + " blocks checked for a page of 100");
  }

  @Test
  void rejectsAMalformedBlockPageToken() {
    for (var token : List.of("not base64!", encode("12"), encode("1,2"), encode("1,2,x"))) {
      var error = assertThrows(StatusRuntimeException.class,
        () -> WorldServiceImpl.blockPage(BOX, QuerySort.QUERY_SORT_NEAREST, 10, token, _ -> true));
      assertEquals(Status.Code.INVALID_ARGUMENT, error.getStatus().getCode(), token);
    }
  }

  /// The matches in the order of one stable sort over the x, y, z scan, as before page tokens resumed.
  private static List<BlockPos> sortedOnce(
    WorldServiceImpl.QueryBounds bounds, QuerySort sort, Set<BlockPos> matching) {
    var matches = new ArrayList<WorldServiceImpl.BlockMatch>();
    forEach(bounds, position -> {
      var match = WorldServiceImpl.blockMatch(position, bounds.origin());
      if (match.distanceSquared() <= bounds.radiusSquared() && matching.contains(position)) {
        matches.add(match);
      }
    });
    matches.sort(switch (sort) {
      case QUERY_SORT_FARTHEST -> Comparator.comparingDouble(WorldServiceImpl.BlockMatch::distanceSquared).reversed();
      case QUERY_SORT_XYZ -> (a, b) -> 0;
      default -> Comparator.comparingDouble(WorldServiceImpl.BlockMatch::distanceSquared);
    });
    return matches.stream().map(WorldServiceImpl.BlockMatch::position).toList();
  }

  /// Pages cut at offsets, as before page tokens resumed.
  private static List<List<BlockPos>> slices(List<BlockPos> sorted, int size) {
    if (sorted.isEmpty()) {
      return List.of(List.of());
    }
    var pages = new ArrayList<List<BlockPos>>();
    for (var offset = 0; offset < sorted.size(); offset += size) {
      pages.add(sorted.subList(offset, Math.min(sorted.size(), offset + size)));
    }
    return pages;
  }

  private static List<List<BlockPos>> readAll(
    WorldServiceImpl.QueryBounds bounds, QuerySort sort, int size, Set<BlockPos> matching) {
    var pages = new ArrayList<List<BlockPos>>();
    var token = "";
    do {
      var page = WorldServiceImpl.blockPage(bounds, sort, size, token, matching::contains);
      pages.add(page.values().stream().map(WorldServiceImpl.BlockMatch::position).toList());
      token = page.nextToken();
      assertTrue(pages.size() <= matching.size() + 1, "more pages than blocks");
    } while (!token.isEmpty());
    return pages;
  }

  /// Every block of BOX after `token`, in pages of 50.
  private static List<BlockPos> readFrom(QuerySort sort, String token, Set<BlockPos> matching) {
    var seen = new ArrayList<BlockPos>();
    while (!token.isEmpty()) {
      var page = WorldServiceImpl.blockPage(BOX, sort, 50, token, matching::contains);
      page.values().forEach(match -> seen.add(match.position()));
      token = page.nextToken();
      assertTrue(seen.size() <= matching.size(), sort + ": more blocks than match");
    }
    return seen;
  }

  private static Set<BlockPos> everything(WorldServiceImpl.QueryBounds bounds) {
    var all = new HashSet<BlockPos>();
    forEach(bounds, all::add);
    return all;
  }

  private static void forEach(WorldServiceImpl.QueryBounds bounds, Consumer<BlockPos> action) {
    for (var x = bounds.minX(); x <= bounds.maxX(); x++) {
      for (var y = bounds.minY(); y <= bounds.maxY(); y++) {
        for (var z = bounds.minZ(); z <= bounds.maxZ(); z++) {
          action.accept(new BlockPos(x, y, z));
        }
      }
    }
  }

  private static String encode(String text) {
    return Base64.getUrlEncoder().withoutPadding().encodeToString(text.getBytes(StandardCharsets.UTF_8));
  }
}
