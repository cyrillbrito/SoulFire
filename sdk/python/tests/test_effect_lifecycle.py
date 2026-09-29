import asyncio
from collections.abc import AsyncIterator
from typing import cast

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from effect_py import (
    EffectGen,
    Failure,
    Scope,
    fail,
    from_async,
    gen,
    layer,
    run_async,
    run_async_exit,
    scoped,
)
from effect_py.clock import Clock

from soulfire.bot import SoulFireBot
from soulfire.bot_connect import BotServiceClient
from soulfire.bot_live_connect import BotLiveServiceClient
from soulfire.bot_live_pb2 import (
    AcquireBotControlResponse,
    BotControlLease,
    BotEvent,
    BotEventEnvelope,
)
from soulfire.errors import SoulFireRpcError, SoulFireStateError, SoulFireValidationError
from soulfire.session import BotSession
from soulfire.streams import Stream
from soulfire.transport import rpc, rpc_stream, validate


async def test_transport_is_lazy_and_only_transport_errors_are_rpc_failures() -> None:
    calls = 0

    async def request() -> int:
        nonlocal calls
        calls += 1
        raise ConnectError(Code.UNAVAILABLE, "temporary")

    effect = rpc("get", request)
    assert calls == 0
    result = await run_async_exit(effect)
    assert calls == 1
    assert isinstance(result, Failure)
    assert isinstance(result.error, SoulFireRpcError)
    assert result.error.retryable
    invalid = await run_async_exit(validate(lambda: int("invalid")))
    assert isinstance(invalid, Failure)
    assert isinstance(invalid.error, SoulFireValidationError)

    async def defective() -> None:
        raise AssertionError("invariant")

    defect = await run_async_exit(rpc("get", defective))
    assert isinstance(defect, Failure)
    assert isinstance(defect.defect, AssertionError)


async def test_each_stream_subscription_is_lazy_independent_and_closed_on_take() -> None:
    opened = 0
    closed = 0

    async def source() -> AsyncIterator[int]:
        nonlocal opened, closed
        opened += 1
        try:
            yield 1
            yield 2
        finally:
            closed += 1

    stream = rpc_stream("numbers", source)
    first = stream.take(1).run_collect()
    assert opened == 0
    assert await run_async(first.or_die()) == (1,)
    assert closed == 1
    assert await run_async(first.or_die()) == (1,)
    assert opened == closed == 2


async def test_cancelling_merged_stream_closes_all_producers() -> None:
    started = 0
    all_started = asyncio.Event()
    closed: set[int] = set()

    async def source(index: int) -> AsyncIterator[int]:
        nonlocal started
        started += 1
        if started == 2:
            all_started.set()
        try:
            yield index
            await asyncio.Event().wait()
        finally:
            closed.add(index)

    stream = Stream.merge(
        rpc_stream("one", lambda: source(1)), rpc_stream("two", lambda: source(2)), buffer_size=1
    )
    task = asyncio.create_task(run_async(stream.run_drain().or_die()))
    await all_started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert closed == {1, 2}


async def test_session_cancelled_before_first_event_awaits_stream_cleanup() -> None:
    started = asyncio.Event()
    closed = asyncio.Event()

    async def source() -> AsyncIterator[BotEvent]:
        started.set()
        try:
            await asyncio.Event().wait()
            yield BotEvent()
        finally:
            closed.set()

    task = asyncio.create_task(
        run_async(scoped(BotSession.open(lambda _: rpc_stream("watch", source))).or_die())
    )
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert closed.is_set()


async def test_session_initial_defect_returns_without_hanging() -> None:
    async def source() -> AsyncIterator[BotEvent]:
        raise AssertionError("invariant")
        yield BotEvent()

    with pytest.raises(AssertionError):
        await asyncio.wait_for(
            run_async(scoped(BotSession.open(lambda _: rpc_stream("watch", source))).or_die()), 1
        )


async def test_session_terminal_failure_reaches_existing_and_late_subscribers() -> None:
    release = asyncio.Event()

    async def source() -> AsyncIterator[BotEvent]:
        yield BotEvent(envelope=BotEventEnvelope(sequence=1, stream_epoch="epoch"))
        await release.wait()
        raise ConnectError(Code.PERMISSION_DENIED, "revoked")

    @gen
    def workflow() -> EffectGen[None, object, Scope]:
        session = yield from BotSession.open(lambda _: rpc_stream("watch", source))
        # Opening the cursor subscribes before allowing the transport to fail.
        cursor = yield from session.events().open
        release.set()
        result = yield from cursor.next().exit()
        assert isinstance(result, Failure)
        assert isinstance(result.error, SoulFireRpcError)
        assert result.error.code == Code.PERMISSION_DENIED
        late = yield from session.events().run_head().exit()
        assert isinstance(late, Failure)
        assert isinstance(late.error, SoulFireRpcError)

    await run_async(scoped(workflow).or_die())


class RecordingClock:
    def __init__(self) -> None:
        self.delays: list[float] = []

    def now(self) -> float:
        return sum(self.delays)

    async def sleep(self, seconds: float) -> None:
        self.delays.append(seconds)
        await asyncio.sleep(0)


async def test_session_retry_delays_reset_after_receiving_an_event() -> None:
    attempts = 0
    resumed = asyncio.Event()
    clock = RecordingClock()
    requests = []

    async def source(request) -> AsyncIterator[BotEvent]:
        nonlocal attempts
        attempts += 1
        requests.append(request)
        if attempts in {1, 4}:
            yield BotEvent(envelope=BotEventEnvelope(sequence=attempts, stream_epoch="epoch"))
        if attempts < 5:
            raise ConnectError(Code.UNAVAILABLE, "temporary")
        resumed.set()
        await asyncio.Event().wait()

    @gen
    def workflow():
        session = yield from BotSession.open(
            lambda request: rpc_stream("watch", lambda: source(request))
        )
        yield from from_async(resumed.wait)
        assert session.state.sequence == 4

    await run_async(scoped(workflow).pipe(layer.provide(layer.succeed(Clock, clock))).or_die())
    assert clock.delays == [0.25, 0.5, 1, 0.25]
    assert requests[-1].after_sequence == 4
    assert requests[-1].stream_epoch == "epoch"


class ControlService:
    def __init__(self) -> None:
        self.released = 0

    async def acquire_bot_control(self, *_args, **_kwargs):
        return AcquireBotControlResponse(lease=BotControlLease(token="token"))

    async def release_bot_control(self, *_args, **_kwargs) -> None:
        self.released += 1


@pytest.mark.parametrize("cancel", [False, True])
async def test_control_lease_releases_after_failure_or_interruption(cancel: bool) -> None:
    service = ControlService()
    bot = SoulFireBot(
        "instance", "bot", cast(BotServiceClient, object()), cast(BotLiveServiceClient, service)
    )
    acquired = asyncio.Event()

    @gen
    def workflow():
        yield from bot.acquire_control()
        acquired.set()
        if cancel:
            yield from from_async(asyncio.Event().wait)
        else:
            yield from fail(SoulFireStateError("failed"))

    task = asyncio.create_task(run_async_exit(scoped(workflow)))
    await acquired.wait()
    if cancel:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    else:
        result = await task
        assert isinstance(result, Failure)
        assert isinstance(result.error, SoulFireStateError)
    assert service.released == 1
