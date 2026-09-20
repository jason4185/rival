# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

import json

import genlayer as gl
from genlayer import u256


SOURCE_BINANCE = "BINANCE"
SOURCE_BYBIT = "BYBIT"
BINANCE_BASE_URL = "https://fapi.binance.com/fapi/v1/klines"
BYBIT_BASE_URL = "https://api.bybit.com/v5/market/kline"
ASSET_NAMES = ("BTC", "ETH", "SOL", "GOLD", "SILVER", "WTI_CRUDE")
BINANCE_SYMBOLS = ("BTCUSDT", "ETHUSDT", "SOLUSDT", "XAUUSDT", "XAGUSDT", "CLUSDT")
# Diagnostic-only mapping. This intentionally differs from Rival.py's current
# Bybit XTIUSDT entry so the known Bybit WTI symbol can be tested directly.
BYBIT_SYMBOLS = ("BTCUSDT", "ETHUSDT", "SOLUSDT", "XAUUSDT", "XAGUSDT", "CLUSDT")
GATE_SYMBOLS = ("BTC_USDT", "ETH_USDT", "SOL_USDT", "XAU_USDT", "XAG_USDT", "CL_USDT")
BITGET_SYMBOLS = ("BTCUSDT", "ETHUSDT", "SOLUSDT", "XAUUSDT", "XAGUSDT", "CLUSDT")
# These are the exact current Forge Hyperliquid symbols. Forge has no
# Hyperliquid mapping for BTC, ETH, or SOL, so those entries remain unsupported.
HYPERLIQUID_SYMBOLS = ("", "", "", "xyz:GOLD", "xyz:SILVER", "xyz:CL")
DURATION_SECONDS = 3600
MAX_RESPONSE_BYTES = 65_536
MAX_TEXT_BYTES = 160
MAX_ERROR_PREVIEW_BYTES = 256
U256_MAX = 2**256 - 1

PROVIDER_GATE = "GATE"
PROVIDER_BITGET = "BITGET"
PROVIDER_HYPERLIQUID = "HYPERLIQUID"


def _is_digits(value: str) -> bool:
    if not value:
        return False
    for char in value:
        if char < "0" or char > "9":
            return False
    return True


def _parse_integer(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if 0 <= value <= U256_MAX else None
    if not isinstance(value, str) or len(value) > 40 or not _is_digits(value):
        return None
    number = int(value)
    return number if number <= U256_MAX else None


def _parse_price(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        text = str(value)
    elif isinstance(value, str):
        text = value
    else:
        return None
    if not text or len(text) > 40 or text.startswith("+") or text.startswith("-"):
        return None
    pieces = text.split(".")
    if len(pieces) > 2 or not _is_digits(pieces[0]) or len(pieces[0]) > 21:
        return None
    fraction = pieces[1] if len(pieces) == 2 else ""
    if fraction and (not _is_digits(fraction) or len(fraction) > 18):
        return None
    scaled = int(pieces[0]) * 1_000_000_000_000_000_000 + int(
        (fraction + "0" * 18)[:18]
    )
    if scaled <= 0 or scaled > 10**39:
        return None
    return scaled


def _kind(value) -> str:
    if value is None:
        return "none"
    if isinstance(value, bytes):
        return "bytes"
    if isinstance(value, str):
        return "str"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "dict"
    return "other"


def _display(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value[:MAX_TEXT_BYTES]
    if isinstance(value, bool) or isinstance(value, int):
        return str(value)
    return "<" + _kind(value) + ">"


def _read_attribute(response, name: str):
    try:
        return True, getattr(response, name)
    except Exception:
        return False, None


def _status_number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and _is_digits(value):
        return int(value)
    return None


def _base_result(source: str, symbol: str, url: str) -> dict:
    return {
        "source": source,
        "asset": ASSET_NAMES[
            BINANCE_SYMBOLS.index(symbol) if source == SOURCE_BINANCE else BYBIT_SYMBOLS.index(symbol)
        ],
        "symbol": symbol,
        "url": url,
        "web_get": "",
        "status_available": False,
        "status_value": "",
        "status_code_available": False,
        "status_code_value": "",
        "body_available": False,
        "body_type": "",
        "body_length": 0,
        "json_decode": "NOT_ATTEMPTED",
        "payload_type": "",
        "parser_result": "INVALID",
        "rival_result": "INVALID",
        "failure_stage": "",
        "secondary_failure_stage": "",
    }


def _failure(result: dict, stage: str, secondary: bool = False) -> None:
    key = "secondary_failure_stage" if secondary else "failure_stage"
    if result[key] == "":
        result[key] = stage


def _capture_response(result: dict, response):
    status_available, status_value = _read_attribute(response, "status")
    status_code_available, status_code_value = _read_attribute(response, "status_code")
    body_available, body = _read_attribute(response, "body")
    result["status_available"] = status_available
    result["status_value"] = _display(status_value)
    result["status_code_available"] = status_code_available
    result["status_code_value"] = _display(status_code_value)
    result["body_available"] = body_available
    result["body_type"] = _kind(body) if body_available else ""
    result["body_length"] = len(body) if body_available and isinstance(body, bytes) else 0

    if not status_available:
        _failure(result, "STATUS_ATTRIBUTE_ERROR")
    status_number = _status_number(status_value) if status_available else None
    status_code_number = _status_number(status_code_value) if status_code_available else None
    effective_status = status_number if status_number is not None else status_code_number
    if status_available and status_number is None:
        _failure(result, "HTTP_STATUS_PARSE_ERROR")
    if effective_status is not None and effective_status != 200:
        if result["failure_stage"] == "STATUS_ATTRIBUTE_ERROR":
            _failure(result, "HTTP_NON_200", secondary=True)
        else:
            _failure(result, "HTTP_NON_200")
        if effective_status in (408, 425, 429) or effective_status >= 500:
            result["rival_result"] = "UNAVAILABLE"
        return None
    if not body_available:
        _failure(result, "BODY_MISSING")
        return None
    if not isinstance(body, bytes):
        _failure(result, "BODY_WRONG_TYPE")
        return None
    if len(body) == 0:
        _failure(result, "BODY_EMPTY")
        return None
    if len(body) > MAX_RESPONSE_BYTES:
        _failure(result, "BODY_TOO_LARGE")
        return None
    try:
        text = body.decode("utf-8")
    except Exception:
        _failure(result, "UTF8_DECODE_ERROR")
        return None
    try:
        payload = json.loads(text)
    except Exception:
        result["json_decode"] = "ERROR"
        _failure(result, "JSON_DECODE_ERROR")
        return None
    result["json_decode"] = "OK"
    result["payload_type"] = _kind(payload)
    return payload


def _finish_valid(result: dict) -> dict:
    result["parser_result"] = "VALID"
    if result["failure_stage"] == "":
        result["rival_result"] = "VALID"
    return result


def _provider_result(source: str, asset_index: int, symbol: str, url: str) -> dict:
    return {
        "source": source,
        "asset": ASSET_NAMES[asset_index],
        "symbol": symbol,
        "url": url,
        "web_get": "",
        "status_available": False,
        "status": "",
        "body_available": False,
        "body_type": "",
        "body_length": 0,
        "json_decode": "NOT_ATTEMPTED",
        "payload_type": "",
        "parser_result": "INVALID",
        "failure_stage": "",
        "secondary_failure_stage": "",
    }


def _unsupported_provider_result(source: str, asset_index: int) -> dict:
    result = _provider_result(source, asset_index, "", "")
    result["web_get"] = "NOT_ATTEMPTED"
    result["parser_result"] = "UNSUPPORTED_MAPPING"
    result["failure_stage"] = "UNSUPPORTED_MAPPING"
    return result


def _capture_provider_response(result: dict, response, decode_json: bool = True):
    status_available, status_value = _read_attribute(response, "status")
    body_available, body = _read_attribute(response, "body")
    result["status_available"] = status_available
    result["status"] = _status_number(status_value) if status_available else ""
    result["body_available"] = body_available
    result["body_type"] = _kind(body) if body_available else ""
    result["body_length"] = len(body) if body_available and isinstance(body, bytes) else 0

    if not status_available:
        _failure(result, "STATUS_ATTRIBUTE_ERROR")
        return None
    status_number = _status_number(status_value)
    if status_number is None:
        _failure(result, "HTTP_STATUS_PARSE_ERROR")
        return None
    if status_number != 200:
        _failure(result, "HTTP_NON_200")
        result["error_body_preview"] = ""
        if not body_available:
            _failure(result, "BODY_MISSING", secondary=True)
            return None
        if not isinstance(body, bytes):
            _failure(result, "BODY_WRONG_TYPE", secondary=True)
            return None
        if len(body) > MAX_RESPONSE_BYTES:
            _failure(result, "BODY_TOO_LARGE", secondary=True)
            return None
        try:
            result["error_body_preview"] = body.decode("utf-8")[:MAX_ERROR_PREVIEW_BYTES]
        except Exception:
            _failure(result, "UTF8_DECODE_ERROR", secondary=True)
        return None
    if not body_available:
        _failure(result, "BODY_MISSING")
        return None
    if not isinstance(body, bytes):
        _failure(result, "BODY_WRONG_TYPE")
        return None
    if len(body) == 0:
        _failure(result, "BODY_EMPTY")
        return None
    if len(body) > MAX_RESPONSE_BYTES:
        _failure(result, "BODY_TOO_LARGE")
        return None
    if not decode_json:
        return None
    try:
        text = body.decode("utf-8")
    except Exception:
        _failure(result, "UTF8_DECODE_ERROR")
        return None
    try:
        payload = json.loads(text)
    except Exception:
        result["json_decode"] = "ERROR"
        _failure(result, "JSON_DECODE_ERROR")
        return None
    result["json_decode"] = "OK"
    result["payload_type"] = _kind(payload)
    return payload


def _provider_valid(result: dict) -> dict:
    result["parser_result"] = "VALID"
    return result


def _gate_url(start_seconds: int, end_seconds: int, symbol: str) -> str:
    return (
        "https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract="
        + symbol
        + "&interval=1h&from="
        + str(start_seconds)
        + "&to="
        + str(end_seconds - 1)
    )


def _bitget_url(start_seconds: int, end_seconds: int, symbol: str) -> str:
    start_ms = start_seconds * 1000
    end_ms = end_seconds * 1000
    return (
        "https://api.bitget.com/api/v3/market/candles?category=USDT-FUTURES&symbol="
        + symbol
        + "&interval=1H&startTime="
        + str(start_ms)
        + "&endTime="
        + str(end_ms - 1)
        + "&limit=1"
    )


def _binance_url(start_seconds: int, end_seconds: int, symbol: str) -> str:
    start_ms = start_seconds * 1000
    end_ms = end_seconds * 1000
    return (
        BINANCE_BASE_URL
        + "?symbol="
        + symbol
        + "&interval=1h&startTime="
        + str(start_ms)
        + "&endTime="
        + str(end_ms - 1)
        + "&limit=1"
    )


def _bybit_url(start_seconds: int, end_seconds: int, symbol: str) -> str:
    start_ms = start_seconds * 1000
    end_ms = end_seconds * 1000
    return (
        BYBIT_BASE_URL
        + "?category=linear&symbol="
        + symbol
        + "&interval=60&start="
        + str(start_ms)
        + "&end="
        + str(end_ms - 1)
        + "&limit=1"
    )


def _parse_gate_payload(result: dict, payload, start_seconds: int, symbol: str) -> dict:
    if not isinstance(payload, list):
        _failure(result, "GATE_PAYLOAD_NOT_LIST")
        return result
    if len(payload) != 1:
        _failure(result, "GATE_ROW_COUNT")
        return result
    row = payload[0]
    if isinstance(row, list):
        result["row_length"] = len(row)
        if len(row) != 7:
            _failure(result, "GATE_ROW_LENGTH")
            return result
        result["open_timestamp"] = _display(row[0])
        result["expected_open_timestamp"] = str(start_seconds)
        result["open"] = _display(row[5])
        result["close"] = _display(row[2])
        if _parse_integer(row[0]) != start_seconds:
            _failure(result, "GATE_TIMESTAMP_MISMATCH")
            return result
        opening = _parse_price(row[5])
        high = _parse_price(row[3])
        low = _parse_price(row[4])
        closing = _parse_price(row[2])
        if opening is None or high is None or low is None or closing is None:
            _failure(result, "GATE_PRICE_PARSE_ERROR")
            return result
        return _provider_valid(result)
    if isinstance(row, dict):
        result["row_length"] = len(row)
        result["open_timestamp"] = _display(row.get("t"))
        result["expected_open_timestamp"] = str(start_seconds)
        result["open"] = _display(row.get("o"))
        result["close"] = _display(row.get("c"))
        if len(row) > 10 or "t" not in row or "o" not in row or "h" not in row or "l" not in row or "c" not in row:
            _failure(result, "GATE_ROW_SHAPE_ERROR")
            return result
        if row.get("source", PROVIDER_GATE) != PROVIDER_GATE:
            _failure(result, "GATE_SOURCE")
            return result
        if row.get("symbol", symbol) != symbol or row.get("contract", symbol) != symbol:
            _failure(result, "GATE_SYMBOL")
            return result
        if row.get("interval", "1h") != "1h":
            _failure(result, "GATE_INTERVAL")
            return result
        if _parse_integer(row["t"]) != start_seconds:
            _failure(result, "GATE_TIMESTAMP_MISMATCH")
            return result
        opening = _parse_price(row["o"])
        high = _parse_price(row["h"])
        low = _parse_price(row["l"])
        closing = _parse_price(row["c"])
        if opening is None or high is None or low is None or closing is None:
            _failure(result, "GATE_PRICE_PARSE_ERROR")
            return result
        return _provider_valid(result)
    _failure(result, "GATE_ROW_TYPE")
    return result


def _probe_gate_asset(start_seconds: int, end_seconds: int, asset_index: int) -> dict:
    symbol = GATE_SYMBOLS[asset_index]
    result = _provider_result(PROVIDER_GATE, asset_index, symbol, _gate_url(start_seconds, end_seconds, symbol))
    try:
        response = gl.nondet.web.get(result["url"], headers={"Accept": "application/json"})
        result["web_get"] = "OK"
    except Exception:
        result["web_get"] = "EXCEPTION"
        _failure(result, "WEB_GET_EXCEPTION")
        return result
    payload = _capture_provider_response(result, response)
    if payload is None:
        return result
    return _parse_gate_payload(result, payload, start_seconds, symbol)


def _parse_bitget_payload(result: dict, payload, start_seconds: int, symbol: str) -> dict:
    if not isinstance(payload, dict):
        _failure(result, "BITGET_PAYLOAD_NOT_DICT")
        return result
    result["provider_code"] = _display(payload.get("code"))
    result["provider_message"] = _display(payload.get("msg"))
    if payload.get("code") != "00000":
        _failure(result, "PROVIDER_ERROR_CODE")
        return result
    if payload.get("source", PROVIDER_BITGET) != PROVIDER_BITGET:
        _failure(result, "BITGET_SOURCE")
        return result
    if payload.get("category", "USDT-FUTURES") != "USDT-FUTURES":
        _failure(result, "BITGET_CATEGORY")
        return result
    if payload.get("symbol", symbol) != symbol:
        _failure(result, "BITGET_SYMBOL")
        return result
    if payload.get("interval", "1H") != "1H":
        _failure(result, "BITGET_INTERVAL")
        return result
    if payload.get("type", "market") not in ("market", ""):
        _failure(result, "BITGET_TYPE")
        return result
    rows = payload.get("data")
    if not isinstance(rows, list):
        _failure(result, "BITGET_DATA")
        return result
    result["row_count"] = len(rows)
    if len(rows) != 1:
        _failure(result, "BITGET_ROW_COUNT")
        return result
    if not isinstance(rows[0], list):
        _failure(result, "BITGET_ROW_TYPE")
        return result
    row = rows[0]
    result["row_length"] = len(row)
    if len(row) != 7:
        _failure(result, "BITGET_ROW_LENGTH")
        return result
    start_ms = start_seconds * 1000
    result["open_timestamp"] = _display(row[0])
    result["expected_open_timestamp"] = str(start_ms)
    result["open"] = _display(row[1])
    result["close"] = _display(row[4])
    if _parse_integer(row[0]) != start_ms:
        _failure(result, "BITGET_TIMESTAMP_MISMATCH")
        return result
    opening = _parse_price(row[1])
    high = _parse_price(row[2])
    low = _parse_price(row[3])
    closing = _parse_price(row[4])
    if opening is None or high is None or low is None or closing is None:
        _failure(result, "BITGET_PRICE_PARSE_ERROR")
        return result
    return _provider_valid(result)


def _probe_bitget_asset(start_seconds: int, end_seconds: int, asset_index: int) -> dict:
    symbol = BITGET_SYMBOLS[asset_index]
    result = _provider_result(PROVIDER_BITGET, asset_index, symbol, _bitget_url(start_seconds, end_seconds, symbol))
    try:
        response = gl.nondet.web.get(result["url"], headers={"Accept": "application/json"})
        result["web_get"] = "OK"
    except Exception:
        result["web_get"] = "EXCEPTION"
        _failure(result, "WEB_GET_EXCEPTION")
        return result
    payload = _capture_provider_response(result, response)
    if payload is None:
        return result
    return _parse_bitget_payload(result, payload, start_seconds, symbol)


def _hyperliquid_body(start_seconds: int, end_seconds: int, symbol: str) -> str:
    return json.dumps(
        {
            "type": "candleSnapshot",
            "req": {
                "coin": symbol,
                "interval": "1h",
                "startTime": start_seconds * 1000,
                "endTime": end_seconds * 1000 - 1,
            },
        },
        separators=(",", ":"),
    )


def _parse_hyperliquid_payload(result: dict, payload, start_seconds: int, end_seconds: int, symbol: str) -> dict:
    if not isinstance(payload, list):
        _failure(result, "HYPERLIQUID_PAYLOAD_NOT_LIST")
        return result
    if len(payload) != 1:
        _failure(result, "HYPERLIQUID_ROW_COUNT")
        return result
    row = payload[0]
    if not isinstance(row, dict):
        _failure(result, "HYPERLIQUID_ROW_NOT_DICT")
        return result
    result["row_length"] = len(row)
    result["open_timestamp"] = _display(row.get("t"))
    result["expected_open_timestamp"] = str(start_seconds * 1000)
    result["close_timestamp"] = _display(row.get("T"))
    result["expected_close_timestamp"] = str(end_seconds * 1000 - 1)
    result["open"] = _display(row.get("o"))
    result["close"] = _display(row.get("c"))
    if row.get("s") != symbol:
        _failure(result, "HYPERLIQUID_SYMBOL")
        return result
    if row.get("i") != "1h":
        _failure(result, "HYPERLIQUID_INTERVAL")
        return result
    if _parse_integer(row.get("t")) != start_seconds * 1000 or _parse_integer(row.get("T")) != end_seconds * 1000 - 1:
        _failure(result, "HYPERLIQUID_TIMESTAMP_MISMATCH")
        return result
    opening = _parse_price(row.get("o"))
    high = _parse_price(row.get("h"))
    low = _parse_price(row.get("l"))
    closing = _parse_price(row.get("c"))
    if opening is None or high is None or low is None or closing is None:
        _failure(result, "HYPERLIQUID_PRICE_PARSE_ERROR")
        return result
    return _provider_valid(result)


def _probe_hyperliquid_asset(start_seconds: int, end_seconds: int, asset_index: int) -> dict:
    symbol = HYPERLIQUID_SYMBOLS[asset_index]
    if symbol == "":
        return _unsupported_provider_result(PROVIDER_HYPERLIQUID, asset_index)
    url = "https://api.hyperliquid.xyz/info"
    result = _provider_result(PROVIDER_HYPERLIQUID, asset_index, symbol, url)
    result["request_method"] = "POST"
    result["request_body"] = _hyperliquid_body(start_seconds, end_seconds, symbol)
    try:
        response = gl.nondet.web.request(
            url,
            method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            body=result["request_body"],
        )
        result["web_get"] = "OK"
    except Exception:
        result["web_get"] = "EXCEPTION"
        _failure(result, "WEB_REQUEST_EXCEPTION")
        return result
    payload = _capture_provider_response(result, response)
    if payload is None:
        return result
    return _parse_hyperliquid_payload(result, payload, start_seconds, end_seconds, symbol)


def _probe_provider(provider: str, start_seconds: int, end_seconds: int) -> dict:
    assets = []
    for asset_index in range(len(ASSET_NAMES)):
        if provider == PROVIDER_GATE:
            assets.append(_probe_gate_asset(start_seconds, end_seconds, asset_index))
        elif provider == PROVIDER_BITGET:
            assets.append(_probe_bitget_asset(start_seconds, end_seconds, asset_index))
        else:
            assets.append(_probe_hyperliquid_asset(start_seconds, end_seconds, asset_index))
    return {
        "probe": "RIVAL_PROVIDER_PROBE",
        "provider": provider,
        "market_start": start_seconds,
        "market_end": end_seconds,
        "assets": assets,
    }


PROVIDER_COMPARE_FIELDS = (
    "source", "asset", "symbol", "url", "web_get", "status_available", "status",
    "body_available", "body_type", "body_length", "json_decode", "payload_type",
    "parser_result", "failure_stage", "secondary_failure_stage", "provider_code",
    "provider_message", "request_method", "request_body", "row_count", "row_length",
    "open_timestamp", "expected_open_timestamp", "close_timestamp",
    "expected_close_timestamp", "open", "close",
)


def _stable_provider_result(result: dict) -> dict:
    stable = {}
    for field in PROVIDER_COMPARE_FIELDS:
        if field in result:
            stable[field] = result[field]
    return stable


def _provider_diagnostics_match(first: dict, second: dict) -> bool:
    if not isinstance(first, dict) or not isinstance(second, dict):
        return False
    if first.get("probe") != second.get("probe") or first.get("provider") != second.get("provider"):
        return False
    if first.get("market_start") != second.get("market_start") or first.get("market_end") != second.get("market_end"):
        return False
    first_assets = first.get("assets")
    second_assets = second.get("assets")
    if not isinstance(first_assets, list) or not isinstance(second_assets, list) or len(first_assets) != len(second_assets):
        return False
    for index in range(len(first_assets)):
        if _stable_provider_result(first_assets[index]) != _stable_provider_result(second_assets[index]):
            return False
    return True


def _run_provider_probe(provider: str, market_start: u256) -> dict:
    if not isinstance(market_start, int) or isinstance(market_start, bool):
        raise gl.vm.UserError("market start must be an integer")
    if market_start <= 0 or market_start > U256_MAX:
        raise gl.vm.UserError("market start is out of range")
    market_end = market_start + DURATION_SECONDS

    def leader_fn():
        return _probe_provider(provider, market_start, market_end)

    def validator_fn(leader_result):
        if not isinstance(leader_result, gl.vm.Return) or not isinstance(leader_result.calldata, dict):
            return False
        return _provider_diagnostics_match(
            leader_result.calldata,
            _probe_provider(provider, market_start, market_end),
        )

    return gl.vm.run_nondet(leader_fn, validator_fn)


def _denial_result(source: str, symbol: str, url: str) -> dict:
    return {
        "source": source,
        "symbol": symbol,
        "url": url,
        "web_get": "",
        "status_available": False,
        "status": "",
        "body_available": False,
        "body_type": "",
        "body_length": 0,
        "failure_stage": "",
        "secondary_failure_stage": "",
    }


def _probe_denial_asset(start_seconds: int, end_seconds: int, source: str) -> dict:
    symbol = "BTCUSDT"
    url = _binance_url(start_seconds, end_seconds, symbol) if source == SOURCE_BINANCE else _bybit_url(start_seconds, end_seconds, symbol)
    result = _denial_result(source, symbol, url)
    try:
        response = gl.nondet.web.get(url, headers={"Accept": "application/json"})
        result["web_get"] = "OK"
    except Exception:
        result["web_get"] = "EXCEPTION"
        _failure(result, "WEB_GET_EXCEPTION")
        return result
    _capture_provider_response(result, response, decode_json=False)
    return result


def _probe_denial_bodies(start_seconds: int, end_seconds: int) -> dict:
    return {
        "probe": "RIVAL_DENIAL_BODY_PROBE",
        "market_start": start_seconds,
        "market_end": end_seconds,
        "results": [
            _probe_denial_asset(start_seconds, end_seconds, SOURCE_BINANCE),
            _probe_denial_asset(start_seconds, end_seconds, SOURCE_BYBIT),
        ],
    }


def _denial_diagnostics_match(first: dict, second: dict) -> bool:
    if not isinstance(first, dict) or not isinstance(second, dict):
        return False
    if first.get("probe") != second.get("probe") or first.get("market_start") != second.get("market_start") or first.get("market_end") != second.get("market_end"):
        return False
    first_results = first.get("results")
    second_results = second.get("results")
    if not isinstance(first_results, list) or not isinstance(second_results, list) or len(first_results) != len(second_results):
        return False
    for index in range(len(first_results)):
        first_result = first_results[index]
        second_result = second_results[index]
        for field in ("source", "symbol", "url", "web_get", "status_available", "status", "body_available", "body_type", "body_length", "failure_stage", "secondary_failure_stage"):
            if first_result.get(field) != second_result.get(field):
                return False
    return True


def _run_denial_probe(market_start: u256) -> dict:
    if not isinstance(market_start, int) or isinstance(market_start, bool):
        raise gl.vm.UserError("market start must be an integer")
    if market_start <= 0 or market_start > U256_MAX:
        raise gl.vm.UserError("market start is out of range")
    market_end = market_start + DURATION_SECONDS

    def leader_fn():
        return _probe_denial_bodies(market_start, market_end)

    def validator_fn(leader_result):
        if not isinstance(leader_result, gl.vm.Return) or not isinstance(leader_result.calldata, dict):
            return False
        # error_body_preview is intentionally excluded: CDN request IDs,
        # timestamps, and edge identifiers may vary across validators.
        return _denial_diagnostics_match(
            leader_result.calldata,
            _probe_denial_bodies(market_start, market_end),
        )

    return gl.vm.run_nondet(leader_fn, validator_fn)


def _probe_binance(start_seconds: int, end_seconds: int, symbol: str) -> dict:
    start_ms = start_seconds * 1000
    end_ms = end_seconds * 1000
    url = (
        BINANCE_BASE_URL
        + "?symbol="
        + symbol
        + "&interval=1h&startTime="
        + str(start_ms)
        + "&endTime="
        + str(end_ms - 1)
        + "&limit=1"
    )
    result = _base_result(SOURCE_BINANCE, symbol, url)
    try:
        response = gl.nondet.web.get(url, headers={"Accept": "application/json"})
        result["web_get"] = "OK"
    except Exception:
        result["web_get"] = "EXCEPTION"
        _failure(result, "WEB_GET_EXCEPTION")
        return result
    payload = _capture_response(result, response)
    if payload is None:
        return result
    if not isinstance(payload, list):
        _failure(result, "BINANCE_PAYLOAD_NOT_LIST")
        return result
    if len(payload) != 1:
        _failure(result, "BINANCE_ROW_COUNT")
        return result
    if not isinstance(payload[0], list):
        _failure(result, "BINANCE_ROW_NOT_LIST")
        return result
    row = payload[0]
    result["row_length"] = len(row)
    if len(row) != 12:
        _failure(result, "BINANCE_ROW_LENGTH")
        return result
    open_timestamp = _parse_integer(row[0])
    close_timestamp = _parse_integer(row[6])
    result["open_timestamp"] = _display(row[0])
    result["expected_open_timestamp"] = str(start_ms)
    result["close_timestamp"] = _display(row[6])
    result["expected_close_timestamp"] = str(end_ms - 1)
    result["open"] = _display(row[1])
    result["close"] = _display(row[4])
    if open_timestamp != start_ms:
        _failure(result, "BINANCE_OPEN_TIMESTAMP")
        return result
    if close_timestamp != end_ms - 1:
        _failure(result, "BINANCE_CLOSE_TIMESTAMP")
        return result
    if _parse_price(row[1]) is None:
        _failure(result, "BINANCE_OPEN_PRICE")
        return result
    if _parse_price(row[4]) is None:
        _failure(result, "BINANCE_CLOSE_PRICE")
        return result
    return _finish_valid(result)


def _probe_bybit(start_seconds: int, end_seconds: int, symbol: str) -> dict:
    start_ms = start_seconds * 1000
    end_ms = end_seconds * 1000
    url = (
        BYBIT_BASE_URL
        + "?category=linear&symbol="
        + symbol
        + "&interval=60&start="
        + str(start_ms)
        + "&end="
        + str(end_ms - 1)
        + "&limit=1"
    )
    result = _base_result(SOURCE_BYBIT, symbol, url)
    try:
        response = gl.nondet.web.get(url, headers={"Accept": "application/json"})
        result["web_get"] = "OK"
    except Exception:
        result["web_get"] = "EXCEPTION"
        _failure(result, "WEB_GET_EXCEPTION")
        return result
    payload = _capture_response(result, response)
    if payload is None:
        return result
    if not isinstance(payload, dict):
        _failure(result, "BYBIT_PAYLOAD_NOT_DICT")
        return result
    result["retCode"] = _display(payload.get("retCode"))
    result["retMsg"] = _display(payload.get("retMsg"))
    if payload.get("retCode") != 0:
        _failure(result, "BYBIT_RET_CODE")
        return result
    source_result = payload.get("result")
    if not isinstance(source_result, dict):
        _failure(result, "BYBIT_RESULT_NOT_DICT")
        return result
    result["returned_category"] = _display(source_result.get("category"))
    result["returned_symbol"] = _display(source_result.get("symbol"))
    if source_result.get("category") != "linear":
        _failure(result, "BYBIT_CATEGORY")
        return result
    if source_result.get("symbol") != symbol:
        _failure(result, "BYBIT_SYMBOL")
        return result
    rows = source_result.get("list")
    if not isinstance(rows, list):
        _failure(result, "BYBIT_LIST")
        return result
    if len(rows) != 1:
        _failure(result, "BYBIT_ROW_COUNT")
        return result
    if not isinstance(rows[0], list):
        _failure(result, "BYBIT_ROW_NOT_LIST")
        return result
    row = rows[0]
    result["row_length"] = len(row)
    if len(row) != 7:
        _failure(result, "BYBIT_ROW_LENGTH")
        return result
    open_timestamp = _parse_integer(row[0])
    result["open_timestamp"] = _display(row[0])
    result["expected_open_timestamp"] = str(start_ms)
    result["open"] = _display(row[1])
    result["close"] = _display(row[4])
    if open_timestamp != start_ms:
        _failure(result, "BYBIT_OPEN_TIMESTAMP")
        return result
    if _parse_price(row[1]) is None:
        _failure(result, "BYBIT_OPEN_PRICE")
        return result
    if _parse_price(row[4]) is None:
        _failure(result, "BYBIT_CLOSE_PRICE")
        return result
    return _finish_valid(result)


def _probe_all(start_seconds: int, end_seconds: int) -> dict:
    return {
        "probe": "RIVAL_SOURCE_PROBE",
        "market_start": start_seconds,
        "market_end": end_seconds,
        "market_start_ms": start_seconds * 1000,
        "market_end_ms": end_seconds * 1000,
        "interval": "1h",
        "binance": [_probe_binance(start_seconds, end_seconds, symbol) for symbol in BINANCE_SYMBOLS],
        "bybit": [_probe_bybit(start_seconds, end_seconds, symbol) for symbol in BYBIT_SYMBOLS],
    }


def _diagnostics_match(first: dict, second: dict) -> bool:
    return first == second


class SourceProbe(gl.contract.Contract):
    def __init__(self):
        pass

    @gl.public.write
    def probe_market(self, market_start: u256) -> dict:
        if not isinstance(market_start, int) or isinstance(market_start, bool):
            raise gl.vm.UserError("market start must be an integer")
        if market_start <= 0 or market_start > U256_MAX:
            raise gl.vm.UserError("market start is out of range")
        market_end = market_start + DURATION_SECONDS

        def leader_fn():
            return _probe_all(market_start, market_end)

        def validator_fn(leader_result):
            if not isinstance(leader_result, gl.vm.Return):
                return False
            leader_diagnostics = leader_result.calldata
            if not isinstance(leader_diagnostics, dict):
                return False
            validator_diagnostics = _probe_all(market_start, market_end)
            # run_nondet exposes only a boolean validator result. A mismatch
            # therefore rejects the diagnostic call instead of being hidden.
            return _diagnostics_match(leader_diagnostics, validator_diagnostics)

        return gl.vm.run_nondet(leader_fn, validator_fn)

    @gl.public.write
    def probe_denial_bodies(self, market_start: u256) -> dict:
        return _run_denial_probe(market_start)

    @gl.public.write
    def probe_gate(self, market_start: u256) -> dict:
        return _run_provider_probe(PROVIDER_GATE, market_start)

    @gl.public.write
    def probe_bitget(self, market_start: u256) -> dict:
        return _run_provider_probe(PROVIDER_BITGET, market_start)

    @gl.public.write
    def probe_hyperliquid(self, market_start: u256) -> dict:
        return _run_provider_probe(PROVIDER_HYPERLIQUID, market_start)
