#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from pathlib import Path


START_DATE = "2025-12-12"
END_DATE = "2026-09-11"
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


def market_prefix(symbol):
    if symbol.startswith(("6", "9")):
        return "sh"
    if symbol.startswith(("0", "2", "3")):
        return "sz"
    return "bj"


def valid_shard(path, symbol):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = json.load(handle)
        return (
            value.get("symbol") == symbol
            and value.get("liveCall") is True
            and value.get("adjustment") == "qfq"
            and value.get("startDate") == START_DATE
            and value.get("endDate") == END_DATE
            and isinstance(value.get("rows"), list)
        )
    except Exception:
        return False


def fetch(symbol, timeout=20):
    import requests
    from akshare.utils import demjson

    provider_symbol = f"{market_prefix(symbol)}{symbol}"
    params = {
        "_var": "kline_day2026",
        "param": f"{provider_symbol},day,{START_DATE},{END_DATE},640,qfq",
        "r": "0.8205512681390605",
    }
    response = requests.get(
        "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get",
        params=params,
        timeout=timeout,
    )
    response.raise_for_status()
    payload = demjson.decode(response.text[response.text.find("={") + 1:])
    source_rows = payload.get("data", {}).get(provider_symbol, {}).get("qfqday")
    if source_rows is None:
        raise ValueError(f"tencent_qfq_data_missing:{provider_symbol}")
    rows = []
    for row in source_rows:
        if len(row) < 6:
            continue
        row_date = str(row[0])
        if START_DATE <= row_date <= END_DATE:
            rows.append({
                "date": row_date,
                "open": float(row[1]),
                "close": float(row[2]),
                "high": float(row[3]),
                "low": float(row[4]),
                "amountHands": float(row[5]),
            })
    unique = {row["date"]: row for row in rows}
    return [unique[key] for key in sorted(unique)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-artifact", required=True)
    parser.add_argument("--lake-dir", required=True)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    source_path = Path(args.source_artifact).resolve()
    lake = Path(args.lake_dir).resolve()
    with open(source_path, "r", encoding="utf-8") as handle:
        source = json.load(handle)
    if source.get("schemaVersion") != "fams.ftr_3r.free_source_full_backfill.v2" or source.get("status") != "passed":
        raise RuntimeError("passed_free_source_v2_artifact_required")
    symbols = sorted(set(
        symbol
        for point in source.get("decisionPoints", [])
        for symbol in point.get("selectedSymbols", [])
    ))
    if not symbols:
        raise RuntimeError("selected_symbol_union_empty")
    config = {
        "schemaVersion": "fams.ftr_3r1.validation_price_lake_config.v1",
        "sourcePointInTimeArtifact": str(source_path),
        "sourcePointInTimeArtifactSha256": sha256_file(source_path),
        "symbols": symbols,
        "startDate": START_DATE,
        "endDate": END_DATE,
        "adjustment": "qfq",
        "maximumWorkers": 4,
    }
    config_path = lake / "config.json"
    if config_path.exists():
        with open(config_path, "r", encoding="utf-8") as handle:
            if json.load(handle) != config:
                raise RuntimeError("candidate_validation_lake_config_mismatch")
    else:
        atomic_json(config_path, config, immutable=True)
    target = lake / "raw" / "prices"
    failure_dir = lake / "raw" / "failures"
    target.mkdir(parents=True, exist_ok=True)
    failure_dir.mkdir(parents=True, exist_ok=True)
    pending = [symbol for symbol in symbols if not valid_shard(target / f"{symbol}.json", symbol)]
    workers = max(1, min(4, args.workers))

    def work(symbol):
        last_error = None
        for attempt in range(1, 4):
            started = time.monotonic()
            try:
                rows = fetch(symbol)
                if not rows:
                    raise RuntimeError("qfq_history_empty")
                atomic_json(target / f"{symbol}.json", {
                    "provider": "akshare_tencent_direct",
                    "endpoint": "proxy.finance.qq.com/newfqkline/get",
                    "symbol": symbol,
                    "providerSymbol": f"{market_prefix(symbol)}{symbol}",
                    "liveCall": True,
                    "adjustment": "qfq",
                    "startDate": START_DATE,
                    "endDate": END_DATE,
                    "rowCount": len(rows),
                    "rows": rows,
                    "attemptCount": attempt,
                    "elapsedMs": round((time.monotonic() - started) * 1000),
                    "generatedAt": now_iso(),
                }, immutable=True)
                return {"symbol": symbol, "status": "passed", "rowCount": len(rows), "attemptCount": attempt}
            except Exception as exc:
                last_error = f"{type(exc).__name__}:{str(exc)[:300]}"
                time.sleep(attempt * 0.5)
        failure = {"symbol": symbol, "status": "failed", "attemptCount": 3, "error": last_error, "generatedAt": now_iso()}
        atomic_json(failure_dir / f"{symbol}-{int(time.time() * 1000)}.json", failure, immutable=True)
        return failure

    results = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(work, symbol): symbol for symbol in pending}
        for future in as_completed(futures):
            results.append(future.result())
    completed = sum(1 for symbol in symbols if valid_shard(target / f"{symbol}.json", symbol))
    failed = [result for result in results if result["status"] == "failed"]
    files = []
    for path in sorted((lake / "raw").rglob("*.json")):
        files.append({"path": str(path.resolve()), "sizeBytes": path.stat().st_size, "sha256": sha256_file(path)})
    manifest = {
        "schemaVersion": "fams.ftr_3r1.validation_price_lake.v1",
        "generatedAt": now_iso(),
        "sourcePointInTimeArtifact": str(source_path),
        "sourcePointInTimeArtifactSha256": sha256_file(source_path),
        "symbolCount": len(symbols),
        "completedShardCount": completed,
        "failedThisRun": failed,
        "providerFailuresRemainInDenominator": True,
        "adjustment": "qfq",
        "startDate": START_DATE,
        "endDate": END_DATE,
        "fileCount": len(files),
        "files": files,
    }
    manifest_path = lake / "lake-manifest.json"
    atomic_json(manifest_path, manifest)
    print(json.dumps({
        "status": "passed" if completed == len(symbols) else "insufficient",
        "lakeDir": str(lake),
        "manifestPath": str(manifest_path.resolve()),
        "symbolCount": len(symbols),
        "completedShardCount": completed,
        "failedCount": len(failed),
    }, ensure_ascii=False))
    if completed != len(symbols):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
