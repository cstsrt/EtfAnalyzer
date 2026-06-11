from __future__ import annotations

import os
import re
from dataclasses import dataclass

import requests
from bs4 import BeautifulSoup


ISIN_PATTERN = re.compile(r"\b[A-Z]{2}[A-Z0-9]{9}[0-9]\b")


@dataclass(frozen=True)
class NeonProductCandidate:
    isin: str
    label: str
    source_url: str


def configured_urls() -> list[str]:
    raw_urls = os.getenv("NEON_INVEST_URLS", "https://www.neon-free.ch/en/invest/")
    return [url.strip() for url in raw_urls.split(",") if url.strip()]


def _context_label(text: str, start: int, end: int) -> str:
    prefix = text[max(0, start - 120) : start].strip()
    suffix = text[end : min(len(text), end + 160)].strip()
    label = " ".join(f"{prefix} {suffix}".split())
    return label[:240]


def scan_neon_pages(urls: list[str] | None = None) -> list[NeonProductCandidate]:
    candidates: dict[str, NeonProductCandidate] = {}
    headers = {
        "User-Agent": "neon-etf-analyzer/0.1 (+local personal research app)",
        "Accept": "text/html,application/xhtml+xml",
    }

    for url in urls or configured_urls():
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        page_text = soup.get_text(" ", strip=True)
        for match in ISIN_PATTERN.finditer(page_text):
            isin = match.group(0).upper()
            candidates[isin] = NeonProductCandidate(
                isin=isin,
                label=_context_label(page_text, match.start(), match.end()),
                source_url=url,
            )

    return sorted(candidates.values(), key=lambda candidate: candidate.isin)
