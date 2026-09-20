import ast
import json
from datetime import datetime as RealDateTime, timezone
from pathlib import Path


RIVAL_SOURCE = Path(__file__).parents[2] / "contracts" / "Rival.py"


def _helpers():
    tree = ast.parse(RIVAL_SOURCE.read_text())
    names = {
        "_is_digits",
        "_parse_integer",
        "_parse_price",
        "_now",
        "_response_json",
        "_gate_candle",
        "_bitget_candle",
        "_score",
        "_compare_scores",
        "_consensus_winner",
    }
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    namespace = {
        "json": json,
        "U256_MAX": 2**256 - 1,
        "PRICE_SCALE": 1_000_000_000_000_000_000,
        "MAX_RESPONSE_BYTES": 65_536,
        "SOURCE_GATE": "GATE",
        "SOURCE_BITGET": "BITGET",
        "SOURCE_VALID": "VALID",
        "SOURCE_TIE": "TIE",
        "SOURCE_UNAVAILABLE": "UNAVAILABLE",
        "SOURCE_INVALID": "INVALID",
        "SOURCES": ("GATE", "BITGET"),
        "OUTCOME_NONE": 2,
        "OUTCOME_COUNT": 2,
    }
    class FixedDateTime:
        @classmethod
        def now(cls, tz=None):
            assert tz is timezone.utc
            return RealDateTime(2026, 1, 1, tzinfo=timezone.utc)

    namespace["datetime"] = FixedDateTime
    namespace["timezone"] = timezone
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(RIVAL_SOURCE), "exec"), namespace)
    return namespace


def _gate_row(timestamp="1789855200", opening="81067.2", closing="81230.2"):
    return [timestamp, "0", closing, "82000", "80000", opening, "0"]


def _bitget_payload(timestamp="1789855200000", opening="81067.6", closing="81231.3"):
    return {
        "code": "00000",
        "msg": "success",
        "data": [[timestamp, opening, "82000", "80000", closing, "0", "0"]],
    }


def test_source_constants_and_request_hosts_are_migrated():
    source = RIVAL_SOURCE.read_text()
    assert 'SOURCE_GATE = "GATE"' in source
    assert 'SOURCE_BITGET = "BITGET"' in source
    assert "api.gateio.ws/api/v4/futures/usdt/candlesticks" in source
    assert "api.bitget.com/api/v3/market/candles" in source
    for stale in ("BINANCE", "BYBIT", "binance", "bybit", "XTIUSDT", "fapi.binance.com", "api.bybit.com"):
        assert stale not in source


def test_transaction_clock_uses_documented_deterministic_utc_clock():
    source = RIVAL_SOURCE.read_text()
    assert "time.time()" not in source
    assert 'gl.message_raw["datetime"]' not in source
    assert "invalid transaction time" not in source
    assert "datetime.now(timezone.utc).timestamp()" in source
    assert _helpers()["_now"]() == 1767225600


def test_next_hour_creation_window_and_timing_boundaries_are_unchanged():
    now = _helpers()["_now"]()
    expected_start = ((now // 3600) + 1) * 3600
    assert expected_start == 1767229200
    assert expected_start % 3600 == 0
    assert expected_start - 1 < expected_start < expected_start + 3600
    assert expected_start + 3600 == 1767232800
    assert expected_start + 3600 + 60 == 1767232860
    assert expected_start + 3600 + 43200 == 1767276000


def test_gate_valid_parser_and_all_negative_shapes():
    helpers = _helpers()
    parse = helpers["_gate_candle"]
    assert parse([_gate_row()], 1789855200, "BTC_USDT") is not None
    assert parse([], 1789855200, "BTC_USDT") is None
    assert parse([_gate_row(), _gate_row()], 1789855200, "BTC_USDT") is None
    assert parse([_gate_row()[:6]], 1789855200, "BTC_USDT") is None
    assert parse([_gate_row("1789855201")], 1789855200, "BTC_USDT") is None
    assert parse([_gate_row(opening="bad")], 1789855200, "BTC_USDT") is None
    assert parse([_gate_row(closing="bad")], 1789855200, "BTC_USDT") is None


def test_bitget_valid_parser_and_all_negative_shapes():
    helpers = _helpers()
    parse = helpers["_bitget_candle"]
    assert parse(_bitget_payload(), 1789855200000, 1789858800000, "BTCUSDT") is not None
    assert parse({"code": "10001", "msg": "error", "data": []}, 1789855200000, 1789858800000, "BTCUSDT") is None
    assert parse({"code": "00000", "data": []}, 1789855200000, 1789858800000, "BTCUSDT") is None
    multiple = _bitget_payload()["data"] * 2
    assert parse({"code": "00000", "data": multiple}, 1789855200000, 1789858800000, "BTCUSDT") is None
    short = _bitget_payload()
    short["data"] = [short["data"][0][:6]]
    assert parse(short, 1789855200000, 1789858800000, "BTCUSDT") is None
    assert parse(_bitget_payload("1789855200001"), 1789855200000, 1789858800000, "BTCUSDT") is None
    assert parse(_bitget_payload(opening="bad"), 1789855200000, 1789858800000, "BTCUSDT") is None
    assert parse(_bitget_payload(closing="bad"), 1789855200000, 1789858800000, "BTCUSDT") is None


def test_http_failure_classification_remains_bounded_and_defensive():
    helpers = _helpers()
    response_json = helpers["_response_json"]

    class Response:
        def __init__(self, status, body):
            self.status = status
            self.body = body

    assert response_json(Response(451, b"restricted"))[0] == "INVALID"
    assert response_json(Response(403, b"denied"))[0] == "INVALID"
    assert response_json(Response(429, b"busy"))[0] == "UNAVAILABLE"
    assert response_json(Response(200, b"{"))[0] == "INVALID"
    assert response_json(Response(200, b"[]"))[0] == "OK"


def test_production_rational_scores_make_both_fixture_sources_crypto():
    helpers = _helpers()
    parse_price = helpers["_parse_price"]
    score = helpers["_score"]
    compare = helpers["_compare_scores"]

    fixtures = {
        "GATE": [("81067.2", "81230.2"), ("2626.6", "2629.73"), ("110.5", "110.63"), ("4381.12", "4382.97"), ("66.63", "66.59"), ("95.36", "95.37")],
        "BITGET": [("81067.6", "81231.3"), ("2626.32", "2629.73"), ("110.488", "110.617"), ("4381.11", "4382.42"), ("66.62", "66.58"), ("95.464", "95.481")],
    }

    for rows in fixtures.values():
        parsed = []
        for opening, closing in rows:
            parsed.append({"_open_scaled": parse_price(opening)[0], "_close_scaled": parse_price(closing)[0]})
        crypto = score(parsed, (0, 1, 2))
        commodities = score(parsed, (3, 4, 5))
        assert compare(crypto, commodities) == 1


def test_strict_two_source_consensus_and_nonconsensus_cases():
    helpers = _helpers()
    consensus = helpers["_consensus_winner"]

    def result(status, winner):
        return {"source_status": status, "source_winner_id": winner}

    assert consensus([result("VALID", 0), result("VALID", 0)]) == 0
    assert consensus([result("VALID", 1), result("VALID", 1)]) == 1
    assert consensus([result("VALID", 0), result("VALID", 1)]) == 2
    assert consensus([result("UNAVAILABLE", 0), result("VALID", 0)]) == 2
    assert consensus([result("INVALID", 0), result("VALID", 0)]) == 2
    assert consensus([result("TIE", 2), result("VALID", 0)]) == 2
    assert consensus([result("VALID", 0), result("TIE", 2)]) == 2
    assert consensus([result("UNAVAILABLE", 0), result("UNAVAILABLE", 0)]) == 2
    assert consensus([result("INVALID", 0), result("INVALID", 0)]) == 2
