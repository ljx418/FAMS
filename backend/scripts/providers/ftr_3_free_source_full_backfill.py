#!/usr/bin/env python3
import argparse
import contextlib
import hashlib
import io
import json
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from pathlib import Path


DECISION_DATES = ["2025-12-12", "2026-01-20", "2026-03-03", "2026-04-08", "2026-05-15", "2026-06-22"]
REPORT_PERIODS = ["20250930", "20251231", "20260331"]
DIVIDEND_PERIODS = ["20221231", "20231231", "20241231", "20251231"]
PRICE_START = "20241001"
PRICE_END = "20260622"
_write_lock = threading.Lock()


def now_iso():
    return datetime.now().astimezone().isoformat()


def clean(value):
    if value is None:
        return None
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if hasattr(value, "item"):
        try:
            value = value.item()
        except Exception:
            pass
    if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
        return None
    if isinstance(value, dict):
        return {str(key): clean(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(item) for item in value]
    return value


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path, value, immutable=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if immutable and path.exists():
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    temporary = path.with_suffix(path.suffix + f".{os.getpid()}.{threading.get_ident()}.tmp")
    with open(temporary, "x", encoding="utf-8") as handle:
        json.dump(clean(value), handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write("\n")
    os.replace(temporary, path)
    return value


def valid_price_shard(path, symbol):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = json.load(handle)
        return value.get("symbol") == symbol and value.get("liveCall") is True and isinstance(value.get("rows"), list)
    except Exception:
        return False


def valid_status_shard(path, symbol):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = json.load(handle)
        return (
            value.get("symbol") == symbol
            and value.get("liveCall") is True
            and value.get("evidenceMode") == "baostock_direct_daily"
            and isinstance(value.get("rows"), list)
        )
    except Exception:
        return False


def collect_result_set(result_set):
    rows = []
    while result_set.error_code == "0" and result_set.next():
        rows.append(dict(zip(result_set.fields, result_set.get_row_data())))
    return rows


def baostock_one(output_path, endpoint, decision_date=None):
    import baostock as bs

    output_path = Path(output_path)
    if output_path.exists():
        return
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
        login = bs.login()
    if login.error_code != "0":
        raise RuntimeError(f"baostock_login_failed:{login.error_code}:{login.error_msg}")
    started = time.monotonic()
    if endpoint == "stock_basic":
        result = bs.query_stock_basic()
    elif endpoint == "all_stock":
        result = bs.query_all_stock(day=decision_date)
    elif endpoint == "industry":
        result = bs.query_stock_industry(date=decision_date)
    else:
        raise RuntimeError(f"unsupported_baostock_endpoint:{endpoint}")
    rows = collect_result_set(result)
    if result.error_code != "0" or not rows:
        raise RuntimeError(f"baostock_{endpoint}_failed:{decision_date or 'all'}:{result.error_code}:{result.error_msg}")
    atomic_json(output_path, {
        "provider": "baostock", "providerVersion": getattr(bs, "__version__", "unknown"),
        "endpoint": endpoint, "decisionDate": decision_date, "liveCall": True,
        "fields": result.fields, "rowCount": len(rows), "rows": rows,
        "elapsedMs": round((time.monotonic() - started) * 1000), "generatedAt": now_iso(),
    }, immutable=True)


def run_baostock_child(path, endpoint, decision_date=None):
    command = [sys.executable, str(Path(__file__).resolve()), "--mode", "baostock-one", "--output-path", str(path), "--endpoint", endpoint]
    if decision_date:
        command.extend(["--decision-date", decision_date])
    errors = []
    for attempt in range(1, 3):
        try:
            subprocess.run(command, check=True, capture_output=True, text=True, timeout=420)
            if path.exists():
                return
            errors.append(f"attempt_{attempt}:missing_output")
        except subprocess.TimeoutExpired:
            errors.append(f"attempt_{attempt}:timeout_420s")
        except subprocess.CalledProcessError as exc:
            errors.append(f"attempt_{attempt}:{(exc.stderr or exc.stdout or str(exc))[-400:]}")
        time.sleep(attempt * 2)
    raise RuntimeError(f"baostock_child_failed:{endpoint}:{decision_date or 'all'}:{'|'.join(errors)}")


def collect_baostock(lake):
    target = Path(lake) / "raw" / "baostock"
    target.mkdir(parents=True, exist_ok=True)
    basic_path = target / "stock_basic.json"
    if not basic_path.exists():
        run_baostock_child(basic_path, "stock_basic")


def baostock_status_chunk(chunk_path, status_dir, result_path):
    import baostock as bs

    with open(chunk_path, "r", encoding="utf-8") as handle:
        symbols = json.load(handle)
    status_dir = Path(status_dir)
    status_dir.mkdir(parents=True, exist_ok=True)
    captured = io.StringIO()

    def login():
        with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
            response = bs.login()
        if response.error_code != "0":
            raise RuntimeError(f"baostock_login_failed:{response.error_code}:{response.error_msg}")

    login()
    completed = 0
    failures = []
    for symbol in symbols:
        output = status_dir / f"{symbol}.json"
        if valid_status_shard(output, symbol):
            completed += 1
            continue
        last_error = None
        for attempt in range(1, 4):
            started = time.monotonic()
            try:
                provider_code = f"{market_prefix(symbol)}.{symbol}"
                result = bs.query_history_k_data_plus(
                    provider_code,
                    "date,code,tradestatus,isST",
                    DECISION_DATES[0],
                    DECISION_DATES[-1],
                    frequency="d",
                    adjustflag="3",
                )
                rows = collect_result_set(result)
                if result.error_code != "0":
                    raise RuntimeError(f"query_failed:{result.error_code}:{result.error_msg}")
                selected = [row for row in rows if row.get("date") in DECISION_DATES]
                if not selected:
                    raise RuntimeError("decision_status_rows_empty")
                atomic_json(output, {
                    "provider": "baostock",
                    "providerVersion": getattr(bs, "__version__", "unknown"),
                    "endpoint": "query_history_k_data_plus",
                    "symbol": symbol,
                    "providerCode": provider_code,
                    "liveCall": True,
                    "evidenceMode": "baostock_direct_daily",
                    "fields": result.fields,
                    "requestedDecisionDates": DECISION_DATES,
                    "rowCount": len(selected),
                    "rows": selected,
                    "attemptCount": attempt,
                    "elapsedMs": round((time.monotonic() - started) * 1000),
                    "generatedAt": now_iso(),
                }, immutable=True)
                completed += 1
                last_error = None
                break
            except Exception as exc:
                last_error = f"{type(exc).__name__}:{str(exc)[:300]}"
                with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
                    try:
                        bs.logout()
                    except Exception:
                        pass
                time.sleep(attempt)
                try:
                    login()
                except Exception as login_error:
                    last_error = f"{last_error}|relogin:{type(login_error).__name__}:{str(login_error)[:200]}"
        if last_error:
            failures.append({"symbol": symbol, "attemptCount": 3, "error": last_error})
    with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
        try:
            bs.logout()
        except Exception:
            pass
    atomic_json(result_path, {
        "status": "completed" if not failures else "partial",
        "symbolCount": len(symbols),
        "completedShardCount": completed,
        "failures": failures,
        "generatedAt": now_iso(),
    })


def collect_statuses(lake, workers):
    lake = Path(lake)
    target = lake / "raw" / "status"
    failures_dir = lake / "raw" / "status-failures"
    work_dir = lake / "work" / "status-chunks"
    target.mkdir(parents=True, exist_ok=True)
    failures_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    symbols = load_price_symbols(lake)
    pending = [symbol for symbol in symbols if not valid_status_shard(target / f"{symbol}.json", symbol)]
    if pending:
        chunk_count = min(workers, len(pending))
        chunks = [pending[index::chunk_count] for index in range(chunk_count)]

        def run_chunk(index_and_symbols):
            index, chunk = index_and_symbols
            chunk_path = work_dir / f"chunk-{index}.json"
            result_path = work_dir / f"result-{index}.json"
            atomic_json(chunk_path, chunk)
            command = [
                sys.executable,
                str(Path(__file__).resolve()),
                "--mode", "baostock-status-chunk",
                "--chunk-path", str(chunk_path),
                "--status-dir", str(target),
                "--result-path", str(result_path),
            ]
            try:
                subprocess.run(command, check=True, capture_output=True, text=True, timeout=1800)
            except subprocess.TimeoutExpired as exc:
                return {"chunk": index, "error": "timeout_1800s", "detail": str(exc)[:300]}
            except subprocess.CalledProcessError as exc:
                return {"chunk": index, "error": "child_failed", "detail": (exc.stderr or exc.stdout or str(exc))[-500:]}
            if not result_path.exists():
                return {"chunk": index, "error": "result_missing"}
            with open(result_path, "r", encoding="utf-8") as handle:
                return json.load(handle)

        with ThreadPoolExecutor(max_workers=chunk_count) as executor:
            chunk_results = list(executor.map(run_chunk, enumerate(chunks)))
    else:
        chunk_results = []

    completed = sum(1 for symbol in symbols if valid_status_shard(target / f"{symbol}.json", symbol))
    missing = [symbol for symbol in symbols if not valid_status_shard(target / f"{symbol}.json", symbol)]
    failure_details = {
        failure.get("symbol"): failure
        for result in chunk_results
        for failure in result.get("failures", [])
        if isinstance(result, dict)
    }
    failed = []
    for symbol in missing:
        failure = {
            "symbol": symbol,
            "status": "failed",
            "attemptCount": failure_details.get(symbol, {}).get("attemptCount", 3),
            "error": failure_details.get(symbol, {}).get("error", "status_shard_missing_after_chunk"),
            "generatedAt": now_iso(),
        }
        failed.append(failure)
        atomic_json(failures_dir / f"{symbol}-{int(time.time() * 1000)}.json", failure, immutable=True)
    summary = {
        "symbolCount": len(symbols),
        "completedShardCount": completed,
        "failedThisRun": failed,
        "workerProcessCount": min(workers, len(pending)) if pending else 0,
        "historicalStatusProxyAllowed": False,
        "evidenceMode": "baostock_direct_daily",
    }
    print(json.dumps({"schemaVersion": "fams.ftr_3r.free_source_status_checkpoint.v1", **summary}, ensure_ascii=False), flush=True)
    return summary


def dataframe_records(frame, columns):
    selected = [column for column in columns if column in frame.columns]
    records = frame[selected].astype(object).where(frame[selected].notna(), None).to_dict(orient="records")
    return clean(records), [str(column) for column in frame.columns]


def collect_akshare_reports(lake):
    import akshare as ak

    target = Path(lake) / "raw" / "akshare"
    target.mkdir(parents=True, exist_ok=True)
    captured = io.StringIO()
    definitions = [
        ("performance", ak.stock_yjbb_em, ["股票代码", "股票简称", "每股收益", "营业总收入-营业总收入", "净利润-净利润", "每股净资产", "净资产收益率", "每股经营现金流量", "所处行业", "最新公告日期"]),
        ("income", ak.stock_lrb_em, ["股票代码", "股票简称", "净利润", "营业总收入", "公告日期"]),
        ("cashflow", ak.stock_xjll_em, ["股票代码", "股票简称", "经营性现金流-现金流量净额", "公告日期"]),
        ("balance", ak.stock_zcfz_em, ["股票代码", "股票简称", "资产-总资产", "负债-总负债", "资产负债率", "股东权益合计", "公告日期"]),
    ]
    for period in REPORT_PERIODS:
        for name, function, columns in definitions:
            path = target / f"{name}-{period}.json"
            if path.exists():
                continue
            started = time.monotonic()
            with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
                frame = function(date=period)
            rows, raw_columns = dataframe_records(frame, columns)
            if not rows:
                raise RuntimeError(f"akshare_{name}_{period}_empty")
            atomic_json(path, {
                "provider": "akshare", "providerVersion": getattr(ak, "__version__", "unknown"),
                "endpoint": function.__name__, "reportPeriod": period, "liveCall": True,
                "columns": raw_columns, "rowCount": len(rows), "rows": rows,
                "elapsedMs": round((time.monotonic() - started) * 1000), "generatedAt": now_iso(),
            }, immutable=True)
        growth_path = target / f"growth-{period}.json"
        if not growth_path.exists():
            started = time.monotonic()
            with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
                frame = ak.stock_yjbb_em(date=period)
            rows, raw_columns = dataframe_records(frame, ["股票代码", "股票简称", "净利润-同比增长", "营业总收入-同比增长", "最新公告日期"])
            if not rows:
                raise RuntimeError(f"akshare_growth_{period}_empty")
            atomic_json(growth_path, {
                "provider": "akshare", "providerVersion": getattr(ak, "__version__", "unknown"),
                "endpoint": "stock_yjbb_em", "reportPeriod": period, "liveCall": True,
                "columns": raw_columns, "rowCount": len(rows), "rows": rows,
                "elapsedMs": round((time.monotonic() - started) * 1000), "generatedAt": now_iso(),
            }, immutable=True)
    columns = ["代码", "名称", "现金分红-现金分红比例", "现金分红-股息率", "每股收益", "每股净资产", "总股本", "预案公告日", "股权登记日", "除权除息日", "方案进度", "最新公告日期"]
    for period in DIVIDEND_PERIODS:
        path = target / f"dividend-{period}.json"
        if path.exists():
            continue
        started = time.monotonic()
        with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
            frame = ak.stock_fhps_em(date=period)
        rows, raw_columns = dataframe_records(frame, columns)
        if not rows:
            raise RuntimeError(f"akshare_dividend_{period}_empty")
        atomic_json(path, {
            "provider": "akshare", "providerVersion": getattr(ak, "__version__", "unknown"),
            "endpoint": "stock_fhps_em", "reportPeriod": period, "liveCall": True,
            "columns": raw_columns, "rowCount": len(rows), "rows": rows,
            "elapsedMs": round((time.monotonic() - started) * 1000), "generatedAt": now_iso(),
        }, immutable=True)


def market_prefix(symbol):
    if symbol.startswith(("6", "9")):
        return "sh"
    if symbol.startswith(("0", "2", "3")):
        return "sz"
    return "bj"


def fetch_tencent_history(symbol, timeout=20):
    import requests
    from akshare.utils import demjson

    provider_symbol = f"{market_prefix(symbol)}{symbol}"
    all_rows = []
    for year in [2024, 2025, 2026]:
        params = {
            "_var": f"kline_day{year}",
            "param": f"{provider_symbol},day,{year}-01-01,{year + 1}-12-31,640,",
            "r": "0.8205512681390605",
        }
        response = requests.get("https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get", params=params, timeout=timeout)
        response.raise_for_status()
        payload = demjson.decode(response.text[response.text.find("={") + 1:])
        data = payload.get("data", {}).get(provider_symbol, {})
        source_rows = data.get("day")
        if source_rows is None:
            raise ValueError(f"tencent_day_data_missing:{provider_symbol}:{year}")
        for row in source_rows:
            if len(row) < 6:
                continue
            row_date = str(row[0])
            compact = row_date.replace("-", "")
            if PRICE_START <= compact <= PRICE_END:
                all_rows.append({
                    "date": row_date,
                    "open": float(row[1]),
                    "close": float(row[2]),
                    "high": float(row[3]),
                    "low": float(row[4]),
                    "amountHands": float(row[5]),
                    "turnoverAmountDerived": float(row[2]) * float(row[5]) * 100,
                })
    unique = {row["date"]: row for row in all_rows}
    return [unique[key] for key in sorted(unique)]


def load_price_symbols(lake):
    path = Path(lake) / "raw" / "baostock" / "stock_basic.json"
    with open(path, "r", encoding="utf-8") as handle:
        rows = json.load(handle)["rows"]
    symbols = []
    for row in rows:
        code = str(row.get("code", ""))
        raw_symbol = code.split(".")[-1]
        ipo = str(row.get("ipoDate", ""))
        out_date = str(row.get("outDate", ""))
        if str(row.get("type")) == "1" and len(raw_symbol) == 6 and ipo and ipo <= "2026-06-22" and (not out_date or out_date > "2025-12-12"):
            symbols.append(raw_symbol)
    return sorted(set(symbols))


def collect_prices(lake, workers):
    target = Path(lake) / "raw" / "prices"
    failures = Path(lake) / "raw" / "price-failures"
    target.mkdir(parents=True, exist_ok=True)
    failures.mkdir(parents=True, exist_ok=True)
    symbols = load_price_symbols(lake)
    pending = [symbol for symbol in symbols if not valid_price_shard(target / f"{symbol}.json", symbol)]
    completed = len(symbols) - len(pending)
    failed = []
    started = time.monotonic()

    def work(symbol):
        error = None
        for attempt in range(1, 4):
            attempt_started = time.monotonic()
            try:
                rows = fetch_tencent_history(symbol)
                if not rows:
                    raise ValueError("empty_history")
                value = {
                    "provider": "akshare_tencent_direct", "endpoint": "proxy.finance.qq.com/newfqkline/get",
                    "symbol": symbol, "providerSymbol": f"{market_prefix(symbol)}{symbol}", "liveCall": True,
                    "adjustment": "none", "startDate": "2024-10-01", "endDate": "2026-06-22",
                    "attemptCount": attempt, "rowCount": len(rows), "rows": rows,
                    "turnoverAmountDerivation": "close*amount_hands*100", "generatedAt": now_iso(),
                    "elapsedMs": round((time.monotonic() - attempt_started) * 1000),
                }
                atomic_json(target / f"{symbol}.json", value, immutable=True)
                return {"symbol": symbol, "status": "passed", "rowCount": len(rows), "attemptCount": attempt}
            except Exception as exc:
                error = f"{type(exc).__name__}:{str(exc)[:300]}"
                time.sleep(attempt * 0.5)
        failure = {"symbol": symbol, "status": "failed", "attemptCount": 3, "error": error, "generatedAt": now_iso()}
        atomic_json(failures / f"{symbol}-{int(time.time() * 1000)}.json", failure, immutable=True)
        return failure

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(work, symbol): symbol for symbol in pending}
        for future in as_completed(futures):
            result = future.result()
            if result["status"] == "passed":
                completed += 1
            else:
                failed.append(result)
            processed = completed + len(failed)
            if processed % 100 == 0 or processed == len(symbols):
                checkpoint = {
                    "schemaVersion": "fams.ftr_3r.free_source_checkpoint.v1", "updatedAt": now_iso(),
                    "symbolCount": len(symbols), "completedShardCount": completed,
                    "failedAttemptCount": len(failed), "pendingCount": max(0, len(symbols) - processed),
                    "workerCount": workers, "elapsedSeconds": round(time.monotonic() - started, 3),
                }
                with _write_lock:
                    atomic_json(Path(lake) / "checkpoint.json", checkpoint)
                print(json.dumps(checkpoint, ensure_ascii=False), flush=True)
    return {"symbolCount": len(symbols), "completedShardCount": completed, "failedThisRun": failed, "elapsedSeconds": round(time.monotonic() - started, 3)}


def build_lake_manifest(lake, price_summary, status_summary):
    lake = Path(lake)
    files = []
    for path in sorted((lake / "raw").rglob("*.json")):
        files.append({"path": str(path.resolve()), "sizeBytes": path.stat().st_size, "sha256": sha256_file(path)})
    manifest = {
        "schemaVersion": "fams.ftr_3r.free_source_lake.v1", "generatedAt": now_iso(),
        "lakeId": "ftr3-free-source-v1", "decisionDates": DECISION_DATES,
        "sourceResponsibilities": {
            "historicalMembership": "baostock_stock_basic_ipo_out_lifecycle",
            "historicalSecurityStatus": "baostock_query_history_k_data_plus_isST_tradestatus",
            "historicalTradeability": "baostock_tradestatus_cross_checked_by_tencent_unadjusted_daily_bar",
            "historicalIndustry": "akshare_performance_report_visible_by_announcement_cutoff",
            "historicalFinancials": "akshare_bulk_reports_visible_by_announcement_cutoff",
            "historicalDividends": "akshare_dividend_plans_visible_by_announcement_cutoff",
        },
        "excludedCriticalDependencies": [
            {
                "provider": "baostock",
                "endpoints": ["query_all_stock", "query_stock_industry"],
                "reason": "two_real_runs_hung_or_timed_out",
                "currentSnapshotFallbackAllowed": False,
            }
        ],
        "priceRange": {"startDate": "2024-10-01", "endDate": "2026-06-22", "adjustment": "none"},
        "reportPeriods": REPORT_PERIODS, "dividendPeriods": DIVIDEND_PERIODS,
        "priceSummary": price_summary, "statusSummary": status_summary, "fileCount": len(files), "files": files,
    }
    atomic_json(lake / "lake-manifest.json", manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lake-dir")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--mode", choices=["all", "metadata", "prices", "baostock-one", "baostock-status-chunk"], default="all")
    parser.add_argument("--output-path")
    parser.add_argument("--endpoint")
    parser.add_argument("--decision-date")
    parser.add_argument("--chunk-path")
    parser.add_argument("--status-dir")
    parser.add_argument("--result-path")
    args = parser.parse_args()
    if args.mode == "baostock-one":
        if not args.output_path or not args.endpoint:
            raise RuntimeError("baostock_child_arguments_missing")
        baostock_one(args.output_path, args.endpoint, args.decision_date)
        print(json.dumps({"status": "passed", "outputPath": str(Path(args.output_path).resolve())}, ensure_ascii=False))
        return
    if args.mode == "baostock-status-chunk":
        if not args.chunk_path or not args.status_dir or not args.result_path:
            raise RuntimeError("baostock_status_chunk_arguments_missing")
        baostock_status_chunk(args.chunk_path, args.status_dir, args.result_path)
        return
    if not args.lake_dir:
        raise RuntimeError("lake_dir_required")
    workers = max(1, min(4, args.workers))
    lake = Path(args.lake_dir).resolve()
    lake.mkdir(parents=True, exist_ok=True)
    config = {
        "schemaVersion": "fams.ftr_3r.free_source_lake_config.v1", "lakeId": "ftr3-free-source-v1",
        "decisionDates": DECISION_DATES, "reportPeriods": REPORT_PERIODS, "dividendPeriods": DIVIDEND_PERIODS,
        "priceStart": PRICE_START, "priceEnd": PRICE_END, "workerCountMaximum": 4,
    }
    config_path = lake / "config.json"
    if config_path.exists():
        with open(config_path, "r", encoding="utf-8") as handle:
            if json.load(handle) != config:
                raise RuntimeError("lake_config_mismatch")
    else:
        atomic_json(config_path, config, immutable=True)

    started = time.monotonic()
    if args.mode in ("all", "metadata"):
        collect_baostock(lake)
        collect_akshare_reports(lake)
    status_summary = {"symbolCount": 0, "completedShardCount": 0, "failedThisRun": [], "workerProcessCount": 0, "historicalStatusProxyAllowed": False, "evidenceMode": "baostock_direct_daily"}
    if args.mode in ("all", "prices"):
        status_summary = collect_statuses(lake, workers)
    price_summary = {"symbolCount": 0, "completedShardCount": 0, "failedThisRun": [], "elapsedSeconds": 0}
    if args.mode in ("all", "prices"):
        price_summary = collect_prices(lake, workers)
    manifest = build_lake_manifest(lake, price_summary, status_summary)
    print(json.dumps({
        "status": "completed", "lakeDir": str(lake), "manifestPath": str(lake / "lake-manifest.json"),
        "fileCount": manifest["fileCount"], "priceSummary": price_summary, "statusSummary": status_summary,
        "elapsedSeconds": round(time.monotonic() - started, 3),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
