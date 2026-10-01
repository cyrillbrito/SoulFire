import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import { Effect, Layer, type Scope } from "effect";

import { type SoulFireOptions } from "./client.js";
import {
  SoulFireClient,
  SoulFireConnectionError,
  SoulFireService,
  SoulFire as UniversalSoulFire,
} from "./index.js";
import type { SoulFireInstallOptions } from "./install-types.js";
import { installLocalServer } from "./local-server.js";
import { makeEffectHttpClientFetch } from "./platform.js";

export * from "./index.js";

function connect(
  options: SoulFireOptions,
): Effect.Effect<SoulFireClient, SoulFireConnectionError, Scope.Scope> {
  return UniversalSoulFire.connectWithHttpClient(options).pipe(
    Effect.provide(FetchHttpClient.layer),
  );
}

function layer(
  options: SoulFireOptions,
): Layer.Layer<SoulFireService, SoulFireConnectionError> {
  return UniversalSoulFire.layerWithHttpClient(options).pipe(
    Layer.provide(FetchHttpClient.layer),
  );
}

function install(
  options: SoulFireInstallOptions = {},
): Effect.Effect<SoulFireClient, SoulFireConnectionError, Scope.Scope> {
  return Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const fetchImplementation =
      options.fetch ?? makeEffectHttpClientFetch(httpClient);
    const localServer = yield* installLocalServer({
      ...options,
      fetch: fetchImplementation,
    });
    return yield* UniversalSoulFire.connectManaged(
      connectionOptions(localServer.info.baseUrl, localServer.token, {
        ...options,
        fetch: fetchImplementation,
      }),
      localServer,
    );
  }).pipe(
    Effect.mapError((cause) => new SoulFireConnectionError({ cause })),
    Effect.provide(FetchHttpClient.layer),
  );
}

function installLayer(
  options: SoulFireInstallOptions = {},
): Layer.Layer<SoulFireService, SoulFireConnectionError> {
  return Layer.effect(SoulFireService, install(options));
}

export const SoulFire = {
  ...UniversalSoulFire,
  connect,
  layer,
  install,
  installLayer,
} as const;

function connectionOptions(
  baseUrl: string,
  token: string,
  options: SoulFireInstallOptions,
): SoulFireOptions {
  return {
    baseUrl,
    token,
    ...(options.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: options.defaultTimeoutMs }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.interceptors === undefined
      ? {}
      : { interceptors: options.interceptors }),
  };
}
