import uuid
from datetime import datetime
from extensions import db


class Game(db.Model):
    __tablename__ = "games"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    status = db.Column(db.String(20), nullable=False, default="lobby")
    house_data = db.Column(db.JSON, nullable=False)
    true_value = db.Column(db.Float, nullable=False)
    market_bid = db.Column(db.Float, nullable=True)
    market_ask = db.Column(db.Float, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    players = db.relationship("Player", backref="game", lazy=True)
    auction_bids = db.relationship("AuctionBid", backref="game", lazy=True)
    trades = db.relationship("Trade", backref="game", lazy=True)


class Player(db.Model):
    __tablename__ = "players"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    game_id = db.Column(db.String(36), db.ForeignKey("games.id"), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    balance = db.Column(db.Float, nullable=False, default=10000.0)
    is_market_maker = db.Column(db.Boolean, default=False)
    is_host = db.Column(db.Boolean, default=False)
    token = db.Column(db.String(36), unique=True, nullable=False, default=lambda: str(uuid.uuid4()))
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)

    auction_bids = db.relationship("AuctionBid", backref="player", lazy=True)
    trades = db.relationship("Trade", backref="player", lazy=True)


class AuctionBid(db.Model):
    __tablename__ = "auction_bids"

    id = db.Column(db.Integer, primary_key=True)
    game_id = db.Column(db.String(36), db.ForeignKey("games.id"), nullable=False)
    player_id = db.Column(db.String(36), db.ForeignKey("players.id"), nullable=False)
    bid_price = db.Column(db.Float, nullable=False)
    ask_price = db.Column(db.Float, nullable=False)
    spread = db.Column(db.Float, nullable=False)
    submitted_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Enforce one bid per player per game at the DB level
    __table_args__ = (
        db.UniqueConstraint("game_id", "player_id", name="uq_auction_bid_game_player"),
    )


class Trade(db.Model):
    __tablename__ = "trades"

    id = db.Column(db.Integer, primary_key=True)
    game_id = db.Column(db.String(36), db.ForeignKey("games.id"), nullable=False)
    player_id = db.Column(db.String(36), db.ForeignKey("players.id"), nullable=False)
    direction = db.Column(db.String(4), nullable=False)  # 'buy' or 'sell'
    price = db.Column(db.Float, nullable=False)
    pnl = db.Column(db.Float, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
