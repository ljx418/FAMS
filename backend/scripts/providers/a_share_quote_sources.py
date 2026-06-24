#!/usr/bin/env python3
import argparse
import contextlib
import io
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def finite_number(value):
    try:
        if value is None:
            return None
        text = str(value).replace(",", "").strip()
        if text in ("", "-", "--", "nan", "None"):
            return None
        parsed = float(text)
        return parsed if parsed > 0 else None
    except Exception:
        return None


def normalize_symbol(value):
    raw = str(value or "").strip().upper()
    if "." in raw:
        raw = raw.split(".")[-1] if raw.startswith(("SH.", "SZ.", "BJ.")) else raw.split(".")[0]
    return raw if len(raw) == 6 and raw.isdigit() else ""


def baostock_code(symbol):
    if not symbol or len(symbol) != 6:
        return ""
    prefix = "sh" if symbol.startswith(("5", "6", "9")) else "bj" if symbol.startswith(("4", "8")) else "sz"
    return f"{prefix}.{symbol}"


def pick_column(columns, candidates):
    normalized = {str(col).strip().lower(): col for col in columns}
    for candidate in candidates:
        key = candidate.strip().lower()
        if key in normalized:
            return normalized[key]
    for col in columns:
        col_text = str(col)
        if any(candidate in col_text for candidate in candidates):
            return col
    return None


def fetch_akshare():
    import akshare as ak

    fetched_at = now_iso()
    items = {}
    warnings = []

    # Stable code/name source. It is useful for universe cross-check even when spot quote fails.
    try:
        code_name = ak.stock_info_a_code_name()
        code_col = pick_column(code_name.columns, ["code", "代码"])
        name_col = pick_column(code_name.columns, ["name", "名称"])
        if code_col is not None:
            for _, row in code_name.iterrows():
                symbol = normalize_symbol(row.get(code_col))
                if not symbol:
                    continue
                items.setdefault(symbol, {
                    "symbol": symbol,
                    "provider": "akshare",
                    "fetchedAt": fetched_at,
                    "sourceRefs": ["akshare.stock_info_a_code_name"],
                })
                if name_col is not None:
                    items[symbol]["name"] = str(row.get(name_col) or "").strip() or symbol
        else:
            warnings.append("akshare stock_info_a_code_name missing code column")
    except Exception as exc:
        warnings.append(f"akshare stock_info_a_code_name failed: {exc}")

    # Best effort market cap source. In this environment it can fail because the upstream is Eastmoney.
    try:
        spot = ak.stock_zh_a_spot_em()
        code_col = pick_column(spot.columns, ["代码", "code"])
        name_col = pick_column(spot.columns, ["名称", "name"])
        total_col = pick_column(spot.columns, ["总市值", "total_market_cap"])
        float_col = pick_column(spot.columns, ["流通市值", "float_market_cap"])
        pe_col = pick_column(spot.columns, ["市盈率-动态", "动态市盈率", "pe", "pe_dynamic"])
        pb_col = pick_column(spot.columns, ["市净率", "pb"])
        industry_col = pick_column(spot.columns, ["行业", "所处行业"])
        if code_col is not None:
            for _, row in spot.iterrows():
                symbol = normalize_symbol(row.get(code_col))
                if not symbol:
                    continue
                item = items.setdefault(symbol, {
                    "symbol": symbol,
                    "provider": "akshare",
                    "fetchedAt": fetched_at,
                    "sourceRefs": [],
                })
                item.setdefault("sourceRefs", []).append("akshare.stock_zh_a_spot_em")
                if name_col is not None:
                    item["name"] = str(row.get(name_col) or item.get("name") or symbol).strip()
                if total_col is not None:
                    total = finite_number(row.get(total_col))
                    if total:
                        item["totalMarketCap"] = total
                if float_col is not None:
                    floating = finite_number(row.get(float_col))
                    if floating:
                        item["floatMarketCap"] = floating
                if pe_col is not None:
                    pe = finite_number(row.get(pe_col))
                    if pe:
                        item["peDynamic"] = pe
                if pb_col is not None:
                    pb = finite_number(row.get(pb_col))
                    if pb:
                        item["pb"] = pb
                if industry_col is not None:
                    industry = str(row.get(industry_col) or "").strip()
                    if industry and industry not in ("-", "--"):
                        item["industryName"] = industry
        else:
            warnings.append("akshare stock_zh_a_spot_em missing code column")
    except Exception as exc:
        warnings.append(f"akshare stock_zh_a_spot_em failed: {exc}")

    return {
        "provider": "akshare",
        "fetchedAt": fetched_at,
        "itemCount": len(items),
        "items": list(items.values()),
        "warnings": warnings,
    }


def fetch_baostock():
    import baostock as bs

    fetched_at = now_iso()
    items = {}
    warnings = []
    login = bs.login()
    if login.error_code != "0":
        return {
            "provider": "baostock",
            "fetchedAt": fetched_at,
            "itemCount": 0,
            "items": [],
            "warnings": [f"baostock login failed: {login.error_code} {login.error_msg}"],
        }

    try:
        basic = bs.query_stock_basic()
        if basic.error_code == "0":
            while basic.next():
                row = dict(zip(basic.fields, basic.get_row_data()))
                symbol = normalize_symbol(row.get("code"))
                if not symbol:
                    continue
                # BaoStock type=1 means stock; status=1 means listed.
                if row.get("type") and row.get("type") != "1":
                    continue
                item = items.setdefault(symbol, {
                    "symbol": symbol,
                    "provider": "baostock",
                    "fetchedAt": fetched_at,
                    "sourceRefs": ["baostock.query_stock_basic"],
                })
                item["name"] = row.get("code_name") or symbol
                item["listStatus"] = "listed" if row.get("status") == "1" else "inactive"
                item["ipoDate"] = row.get("ipoDate") or None
                item["outDate"] = row.get("outDate") or None
        else:
            warnings.append(f"baostock query_stock_basic failed: {basic.error_code} {basic.error_msg}")

        industry = bs.query_stock_industry()
        if industry.error_code == "0":
            while industry.next():
                row = dict(zip(industry.fields, industry.get_row_data()))
                symbol = normalize_symbol(row.get("code"))
                if not symbol:
                    continue
                item = items.setdefault(symbol, {
                    "symbol": symbol,
                    "provider": "baostock",
                    "fetchedAt": fetched_at,
                    "sourceRefs": [],
                })
                item.setdefault("sourceRefs", []).append("baostock.query_stock_industry")
                item["name"] = row.get("code_name") or item.get("name") or symbol
                industry_name = str(row.get("industry") or "").strip()
                if industry_name:
                    item["industryName"] = industry_name
                    item["industryClassification"] = row.get("industryClassification") or None
        else:
            warnings.append(f"baostock query_stock_industry failed: {industry.error_code} {industry.error_msg}")

        cap_limit = int(os.environ.get("FAMS_BAOSTOCK_FLOAT_CAP_LIMIT", "120") or "0")
        cap_items = [
            item for item in items.values()
            if item.get("listStatus") != "inactive"
        ]
        cap_items.sort(key=lambda item: item.get("symbol") or "")
        if cap_limit > 0:
            cap_items = cap_items[:cap_limit]
            warnings.append(f"baostock derived float market cap limited to first {cap_limit} listed symbols")
        end_date = datetime.now().date()
        start_date = end_date - timedelta(days=14)
        derived_count = 0
        failed_count = 0
        for item in cap_items:
            symbol = item.get("symbol")
            provider_symbol = baostock_code(symbol)
            if not provider_symbol:
                continue
            try:
                bars = bs.query_history_k_data_plus(
                    provider_symbol,
                    "date,code,close,volume,amount,turn",
                    start_date=start_date.isoformat(),
                    end_date=end_date.isoformat(),
                    frequency="d",
                    adjustflag="3",
                )
                if bars.error_code != "0":
                    failed_count += 1
                    continue
                latest = None
                while bars.next():
                    latest = dict(zip(bars.fields, bars.get_row_data()))
                if not latest:
                    continue
                close = finite_number(latest.get("close"))
                volume = finite_number(latest.get("volume"))
                turnover = finite_number(latest.get("turn"))
                if not close or not volume or not turnover:
                    continue
                # BaoStock `turn` is turnover rate in percent. close * volume / (turn / 100)
                # approximates free-float market cap and provides an independent cap source.
                item["floatMarketCap"] = close * volume * 100 / turnover
                item["latestTradeDate"] = latest.get("date") or None
                item.setdefault("sourceRefs", []).append("baostock.query_history_k_data_plus.derived_float_market_cap")
                item["marketCapDerivation"] = "close * volume * 100 / turnover_rate_percent"
                derived_count += 1
            except Exception:
                failed_count += 1
        warnings.append(f"baostock derived float market cap count={derived_count}, failed={failed_count}")
    finally:
        bs.logout()

    return {
        "provider": "baostock",
        "fetchedAt": fetched_at,
        "itemCount": len(items),
        "items": list(items.values()),
        "warnings": warnings,
    }


def fetch_baostock_market_cap(symbols):
    import baostock as bs

    fetched_at = now_iso()
    items = []
    warnings = []
    login = bs.login()
    if login.error_code != "0":
        return {
            "provider": "baostock_market_cap",
            "fetchedAt": fetched_at,
            "itemCount": 0,
            "items": [],
            "warnings": [f"baostock login failed: {login.error_code} {login.error_msg}"],
        }

    try:
        end_date = datetime.now().date()
        start_date = end_date - timedelta(days=14)
        failed_count = 0
        for symbol in symbols:
            normalized = normalize_symbol(symbol)
            provider_symbol = baostock_code(normalized)
            if not provider_symbol:
                failed_count += 1
                continue
            try:
                bars = bs.query_history_k_data_plus(
                    provider_symbol,
                    "date,code,close,volume,amount,turn",
                    start_date=start_date.isoformat(),
                    end_date=end_date.isoformat(),
                    frequency="d",
                    adjustflag="3",
                )
                if bars.error_code != "0":
                    failed_count += 1
                    warnings.append(f"{normalized} baostock history failed: {bars.error_code} {bars.error_msg}")
                    continue
                latest = None
                while bars.next():
                    latest = dict(zip(bars.fields, bars.get_row_data()))
                if not latest:
                    failed_count += 1
                    warnings.append(f"{normalized} baostock history returned no bars")
                    continue
                close = finite_number(latest.get("close"))
                volume = finite_number(latest.get("volume"))
                turnover = finite_number(latest.get("turn"))
                if not close or not volume or not turnover:
                    failed_count += 1
                    warnings.append(f"{normalized} missing close/volume/turn for market cap derivation")
                    continue
                items.append({
                    "symbol": normalized,
                    "provider": "baostock_market_cap",
                    "fetchedAt": fetched_at,
                    "floatMarketCap": close * volume * 100 / turnover,
                    "latestTradeDate": latest.get("date") or None,
                    "sourceRefs": ["baostock.query_history_k_data_plus.derived_float_market_cap"],
                    "marketCapDerivation": "close * volume * 100 / turnover_rate_percent",
                })
            except Exception as exc:
                failed_count += 1
                warnings.append(f"{normalized} baostock market cap failed: {exc}")
        if failed_count:
            warnings.append(f"baostock market cap failed count={failed_count}")
    finally:
        bs.logout()

    return {
        "provider": "baostock_market_cap",
        "fetchedAt": fetched_at,
        "itemCount": len(items),
        "items": items,
        "warnings": warnings,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", choices=["akshare", "baostock", "baostock_market_cap", "all"], default="all")
    parser.add_argument("--symbols", default="")
    args = parser.parse_args()

    started = time.time()
    providers = []
    provider_list = ["akshare", "baostock"] if args.provider == "all" else [args.provider]
    for provider in provider_list:
        try:
            captured = io.StringIO()
            with contextlib.redirect_stdout(captured):
                if provider == "akshare":
                    result = fetch_akshare()
                elif provider == "baostock_market_cap":
                    symbols = [symbol.strip() for symbol in args.symbols.split(",") if symbol.strip()]
                    result = fetch_baostock_market_cap(symbols)
                else:
                    result = fetch_baostock()
            captured_text = captured.getvalue().strip()
            if captured_text:
                result.setdefault("warnings", []).append(f"{provider} stdout suppressed: {captured_text[:500]}")
            providers.append(result)
        except Exception as exc:
            providers.append({
                "provider": provider,
                "fetchedAt": now_iso(),
                "itemCount": 0,
                "items": [],
                "warnings": [f"{provider} failed: {exc}"],
            })

    print(json.dumps({
        "schemaVersion": "fams.a_share_quote_sources.v1",
        "generatedAt": now_iso(),
        "elapsedMs": int((time.time() - started) * 1000),
        "providers": providers,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
