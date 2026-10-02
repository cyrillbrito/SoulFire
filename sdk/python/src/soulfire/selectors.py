import re
from collections.abc import Iterable

from .inventory_pb2 import ItemSelector


def item_selector(value: str | ItemSelector) -> ItemSelector:
    if isinstance(value, ItemSelector):
        return value
    if value.startswith("#"):
        return ItemSelector(tags=[resource_id(value[1:])])
    return ItemSelector(item_ids=[resource_id(value)])


def block_selectors(values: str | Iterable[str]) -> tuple[tuple[str, ...], tuple[str, ...]]:
    ids: list[str] = []
    tags: list[str] = []
    for value in (values,) if isinstance(values, str) else values:
        if value.startswith("#"):
            tags.append(resource_id(value[1:]))
        else:
            ids.append(resource_id(value))
    return tuple(ids), tuple(tags)


def resource_id(value: str) -> str:
    normalized = value if ":" in value else f"minecraft:{value}"
    if re.fullmatch(r"[a-z0-9_.-]+:[a-z0-9/._-]+", normalized) is None:
        raise ValueError(f"Invalid Minecraft resource ID: {value}")
    return normalized
