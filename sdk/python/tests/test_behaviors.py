import asyncio
from typing import Protocol, cast

import pytest
from effect_py import (
    EffectGen,
    Failure,
    fail,
    fn,
    from_async,
    layer,
    run_async,
    run_async_exit,
    service,
    succeed,
    sync,
)
from effect_py.errors import TaggedError

from soulfire.behaviors import (
    SoulFireBehaviorTimeoutError,
    cleanup,
    define_behavior,
    fallback,
    parallel,
    race,
    repeat,
    retry,
    sequence,
    timeout,
    until,
)
from soulfire.bot import SoulFireBot

bot = cast(SoulFireBot, object())


class Unavailable(TaggedError):
    pass


class Counter(Protocol):
    def increment(self) -> int: ...


class InMemoryCounter:
    value = 0

    def increment(self) -> int:
        self.value += 1
        return self.value


async def test_combinators_preserve_services_errors_and_result_order() -> None:
    counter = InMemoryCounter()

    @fn("increment")
    def increment(_: SoulFireBot) -> EffectGen[int, Unavailable, Counter]:
        dependency = yield from service(Counter)
        value = dependency.increment()
        if value < 3:
            return (yield from fail(Unavailable()))
        return value

    behavior = sequence(
        retry(define_behavior(increment), attempts=3),
        repeat(define_behavior(lambda _: succeed(7)), times=2),
    )
    result = await run_async(
        behavior.run(bot).pipe(layer.provide(layer.succeed(Counter, counter))).or_die()
    )
    assert result == (3, (7, 7))
    assert counter.value == 3


async def test_parallel_fails_fast_and_waits_for_sibling_cleanup() -> None:
    started = asyncio.Event()
    cleaned = asyncio.Event()

    async def blocked() -> None:
        started.set()
        await asyncio.Event().wait()

    @fn("fail_after_sibling_starts")
    def failing(_: SoulFireBot) -> EffectGen[None, Unavailable]:
        yield from from_async(started.wait)
        return (yield from fail(Unavailable()))

    waiting = cleanup(
        define_behavior(lambda _: from_async(blocked)), define_behavior(lambda _: sync(cleaned.set))
    )
    result = await asyncio.wait_for(
        run_async_exit(parallel(waiting, define_behavior(failing)).run(bot)), 1
    )
    assert isinstance(result, Failure)
    assert isinstance(result.error, Unavailable)
    assert cleaned.is_set()


async def test_race_waits_for_loser_cleanup_and_ignores_typed_failures() -> None:
    started = asyncio.Event()
    cleaned = asyncio.Event()

    async def blocked() -> int:
        started.set()
        await asyncio.Event().wait()
        return 0

    @fn("winner")
    def winner(_: SoulFireBot) -> EffectGen[int]:
        yield from from_async(started.wait)
        return 7

    loser = cleanup(
        define_behavior(lambda _: from_async(blocked)), define_behavior(lambda _: sync(cleaned.set))
    )
    result = await run_async(
        race(loser, define_behavior(lambda _: fail(Unavailable())), define_behavior(winner))
        .run(bot)
        .or_die()
    )
    assert result == 7
    assert cleaned.is_set()


async def test_cleanup_runs_on_external_cancellation() -> None:
    started = asyncio.Event()
    cleaned = asyncio.Event()

    async def wait() -> None:
        started.set()
        await asyncio.Event().wait()

    behavior = cleanup(
        define_behavior(lambda _: from_async(wait)), define_behavior(lambda _: sync(cleaned.set))
    )
    task = asyncio.create_task(run_async(behavior.run(bot)))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cleaned.is_set()


async def test_timeout_awaits_cleanup_before_returning_typed_failure() -> None:
    cleaned = asyncio.Event()
    behavior = cleanup(
        define_behavior(lambda _: from_async(asyncio.Event().wait)),
        define_behavior(lambda _: sync(cleaned.set)),
    )
    result = await run_async_exit(timeout(behavior, 0.001).run(bot))
    assert isinstance(result, Failure)
    assert isinstance(result.error, SoulFireBehaviorTimeoutError)
    assert cleaned.is_set()


async def test_retry_predicate_and_fallback_only_handle_typed_errors() -> None:
    attempts = 0

    @fn("fail")
    def failing(_: SoulFireBot) -> EffectGen[int, Unavailable]:
        nonlocal attempts
        attempts += 1
        return (yield from fail(Unavailable()))

    selected = fallback(
        retry(define_behavior(failing), attempts=4, while_=lambda _: False),
        define_behavior(lambda _: succeed(9)),
    )
    assert await run_async(selected.run(bot).or_die()) == 9
    assert attempts == 1
    defective = define_behavior(lambda _: sync(lambda: 1 / 0))
    with pytest.raises(ZeroDivisionError):
        await run_async(fallback(defective, define_behavior(lambda _: succeed(9))).run(bot))


async def test_until_accepts_an_effect_predicate() -> None:
    counter = InMemoryCounter()
    behavior = until(
        define_behavior(lambda _: sync(counter.increment)),
        lambda value: succeed(value == 3),
        maximum_iterations=4,
    )
    assert await run_async(behavior.run(bot).or_die()) == 3
