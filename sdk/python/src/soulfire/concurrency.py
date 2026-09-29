from __future__ import annotations

import asyncio
from collections.abc import Iterable
from typing import Never

from effect_py import Effect, EffectGen, Fiber, Success, fork, from_async, gen, join, scoped, sync
from effect_py.fiber import await_exit

from .resources import ensuring


def parallel[A, E = Never, R = Never](
    effects: Iterable[Effect[A, E, R]], *, concurrency: int = 8
) -> Effect[tuple[A, ...], E, R]:
    """Run bounded workers, fail fast, and await every worker's cleanup."""

    @gen
    def run() -> EffectGen[tuple[A, ...], E, R]:
        if concurrency < 1:
            raise ValueError("concurrency must be at least 1")
        pending = iter(enumerate(effects))
        results: dict[int, A] = {}
        completed: asyncio.Queue[int] = asyncio.Queue()

        @gen
        def worker() -> EffectGen[None, E, R]:
            while True:
                entry = next(pending, None)
                if entry is None:
                    return
                index, effect = entry
                results[index] = yield from effect

        fibers: list[Fiber[None, E]] = []
        for index in range(concurrency):
            fibers.append(
                (
                    yield from fork(
                        ensuring(worker, sync(lambda index=index: completed.put_nowait(index)))
                    )
                )
            )
        for _ in fibers:
            index = yield from from_async(completed.get)
            yield from join(fibers[index])
        return tuple((value for _, value in sorted(results.items())))

    return scoped(run)


def race[A, E = Never, R = Never](
    first: Effect[A, E, R], *others: Effect[A, E, R]
) -> Effect[A, E, R]:
    """Return the first success and await all losing fibers' cleanup."""

    @gen
    def run() -> EffectGen[A, E, R]:
        completed: asyncio.Queue[int] = asyncio.Queue()
        fibers: list[Fiber[A, E]] = []
        for index, effect in enumerate((first, *others)):
            fibers.append(
                (
                    yield from fork(
                        ensuring(effect, sync(lambda index=index: completed.put_nowait(index)))
                    )
                )
            )
        last = 0
        for _ in fibers:
            last = yield from from_async(completed.get)
            result = yield from await_exit(fibers[last])
            if isinstance(result, Success):
                return result.value
            if result.cause.defects or result.cause.interrupted:
                return (yield from join(fibers[last]))
        return (yield from join(fibers[last]))

    return scoped(run)
