import argparse
import contextlib
import hashlib
import io
import json
import signal
import time
from datetime import datetime, timezone


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_json(value):
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def normalized_stock_code(value):
    raw = str(value or "").lower()
    if raw.startswith(("sh.", "sz.", "bj.")) and len(raw) == 9:
        code = raw[3:]
        if code.isdigit() and code.startswith(("000", "001", "002", "003", "300", "301", "600", "601", "603", "605", "688", "689", "4", "8", "9")):
            return code
    return None


class ProbeTimeout(Exception):
    pass


def timeout_handler(_signum, _frame):
    raise ProbeTimeout("provider_query_timeout")


def collect_rows(result_set, limit=None):
    rows = []
    count = 0
    while result_set.error_code == "0" and result_set.next():
        count += 1
        if limit is None or len(rows) < limit:
            rows.append(dict(zip(result_set.fields, result_set.get_row_data())))
    return count, rows


def baostock_universe(decision_date, timeout_seconds):
    import baostock as bs

    started = time.monotonic()
    output = {
        "provider": "baostock",
        "providerVersion": getattr(bs, "__version__", "unknown"),
        "mode": "historical_universe",
        "decisionDate": decision_date,
        "liveCall": True,
        "sourceMethod": "query_all_stock(day)",
        "status": "error",
        "symbols": [],
        "warnings": [],
    }
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        login = bs.login()
    output["loginCode"] = login.error_code
    output["loginMessage"] = login.error_msg
    if login.error_code != "0":
        output["warnings"].append("baostock_login_failed")
        output["elapsedMs"] = round((time.monotonic() - started) * 1000)
        output["contentSha256"] = sha256_json(output)
        return output
    previous = signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(timeout_seconds)
    try:
        result_set = bs.query_all_stock(day=decision_date)
        symbols = []
        provider_rows = 0
        while result_set.error_code == "0" and result_set.next():
            provider_rows += 1
            row = dict(zip(result_set.fields, result_set.get_row_data()))
            symbol = normalized_stock_code(row.get("code"))
            if symbol:
                symbols.append({
                    "symbol": symbol,
                    "providerCode": row.get("code"),
                    "name": row.get("code_name"),
                    "tradeStatus": row.get("tradeStatus"),
                })
        output["providerRowCount"] = provider_rows
        output["symbols"] = symbols
        output["status"] = "passed" if result_set.error_code == "0" and symbols else "error"
        if result_set.error_code != "0":
            output["warnings"].append(f"baostock_query_error:{result_set.error_code}:{result_set.error_msg}")
    except ProbeTimeout:
        output["status"] = "timeout"
        output["warnings"].append(f"query_all_stock_exceeded_{timeout_seconds}s")
    except Exception as exc:
        output["warnings"].append(f"query_all_stock_exception:{type(exc).__name__}:{str(exc)[:160]}")
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)
        with contextlib.redirect_stdout(captured):
            try:
                bs.logout()
            except Exception:
                output["warnings"].append("baostock_logout_failed")
    output["elapsedMs"] = round((time.monotonic() - started) * 1000)
    output["symbolCount"] = len(output["symbols"])
    if captured.getvalue().strip():
        output["providerStdoutSuppressed"] = True
    output["contentSha256"] = sha256_json(output)
    return output


def baostock_samples(decision_date, symbols):
    import baostock as bs

    started = time.monotonic()
    output = {
        "provider": "baostock",
        "providerVersion": getattr(bs, "__version__", "unknown"),
        "mode": "historical_field_samples",
        "decisionDate": decision_date,
        "liveCall": True,
        "samples": [],
        "warnings": [],
    }
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        login = bs.login()
    output["loginCode"] = login.error_code
    output["loginMessage"] = login.error_msg
    if login.error_code != "0":
        output["status"] = "error"
        output["elapsedMs"] = round((time.monotonic() - started) * 1000)
        output["contentSha256"] = sha256_json(output)
        return output
    try:
        decision_year = int(decision_date[:4])
        provider_codes = [("sh." if symbol.startswith(("6", "9")) else "bj." if symbol.startswith(("4", "8")) else "sz.") + symbol for symbol in symbols]
        for provider_code in provider_codes:
            sample = {"providerCode": provider_code}
            history = bs.query_history_k_data_plus(
                provider_code,
                "date,code,open,high,low,close,preclose,volume,amount,adjustflag,turn,tradestatus,pctChg,isST",
                start_date=decision_date,
                end_date=decision_date,
                frequency="d",
                adjustflag="3",
            )
            _, sample["history"] = collect_rows(history, 2)
            sample["historyFields"] = history.fields

            industry = bs.query_stock_industry(code=provider_code, date=decision_date)
            _, sample["industry"] = collect_rows(industry, 2)
            sample["industryFields"] = industry.fields

            basic = bs.query_stock_basic(code=provider_code)
            _, sample["basic"] = collect_rows(basic, 2)
            sample["basicFields"] = basic.fields

            profit = bs.query_profit_data(code=provider_code, year=decision_year, quarter=3)
            _, sample["profit"] = collect_rows(profit, 3)
            sample["profitFields"] = profit.fields

            dividend = bs.query_dividend_data(code=provider_code, year=str(decision_year), yearType="report")
            _, sample["dividend"] = collect_rows(dividend, 5)
            sample["dividendFields"] = dividend.fields
            output["samples"].append(sample)
        output["status"] = "passed"
    except Exception as exc:
        output["status"] = "error"
        output["warnings"].append(f"baostock_sample_exception:{type(exc).__name__}:{str(exc)[:160]}")
    finally:
        with contextlib.redirect_stdout(captured):
            try:
                bs.logout()
            except Exception:
                output["warnings"].append("baostock_logout_failed")
    output["elapsedMs"] = round((time.monotonic() - started) * 1000)
    if captured.getvalue().strip():
        output["providerStdoutSuppressed"] = True
    output["contentSha256"] = sha256_json(output)
    return output


def akshare_dividend(symbol):
    import akshare as ak

    started = time.monotonic()
    output = {
        "provider": "akshare",
        "providerVersion": getattr(ak, "__version__", "unknown"),
        "mode": "dividend_cross_check",
        "symbol": symbol,
        "liveCall": True,
        "sourceMethod": "stock_fhps_detail_em",
        "status": "error",
        "columns": [],
        "rows": [],
        "warnings": [],
    }
    captured = io.StringIO()
    try:
        with contextlib.redirect_stdout(captured):
            frame = ak.stock_fhps_detail_em(symbol=symbol)
        output["columns"] = [str(column) for column in frame.columns]
        output["rows"] = json.loads(frame.tail(5).to_json(orient="records", force_ascii=False, date_format="iso"))
        output["rowCount"] = len(frame)
        output["status"] = "passed" if len(frame) > 0 else "error"
    except Exception as exc:
        output["warnings"].append(f"akshare_dividend_exception:{type(exc).__name__}:{str(exc)[:160]}")
    output["elapsedMs"] = round((time.monotonic() - started) * 1000)
    if captured.getvalue().strip():
        output["providerStdoutSuppressed"] = True
    output["contentSha256"] = sha256_json(output)
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["universe", "samples", "akshare"], required=True)
    parser.add_argument("--decision-date", default="2025-12-12")
    parser.add_argument("--symbols", default="600887,000001,300750")
    parser.add_argument("--timeout-seconds", type=int, default=420)
    args = parser.parse_args()
    symbols = [value.strip() for value in args.symbols.split(",") if value.strip()]
    if args.mode == "universe":
        result = baostock_universe(args.decision_date, args.timeout_seconds)
    elif args.mode == "samples":
        result = baostock_samples(args.decision_date, symbols)
    else:
        result = akshare_dividend(symbols[0])
    result["generatedAt"] = now_iso()
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
