from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Protocol, runtime_checkable

from connectrpc.errors import ConnectError
from effect_py import Effect, EffectGen, Scope, acquire_release, from_async, gen, try_, try_async

from .errors import SoulFireRpcError, SoulFireValidationError, rpc_error
from .streams import END, Cursor, End, Item, Stream


@runtime_checkable
class _Closable(Protocol):
    async def aclose(self) -> None: ...


def rpc[A](operation: str, call: Callable[[], Awaitable[A]]) -> Effect[A, SoulFireRpcError]:
    def on_error(error: Exception) -> SoulFireRpcError:
        if isinstance(error, SoulFireRpcError):
            return error
        if isinstance(error, ConnectError):
            return rpc_error(operation, error)
        raise error

    return try_async(call, on_error)


def validate[A](call: Callable[[], A]) -> Effect[A, SoulFireValidationError]:
    def on_error(error: Exception) -> SoulFireValidationError:
        if isinstance(error, (ValueError, TypeError, RuntimeError)):
            return SoulFireValidationError(str(error))
        raise error

    return try_(call, on_error)


def rpc_stream[A](operation: str, factory: Callable[[], AsyncIterator[A]]) -> Stream[A, SoulFireRpcError]:
    @gen
    def acquire() -> EffectGen[Cursor[A, SoulFireRpcError], SoulFireRpcError, Scope]:
        def create() -> AsyncIterator[A]:
            return factory()

        async def close(iterator: AsyncIterator[A]) -> None:
            if isinstance(iterator, _Closable):
                await iterator.aclose()

        iterator = yield from acquire_release(
            try_(create, lambda error: rpc_error(operation, error)),
            lambda iterator, _: from_async(lambda: close(iterator)),
        )

        async def pull() -> Item[A] | End:
            try:
                return Item(await anext(iterator))
            except StopAsyncIteration:
                return END

        return Cursor(lambda: rpc(operation, pull))

    return Stream(acquire())
