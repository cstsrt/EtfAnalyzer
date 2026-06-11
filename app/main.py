from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import database
from app.scrapers import justetf_client, neon_client


app = FastAPI(title="neon ETF Analyzer", version="0.1.0")


class ManualProductsRequest(BaseModel):
    isins: list[str] = Field(default_factory=list)
    source_name: str | None = None
    notes: str | None = None


class ChartSyncRequest(BaseModel):
    isins: list[str] = Field(default_factory=list)
    unclosed: bool = False


class ProfileSyncRequest(BaseModel):
    isins: list[str] = Field(default_factory=list)


class EventRequest(BaseModel):
    event_date: str
    title: str
    category: str | None = None
    notes: str | None = None


def parse_json_column(value: str | None) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def clean_product(row: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(row)
    for key in ("countries_json", "sectors_json", "holdings_json", "raw_json"):
        cleaned[key.replace("_json", "")] = parse_json_column(cleaned.pop(key, None))
    cleaned["is_neon_product"] = bool(cleaned.get("is_neon_product"))
    return cleaned


@app.on_event("startup")
def startup() -> None:
    database.init_db()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/products")
def products(
    scope: Literal["neon", "all"] = "neon",
    search: str | None = None,
    asset_class: str | None = None,
    region: str | None = None,
    currency: str | None = None,
    distribution_policy: str | None = None,
    replication: str | None = None,
    max_ter: float | None = None,
    min_fund_size: float | None = None,
    max_risk: float | None = None,
    sort: str = "name",
    direction: Literal["asc", "desc"] = "asc",
    limit: int = Query(250, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    allowed_sort_columns = {
        "name",
        "ter",
        "fund_size_mn",
        "return_1y",
        "return_3y",
        "return_5y",
        "volatility_1y",
        "max_drawdown",
        "updated_at",
    }
    sort_column = sort if sort in allowed_sort_columns else "name"
    where_clauses: list[str] = []
    values: list[Any] = []

    if scope == "neon":
        where_clauses.append("offered_products.is_active = 1")
    if search:
        where_clauses.append("(etfs.name LIKE ? OR etfs.isin LIKE ? OR etfs.ticker LIKE ?)")
        search_value = f"%{search}%"
        values.extend([search_value, search_value, search_value])
    for column, value in {
        "asset_class": asset_class,
        "region": region,
        "currency": currency,
        "distribution_policy": distribution_policy,
        "replication": replication,
    }.items():
        if value:
            where_clauses.append(f"etfs.{column} = ?")
            values.append(value)
    if max_ter is not None:
        where_clauses.append("etfs.ter <= ?")
        values.append(max_ter)
    if min_fund_size is not None:
        where_clauses.append("etfs.fund_size_mn >= ?")
        values.append(min_fund_size)
    if max_risk is not None:
        where_clauses.append("etfs.risk_indicator <= ?")
        values.append(max_risk)

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    direction_sql = "DESC" if direction == "desc" else "ASC"

    with database.connect() as connection:
        rows = connection.execute(
            f"""
            SELECT
                etfs.*,
                offered_products.source_name,
                offered_products.source_url,
                offered_products.notes,
                CASE WHEN offered_products.isin IS NULL THEN 0 ELSE 1 END AS is_neon_product
            FROM etfs
            LEFT JOIN offered_products ON offered_products.isin = etfs.isin
            {where_sql}
            ORDER BY etfs.{sort_column} IS NULL, etfs.{sort_column} {direction_sql}
            LIMIT ? OFFSET ?
            """,
            [*values, limit, offset],
        ).fetchall()
        total = connection.execute(
            f"""
            SELECT COUNT(*) AS count
            FROM etfs
            LEFT JOIN offered_products ON offered_products.isin = etfs.isin
            {where_sql}
            """,
            values,
        ).fetchone()["count"]

    return {"items": [clean_product(database.row_to_dict(row)) for row in rows], "total": total}


@app.get("/api/filters")
def filters(scope: Literal["neon", "all"] = "neon") -> dict[str, Any]:
    join_sql = "JOIN offered_products ON offered_products.isin = etfs.isin AND offered_products.is_active = 1" if scope == "neon" else ""
    with database.connect() as connection:
        result: dict[str, Any] = {}
        for column in ("asset_class", "region", "currency", "distribution_policy", "replication"):
            rows = connection.execute(
                f"SELECT DISTINCT etfs.{column} AS value FROM etfs {join_sql} WHERE etfs.{column} IS NOT NULL ORDER BY etfs.{column}"
            ).fetchall()
            result[column] = [row["value"] for row in rows]
        ranges = connection.execute(
            f"""
            SELECT
                MIN(ter) AS min_ter,
                MAX(ter) AS max_ter,
                MIN(fund_size_mn) AS min_fund_size,
                MAX(fund_size_mn) AS max_fund_size,
                MIN(risk_indicator) AS min_risk,
                MAX(risk_indicator) AS max_risk
            FROM etfs {join_sql}
            """
        ).fetchone()
        result["ranges"] = database.row_to_dict(ranges)
    return result


@app.post("/api/neon/products")
def add_neon_products(payload: ManualProductsRequest) -> dict[str, Any]:
    unique_isins = sorted({isin.strip().upper() for isin in payload.isins if isin.strip()})
    for isin in unique_isins:
        database.upsert_offered_product(isin, source_name=payload.source_name, notes=payload.notes)
    return {"added": len(unique_isins), "isins": unique_isins}


@app.post("/api/sync/neon")
def sync_neon(urls: list[str] | None = Body(default=None)) -> dict[str, Any]:
    run_id = database.start_sync_run("neon")
    try:
        candidates = neon_client.scan_neon_pages(urls)
        for candidate in candidates:
            database.upsert_offered_product(candidate.isin, candidate.label, candidate.source_url)
        message = f"Found {len(candidates)} ISIN candidates on neon pages."
        database.finish_sync_run(run_id, "success", message, len(candidates))
        return {"run_id": run_id, "message": message, "items": [candidate.__dict__ for candidate in candidates]}
    except Exception as exc:
        database.finish_sync_run(run_id, "failed", str(exc), 0)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/sync/justetf/overview")
def sync_justetf_overview(
    strategy: str | None = "epg-longOnly",
    enrich: bool = False,
    neon_only: bool = False,
) -> dict[str, Any]:
    run_id = database.start_sync_run("justetf-overview")
    try:
        records = justetf_client.load_overview_records(strategy=strategy, enrich=enrich)
        if neon_only:
            with database.connect() as connection:
                neon_isins = {
                    row["isin"]
                    for row in connection.execute("SELECT isin FROM offered_products WHERE is_active = 1").fetchall()
                }
            records = [record for record in records if str(record.get("isin", "")).upper() in neon_isins]
        for record in records:
            database.upsert_etf(record)
        message = f"Imported {len(records)} ETF overview records from justETF."
        database.finish_sync_run(run_id, "success", message, len(records))
        return {"run_id": run_id, "message": message, "records": len(records)}
    except Exception as exc:
        database.finish_sync_run(run_id, "failed", str(exc), 0)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/sync/justetf/charts")
def sync_justetf_charts(payload: ChartSyncRequest) -> dict[str, Any]:
    run_id = database.start_sync_run("justetf-charts")
    unique_isins = sorted({isin.strip().upper() for isin in payload.isins if isin.strip()})
    try:
        records_count = 0
        for isin in unique_isins:
            records = justetf_client.load_chart_records(isin, unclosed=payload.unclosed)
            for record in records:
                database.upsert_performance_point(isin, record)
            records_count += len(records)
        message = f"Imported {records_count} chart points for {len(unique_isins)} ETFs."
        database.finish_sync_run(run_id, "success", message, records_count)
        return {"run_id": run_id, "message": message, "records": records_count}
    except Exception as exc:
        database.finish_sync_run(run_id, "failed", str(exc), 0)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/sync/justetf/profiles")
def sync_justetf_profiles(payload: ProfileSyncRequest) -> dict[str, Any]:
    run_id = database.start_sync_run("justetf-profiles")
    unique_isins = sorted({isin.strip().upper() for isin in payload.isins if isin.strip()})
    try:
        for isin in unique_isins:
            record = justetf_client.load_profile_record(isin)
            record["isin"] = isin
            database.upsert_etf(record)
        message = f"Imported {len(unique_isins)} ETF profiles from justETF."
        database.finish_sync_run(run_id, "success", message, len(unique_isins))
        return {"run_id": run_id, "message": message, "records": len(unique_isins)}
    except Exception as exc:
        database.finish_sync_run(run_id, "failed", str(exc), 0)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/performance")
def performance(
    isins: str,
    from_date: str | None = None,
    normalize: bool = True,
) -> dict[str, Any]:
    requested_isins = [isin.strip().upper() for isin in isins.split(",") if isin.strip()]
    if not requested_isins:
        return {"series": []}

    with database.connect() as connection:
        series = []
        for isin in requested_isins:
            values: list[Any] = [isin]
            date_filter = ""
            if from_date:
                date_filter = "AND date >= ?"
                values.append(from_date)
            rows = connection.execute(
                f"""
                SELECT date, quote, quote_with_dividends, quote_with_reinvested_dividends, relative, relative_with_dividends
                FROM performance_points
                WHERE isin = ? {date_filter}
                ORDER BY date
                """,
                values,
            ).fetchall()
            points = [database.row_to_dict(row) for row in rows]
            base = None
            if normalize and points:
                first_point = points[0]
                base = first_point.get("quote_with_reinvested_dividends") or first_point.get("quote_with_dividends") or first_point.get("quote")
            for point in points:
                raw_value = point.get("quote_with_reinvested_dividends") or point.get("quote_with_dividends") or point.get("quote")
                point["value"] = ((raw_value / base) - 1) * 100 if normalize and base and raw_value is not None else raw_value
            name_row = connection.execute("SELECT name FROM etfs WHERE isin = ?", (isin,)).fetchone()
            series.append({"isin": isin, "name": name_row["name"] if name_row else isin, "points": points})

    return {"series": series}


@app.get("/api/sync/runs")
def sync_runs(limit: int = Query(20, ge=1, le=100)) -> dict[str, Any]:
    with database.connect() as connection:
        rows = connection.execute("SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return {"items": [database.row_to_dict(row) for row in rows]}


@app.get("/api/events")
def list_events() -> dict[str, Any]:
    with database.connect() as connection:
        rows = connection.execute("SELECT * FROM market_events ORDER BY event_date DESC, id DESC").fetchall()
    return {"items": [database.row_to_dict(row) for row in rows]}


@app.post("/api/events")
def create_event(payload: EventRequest) -> dict[str, Any]:
    with database.connect() as connection:
        cursor = connection.execute(
            """
            INSERT INTO market_events (event_date, title, category, notes, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (payload.event_date, payload.title, payload.category, payload.notes, database.utc_now()),
        )
        event_id = int(cursor.lastrowid)
    return {"id": event_id}


@app.get("/api/export/snapshot")
def export_snapshot() -> dict[str, Any]:
    with database.connect() as connection:
        etfs = [clean_product(database.row_to_dict(row)) for row in connection.execute(
            """
            SELECT
                etfs.*,
                offered_products.source_name,
                offered_products.source_url,
                offered_products.notes,
                CASE WHEN offered_products.isin IS NULL THEN 0 ELSE 1 END AS is_neon_product
            FROM etfs
            LEFT JOIN offered_products ON offered_products.isin = etfs.isin
            ORDER BY is_neon_product DESC, etfs.name
            """
        ).fetchall()]
        performance_rows = [
            database.row_to_dict(row)
            for row in connection.execute("SELECT * FROM performance_points ORDER BY isin, date").fetchall()
        ]
        events = [database.row_to_dict(row) for row in connection.execute("SELECT * FROM market_events ORDER BY event_date").fetchall()]
        sync_history = [database.row_to_dict(row) for row in connection.execute("SELECT * FROM sync_runs ORDER BY id DESC LIMIT 50").fetchall()]

    return {
        "generated_at": database.utc_now(),
        "purpose": "ChatGPT-ready export for ETF comparison and contextual investment research.",
        "disclaimer": "Decision-support data only; not financial advice.",
        "etfs": etfs,
        "performance_points": performance_rows,
        "market_events": events,
        "sync_history": sync_history,
    }


static_path = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_path), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(static_path / "index.html")
