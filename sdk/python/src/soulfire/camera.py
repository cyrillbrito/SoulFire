from __future__ import annotations

import base64
from dataclasses import dataclass

from effect_py import EffectGen, fn

from .bot_connect import BotServiceClient
from .bot_pb2 import (
    BotPovFrame,
    BotRenderPovRequest,
    BotRenderPovResponse,
    BotWatchPovRequest,
    BotWorldMapRequest,
    BotWorldMapResponse,
)
from .errors import SoulFireOperationError
from .streams import Stream
from .transport import rpc, rpc_stream

type Headers = dict[str, str] | None


@dataclass(frozen=True, slots=True, kw_only=True)
class CameraRenderOptions:
    width: int = 0
    height: int = 0
    max_distance: int | None = None
    fov: float | None = None
    camera_x: float | None = None
    camera_y: float | None = None
    camera_z: float | None = None
    yaw: float | None = None
    pitch: float | None = None
    include_hud: bool | None = None
    include_hands: bool | None = None
    include_debug_trace: bool = False


@dataclass(frozen=True, slots=True, kw_only=True)
class WorldMapOptions:
    center_x: int | None = None
    center_z: int | None = None
    radius: int = 0
    sample_step: int = 0
    include_entities: bool = False


_DEFAULT_CAMERA_OPTIONS = CameraRenderOptions()
_DEFAULT_WORLD_MAP_OPTIONS = WorldMapOptions()


class SoulFireCamera:
    """Async camera, frame-stream, and map-view access for one bot."""

    def __init__(self, instance_id: str, bot_id: str, client: BotServiceClient) -> None:
        self._instance_id = instance_id
        self._bot_id = bot_id
        self._client = client

    @fn("SoulFireCamera.capture")
    def capture(
        self,
        options: CameraRenderOptions = _DEFAULT_CAMERA_OPTIONS,
        *,
        headers: Headers = None,
        timeout_ms: int | None = None,
    ) -> EffectGen[BotRenderPovResponse, SoulFireOperationError]:
        return (
            yield from rpc(
                "SoulFireCamera.capture",
                lambda: self._client.render_bot_pov(
                    _render_request(self._instance_id, self._bot_id, options),
                    headers=headers,
                    timeout_ms=timeout_ms,
                ),
            )
        )

    @fn("SoulFireCamera.capture_bytes")
    def capture_bytes(
        self,
        options: CameraRenderOptions = _DEFAULT_CAMERA_OPTIONS,
        *,
        headers: Headers = None,
        timeout_ms: int | None = None,
    ) -> EffectGen[bytes, SoulFireOperationError]:
        capture = yield from self.capture(options, headers=headers, timeout_ms=timeout_ms)
        return decode_camera_image(capture)

    def frames(
        self,
        options: CameraRenderOptions = _DEFAULT_CAMERA_OPTIONS,
        *,
        interval_ms: int = 0,
        headers: Headers = None,
        timeout_ms: int | None = None,
    ) -> Stream[BotPovFrame, SoulFireOperationError]:
        return rpc_stream(
            "SoulFireCamera.frames",
            lambda: self._client.watch_bot_pov(
                _watch_request(self._instance_id, self._bot_id, options, interval_ms),
                headers=headers,
                timeout_ms=timeout_ms,
            ),
        )

    @fn("SoulFireCamera.world_map")
    def world_map(
        self,
        options: WorldMapOptions = _DEFAULT_WORLD_MAP_OPTIONS,
        *,
        headers: Headers = None,
        timeout_ms: int | None = None,
    ) -> EffectGen[BotWorldMapResponse, SoulFireOperationError]:
        return (
            yield from rpc(
                "SoulFireCamera.world_map",
                lambda: self._client.get_bot_world_map(
                    _world_map_request(self._instance_id, self._bot_id, options),
                    headers=headers,
                    timeout_ms=timeout_ms,
                ),
            )
        )


def decode_camera_image(image: BotRenderPovResponse) -> bytes:
    """Decode a camera image payload into its original bytes."""
    return base64.b64decode(image.image_base64, validate=True)


def _render_request(
    instance_id: str, bot_id: str, options: CameraRenderOptions
) -> BotRenderPovRequest:
    request = BotRenderPovRequest(
        instance_id=instance_id,
        bot_id=bot_id,
        width=options.width,
        height=options.height,
        include_debug_trace=options.include_debug_trace,
    )
    _apply_render_options(request, options)
    return request


def _watch_request(
    instance_id: str, bot_id: str, options: CameraRenderOptions, interval_ms: int
) -> BotWatchPovRequest:
    request = BotWatchPovRequest(
        instance_id=instance_id,
        bot_id=bot_id,
        width=options.width,
        height=options.height,
        include_debug_trace=options.include_debug_trace,
        interval_ms=interval_ms,
    )
    _apply_render_options(request, options)
    return request


def _apply_render_options(
    request: BotRenderPovRequest | BotWatchPovRequest, options: CameraRenderOptions
) -> None:
    if options.max_distance is not None:
        request.max_distance = options.max_distance
    if options.fov is not None:
        request.fov = options.fov
    if options.camera_x is not None:
        request.camera_x = options.camera_x
    if options.camera_y is not None:
        request.camera_y = options.camera_y
    if options.camera_z is not None:
        request.camera_z = options.camera_z
    if options.yaw is not None:
        request.y_rot = options.yaw
    if options.pitch is not None:
        request.x_rot = options.pitch
    if options.include_hud is not None:
        request.include_hud = options.include_hud
    if options.include_hands is not None:
        request.include_hands = options.include_hands


def _world_map_request(
    instance_id: str, bot_id: str, options: WorldMapOptions
) -> BotWorldMapRequest:
    request = BotWorldMapRequest(
        instance_id=instance_id,
        bot_id=bot_id,
        radius=options.radius,
        sample_step=options.sample_step,
        include_entities=options.include_entities,
    )
    if options.center_x is not None:
        request.center_x = options.center_x
    if options.center_z is not None:
        request.center_z = options.center_z
    return request
