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

import com.google.gson.JsonPrimitive;
import com.soulfiremc.grpc.generated.BotAuthentication;
import com.soulfiremc.grpc.generated.InstanceGetOrCreateBotRequest;
import com.soulfiremc.server.account.AuthType;
import com.soulfiremc.server.account.service.OfflineJavaData;
import com.soulfiremc.server.settings.lib.InstanceSettingsImpl;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class SdkProvisioningTest {
  @Test
  void offlineCreationPreservesSettingsAndReusesTheAccount() {
    var settings = new InstanceSettingsImpl.Stem(
      Map.of("custom", Map.of("enabled", new JsonPrimitive(true))),
      List.of(), List.of(), Map.of());
    var request = offline("builder");
    var first = SdkProvisioning.account(settings, request);
    var second = SdkProvisioning.account(first.settings(), request);

    assertTrue(first.created());
    assertFalse(second.created());
    assertEquals(OfflineJavaData.getOfflineUUID("builder"), first.account().profileId());
    assertEquals(AuthType.OFFLINE, first.account().authType());
    assertEquals(settings.settings(), first.settings().settings());
    assertEquals(first.account(), second.account());
    assertEquals(1, second.settings().accounts().size());
  }

  @Test
  void aliasesPreserveIdentityAndRejectUsernameOrAuthenticationChanges() {
    var request = offline("wood-worker").toBuilder().setUsername("Lumberjack").build();
    var created = SdkProvisioning.account(InstanceSettingsImpl.Stem.EMPTY, request);
    assertEquals(created.account(), SdkProvisioning.account(created.settings(), request).account());
    assertCode(Status.Code.FAILED_PRECONDITION, () -> SdkProvisioning.account(created.settings(),
      request.toBuilder().setUsername("OtherBot").build()));
    assertCode(Status.Code.FAILED_PRECONDITION, () -> SdkProvisioning.account(created.settings(),
      request.toBuilder().setAuth(BotAuthentication.BOT_AUTHENTICATION_MICROSOFT).build()));
    assertCode(Status.Code.FAILED_PRECONDITION, () -> SdkProvisioning.account(created.settings(),
      offline("OtherAlias").toBuilder().setUsername("Lumberjack").build()));
  }

  @Test
  void invalidOfflineNamesDoNotCreateAccounts() {
    for (var name : List.of("", "contains spaces", "seventeen_letters", "é")) {
      assertCode(Status.Code.INVALID_ARGUMENT, () -> SdkProvisioning.account(InstanceSettingsImpl.Stem.EMPTY, offline(name)));
    }
  }

  @Test
  void serverConflictsPreserveTheConfiguredAddress() {
    var settings = SdkProvisioning.instanceSettings("localhost:25565");
    assertDoesNotThrow(() -> SdkProvisioning.requireServerMatch(settings, "localhost:25565"));
    assertCode(Status.Code.FAILED_PRECONDITION, () -> SdkProvisioning.requireServerMatch(settings, "localhost:25566"));
  }

  @Test
  void newMicrosoftBotsRequireAuthentication() {
    assertCode(Status.Code.NOT_FOUND, () -> SdkProvisioning.account(InstanceSettingsImpl.Stem.EMPTY,
      offline("account").toBuilder().setAuth(BotAuthentication.BOT_AUTHENTICATION_MICROSOFT).build()));
  }

  private static InstanceGetOrCreateBotRequest offline(String name) {
    return InstanceGetOrCreateBotRequest.newBuilder().setName(name)
      .setAuth(BotAuthentication.BOT_AUTHENTICATION_OFFLINE).build();
  }

  private static void assertCode(Status.Code code, Runnable action) {
    assertEquals(code, assertThrows(StatusRuntimeException.class, action::run).getStatus().getCode());
  }
}
