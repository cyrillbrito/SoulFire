from __future__ import annotations

from typing import Never

from effect_py import Effect, EffectGen, Scope, add_finalizer, gen, scoped


def ensuring[A, E = Never, R = Never](
    effect: Effect[A, E, R],
    finalizer: Effect[object],
) -> Effect[A, E, R]:
    """Run a scope finalizer after success, failure, defect, or interruption."""

    @gen
    def run() -> EffectGen[A, E, R | Scope]:
        yield from add_finalizer(lambda _: finalizer)
        return (yield from effect)

    return scoped(run)
