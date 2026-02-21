import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from game_logic import calculate_pnl, calculate_market_maker_pnl, select_market_maker


def make_trade(direction, price):
    return SimpleNamespace(direction=direction, price=price)


def make_bid(spread, submitted_at=None):
    return SimpleNamespace(spread=spread, submitted_at=submitted_at or datetime.utcnow())


class TestCalculatePnl(unittest.TestCase):

    def test_buy_profit(self):
        # Bought at 400k, true value is 450k → profit of 50k
        self.assertEqual(calculate_pnl("buy", 400_000, 450_000), 50_000)

    def test_buy_loss(self):
        # Bought at 500k, true value is 450k → loss of 50k
        self.assertEqual(calculate_pnl("buy", 500_000, 450_000), -50_000)

    def test_buy_breakeven(self):
        self.assertEqual(calculate_pnl("buy", 450_000, 450_000), 0)

    def test_sell_profit(self):
        # Sold at 500k, true value is 450k → profit of 50k
        self.assertEqual(calculate_pnl("sell", 500_000, 450_000), 50_000)

    def test_sell_loss(self):
        # Sold at 400k, true value is 450k → loss of 50k
        self.assertEqual(calculate_pnl("sell", 400_000, 450_000), -50_000)

    def test_sell_breakeven(self):
        self.assertEqual(calculate_pnl("sell", 450_000, 450_000), 0)


class TestCalculateMarketMakerPnl(unittest.TestCase):

    def test_no_trades(self):
        self.assertEqual(calculate_market_maker_pnl([], 450_000), 0.0)

    def test_single_buy_trade_mm_loses(self):
        # Trader buys at 400k, true value 450k → trader +50k, MM -50k
        trades = [make_trade("buy", 400_000)]
        self.assertEqual(calculate_market_maker_pnl(trades, 450_000), -50_000)

    def test_single_sell_trade_mm_loses(self):
        # Trader sells at 500k, true value 450k → trader +50k, MM -50k
        trades = [make_trade("sell", 500_000)]
        self.assertEqual(calculate_market_maker_pnl(trades, 450_000), -50_000)

    def test_single_buy_trade_mm_wins(self):
        # Trader buys at 500k, true value 450k → trader -50k, MM +50k
        trades = [make_trade("buy", 500_000)]
        self.assertEqual(calculate_market_maker_pnl(trades, 450_000), 50_000)

    def test_zero_sum_multiple_trades(self):
        # One buyer profits, one seller profits equally → MM breaks even
        trades = [
            make_trade("buy", 400_000),   # trader pnl = +50k
            make_trade("sell", 500_000),  # trader pnl = +50k
        ]
        mm_pnl = calculate_market_maker_pnl(trades, 450_000)
        # MM is on opposite side of both → -50k + -50k = -100k
        self.assertEqual(mm_pnl, -100_000)

    def test_zero_sum_property(self):
        # Total P&L across all participants must be zero
        true_value = 450_000
        trades = [
            make_trade("buy", 460_000),
            make_trade("sell", 440_000),
            make_trade("buy", 455_000),
        ]
        trader_pnls = sum(
            calculate_pnl(t.direction, t.price, true_value) for t in trades
        )
        mm_pnl = calculate_market_maker_pnl(trades, true_value)
        self.assertAlmostEqual(trader_pnls + mm_pnl, 0.0)

    def test_all_buyers_below_true_value(self):
        # All traders profit → MM takes a loss on all
        true_value = 500_000
        trades = [make_trade("buy", 400_000), make_trade("buy", 450_000)]
        mm_pnl = calculate_market_maker_pnl(trades, true_value)
        self.assertEqual(mm_pnl, -(100_000 + 50_000))


class TestSelectMarketMaker(unittest.TestCase):

    def test_empty_returns_none(self):
        self.assertIsNone(select_market_maker([]))

    def test_single_bid(self):
        bid = make_bid(20_000)
        self.assertIs(select_market_maker([bid]), bid)

    def test_picks_tightest_spread(self):
        wide = make_bid(50_000)
        tight = make_bid(10_000)
        medium = make_bid(30_000)
        self.assertIs(select_market_maker([wide, tight, medium]), tight)

    def test_tie_broken_by_earliest_submission(self):
        now = datetime.utcnow()
        first = make_bid(10_000, submitted_at=now)
        second = make_bid(10_000, submitted_at=now + timedelta(seconds=5))
        self.assertIs(select_market_maker([second, first]), first)

    def test_tie_broken_by_earliest_submission_reversed_input(self):
        now = datetime.utcnow()
        first = make_bid(10_000, submitted_at=now)
        second = make_bid(10_000, submitted_at=now + timedelta(seconds=5))
        # Input order should not affect result
        self.assertIs(select_market_maker([first, second]), first)

    def test_different_spreads_ignores_submission_time(self):
        now = datetime.utcnow()
        submitted_first = make_bid(50_000, submitted_at=now)
        submitted_second = make_bid(10_000, submitted_at=now + timedelta(hours=1))
        # Later submission but tighter spread wins
        self.assertIs(select_market_maker([submitted_first, submitted_second]), submitted_second)


if __name__ == "__main__":
    unittest.main()
