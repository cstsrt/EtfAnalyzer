from __future__ import annotations

from typing import Any


def _load_library():
    try:
        import justetf_scraping
    except ImportError as exc:
        raise RuntimeError(
            "justetf-scraping is not installed. Rebuild the Docker image so the GitHub dependency is installed."
        ) from exc
    return justetf_scraping


def dataframe_to_records(dataframe: Any) -> list[dict[str, Any]]:
    if dataframe is None:
        return []
    prepared = dataframe.reset_index()
    return prepared.to_dict(orient="records")


def load_overview_records(strategy: str | None = "epg-longOnly", enrich: bool = False) -> list[dict[str, Any]]:
    justetf_scraping = _load_library()
    kwargs: dict[str, Any] = {"enrich": enrich}
    if strategy:
        kwargs["strategy"] = strategy
    dataframe = justetf_scraping.load_overview(**kwargs)
    return dataframe_to_records(dataframe)


def load_chart_records(isin: str, unclosed: bool = False) -> list[dict[str, Any]]:
    justetf_scraping = _load_library()
    dataframe = justetf_scraping.load_chart(isin, unclosed=unclosed)
    return dataframe_to_records(dataframe)


def load_profile_record(isin: str) -> dict[str, Any]:
    justetf_scraping = _load_library()
    return dict(justetf_scraping.get_etf_overview(isin))
