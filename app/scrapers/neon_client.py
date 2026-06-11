from __future__ import annotations

import os
import re
from io import BytesIO
from dataclasses import dataclass

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader


ISIN_PATTERN = re.compile(r"\b[A-Z]{2}[A-Z0-9]{9}[0-9]\b")
DEFAULT_INSTRUMENT_LIST_URL = "https://static-assets.neon-free.ch/trading/asset-list/neon_invest_stocks_etfs.pdf"


@dataclass(frozen=True)
class NeonProductCandidate:
    isin: str
    label: str
    source_url: str


@dataclass(frozen=True)
class NeonInstrument:
    isin: str
    instrument_type: str
    neon_name: str
    full_name: str | None
    acc_dist: str | None
    zero_fee: bool | None
    source_url: str
    published_label: str | None = None


def configured_urls() -> list[str]:
    raw_urls = os.getenv("NEON_INVEST_URLS", "https://www.neon-free.ch/en/invest/")
    return [url.strip() for url in raw_urls.split(",") if url.strip()]


def instrument_list_url() -> str:
    return os.getenv("NEON_INSTRUMENT_LIST_URL", DEFAULT_INSTRUMENT_LIST_URL)


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


def _ignore_pdf_line(line: str) -> bool:
    if not line:
        return True
    ignored_patterns = (
        r"^neon Switzerland AG",
        r"^\d+/\d+",
        r"^Name ISIN$",
        r"^neon name",
        r"^Full name",
        r"^ISIN acc",
        r"^dist\.$",
        r"^0%$",
        r"^fee\*$",
        r"^✅ =",
        r"^\*\* =",
    )
    return any(re.search(pattern, line) for pattern in ignored_patterns)


def _split_instrument_names(instrument_type: str, text_before_isin: str) -> tuple[str, str | None]:
    cleaned = " ".join(text_before_isin.split())
    if instrument_type == "stock":
        return cleaned, cleaned

    issuer_patterns = (
        "Xtrackers",
        "iShares",
        "ISHARES",
        "WisdomTree",
        "Invesco",
        "LYX",
        "Market Access",
        "UBS",
        "SPDR",
        "Vanguard",
        "Swisscanto",
        "Franklin",
        "VanEck",
        "Global X",
        "L&G",
        "ZKB",
        "Leonteq",
        "ETP on",
        "Tracker Certificate",
    )
    candidates = [
        index
        for issuer in issuer_patterns
        if (index := cleaned.find(issuer)) > 0
    ]
    if not candidates:
        return cleaned, cleaned

    split_index = min(candidates)
    neon_name = cleaned[:split_index].strip()
    full_name = cleaned[split_index:].strip()
    return neon_name or cleaned, full_name or cleaned


def _parse_pdf_instruments(pdf_bytes: bytes, source_url: str) -> list[NeonInstrument]:
    reader = PdfReader(BytesIO(pdf_bytes))
    instruments: list[NeonInstrument] = []
    seen_isins: set[str] = set()
    section: str | None = None
    buffer: list[str] = []
    published_label: str | None = None

    def flush(line: str) -> None:
        text = " ".join([*buffer, line]).strip()
        buffer.clear()
        text = " ".join(text.split())
        match = ISIN_PATTERN.search(text)
        if not match:
            return

        isin = match.group(0).upper()
        if isin in seen_isins or not section:
            return
        seen_isins.add(isin)

        before = text[: match.start()].strip()
        after_tokens = text[match.end() :].strip().split()
        acc_dist = None
        zero_fee = None
        if after_tokens and after_tokens[0] in {"acc.", "dist.", "n/a"}:
            acc_dist = after_tokens.pop(0)
        if after_tokens:
            zero_fee = after_tokens[0] in {"✅", "✅**", "**"}

        neon_name, full_name = _split_instrument_names(section, before)
        instruments.append(
            NeonInstrument(
                isin=isin,
                instrument_type=section,
                neon_name=neon_name,
                full_name=full_name,
                acc_dist=acc_dist,
                zero_fee=zero_fee,
                source_url=source_url,
                published_label=published_label,
            )
        )

    for page in reader.pages:
        page_text = page.extract_text() or ""
        if not published_label:
            match = re.search(r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b", page_text)
            if match:
                published_label = match.group(0)

        for raw_line in page_text.splitlines():
            line = raw_line.strip()
            if line == "Stocks":
                section = "stock"
                buffer = []
                continue
            if line == "ETFs":
                section = "etf"
                buffer = []
                continue
            if line == "Crypto & other ETPs":
                section = "crypto_etp"
                buffer = []
                continue
            if not section or _ignore_pdf_line(line):
                continue
            if ISIN_PATTERN.search(line):
                flush(line)
            else:
                buffer.append(line)

    return instruments


def load_instrument_list(url: str | None = None) -> list[NeonInstrument]:
    source_url = url or instrument_list_url()
    response = requests.get(
        source_url,
        headers={
            "User-Agent": "neon-etf-analyzer/0.1 (+local personal research app)",
            "Accept": "application/pdf,*/*",
        },
        timeout=45,
    )
    response.raise_for_status()
    return _parse_pdf_instruments(response.content, source_url)
