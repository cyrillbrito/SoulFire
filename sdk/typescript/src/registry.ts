import type {
  DescMessage,
  MessageInitShape,
} from "@bufbuild/protobuf";
import type { CallOptions, Client } from "@connectrpc/connect";

import {
  RegistryService,
  type GetRegistryEntryRequestSchema,
  type GetRegistryEntryResponse,
  type GetRegistryIdentityResponse,
  type ListRegistryEntriesRequestSchema,
  type ListRegistryEntriesResponse,
  type ListRegistryTagsRequestSchema,
  type ListRegistryTagsResponse,
} from "./generated/soulfire/registry_pb.js";

type RegistryRequest<T extends DescMessage> = Omit<
  MessageInitShape<T>,
  "$typeName" | "botId" | "instanceId"
>;

export class SoulFireRegistry {
  public constructor(
    private readonly instanceId: string,
    private readonly botId: string,
    private readonly client: Client<typeof RegistryService>,
  ) {}

  public identity(options?: CallOptions): Promise<GetRegistryIdentityResponse> {
    return this.client.getRegistryIdentity(this.scope(), options);
  }

  /**
   * Entries of one registry, sorted by id, filtered by `idPrefix` and by `tags`
   * (an entry must have all of them). `pageSize` defaults to 100, at most 1000.
   */
  public entries(
    request: RegistryRequest<typeof ListRegistryEntriesRequestSchema>,
    options?: CallOptions,
  ): Promise<ListRegistryEntriesResponse> {
    return this.client.listRegistryEntries(
      { ...request, ...this.scope() },
      options,
    );
  }

  public entry(
    request: RegistryRequest<typeof GetRegistryEntryRequestSchema>,
    options?: CallOptions,
  ): Promise<GetRegistryEntryResponse> {
    return this.client.getRegistryEntry(
      { ...request, ...this.scope() },
      options,
    );
  }

  public tags(
    request: RegistryRequest<typeof ListRegistryTagsRequestSchema>,
    options?: CallOptions,
  ): Promise<ListRegistryTagsResponse> {
    return this.client.listRegistryTags(
      { ...request, ...this.scope() },
      options,
    );
  }

  private scope(): { instanceId: string; botId: string } {
    return { instanceId: this.instanceId, botId: this.botId };
  }
}
