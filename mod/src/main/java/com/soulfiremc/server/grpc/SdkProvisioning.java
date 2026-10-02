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
import com.soulfiremc.server.account.MinecraftAccount;
import com.soulfiremc.server.account.service.OfflineJavaData;
import com.soulfiremc.server.settings.instance.BotSettings;
import com.soulfiremc.server.settings.lib.InstanceSettingsImpl;
import com.soulfiremc.server.settings.lib.SettingsSource;
import io.grpc.Status;

import java.util.ArrayList;

/// Validates named SDK resources without replacing existing configuration.
final class SdkProvisioning {
  private static final String METADATA_NAMESPACE = "soulfire-sdk";
  private static final String NAME_KEY = "name";

  private SdkProvisioning() {
  }

  static String requireName(String name) {
    var normalized = name.trim();
    if (normalized.isEmpty() || normalized.length() > 128) {
      throw Status.INVALID_ARGUMENT.withDescription("Name must contain 1 to 128 characters").asRuntimeException();
    }
    return normalized;
  }

  static String requireServer(String server) {
    var normalized = server.trim();
    if (normalized.isEmpty() || normalized.chars().anyMatch(Character::isWhitespace)) {
      throw Status.INVALID_ARGUMENT.withDescription("Minecraft server address must not be blank or contain whitespace").asRuntimeException();
    }
    return normalized;
  }

  static InstanceSettingsImpl.Stem instanceSettings(String server) {
    return InstanceSettingsImpl.Stem.EMPTY.withSettings(SettingsSource.Stem.withUpdatedEntry(
      InstanceSettingsImpl.Stem.EMPTY.settings(), BotSettings.ADDRESS.namespace(), BotSettings.ADDRESS.key(), new JsonPrimitive(server)));
  }

  static void requireServerMatch(InstanceSettingsImpl.Stem settings, String server) {
    var configured = settings.get(BotSettings.ADDRESS).map(value -> value.getAsString()).orElse(BotSettings.ADDRESS.defaultValue());
    if (!configured.equals(server)) {
      throw Status.FAILED_PRECONDITION
        .withDescription("Instance already connects to '%s', not '%s'. Use another instance name or update its configuration explicitly.".formatted(configured, server))
        .asRuntimeException();
    }
  }

  static AccountResult account(InstanceSettingsImpl.Stem settings, InstanceGetOrCreateBotRequest request) {
    var name = requireName(request.getName());
    if (request.getAuth() != BotAuthentication.BOT_AUTHENTICATION_OFFLINE
      && request.getAuth() != BotAuthentication.BOT_AUTHENTICATION_MICROSOFT) {
      throw Status.INVALID_ARGUMENT.withDescription("Bot authentication must be offline or Microsoft").asRuntimeException();
    }
    var matches = settings.accounts().stream().filter(account -> {
      var metadata = account.persistentMetadata().get(METADATA_NAMESPACE);
      var sdkName = metadata == null ? null : metadata.get(NAME_KEY);
      return sdkName == null ? account.lastKnownName().equals(name) : sdkName.getAsString().equals(name);
    }).toList();
    if (matches.size() > 1) {
      throw Status.FAILED_PRECONDITION.withDescription("More than one bot has this name. Select a bot by ID or rename the accounts.").asRuntimeException();
    }
    if (!matches.isEmpty()) {
      var existing = matches.getFirst();
      requireAuthentication(existing, request.getAuth());
      if (request.hasUsername() && !existing.lastKnownName().equals(request.getUsername())) {
        throw Status.FAILED_PRECONDITION.withDescription("Bot name already belongs to a different Minecraft username").asRuntimeException();
      }
      if (request.hasAccount() && !existing.profileId().toString().equals(request.getAccount().getProfileId())) {
        throw Status.FAILED_PRECONDITION.withDescription("Bot name already belongs to a different Minecraft profile").asRuntimeException();
      }
      return new AccountResult(settings, existing, false);
    }
    MinecraftAccount account;
    if (request.getAuth() == BotAuthentication.BOT_AUTHENTICATION_OFFLINE) {
      if (request.hasAccount()) {
        throw Status.INVALID_ARGUMENT.withDescription("Offline bots do not accept an authenticated account").asRuntimeException();
      }
      var username = request.hasUsername() ? request.getUsername() : name;
      if (!username.matches("[A-Za-z0-9_]{1,16}")) {
        throw Status.INVALID_ARGUMENT.withDescription("Offline username must contain 1 to 16 letters, digits, or underscores").asRuntimeException();
      }
      account = new MinecraftAccount(AuthType.OFFLINE, OfflineJavaData.getOfflineUUID(username), username, new OfflineJavaData(), null, null);
    } else {
      if (!request.hasAccount()) {
        throw Status.NOT_FOUND.withDescription("Microsoft bot needs device-code authentication before creation").asRuntimeException();
      }
      try {
        account = MinecraftAccount.fromProto(request.getAccount());
      } catch (IllegalArgumentException e) {
        throw Status.INVALID_ARGUMENT.withDescription("Authenticated Minecraft account is invalid").withCause(e).asRuntimeException();
      }
      requireAuthentication(account, request.getAuth());
      if (request.hasUsername() && !account.lastKnownName().equals(request.getUsername())) {
        throw Status.FAILED_PRECONDITION.withDescription("Authenticated Minecraft username does not match the requested username").asRuntimeException();
      }
    }
    var profileId = account.profileId();
    if (settings.accounts().stream().anyMatch(existing -> existing.profileId().equals(profileId))) {
      throw Status.FAILED_PRECONDITION.withDescription("Minecraft profile already exists under a different bot name").asRuntimeException();
    }
    account = account.withPersistentMetadata(SettingsSource.Stem.withUpdatedEntry(
      account.persistentMetadata(), METADATA_NAMESPACE, NAME_KEY, new JsonPrimitive(name)));
    var accounts = new ArrayList<>(settings.accounts());
    accounts.add(account);
    return new AccountResult(settings.withAccounts(accounts), account, true);
  }

  private static void requireAuthentication(MinecraftAccount account, BotAuthentication auth) {
    var matches = switch (auth) {
      case BOT_AUTHENTICATION_OFFLINE -> account.authType() == AuthType.OFFLINE;
      case BOT_AUTHENTICATION_MICROSOFT -> account.authType().name().startsWith("MICROSOFT_JAVA_");
      default -> false;
    };
    if (!matches) {
      throw Status.FAILED_PRECONDITION.withDescription("Bot name already uses a different authentication method").asRuntimeException();
    }
  }

  record AccountResult(InstanceSettingsImpl.Stem settings, MinecraftAccount account, boolean created) {
  }
}
