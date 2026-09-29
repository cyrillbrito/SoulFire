from __future__ import annotations

from effect_py import EffectGen, fn

from .errors import SoulFireOperationError
from .plugin.example.v1.example_connect import ExamplePluginServiceClient
from .plugin.example.v1.example_pb2 import EchoRequest, EchoResponse, Tick, WatchTicksRequest
from .plugin_api_pb2 import PluginApiDescriptor
from .plugins import PluginCatalog
from .streams import Stream
from .transport import rpc, rpc_stream

_PLUGIN_ID = "example"
_SERVICE_NAME = "soulfire.plugin.example.v1.ExamplePluginService"


class ExamplePluginClient:
    __slots__ = ("_client",)

    def __init__(self, client: ExamplePluginServiceClient) -> None:
        self._client = client

    @fn("ExamplePluginClient.echo")
    def echo(
        self, instance_id: str, message: str, *, timeout_ms: int | None = None
    ) -> EffectGen[EchoResponse, SoulFireOperationError]:
        return (
            yield from rpc(
                "ExamplePluginClient.echo",
                lambda: self._client.echo(
                    EchoRequest(instance_id=instance_id, message=message), timeout_ms=timeout_ms
                ),
            )
        )

    def watch_ticks(
        self, instance_id: str, count: int, *, timeout_ms: int | None = None
    ) -> Stream[Tick, SoulFireOperationError]:
        return rpc_stream(
            "ExamplePluginClient.watch_ticks",
            lambda: self._client.watch_ticks(
                WatchTicksRequest(instance_id=instance_id, count=count), timeout_ms=timeout_ms
            ),
        )


class _ExamplePluginModule:
    plugin_id = _PLUGIN_ID

    @staticmethod
    def is_compatible(descriptor: PluginApiDescriptor) -> bool:
        return _is_compatible(descriptor)

    @staticmethod
    def create(catalog: PluginCatalog, _: PluginApiDescriptor) -> ExamplePluginClient:
        return ExamplePluginClient(catalog.service(ExamplePluginServiceClient))


example_plugin = _ExamplePluginModule()


def _is_compatible(descriptor: PluginApiDescriptor) -> bool:
    return descriptor.api_major_version == 1 and any(
        service.full_name == _SERVICE_NAME for service in descriptor.services
    )
