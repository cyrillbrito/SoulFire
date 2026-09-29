from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Never

from effect_py import Effect, EffectGen, Scope, gen, scoped, succeed


@dataclass(frozen=True, slots=True)
class Item[A]:
    value: A


@dataclass(frozen=True, slots=True)
class End:
    pass


END = End()


@dataclass(frozen=True, slots=True)
class Cursor[A, E = Never, R = Never]:
    next: Callable[[], Effect[Item[A] | End, E, R]]


@dataclass(frozen=True, slots=True)
class Stream[A, E = Never, R = Never]:
    """A lazy stream. Each subscription acquires its own scoped cursor."""

    open: Effect[Cursor[A, E, R], E, R | Scope]

    def map[B](self, transform: Callable[[A], B]) -> Stream[B, E, R]:
        return Stream(self.open.map(lambda cursor: Cursor(lambda: cursor.next().map(
            lambda item: Item(transform(item.value)) if isinstance(item, Item) else END
        ))))

    def filter(self, predicate: Callable[[A], bool]) -> Stream[A, E, R]:
        @gen
        def acquire() -> EffectGen[Cursor[A, E, R], E, R | Scope]:
            cursor = yield from self.open

            @gen
            def next_item() -> EffectGen[Item[A] | End, E, R]:
                while True:
                    item = yield from cursor.next()
                    if isinstance(item, End) or predicate(item.value):
                        return item

            return Cursor(next_item)

        return Stream(acquire())

    def tap[E2 = Never, R2 = Never](self, action: Callable[[A], Effect[object, E2, R2]]) -> Stream[A, E | E2, R | R2]:
        @gen
        def acquire() -> EffectGen[Cursor[A, E | E2, R | R2], E | E2, R | R2 | Scope]:
            cursor = yield from self.open

            @gen
            def next_item() -> EffectGen[Item[A] | End, E | E2, R | R2]:
                item = yield from cursor.next()
                if isinstance(item, Item):
                    yield from action(item.value)
                return item

            return Cursor(next_item)

        return Stream(acquire())

    def take(self, count: int) -> Stream[A, E, R]:
        @gen
        def acquire() -> EffectGen[Cursor[A, E, R], E, R | Scope]:
            cursor = yield from self.open
            remaining = max(0, count)

            @gen
            def next_item() -> EffectGen[Item[A] | End, E, R]:
                nonlocal remaining
                if remaining == 0:
                    return END
                remaining -= 1
                return (yield from cursor.next())

            return Cursor(next_item)

        return Stream(acquire())

    def run_collect(self) -> Effect[tuple[A, ...], E, R]:
        @gen
        def collect() -> EffectGen[tuple[A, ...], E, R | Scope]:
            cursor = yield from self.open
            values: list[A] = []
            while True:
                item = yield from cursor.next()
                if isinstance(item, End):
                    return tuple(values)
                values.append(item.value)

        return scoped(collect())

    def run_for_each[E2 = Never, R2 = Never](self, action: Callable[[A], Effect[object, E2, R2]]) -> Effect[None, E | E2, R | R2]:
        @gen
        def consume() -> EffectGen[None, E | E2, R | R2 | Scope]:
            cursor = yield from self.open
            while True:
                item = yield from cursor.next()
                if isinstance(item, End):
                    return
                yield from action(item.value)

        return scoped(consume())

    def run_drain(self) -> Effect[None, E, R]:
        return self.run_for_each(lambda _: succeed(None))

    def run_head(self) -> Effect[A | None, E, R]:
        return self.take(1).run_collect().map(lambda values: values[0] if values else None)

    @staticmethod
    def unwrap[A2, E2 = Never, R2 = Never](effect: Effect[Stream[A2, E2, R2], E2, R2]) -> Stream[A2, E2, R2]:
        return Stream(effect.flat_map(lambda stream: stream.open))
