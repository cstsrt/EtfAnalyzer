from __future__ import annotations

from typing import Any

import requests


FRANKFURTER_URL = "https://api.frankfurter.app"


def load_rates(start_date: str, end_date: str, from_currency: str, to_currency: str) -> list[dict[str, Any]]:
    source = from_currency.strip().upper()
    target = to_currency.strip().upper()
    if not start_date or not end_date or not source or not target or source == target:
        return []

    response = requests.get(
        f"{FRANKFURTER_URL}/{start_date}..{end_date}",
        params={"from": source, "to": target},
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    rates = payload.get("rates") or {}
    return [
        {"date": date, "base_currency": source, "quote_currency": target, "rate": values[target]}
        for date, values in rates.items()
        if target in values
    ]
