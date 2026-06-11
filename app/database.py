from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


DATABASE_PATH = Path(os.getenv("ETF_ANALYZER_DB", "data/etf_analyzer.sqlite3"))


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_value(value: Any) -> Any:
    if value is None:
        return None
    try:
        import math

        if isinstance(value, float) and math.isnan(value):
            return None
    except TypeError:
        pass
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def normalize_record(record: dict[str, Any]) -> dict[str, Any]:
    return {key: normalize_value(value) for key, value in record.items()}


def json_dumps(value: Any) -> str:
    return json.dumps(value, default=str, ensure_ascii=False, sort_keys=True)


@contextmanager
def connect() -> Iterable[sqlite3.Connection]:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def init_db() -> None:
    with connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS etfs (
                isin TEXT PRIMARY KEY,
                name TEXT,
                ticker TEXT,
                wkn TEXT,
                valor TEXT,
                strategy TEXT,
                asset_class TEXT,
                region TEXT,
                currency TEXT,
                domicile_country TEXT,
                index_name TEXT,
                ter REAL,
                fund_size_mn REAL,
                distribution_policy TEXT,
                replication TEXT,
                inception_date TEXT,
                risk_indicator REAL,
                return_1y REAL,
                return_3y REAL,
                return_5y REAL,
                volatility_1y REAL,
                volatility_3y REAL,
                volatility_5y REAL,
                max_drawdown REAL,
                description TEXT,
                countries_json TEXT,
                sectors_json TEXT,
                holdings_json TEXT,
                raw_json TEXT NOT NULL DEFAULT '{}',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS offered_products (
                isin TEXT PRIMARY KEY,
                source TEXT NOT NULL DEFAULT 'neon',
                instrument_type TEXT,
                neon_name TEXT,
                full_name TEXT,
                acc_dist TEXT,
                zero_fee INTEGER,
                source_name TEXT,
                source_url TEXT,
                notes TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (isin) REFERENCES etfs(isin) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS performance_points (
                isin TEXT NOT NULL,
                date TEXT NOT NULL,
                quote REAL,
                relative REAL,
                dividends REAL,
                cumulative_dividends REAL,
                quote_with_dividends REAL,
                relative_with_dividends REAL,
                quote_with_reinvested_dividends REAL,
                relative_with_reinvested_dividends REAL,
                raw_json TEXT NOT NULL DEFAULT '{}',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (isin, date)
            );

            CREATE TABLE IF NOT EXISTS sync_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                status TEXT NOT NULL,
                message TEXT,
                records INTEGER NOT NULL DEFAULT 0,
                started_at TEXT NOT NULL,
                completed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS market_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_date TEXT NOT NULL,
                title TEXT NOT NULL,
                category TEXT,
                notes TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_etfs_name ON etfs(name);
            CREATE INDEX IF NOT EXISTS idx_etfs_filters ON etfs(asset_class, region, currency, distribution_policy, replication);
            CREATE INDEX IF NOT EXISTS idx_performance_isin_date ON performance_points(isin, date);
            """
        )
        ensure_column(connection, "offered_products", "instrument_type", "TEXT")
        ensure_column(connection, "offered_products", "neon_name", "TEXT")
        ensure_column(connection, "offered_products", "full_name", "TEXT")
        ensure_column(connection, "offered_products", "acc_dist", "TEXT")
        ensure_column(connection, "offered_products", "zero_fee", "INTEGER")
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_offered_products_type ON offered_products(instrument_type, zero_fee)"
        )


def ensure_column(connection: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def start_sync_run(source: str) -> int:
    with connect() as connection:
        cursor = connection.execute(
            "INSERT INTO sync_runs (source, status, started_at) VALUES (?, ?, ?)",
            (source, "running", utc_now()),
        )
        return int(cursor.lastrowid)


def finish_sync_run(run_id: int, status: str, message: str, records: int = 0) -> None:
    with connect() as connection:
        connection.execute(
            """
            UPDATE sync_runs
            SET status = ?, message = ?, records = ?, completed_at = ?
            WHERE id = ?
            """,
            (status, message, records, utc_now(), run_id),
        )


ETF_COLUMN_ALIASES = {
    "index_name": ["index", "tracked_index", "benchmark"],
    "fund_size_mn": ["fund_size_mn", "fund_size_million", "fund_size_eur", "fund_size"],
    "distribution_policy": ["distribution_policy", "distribution", "use_of_profit"],
    "replication": ["replication", "replication_method"],
    "risk_indicator": ["risk_indicator", "srri"],
    "return_1y": ["last_year_return", "one_year_return", "return_1y"],
    "return_3y": ["last_three_years_return", "three_year_return", "return_3y"],
    "return_5y": ["last_five_years_return", "five_year_return", "return_5y"],
    "volatility_1y": ["last_year_volatility", "one_year_volatility", "volatility_1y"],
    "volatility_3y": ["last_three_years_volatility", "three_year_volatility", "volatility_3y"],
    "volatility_5y": ["last_five_years_volatility", "five_year_volatility", "volatility_5y"],
    "max_drawdown": ["max_drawdown"],
}


def pick(record: dict[str, Any], key: str) -> Any:
    if key in record:
        return record.get(key)
    for alias in ETF_COLUMN_ALIASES.get(key, []):
        if alias in record:
            return record.get(alias)
    return None


def upsert_etf(record: dict[str, Any]) -> None:
    normalized = normalize_record(record)
    isin = str(normalized.get("isin") or "").strip().upper()
    if not isin:
        return

    countries = pick(normalized, "countries")
    sectors = pick(normalized, "sectors")
    holdings = pick(normalized, "top_holdings") or pick(normalized, "holdings")

    values = {
        "isin": isin,
        "name": pick(normalized, "name"),
        "ticker": pick(normalized, "ticker"),
        "wkn": pick(normalized, "wkn"),
        "valor": pick(normalized, "valor"),
        "strategy": pick(normalized, "strategy"),
        "asset_class": pick(normalized, "asset_class"),
        "region": pick(normalized, "region"),
        "currency": pick(normalized, "currency") or pick(normalized, "fund_currency"),
        "domicile_country": pick(normalized, "domicile_country") or pick(normalized, "fund_domicile"),
        "index_name": pick(normalized, "index_name"),
        "ter": pick(normalized, "ter"),
        "fund_size_mn": pick(normalized, "fund_size_mn"),
        "distribution_policy": pick(normalized, "distribution_policy"),
        "replication": pick(normalized, "replication"),
        "inception_date": pick(normalized, "inception_date"),
        "risk_indicator": pick(normalized, "risk_indicator"),
        "return_1y": pick(normalized, "return_1y"),
        "return_3y": pick(normalized, "return_3y"),
        "return_5y": pick(normalized, "return_5y"),
        "volatility_1y": pick(normalized, "volatility_1y"),
        "volatility_3y": pick(normalized, "volatility_3y"),
        "volatility_5y": pick(normalized, "volatility_5y"),
        "max_drawdown": pick(normalized, "max_drawdown"),
        "description": pick(normalized, "description"),
        "countries_json": json_dumps(countries or []),
        "sectors_json": json_dumps(sectors or []),
        "holdings_json": json_dumps(holdings or []),
        "raw_json": json_dumps(normalized),
        "updated_at": utc_now(),
    }

    columns = list(values.keys())
    update_columns = [column for column in columns if column != "isin"]
    placeholders = ", ".join(["?"] * len(columns))
    update_clause = ", ".join([f"{column}=excluded.{column}" for column in update_columns])

    with connect() as connection:
        connection.execute(
            f"""
            INSERT INTO etfs ({", ".join(columns)})
            VALUES ({placeholders})
            ON CONFLICT(isin) DO UPDATE SET {update_clause}
            """,
            [values[column] for column in columns],
        )


def upsert_offered_product(
    isin: str,
    source_name: str | None = None,
    source_url: str | None = None,
    notes: str | None = None,
    instrument_type: str | None = None,
    neon_name: str | None = None,
    full_name: str | None = None,
    acc_dist: str | None = None,
    zero_fee: bool | None = None,
) -> None:
    normalized_isin = isin.strip().upper()
    now = utc_now()
    display_name = full_name or neon_name or source_name or normalized_isin
    with connect() as connection:
        connection.execute(
            """
            INSERT OR IGNORE INTO etfs (isin, name, raw_json, updated_at)
            VALUES (?, ?, '{}', ?)
            """,
            (normalized_isin, display_name, now),
        )
        connection.execute(
            """
            UPDATE etfs
            SET name = CASE
                    WHEN name IS NULL OR name = isin THEN ?
                    ELSE name
                END,
                updated_at = ?
            WHERE isin = ?
            """,
            (display_name, now, normalized_isin),
        )
        connection.execute(
            """
            INSERT INTO offered_products (
                isin, source, instrument_type, neon_name, full_name, acc_dist, zero_fee,
                source_name, source_url, notes, is_active, created_at, updated_at
            )
            VALUES (?, 'neon', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(isin) DO UPDATE SET
                instrument_type = COALESCE(excluded.instrument_type, offered_products.instrument_type),
                neon_name = COALESCE(excluded.neon_name, offered_products.neon_name),
                full_name = COALESCE(excluded.full_name, offered_products.full_name),
                acc_dist = COALESCE(excluded.acc_dist, offered_products.acc_dist),
                zero_fee = COALESCE(excluded.zero_fee, offered_products.zero_fee),
                source_name = COALESCE(excluded.source_name, offered_products.source_name),
                source_url = COALESCE(excluded.source_url, offered_products.source_url),
                notes = COALESCE(excluded.notes, offered_products.notes),
                is_active = 1,
                updated_at = excluded.updated_at
            """,
            (
                normalized_isin,
                instrument_type,
                neon_name,
                full_name,
                acc_dist,
                int(zero_fee) if zero_fee is not None else None,
                source_name,
                source_url,
                notes,
                now,
                now,
            ),
        )


def upsert_performance_point(isin: str, record: dict[str, Any]) -> None:
    normalized = normalize_record(record)
    point_date = str(normalized.get("date") or "").split("T")[0]
    if not point_date:
        return

    values = {
        "isin": isin.strip().upper(),
        "date": point_date,
        "quote": normalized.get("quote"),
        "relative": normalized.get("relative"),
        "dividends": normalized.get("dividends"),
        "cumulative_dividends": normalized.get("cumulative_dividends"),
        "quote_with_dividends": normalized.get("quote_with_dividends"),
        "relative_with_dividends": normalized.get("relative_with_dividends"),
        "quote_with_reinvested_dividends": normalized.get("quote_with_reinvested_dividends"),
        "relative_with_reinvested_dividends": normalized.get("relative_with_reinvested_dividends"),
        "raw_json": json_dumps(normalized),
        "updated_at": utc_now(),
    }

    columns = list(values.keys())
    placeholders = ", ".join(["?"] * len(columns))
    update_columns = [column for column in columns if column not in {"isin", "date"}]
    update_clause = ", ".join([f"{column}=excluded.{column}" for column in update_columns])

    with connect() as connection:
        connection.execute(
            f"""
            INSERT INTO performance_points ({", ".join(columns)})
            VALUES ({placeholders})
            ON CONFLICT(isin, date) DO UPDATE SET {update_clause}
            """,
            [values[column] for column in columns],
        )
