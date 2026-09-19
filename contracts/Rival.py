# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

import json
import time

import genlayer as gl
from genlayer import Address, u256
from genlayer.storage import TreeMap


OUTCOME_CRYPTO = 0
OUTCOME_COMMODITIES = 1
OUTCOME_NONE = 2
OUTCOME_COUNT = 2
OUTCOME_NAMES = ("CRYPTO", "COMMODITIES")
ASSET_NAMES = ("BTC", "ETH", "SOL", "GOLD", "SILVER", "WTI_CRUDE")
CRYPTO_ASSETS = (0, 1, 2)
COMMODITY_ASSETS = (3, 4, 5)

SOURCE_BINANCE = "BINANCE"
SOURCE_BYBIT = "BYBIT"
SOURCES = (SOURCE_BINANCE, SOURCE_BYBIT)

# Binance USDⓈ-M and Bybit linear symbols are intentionally immutable.
BINANCE_SYMBOLS = ("BTCUSDT", "ETHUSDT", "SOLUSDT", "XAUUSDT", "XAGUSDT", "CLUSDT")
BYBIT_SYMBOLS = ("BTCUSDT", "ETHUSDT", "SOLUSDT", "XAUUSDT", "XAGUSDT", "XTIUSDT")

STATE_OPEN = "OPEN"
STATE_PENDING = "SETTLEMENT_PENDING"
STATE_SETTLED = "SETTLED"
STATE_INCONCLUSIVE = "INCONCLUSIVE"

REASON_NONE = ""
REASON_CONSENSUS = "CONSENSUS"
REASON_NO_CONSENSUS = "NO_CONSENSUS"
REASON_EXPIRED = "EXPIRED_NO_CONSENSUS"
REASON_ZERO_BACKED = "ZERO_BACKED_WINNER"

SOURCE_VALID = "VALID"
SOURCE_TIE = "TIE"
SOURCE_UNAVAILABLE = "UNAVAILABLE"
SOURCE_INVALID = "INVALID"

DURATION_SECONDS = 3600
SETTLEMENT_GRACE_SECONDS = 60
SETTLEMENT_RETRY_WINDOW_SECONDS = 12 * 3600
GEN_SCALE = 1_000_000_000_000_000_000
MIN_BET = GEN_SCALE
MAX_BET_PER_MARKET = 15 * GEN_SCALE
PRICE_SCALE = GEN_SCALE
MAX_RESPONSE_BYTES = 65_536
MAX_PAGE_SIZE = 50
MAX_SOURCE_ATTEMPTS = 3
MAX_MARKETS = 1024
MAX_POSITIONS = 100_000
U256_MAX = 2**256 - 1


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


def _is_u256(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= U256_MAX


def _outcome_id(outcome) -> u256:
    if isinstance(outcome, int) and not isinstance(outcome, bool) and 0 <= outcome < OUTCOME_COUNT:
        return outcome
    if isinstance(outcome, str):
        for index in range(OUTCOME_COUNT):
            if outcome == OUTCOME_NAMES[index]:
                return index
    raise gl.vm.UserError("invalid outcome")


def _outcome_name(outcome) -> str:
    outcome_id = _outcome_id(outcome)
    return OUTCOME_NAMES[outcome_id]


def _asset_symbol(source: str, asset: u256) -> str:
    if not isinstance(asset, int) or isinstance(asset, bool) or asset < 0 or asset >= len(ASSET_NAMES):
        raise gl.vm.UserError("invalid asset")
    if source == SOURCE_BINANCE:
        return BINANCE_SYMBOLS[asset]
    if source == SOURCE_BYBIT:
        return BYBIT_SYMBOLS[asset]
    raise gl.vm.UserError("invalid source")


def _now() -> int:
    return int(time.time())


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
    scaled = int(pieces[0]) * PRICE_SCALE + int((fraction + "0" * 18)[:18])
    if scaled <= 0 or scaled > 10**39:
        return None
    canonical_fraction = fraction.rstrip("0")
    canonical = str(int(pieces[0]))
    if canonical_fraction:
        canonical += "." + canonical_fraction
    return scaled, canonical


def _add_u256(left: int, right: int) -> int:
    if left < 0 or right < 0 or left > U256_MAX or right > U256_MAX - left:
        raise gl.vm.UserError("u256 addition overflow")
    return left + right


def _mul_u256(left: int, right: int) -> int:
    if left < 0 or right < 0 or left > U256_MAX or right > U256_MAX:
        raise gl.vm.UserError("u256 multiplication overflow")
    if right and left > U256_MAX // right:
        raise gl.vm.UserError("u256 multiplication overflow")
    return left * right


def _mul_div_u256(numerator: int, multiplier: int, denominator: int) -> int:
    if numerator < 0 or multiplier < 0 or denominator <= 0 or numerator > denominator:
        raise gl.vm.UserError("invalid payout arithmetic")
    quotient = 0
    remainder = 0
    for bit_index in range(256):
        bit = (numerator >> (255 - bit_index)) & 1
        carry = remainder * 2 + (multiplier if bit else 0)
        added, remainder = divmod(carry, denominator)
        quotient = quotient * 2 + added
    if quotient > U256_MAX:
        raise gl.vm.UserError("u256 payout overflow")
    return quotient


def _response_json(response):
    try:
        status = int(response.status)
        if status >= 500 or status in (408, 425, 429):
            return SOURCE_UNAVAILABLE, None
        body = response.body
        if not isinstance(body, bytes) or len(body) == 0 or len(body) > MAX_RESPONSE_BYTES:
            return SOURCE_INVALID, None
        if status != 200:
            return SOURCE_INVALID, None
        return "OK", json.loads(body.decode("utf-8"))
    except Exception:
        return SOURCE_INVALID, None


def _request_json(url: str):
    try:
        response = gl.nondet.web.get(url, headers={"Accept": "application/json"})
    except Exception:
        return SOURCE_UNAVAILABLE, None
    return _response_json(response)


def _binance_candle(payload, start_ms: int, end_ms: int, symbol: str):
    if not isinstance(payload, list) or len(payload) != 1 or not isinstance(payload[0], list):
        return None
    row = payload[0]
    if len(row) != 12 or _parse_integer(row[0]) != start_ms or _parse_integer(row[6]) != end_ms - 1:
        return None
    opening = _parse_price(row[1])
    closing = _parse_price(row[4])
    if opening is None or closing is None:
        return None
    return start_ms, opening, closing, symbol


def _bybit_candle(payload, start_ms: int, symbol: str):
    if not isinstance(payload, dict) or payload.get("retCode") != 0:
        return None
    result = payload.get("result")
    if not isinstance(result, dict) or result.get("category") != "linear" or result.get("symbol") != symbol:
        return None
    rows = result.get("list")
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], list) or len(rows[0]) != 7:
        return None
    row = rows[0]
    if _parse_integer(row[0]) != start_ms:
        return None
    opening = _parse_price(row[1])
    closing = _parse_price(row[4])
    if opening is None or closing is None:
        return None
    return start_ms, opening, closing, symbol


def _fetch_candle(source: str, asset: u256, start_seconds: u256, end_seconds: u256):
    symbol = _asset_symbol(source, asset)
    start_ms = _mul_u256(start_seconds, 1000)
    end_ms = _mul_u256(end_seconds, 1000)
    if source == SOURCE_BINANCE:
        url = (
            "https://fapi.binance.com/fapi/v1/klines?symbol=" + symbol
            + "&interval=1h&startTime=" + str(start_ms)
            + "&endTime=" + str(end_ms - 1) + "&limit=1"
        )
        status, payload = _request_json(url)
        if status != "OK":
            return status, None
        row = _binance_candle(payload, start_ms, end_ms, symbol)
    elif source == SOURCE_BYBIT:
        url = (
            "https://api.bybit.com/v5/market/kline?category=linear&symbol=" + symbol
            + "&interval=60&start=" + str(start_ms)
            + "&end=" + str(end_ms - 1) + "&limit=1"
        )
        status, payload = _request_json(url)
        if status != "OK":
            return status, None
        row = _bybit_candle(payload, start_ms, symbol)
    else:
        return SOURCE_INVALID, None
    return ("OK", row) if row is not None else (SOURCE_INVALID, None)


def _score(rows, indexes):
    first = rows[indexes[0]]
    second = rows[indexes[1]]
    third = rows[indexes[2]]
    o1 = first["_open_scaled"]
    o2 = second["_open_scaled"]
    o3 = third["_open_scaled"]
    d1 = first["_close_scaled"] - o1
    d2 = second["_close_scaled"] - o2
    d3 = third["_close_scaled"] - o3
    denominator = 3 * o1 * o2 * o3
    numerator = d1 * o2 * o3 + d2 * o1 * o3 + d3 * o1 * o2
    return numerator, denominator


def _compare_scores(left, right) -> int:
    left_value = left[0] * right[1]
    right_value = right[0] * left[1]
    if left_value > right_value:
        return 1
    if left_value < right_value:
        return -1
    return 0


def _empty_asset(source: str, asset: u256, start: u256, end: u256) -> dict:
    return {
        "asset": ASSET_NAMES[asset],
        "asset_id": asset,
        "symbol": _asset_symbol(source, asset),
        "market_start": start,
        "market_end": end,
        "candle_timestamp": "",
        "timestamp_unit": "",
        "interval": "1h",
        "open": "",
        "close": "",
        "return_numerator": "",
        "return_denominator": "",
        "valid": False,
    }


def _empty_source_result(source: str, start: u256, end: u256, status: str) -> dict:
    return {
        "source": source,
        "market_start": start,
        "market_end": end,
        "interval": "1h",
        "source_status": status,
        "source_winner": "",
        "source_winner_id": OUTCOME_NONE,
        "crypto_average_numerator": "",
        "crypto_average_denominator": "",
        "commodities_average_numerator": "",
        "commodities_average_denominator": "",
        "assets": [_empty_asset(source, asset, start, end) for asset in range(len(ASSET_NAMES))],
    }


def _source_once(source: str, start: u256, end: u256) -> dict:
    rows = []
    for asset in range(len(ASSET_NAMES)):
        candle_status, candle = _fetch_candle(source, asset, start, end)
        if candle_status != "OK":
            return _empty_source_result(source, start, end, candle_status)
        timestamp, opening, closing, symbol = candle
        opening_scaled, opening_text = opening
        closing_scaled, closing_text = closing
        rows.append({
            "asset": ASSET_NAMES[asset],
            "asset_id": asset,
            "symbol": symbol,
            "market_start": start,
            "market_end": end,
            "candle_timestamp": str(timestamp),
            "timestamp_unit": "ms",
            "interval": "1h",
            "open": opening_text,
            "close": closing_text,
            "return_numerator": str(closing_scaled - opening_scaled),
            "return_denominator": str(opening_scaled),
            "valid": True,
            "_open_scaled": opening_scaled,
            "_close_scaled": closing_scaled,
        })
    crypto_score = _score(rows, CRYPTO_ASSETS)
    commodities_score = _score(rows, COMMODITY_ASSETS)
    comparison = _compare_scores(crypto_score, commodities_score)
    winner = OUTCOME_CRYPTO if comparison > 0 else OUTCOME_COMMODITIES if comparison < 0 else OUTCOME_NONE
    for row in rows:
        del row["_open_scaled"]
        del row["_close_scaled"]
    return {
        "source": source,
        "market_start": start,
        "market_end": end,
        "interval": "1h",
        "source_status": SOURCE_TIE if winner == OUTCOME_NONE else SOURCE_VALID,
        "source_winner": "" if winner == OUTCOME_NONE else _outcome_name(winner),
        "source_winner_id": winner,
        "crypto_average_numerator": str(crypto_score[0]),
        "crypto_average_denominator": str(crypto_score[1]),
        "commodities_average_numerator": str(commodities_score[0]),
        "commodities_average_denominator": str(commodities_score[1]),
        "assets": rows,
    }


def _fetch_source(source: str, start: u256, end: u256) -> dict:
    for _attempt in range(MAX_SOURCE_ATTEMPTS):
        try:
            result = _source_once(source, start, end)
        except Exception:
            result = _empty_source_result(source, start, end, SOURCE_INVALID)
        if result["source_status"] != SOURCE_UNAVAILABLE:
            return result
    return _empty_source_result(source, start, end, SOURCE_UNAVAILABLE)


def _source_result(proposal: dict, source: str):
    results = proposal.get("source_results") if isinstance(proposal, dict) else None
    if not isinstance(results, list) or len(results) != len(SOURCES):
        return None
    for index in range(len(SOURCES)):
        if SOURCES[index] == source and isinstance(results[index], dict) and results[index].get("source") == source:
            return results[index]
    return None


def _consensus_winner(results: list[dict]) -> int:
    if len(results) != len(SOURCES):
        return OUTCOME_NONE
    first = results[0]
    second = results[1]
    first_vote = first.get("source_winner_id", OUTCOME_NONE) if first.get("source_status") == SOURCE_VALID else OUTCOME_NONE
    second_vote = second.get("source_winner_id", OUTCOME_NONE) if second.get("source_status") == SOURCE_VALID else OUTCOME_NONE
    if first_vote < OUTCOME_COUNT and first_vote == second_vote:
        return first_vote
    return OUTCOME_NONE


def _evidence_key(evidence: dict, source: str, start: u256, end: u256):
    if not isinstance(evidence, dict) or evidence.get("source") != source:
        return None
    if evidence.get("market_start") != start or evidence.get("market_end") != end or evidence.get("interval") != "1h":
        return None
    status = evidence.get("source_status")
    winner = evidence.get("source_winner")
    winner_id = evidence.get("source_winner_id", OUTCOME_NONE)
    if status not in (SOURCE_VALID, SOURCE_TIE, SOURCE_UNAVAILABLE, SOURCE_INVALID):
        return None
    if not isinstance(winner, str) or not isinstance(winner_id, int) or isinstance(winner_id, bool) or winner_id < 0 or winner_id > OUTCOME_NONE:
        return None
    if status == SOURCE_VALID and (winner_id >= OUTCOME_COUNT or winner != _outcome_name(winner_id)):
        return None
    if status != SOURCE_VALID and (winner != "" or winner_id != OUTCOME_NONE):
        return None
    rows = evidence.get("assets")
    if not isinstance(rows, list) or len(rows) != len(ASSET_NAMES):
        return None
    if status in (SOURCE_VALID, SOURCE_TIE):
        crypto_numerator = evidence.get("crypto_average_numerator")
        crypto_denominator = evidence.get("crypto_average_denominator")
        commodities_numerator = evidence.get("commodities_average_numerator")
        commodities_denominator = evidence.get("commodities_average_denominator")
        if not all(isinstance(value, str) for value in (crypto_numerator, crypto_denominator, commodities_numerator, commodities_denominator)):
            return None
        parsed_rows = []
    else:
        if any(evidence.get(key) != "" for key in ("crypto_average_numerator", "crypto_average_denominator", "commodities_average_numerator", "commodities_average_denominator")):
            return None
        parsed_rows = None
    parts = [source, str(start), str(end), "1h", status, winner, str(winner_id)]
    for asset in range(len(ASSET_NAMES)):
        row = rows[asset]
        if not isinstance(row, dict) or row.get("asset_id") != asset or row.get("asset") != ASSET_NAMES[asset] or row.get("symbol") != _asset_symbol(source, asset):
            return None
        if row.get("market_start") != start or row.get("market_end") != end or row.get("interval") != "1h":
            return None
        fields = (row.get("candle_timestamp"), row.get("timestamp_unit"), row.get("open"), row.get("close"), row.get("return_numerator"), row.get("return_denominator"))
        if not all(isinstance(value, str) for value in fields) or not isinstance(row.get("valid"), bool):
            return None
        valid = status in (SOURCE_VALID, SOURCE_TIE)
        if row["valid"] != valid:
            return None
        if valid:
            if row["candle_timestamp"] != str(_mul_u256(start, 1000)) or row["timestamp_unit"] != "ms":
                return None
            opening = _parse_price(row["open"])
            closing = _parse_price(row["close"])
            if opening is None or closing is None:
                return None
            if row["open"] != opening[1] or row["close"] != closing[1]:
                return None
            if row["return_numerator"] != str(closing[0] - opening[0]) or row["return_denominator"] != str(opening[0]):
                return None
            parsed_rows.append({"_open_scaled": opening[0], "_close_scaled": closing[0]})
        elif any(value != "" for value in fields):
            return None
        parts.extend([str(row["asset_id"]), row["asset"], row["symbol"], row["candle_timestamp"], row["timestamp_unit"], row["open"], row["close"], row["return_numerator"], row["return_denominator"], str(row["valid"])])
    if parsed_rows is not None:
        crypto_score = _score(parsed_rows, CRYPTO_ASSETS)
        commodities_score = _score(parsed_rows, COMMODITY_ASSETS)
        if evidence["crypto_average_numerator"] != str(crypto_score[0]) or evidence["crypto_average_denominator"] != str(crypto_score[1]):
            return None
        if evidence["commodities_average_numerator"] != str(commodities_score[0]) or evidence["commodities_average_denominator"] != str(commodities_score[1]):
            return None
        comparison = _compare_scores(crypto_score, commodities_score)
        expected_status = SOURCE_TIE if comparison == 0 else SOURCE_VALID
        expected_winner = OUTCOME_NONE if comparison == 0 else OUTCOME_CRYPTO if comparison > 0 else OUTCOME_COMMODITIES
        if status != expected_status or winner_id != expected_winner or winner != ("" if expected_winner == OUTCOME_NONE else _outcome_name(expected_winner)):
            return None
    return "\x1f".join(parts)


def _proposal_valid(proposal: dict, start: u256, end: u256) -> bool:
    if not isinstance(proposal, dict) or not isinstance(proposal.get("source_results"), list) or len(proposal["source_results"]) != len(SOURCES):
        return False
    results = proposal["source_results"]
    for index in range(len(SOURCES)):
        if _evidence_key(results[index], SOURCES[index], start, end) is None:
            return False
    winner = _consensus_winner(results)
    return _is_u256(proposal.get("consensus_winner")) and proposal.get("consensus_winner") == winner and _is_u256(proposal.get("consensus_count")) and proposal.get("consensus_count") == (2 if winner != OUTCOME_NONE else 0)


def _financial_winner(proposal: dict) -> int:
    if isinstance(proposal, dict) and proposal.get("consensus_count") == 2:
        winner = proposal.get("consensus_winner", OUTCOME_NONE)
        if isinstance(winner, int) and not isinstance(winner, bool) and winner < OUTCOME_COUNT:
            return winner
    return OUTCOME_NONE


def _common_valid_votes(first: dict, second: dict, winner: int) -> int:
    count = 0
    for source in SOURCES:
        first_result = _source_result(first, source)
        second_result = _source_result(second, source)
        if first_result is not None and second_result is not None and first_result.get("source_status") == SOURCE_VALID and second_result.get("source_status") == SOURCE_VALID and first_result.get("source_winner_id") == winner and second_result.get("source_winner_id") == winner:
            count += 1
    return count


def _same_source_evidence(first: dict, second: dict, source: str, start: u256, end: u256) -> bool:
    first_key = _evidence_key(first, source, start, end)
    second_key = _evidence_key(second, source, start, end)
    return first_key is not None and first_key == second_key


def _settlement_proposal(start: u256, end: u256) -> dict:
    def leader_fn():
        results = [_fetch_source(source, start, end) for source in SOURCES]
        winner = _consensus_winner(results)
        return {"source_results": results, "consensus_winner": winner, "consensus_count": 2 if winner != OUTCOME_NONE else 0}

    def validator_fn(leaders_result) -> bool:
        try:
            if not isinstance(leaders_result, gl.vm.Return) or not isinstance(leaders_result.calldata, dict):
                return False
            leader_proposal = leaders_result.calldata
            if not _proposal_valid(leader_proposal, start, end):
                return False
            validator_proposal = leader_fn()
            if not _proposal_valid(validator_proposal, start, end):
                return False
            for source in SOURCES:
                leader_result = _source_result(leader_proposal, source)
                validator_result = _source_result(validator_proposal, source)
                if not _same_source_evidence(leader_result, validator_result, source, start, end):
                    return False
            leader_winner = _financial_winner(leader_proposal)
            validator_winner = _financial_winner(validator_proposal)
            if leader_winner != validator_winner:
                return False
            if leader_winner == OUTCOME_NONE:
                return True
            return _common_valid_votes(leader_proposal, validator_proposal, leader_winner) == 2
        except Exception:
            return False

    # The pinned Studio Next runner exposes run_nondet, but not run_nondet_unsafe.
    # Validator exceptions are converted to disagreement by the explicit guard above.
    return gl.vm.run_nondet(leader_fn, validator_fn)


class Rival(gl.contract.Contract):
    market_count: u256
    position_count: u256
    market_start_seconds: TreeMap[u256, u256]
    market_end_seconds: TreeMap[u256, u256]
    market_state: TreeMap[u256, str]
    market_winner: TreeMap[u256, u256]
    market_reason: TreeMap[u256, str]
    market_creation_keys: TreeMap[str, u256]
    market_source_evidence: TreeMap[str, str]
    market_pool: TreeMap[u256, u256]
    market_winning_pool: TreeMap[u256, u256]
    market_claimed_pool: TreeMap[u256, u256]
    market_claimed_winning_stake: TreeMap[u256, u256]
    market_refunded_pool: TreeMap[u256, u256]
    market_settlement_deadline: TreeMap[u256, u256]
    outcome_pool: TreeMap[str, u256]
    bettor_outcome: TreeMap[str, u256]
    bettor_stake: TreeMap[str, u256]
    bettor_claimed: TreeMap[str, bool]
    bettor_refunded: TreeMap[str, bool]
    user_market_count: TreeMap[str, u256]
    user_market_index: TreeMap[str, u256]

    def __init__(self):
        self.market_count = 0
        self.position_count = 0

    def _require_market(self, market_id: u256) -> None:
        if not _is_u256(market_id) or market_id == 0 or market_id > self.market_count or market_id not in self.market_start_seconds:
            raise gl.vm.UserError("market not found")

    def _outcome_key(self, market_id: u256, outcome: u256) -> str:
        return str(market_id) + ":" + str(outcome)

    def _position_key(self, market_id: u256, user: Address) -> str:
        return str(market_id) + ":" + user.as_hex

    def _user_market_key(self, user: Address, index: u256) -> str:
        return user.as_hex + ":" + str(index)

    def _source_key(self, market_id: u256, source: str) -> str:
        return str(market_id) + ":" + source

    def _send_value(self, recipient: Address, amount: u256) -> None:
        _Recipient(recipient).emit_transfer(value=amount)

    def _market_preview(self, market_id: u256) -> dict:
        self._require_market(market_id)
        state = self.market_state[market_id]
        total_pool = self.market_pool.get(market_id, 0)
        crypto_pool = self.outcome_pool.get(self._outcome_key(market_id, OUTCOME_CRYPTO), 0)
        commodities_pool = self.outcome_pool.get(self._outcome_key(market_id, OUTCOME_COMMODITIES), 0)
        claimed_pool = self.market_claimed_pool.get(market_id, 0)
        refunded_pool = self.market_refunded_pool.get(market_id, 0)
        if claimed_pool > total_pool or refunded_pool > total_pool:
            raise gl.vm.UserError("market liability overflow")
        consumed = claimed_pool if state == STATE_SETTLED else refunded_pool if state == STATE_INCONCLUSIVE else 0
        winner = self.market_winner[market_id]
        now_seconds = _now()
        market_start = self.market_start_seconds[market_id]
        market_end = self.market_end_seconds[market_id]
        settlement_ready = _add_u256(market_end, SETTLEMENT_GRACE_SECONDS)
        settlement_deadline = self.market_settlement_deadline[market_id]
        return {
            "id": market_id,
            "market_id": market_id,
            "outcomes": list(OUTCOME_NAMES),
            "crypto_basket": list(ASSET_NAMES[:3]),
            "commodities_basket": list(ASSET_NAMES[3:]),
            "market_start": market_start,
            "market_end": market_end,
            "betting_close": market_start,
            "duration_seconds": DURATION_SECONDS,
            "state": state,
            "winner": "" if winner == OUTCOME_NONE else _outcome_name(winner),
            "reason": self.market_reason.get(market_id, REASON_NONE),
            "market_pool": total_pool,
            "total_pool": total_pool,
            "crypto_pool": crypto_pool,
            "commodities_pool": commodities_pool,
            "outcome_pools": {"CRYPTO": crypto_pool, "COMMODITIES": commodities_pool},
            "betting_open": state == STATE_OPEN and now_seconds < market_start,
            "settlement_ready": settlement_ready,
            "settlement_available": state in (STATE_OPEN, STATE_PENDING) and settlement_ready <= now_seconds < settlement_deadline,
            "deadline_expired": state in (STATE_OPEN, STATE_PENDING) and now_seconds >= settlement_deadline,
            "settlement_deadline": settlement_deadline,
            "winning_pool": self.market_winning_pool.get(market_id, 0),
            "claimed_pool": claimed_pool,
            "refunded_pool": refunded_pool,
            "remaining_pool": total_pool - consumed,
        }

    def _position_view(self, market_id: u256, user: Address) -> dict:
        self._require_market(market_id)
        key = self._position_key(market_id, user)
        selected = self.bettor_outcome.get(key, OUTCOME_NONE)
        has_position = selected != OUTCOME_NONE
        stake = self.bettor_stake.get(key, 0)
        state = self.market_state[market_id]
        claimed = self.bettor_claimed.get(key, False)
        refunded = self.bettor_refunded.get(key, False)
        winner = self.market_winner[market_id]
        now_seconds = _now()
        market_start = self.market_start_seconds[market_id]
        market_end = self.market_end_seconds[market_id]
        settlement_ready = _add_u256(market_end, SETTLEMENT_GRACE_SECONDS)
        total_pool = self.market_pool.get(market_id, 0)
        crypto_pool = self.outcome_pool.get(self._outcome_key(market_id, OUTCOME_CRYPTO), 0)
        commodities_pool = self.outcome_pool.get(self._outcome_key(market_id, OUTCOME_COMMODITIES), 0)
        winning_pool = self.market_winning_pool.get(market_id, 0)
        claimed_pool = self.market_claimed_pool.get(market_id, 0)
        refunded_pool = self.market_refunded_pool.get(market_id, 0)
        position_won = state == STATE_SETTLED and has_position and selected == winner
        position_lost = state == STATE_SETTLED and has_position and selected != winner
        claimable = 0
        claim_available = False
        if position_won and not claimed:
            claimed_stake = self.market_claimed_winning_stake.get(market_id, 0)
            new_stake = _add_u256(claimed_stake, stake)
            if winning_pool > 0 and claimed_stake <= winning_pool and claimed_pool <= total_pool and new_stake <= winning_pool:
                claimable = total_pool - claimed_pool if new_stake == winning_pool else _mul_div_u256(stake, total_pool, winning_pool)
                claim_available = claimable > 0
        refund_available = state == STATE_INCONCLUSIVE and has_position and stake > 0 and not refunded
        if refund_available:
            claimable = stake
        return {
            "market_id": market_id,
            "market_start": market_start,
            "market_end": market_end,
            "settlement_ready": settlement_ready,
            "settlement_deadline": self.market_settlement_deadline[market_id],
            "has_position": has_position,
            "selected_outcome": "" if not has_position else _outcome_name(selected),
            "user_outcome": "" if not has_position else _outcome_name(selected),
            "total_stake": stake,
            "user_stake": stake,
            "market_state": state,
            "state": state,
            "winner": "" if winner == OUTCOME_NONE else _outcome_name(winner),
            "reason": self.market_reason.get(market_id, REASON_NONE),
            "market_pool": total_pool,
            "crypto_pool": crypto_pool,
            "commodities_pool": commodities_pool,
            "winning_pool": winning_pool,
            "claimed_pool": claimed_pool,
            "refunded_pool": refunded_pool,
            "can_top_up": state == STATE_OPEN and now_seconds < self.market_start_seconds[market_id] and has_position,
            "position_won": position_won,
            "position_lost": position_lost,
            "claim_available": claim_available,
            "refund_available": refund_available,
            "already_claimed": claimed,
            "claimed": claimed,
            "refunded": refunded,
            "claimable_amount": claimable,
            "claim_type": "REFUND" if refund_available else "WINNINGS" if claim_available else "NONE",
        }

    def _page_bounds(self, offset: u256, limit: u256, count: u256) -> tuple[int, int]:
        if not _is_u256(offset) or not _is_u256(limit) or limit > MAX_PAGE_SIZE:
            raise gl.vm.UserError("page limit exceeded")
        if offset >= count or limit == 0:
            return 0, 0
        return offset, min(count, _add_u256(offset, limit))

    def _market_page(self, cursor: u256, limit: u256, open_only: bool) -> dict:
        if not _is_u256(cursor) or not _is_u256(limit) or limit > MAX_PAGE_SIZE:
            raise gl.vm.UserError("page limit exceeded")
        count = self.market_count
        if cursor >= count:
            return {"items": [], "next_cursor": 0, "has_more": False}
        if limit == 0:
            return {"items": [], "next_cursor": 0, "has_more": False}
        end = min(count, _add_u256(cursor, limit))
        items = []
        for index in range(cursor, end):
            market = self._market_preview(count - index)
            if not open_only or market["betting_open"]:
                items.append(market)
        has_more = end < count
        return {"items": items, "next_cursor": end if has_more else 0, "has_more": has_more}

    def _user_position_page(self, user: Address, cursor: u256, limit: u256) -> dict:
        if not _is_u256(cursor) or not _is_u256(limit) or limit > MAX_PAGE_SIZE:
            raise gl.vm.UserError("page limit exceeded")
        count = self.user_market_count.get(user.as_hex, 0)
        if cursor >= count:
            return {"items": [], "next_cursor": 0, "has_more": False}
        if limit == 0:
            return {"items": [], "next_cursor": 0, "has_more": False}
        end = min(count, _add_u256(cursor, limit))
        items = [self._position_view(self.user_market_index[self._user_market_key(user, count - index - 1)], user) for index in range(cursor, end)]
        has_more = end < count
        return {"items": items, "next_cursor": end if has_more else 0, "has_more": has_more}

    @gl.public.view
    def get_config(self) -> dict:
        return {
            "protocol": "RIVAL V1",
            "outcomes": list(OUTCOME_NAMES),
            "crypto_basket": list(ASSET_NAMES[:3]),
            "commodities_basket": list(ASSET_NAMES[3:]),
            "sources": list(SOURCES),
            "symbols_by_source": {SOURCE_BINANCE: list(BINANCE_SYMBOLS), SOURCE_BYBIT: list(BYBIT_SYMBOLS)},
            "duration_seconds": DURATION_SECONDS,
            "minimum_bet": MIN_BET,
            "maximum_bet_per_wallet_per_market": MAX_BET_PER_MARKET,
            "fee_bps": 0,
            "consensus_threshold": 2,
            "consensus_sources": 2,
            "timezone": "UTC",
            "return_calculation": "(close-open)/open; exact integer rational arithmetic",
            "basket_weighting": "equal arithmetic mean",
            "settlement_grace_seconds": SETTLEMENT_GRACE_SECONDS,
            "settlement_retry_window_seconds": SETTLEMENT_RETRY_WINDOW_SECONDS,
            "settlement_deadline_anchor": "market_end",
            "payout_rounding": "floor; final winning claimant receives remaining pool",
            "zero_backed_winner_behavior": "inconclusive with original-stake refunds",
            "source_evidence_semantics": "each source candle is independently re-fetched and exactly matched by validators; Binance and Bybit prices are never cross-compared",
            "max_page_size": MAX_PAGE_SIZE,
            "max_markets": MAX_MARKETS,
            "max_positions": MAX_POSITIONS,
        }

    @gl.public.view
    def outcomes(self) -> list[str]:
        return list(OUTCOME_NAMES)

    @gl.public.view
    def get_market(self, market_id: u256) -> dict:
        return self._market_preview(market_id)

    @gl.public.view
    def get_markets(self, cursor: u256, limit: u256) -> dict:
        return self._market_page(cursor, limit, False)

    @gl.public.view
    def get_open_markets(self, cursor: u256, limit: u256) -> dict:
        return self._market_page(cursor, limit, True)

    @gl.public.view
    def get_market_count(self) -> u256:
        return self.market_count

    @gl.public.view
    def get_my_position(self, market_id: u256) -> dict:
        return self._position_view(market_id, gl.message.sender_address)

    @gl.public.view
    def get_my_market_count(self) -> u256:
        return self.user_market_count.get(gl.message.sender_address.as_hex, 0)

    @gl.public.view
    def get_my_positions(self, offset: u256, limit: u256) -> list[dict]:
        user = gl.message.sender_address
        count = self.user_market_count.get(user.as_hex, 0)
        start, end = self._page_bounds(offset, limit, count)
        return [self._position_view(self.user_market_index[self._user_market_key(user, count - index - 1)], user) for index in range(start, end)]

    @gl.public.view
    def get_user_positions(self, user: Address, cursor: u256, limit: u256) -> dict:
        return self._user_position_page(user, cursor, limit)

    @gl.public.view
    def get_my_claimable_markets(self, offset: u256, limit: u256) -> list[dict]:
        user = gl.message.sender_address
        page = self._user_position_page(user, offset, limit)
        return [position for position in page["items"] if position["claim_available"] or position["refund_available"]]

    @gl.public.view
    def get_market_by_start(self, market_start: u256) -> dict:
        if not _is_u256(market_start) or market_start % DURATION_SECONDS != 0:
            raise gl.vm.UserError("market start must be exact UTC hour")
        key = str(market_start)
        if key not in self.market_creation_keys:
            raise gl.vm.UserError("market not found")
        return self._market_preview(self.market_creation_keys[key])

    @gl.public.view
    def get_source_evidence(self, market_id: u256, source: str) -> dict:
        self._require_market(market_id)
        if source not in SOURCES:
            raise gl.vm.UserError("invalid source")
        key = self._source_key(market_id, source)
        if key not in self.market_source_evidence:
            raise gl.vm.UserError("source evidence unavailable")
        evidence = json.loads(self.market_source_evidence[key])
        evidence["evidence_semantics"] = "EXACT_SOURCE_DATA_VALIDATOR_MATCH"
        evidence["cross_source_price_comparison"] = False
        return evidence

    @gl.public.view
    def get_betting_state(self, market_id: u256) -> dict:
        self._require_market(market_id)
        key = self._position_key(market_id, gl.message.sender_address)
        selected = self.bettor_outcome.get(key, OUTCOME_NONE)
        return {
            "total_market_pool": self.market_pool.get(market_id, 0),
            "outcome_stakes": {_outcome_name(i): self.outcome_pool.get(self._outcome_key(market_id, i), 0) for i in range(OUTCOME_COUNT)},
            "bettor_outcome": "" if selected == OUTCOME_NONE else _outcome_name(selected),
            "bettor_stake": self.bettor_stake.get(key, 0),
            "claimed": self.bettor_claimed.get(key, False),
            "refunded": self.bettor_refunded.get(key, False),
            "winning_pool": self.market_winning_pool.get(market_id, 0),
            "claimed_pool": self.market_claimed_pool.get(market_id, 0),
            "claimed_winning_stake": self.market_claimed_winning_stake.get(market_id, 0),
            "refunded_pool": self.market_refunded_pool.get(market_id, 0),
        }

    @gl.public.write
    def create_market(self, market_start: u256) -> u256:
        if not _is_u256(market_start) or market_start % DURATION_SECONDS != 0:
            raise gl.vm.UserError("market start must be exact UTC hour")
        now_seconds = _now()
        expected_start = _mul_u256(_add_u256(now_seconds // DURATION_SECONDS, 1), DURATION_SECONDS)
        if market_start != expected_start:
            raise gl.vm.UserError("market start must be next UTC hour")
        if self.market_count >= MAX_MARKETS:
            raise gl.vm.UserError("maximum market count reached")
        key = str(market_start)
        if key in self.market_creation_keys:
            raise gl.vm.UserError("market already exists")
        market_id = _add_u256(self.market_count, 1)
        end_seconds = _add_u256(market_start, DURATION_SECONDS)
        deadline = _add_u256(end_seconds, SETTLEMENT_RETRY_WINDOW_SECONDS)
        _mul_u256(end_seconds, 1000)
        self.market_count = market_id
        self.market_start_seconds[market_id] = market_start
        self.market_end_seconds[market_id] = end_seconds
        self.market_state[market_id] = STATE_OPEN
        self.market_winner[market_id] = OUTCOME_NONE
        self.market_reason[market_id] = REASON_NONE
        self.market_pool[market_id] = 0
        self.market_winning_pool[market_id] = 0
        self.market_claimed_pool[market_id] = 0
        self.market_claimed_winning_stake[market_id] = 0
        self.market_refunded_pool[market_id] = 0
        self.market_settlement_deadline[market_id] = deadline
        self.market_creation_keys[key] = market_id
        return market_id

    @gl.public.write.payable
    def place_bet(self, market_id: u256, outcome: str) -> None:
        if not isinstance(outcome, str):
            raise gl.vm.UserError("outcome must be a string")
        self._require_market(market_id)
        if self.market_state[market_id] != STATE_OPEN:
            raise gl.vm.UserError("market is not open")
        if _now() >= self.market_start_seconds[market_id]:
            raise gl.vm.UserError("betting is closed")
        outcome_id = _outcome_id(outcome)
        amount = gl.message.value
        if not _is_u256(amount) or amount < MIN_BET:
            raise gl.vm.UserError("minimum bet is 1 GEN")
        key = self._position_key(market_id, gl.message.sender_address)
        selected = self.bettor_outcome.get(key, OUTCOME_NONE)
        if selected != OUTCOME_NONE and selected != outcome_id:
            raise gl.vm.UserError("wallet outcome already selected")
        old_stake = self.bettor_stake.get(key, 0)
        if old_stake > MAX_BET_PER_MARKET or amount > MAX_BET_PER_MARKET - old_stake:
            raise gl.vm.UserError("maximum cumulative stake is 15 GEN")
        first_position = selected == OUTCOME_NONE
        if first_position:
            if self.position_count >= MAX_POSITIONS:
                raise gl.vm.UserError("maximum position count reached")
            user = gl.message.sender_address
            user_count = self.user_market_count.get(user.as_hex, 0)
            if user_count >= MAX_POSITIONS:
                raise gl.vm.UserError("maximum user market count reached")
            self.position_count = _add_u256(self.position_count, 1)
            self.user_market_index[self._user_market_key(user, user_count)] = market_id
            self.user_market_count[user.as_hex] = _add_u256(user_count, 1)
        new_stake = _add_u256(old_stake, amount)
        self.bettor_outcome[key] = outcome_id
        self.bettor_stake[key] = new_stake
        self.outcome_pool[self._outcome_key(market_id, outcome_id)] = _add_u256(self.outcome_pool.get(self._outcome_key(market_id, outcome_id), 0), amount)
        self.market_pool[market_id] = _add_u256(self.market_pool.get(market_id, 0), amount)

    @gl.public.write
    def claim(self, market_id: u256) -> None:
        self._require_market(market_id)
        if self.market_state[market_id] != STATE_SETTLED:
            raise gl.vm.UserError("market is not settled")
        key = self._position_key(market_id, gl.message.sender_address)
        if self.bettor_claimed.get(key, False):
            raise gl.vm.UserError("payout already claimed")
        if self.bettor_refunded.get(key, False):
            raise gl.vm.UserError("position already refunded")
        if self.bettor_outcome.get(key, OUTCOME_NONE) != self.market_winner[market_id]:
            raise gl.vm.UserError("not a winning bettor")
        stake = self.bettor_stake.get(key, 0)
        winning_pool = self.market_winning_pool.get(market_id, 0)
        if stake <= 0 or winning_pool <= 0:
            raise gl.vm.UserError("winning position is empty")
        total_pool = self.market_pool.get(market_id, 0)
        claimed_pool = self.market_claimed_pool.get(market_id, 0)
        claimed_stake = self.market_claimed_winning_stake.get(market_id, 0)
        if claimed_pool > total_pool or claimed_stake > winning_pool:
            raise gl.vm.UserError("claimed accounting exceeds pool")
        new_claimed_stake = _add_u256(claimed_stake, stake)
        if new_claimed_stake > winning_pool:
            raise gl.vm.UserError("winning stake accounting exceeds pool")
        payout = total_pool - claimed_pool if new_claimed_stake == winning_pool else _mul_div_u256(stake, total_pool, winning_pool)
        if payout <= 0 or payout > total_pool - claimed_pool:
            raise gl.vm.UserError("payout is empty")
        self.bettor_claimed[key] = True
        self.market_claimed_pool[market_id] = _add_u256(claimed_pool, payout)
        self.market_claimed_winning_stake[market_id] = new_claimed_stake
        self._send_value(gl.message.sender_address, payout)

    @gl.public.write
    def claim_refund(self, market_id: u256) -> None:
        self._require_market(market_id)
        if self.market_state[market_id] != STATE_INCONCLUSIVE:
            raise gl.vm.UserError("market is not inconclusive")
        key = self._position_key(market_id, gl.message.sender_address)
        if self.bettor_refunded.get(key, False):
            raise gl.vm.UserError("refund already claimed")
        if self.bettor_claimed.get(key, False):
            raise gl.vm.UserError("position already claimed")
        stake = self.bettor_stake.get(key, 0)
        if stake <= 0:
            raise gl.vm.UserError("no bettor stake")
        total_pool = self.market_pool.get(market_id, 0)
        refunded_pool = self.market_refunded_pool.get(market_id, 0)
        if refunded_pool > total_pool or stake > total_pool - refunded_pool:
            raise gl.vm.UserError("refund exceeds remaining pool")
        self.bettor_refunded[key] = True
        self.market_refunded_pool[market_id] = _add_u256(refunded_pool, stake)
        self._send_value(gl.message.sender_address, stake)

    @gl.public.write
    def settle_market(self, market_id: u256) -> str:
        self._require_market(market_id)
        state = self.market_state[market_id]
        if state not in (STATE_OPEN, STATE_PENDING):
            raise gl.vm.UserError("market is not open")
        now_seconds = _now()
        end_seconds = self.market_end_seconds[market_id]
        deadline = self.market_settlement_deadline[market_id]
        if now_seconds < end_seconds:
            raise gl.vm.UserError("market has not ended")
        settlement_ready = _add_u256(end_seconds, SETTLEMENT_GRACE_SECONDS)
        if now_seconds < settlement_ready:
            raise gl.vm.UserError("settlement is not ready; candle finalization grace is active")
        if now_seconds >= deadline:
            self.market_state[market_id] = STATE_INCONCLUSIVE
            self.market_winner[market_id] = OUTCOME_NONE
            self.market_reason[market_id] = REASON_EXPIRED
            return STATE_INCONCLUSIVE
        start_seconds = self.market_start_seconds[market_id]
        proposal = _settlement_proposal(start_seconds, end_seconds)
        results = proposal["source_results"]
        for index in range(len(SOURCES)):
            self.market_source_evidence[self._source_key(market_id, SOURCES[index])] = json.dumps(results[index], separators=(",", ":"), sort_keys=True)
        winner = _financial_winner(proposal)
        if winner == OUTCOME_NONE:
            self.market_state[market_id] = STATE_PENDING
            self.market_winner[market_id] = OUTCOME_NONE
            self.market_reason[market_id] = REASON_NO_CONSENSUS
            return STATE_PENDING
        winning_pool = self.outcome_pool.get(self._outcome_key(market_id, winner), 0)
        total_pool = self.market_pool.get(market_id, 0)
        self.market_winner[market_id] = winner
        if total_pool > 0 and winning_pool == 0:
            self.market_state[market_id] = STATE_INCONCLUSIVE
            self.market_winner[market_id] = OUTCOME_NONE
            self.market_reason[market_id] = REASON_ZERO_BACKED
            return STATE_INCONCLUSIVE
        self.market_winning_pool[market_id] = winning_pool
        self.market_state[market_id] = STATE_SETTLED
        self.market_reason[market_id] = REASON_CONSENSUS
        return STATE_SETTLED
