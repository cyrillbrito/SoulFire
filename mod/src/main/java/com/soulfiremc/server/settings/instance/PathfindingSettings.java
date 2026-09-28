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
package com.soulfiremc.server.settings.instance;

import com.soulfiremc.server.pathfinding.RouteSearchMode;
import com.soulfiremc.server.settings.lib.SettingsObject;
import com.soulfiremc.server.settings.lib.SettingsSource;
import com.soulfiremc.server.settings.property.*;
import lombok.AccessLevel;
import lombok.NoArgsConstructor;

@NoArgsConstructor(access = AccessLevel.PRIVATE)
public final class PathfindingSettings implements SettingsObject {
  private static final String NAMESPACE = "pathfinding";
  public static final BooleanProperty<SettingsSource.Bot> ALLOW_BREAKING_UNDIGGABLE =
    ImmutableBooleanProperty.<SettingsSource.Bot>builder()
            .sourceType(SettingsSource.Bot.INSTANCE)
      .namespace(NAMESPACE)
      .key("allow-breaking-undiggable")
      .uiName("Allow Breaking Undiggable")
      .description("Allow the bot to attempt breaking blocks that are normally undiggable (like bedrock)")
      .defaultValue(false)
      .build();
  public static final BooleanProperty<SettingsSource.Bot> AVOID_DIAGONAL_SQUEEZE =
    ImmutableBooleanProperty.<SettingsSource.Bot>builder()
            .sourceType(SettingsSource.Bot.INSTANCE)
      .namespace(NAMESPACE)
      .key("avoid-diagonal-squeeze")
      .uiName("Avoid Diagonal Squeeze")
      .description("Prevent the bot from squeezing through diagonal gaps between blocks")
      .defaultValue(false)
      .build();
  public static final BooleanProperty<SettingsSource.Bot> AVOID_HARMFUL_ENTITIES =
    ImmutableBooleanProperty.<SettingsSource.Bot>builder()
            .sourceType(SettingsSource.Bot.INSTANCE)
      .namespace(NAMESPACE)
      .key("avoid-harmful-entities")
      .uiName("Avoid Harmful Entities")
      .description("Add a penalty to paths that go near harmful entities like hostile mobs")
      .defaultValue(true)
      .build();
  public static final BooleanProperty<SettingsSource.Bot> AVOID_FLUIDS =
    ImmutableBooleanProperty.<SettingsSource.Bot>builder()
            .sourceType(SettingsSource.Bot.INSTANCE)
      .namespace(NAMESPACE)
      .key("avoid-fluids")
      .uiName("Avoid Fluids")
      .description("Keep routes out of water and lava, unless a request sets avoid_fluids itself")
      .defaultValue(false)
      .build();
  public static final DoubleProperty<SettingsSource.Bot> MAXIMUM_QUALITY_BOUND =
    ImmutableDoubleProperty.<SettingsSource.Bot>builder()
            .sourceType(SettingsSource.Bot.INSTANCE)
      .namespace(NAMESPACE)
      .key("maximum-quality-bound")
      .uiName("Maximum Quality Bound")
      .description("Largest accepted route-quality bound in the normal search mode, unless a request sets its own. Higher accepts longer routes instead of throwing away a route the search found but couldn't prove short enough")
      .defaultValue(RouteSearchMode.NORMAL.defaultQualityBound())
      .minValue(1.0d)
      .maxValue(RouteSearchMode.NORMAL.initialEpsilon())
      .stepValue(0.1d)
      .build();
  public static final IntProperty<SettingsSource.Bot> MAX_ENEMY_PENALTY =
    ImmutableIntProperty.<SettingsSource.Bot>builder()
            .sourceType(SettingsSource.Bot.INSTANCE)
      .namespace(NAMESPACE)
      .key("max-enemy-penalty")
      .uiName("Max Enemy Penalty")
      .description("Maximum cost penalty applied when pathfinding near hostile entities")
      .defaultValue(50)
      .minValue(0)
      .maxValue(Integer.MAX_VALUE)
      .build();
  public static final IntProperty<SettingsSource.Bot> BREAK_BLOCK_PENALTY =
    ImmutableIntProperty.<SettingsSource.Bot>builder()
            .sourceType(SettingsSource.Bot.INSTANCE)
      .namespace(NAMESPACE)
      .key("break-block-penalty")
      .uiName("Break Block Penalty")
      .description("Cost penalty for breaking a block during pathfinding (higher values discourage breaking)")
      .defaultValue(2)
      .minValue(0)
      .maxValue(Integer.MAX_VALUE)
      .build();
  public static final IntProperty<SettingsSource.Bot> PLACE_BLOCK_PENALTY =
    ImmutableIntProperty.<SettingsSource.Bot>builder()
            .sourceType(SettingsSource.Bot.INSTANCE)
      .namespace(NAMESPACE)
      .key("place-block-penalty")
      .uiName("Place Block Penalty")
      .description("Cost penalty for placing a block during pathfinding (higher values discourage placing)")
      .defaultValue(20)
      .minValue(0)
      .maxValue(Integer.MAX_VALUE)
      .build();
  public static final IntProperty<SettingsSource.Bot> EXPIRE_TIMEOUT =
    ImmutableIntProperty.<SettingsSource.Bot>builder()
            .sourceType(SettingsSource.Bot.INSTANCE)
      .namespace(NAMESPACE)
      .key("expire-timeout")
      .uiName("Expire Timeout")
      .description("Maximum time in seconds before pathfinding gives up")
      .defaultValue(180)
      .minValue(1)
      .maxValue(Integer.MAX_VALUE)
      .build();
}
