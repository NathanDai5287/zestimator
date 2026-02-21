def calculate_pnl(direction, price, true_value):
    """
    Calculate P&L for a trader.
    buy: bought at ask_price, worth true_value → profit if true_value > ask
    sell: sold at bid_price, worth true_value → profit if bid > true_value
    """
    if direction == "buy":
        return true_value - price
    else:  # sell
        return price - true_value


def calculate_market_maker_pnl(trades, true_value):
    """
    Market maker takes the opposite side of every trade.
    Their P&L is the negative sum of all trader P&Ls (zero-sum game).
    """
    total = 0.0
    for trade in trades:
        trader_pnl = calculate_pnl(trade.direction, trade.price, true_value)
        total += -trader_pnl
    return total


def select_market_maker(auction_bids):
    """
    Return the AuctionBid with the tightest spread.
    Ties broken by earliest submitted_at.
    Returns None if auction_bids is empty.
    """
    if not auction_bids:
        return None
    return min(auction_bids, key=lambda b: (b.spread, b.submitted_at))
