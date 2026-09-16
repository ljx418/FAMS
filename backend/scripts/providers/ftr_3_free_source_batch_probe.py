#!/usr/bin/env python3
import argparse
import contextlib
import io
import json
import time
from datetime import date, datetime


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


def dataframe_records(frame, columns):
    selected = [column for column in columns if column in frame.columns]
    records = frame[selected].astype(object).where(frame[selected].notna(), None).to_dict(orient="records")
    return clean(records), [str(column) for column in frame.columns]


def collect_result_set(result_set):
    rows = []
    while result_set.error_code == "0" and result_set.next():
        rows.append(dict(zip(result_set.fields, result_set.get_row_data())))
    return rows


def baostock_bulk(decision_date):
    import baostock as bs

    started = time.monotonic()
    captured = io.StringIO()
    output = {
        "provider": "baostock",
        "providerVersion": getattr(bs, "__version__", "unknown"),
        "mode": "bulk_security_metadata",
        "decisionDate": decision_date,
        "liveCall": True,
        "status": "error",
        "datasets": {},
        "warnings": [],
    }
    with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
        login = bs.login()
    output["loginCode"] = login.error_code
    output["loginMessage"] = login.error_msg
    if login.error_code != "0":
        output["warnings"].append("baostock_login_failed")
        output["elapsedMs"] = round((time.monotonic() - started) * 1000)
        return output

    calls = [
        ("allStock", lambda: bs.query_all_stock(day=decision_date)),
        ("stockBasic", lambda: bs.query_stock_basic()),
        ("industry", lambda: bs.query_stock_industry(date=decision_date)),
    ]
    try:
        for name, call in calls:
            call_started = time.monotonic()
            result_set = call()
            rows = collect_result_set(result_set)
            output["datasets"][name] = {
                "status": "passed" if result_set.error_code == "0" else "error",
                "fields": result_set.fields,
                "rowCount": len(rows),
                "rows": rows,
                "elapsedMs": round((time.monotonic() - call_started) * 1000),
                "errorCode": result_set.error_code,
                "errorMessage": result_set.error_msg,
            }
        output["status"] = "passed" if all(item["status"] == "passed" for item in output["datasets"].values()) else "error"
    except Exception as exc:
        output["warnings"].append(f"baostock_bulk_exception:{type(exc).__name__}:{str(exc)[:240]}")
    finally:
        with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
            try:
                bs.logout()
            except Exception:
                output["warnings"].append("baostock_logout_failed")
    output["elapsedMs"] = round((time.monotonic() - started) * 1000)
    output["providerOutputSuppressed"] = bool(captured.getvalue().strip())
    return clean(output)


def akshare_bulk(decision_date):
    import akshare as ak

    started = time.monotonic()
    captured = io.StringIO()
    output = {
        "provider": "akshare",
        "providerVersion": getattr(ak, "__version__", "unknown"),
        "mode": "bulk_financial_and_dividend_reports",
        "decisionDate": decision_date,
        "liveCall": True,
        "status": "error",
        "datasets": {},
        "warnings": [],
    }
    calls = [
        ("performance_20250930", ak.stock_yjbb_em, {"date": "20250930"}, ["股票代码", "股票简称", "每股收益", "营业总收入-营业总收入", "净利润-净利润", "每股净资产", "净资产收益率", "每股经营现金流量", "所处行业", "最新公告日期"]),
        ("income_20250930", ak.stock_lrb_em, {"date": "20250930"}, ["股票代码", "股票简称", "净利润", "营业总收入", "公告日期"]),
        ("cashflow_20250930", ak.stock_xjll_em, {"date": "20250930"}, ["股票代码", "股票简称", "经营性现金流-现金流量净额", "公告日期"]),
        ("balance_20250930", ak.stock_zcfz_em, {"date": "20250930"}, ["股票代码", "股票简称", "资产-总资产", "负债-总负债", "资产负债率", "股东权益合计", "公告日期"]),
        ("dividend_20241231", ak.stock_fhps_em, {"date": "20241231"}, ["代码", "名称", "现金分红-现金分红比例", "现金分红-股息率", "每股收益", "每股净资产", "总股本", "预案公告日", "股权登记日", "除权除息日", "方案进度", "最新公告日期"]),
        ("dividend_20231231", ak.stock_fhps_em, {"date": "20231231"}, ["代码", "名称", "现金分红-现金分红比例", "现金分红-股息率", "每股收益", "每股净资产", "总股本", "预案公告日", "股权登记日", "除权除息日", "方案进度", "最新公告日期"]),
        ("dividend_20221231", ak.stock_fhps_em, {"date": "20221231"}, ["代码", "名称", "现金分红-现金分红比例", "现金分红-股息率", "每股收益", "每股净资产", "总股本", "预案公告日", "股权登记日", "除权除息日", "方案进度", "最新公告日期"]),
    ]
    for name, function, kwargs, columns in calls:
        call_started = time.monotonic()
        try:
            with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
                frame = function(**kwargs)
            rows, raw_columns = dataframe_records(frame, columns)
            output["datasets"][name] = {
                "status": "passed" if len(frame) > 0 else "error",
                "columns": raw_columns,
                "rowCount": len(frame),
                "rows": rows,
                "elapsedMs": round((time.monotonic() - call_started) * 1000),
            }
        except Exception as exc:
            output["datasets"][name] = {
                "status": "error",
                "columns": [],
                "rowCount": 0,
                "rows": [],
                "elapsedMs": round((time.monotonic() - call_started) * 1000),
                "error": f"{type(exc).__name__}:{str(exc)[:240]}",
            }
    output["status"] = "passed" if all(item["status"] == "passed" for item in output["datasets"].values()) else "error"
    output["elapsedMs"] = round((time.monotonic() - started) * 1000)
    output["providerOutputSuppressed"] = bool(captured.getvalue().strip())
    return clean(output)


def market_prefix(symbol):
    if symbol.startswith(("6", "9")):
        return "sh"
    if symbol.startswith(("0", "2", "3")):
        return "sz"
    return "bj"


def price_sample(decision_date, symbols):
    import akshare as ak

    started = time.monotonic()
    captured = io.StringIO()
    output = {
        "provider": "akshare_tencent",
        "providerVersion": getattr(ak, "__version__", "unknown"),
        "mode": "unadjusted_price_throughput_sample",
        "decisionDate": decision_date,
        "historyStartDate": "2024-10-01",
        "liveCall": True,
        "status": "error",
        "samples": [],
        "warnings": [],
    }
    for symbol in symbols:
        sample_started = time.monotonic()
        sample = {"symbol": symbol, "status": "error", "rows": []}
        for attempt in range(1, 4):
            try:
                with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
                    frame = ak.stock_zh_a_hist_tx(
                        symbol=f"{market_prefix(symbol)}{symbol}",
                        start_date="20241001",
                        end_date=decision_date.replace("-", ""),
                        adjust="",
                        timeout=20,
                    )
                rows, raw_columns = dataframe_records(frame, ["date", "open", "close", "high", "low", "amount"])
                sample.update({
                    "status": "passed" if len(rows) >= 250 else "insufficient",
                    "attemptCount": attempt,
                    "columns": raw_columns,
                    "rowCount": len(rows),
                    "rows": rows,
                    "turnoverAmountDerivation": "close*amount_hands*100",
                })
                break
            except Exception as exc:
                sample["error"] = f"{type(exc).__name__}:{str(exc)[:240]}"
                sample["attemptCount"] = attempt
                time.sleep(attempt)
        sample["elapsedMs"] = round((time.monotonic() - sample_started) * 1000)
        output["samples"].append(sample)
        time.sleep(0.15)
    output["status"] = "passed" if all(sample["status"] == "passed" for sample in output["samples"]) else "insufficient"
    output["elapsedMs"] = round((time.monotonic() - started) * 1000)
    output["providerOutputSuppressed"] = bool(captured.getvalue().strip())
    return clean(output)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["baostock-bulk", "akshare-bulk", "price-sample"], required=True)
    parser.add_argument("--decision-date", default="2025-12-12")
    parser.add_argument("--symbols", default="")
    args = parser.parse_args()
    symbols = [item.strip() for item in args.symbols.split(",") if item.strip()]
    if args.mode == "baostock-bulk":
        result = baostock_bulk(args.decision_date)
    elif args.mode == "akshare-bulk":
        result = akshare_bulk(args.decision_date)
    else:
        result = price_sample(args.decision_date, symbols)
    result["generatedAt"] = now_iso()
    print(json.dumps(clean(result), ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
