import uuid
from datetime import datetime
from functools import wraps

from flask import Blueprint, request, jsonify, g
from extensions import db, socketio
from models import Game, Player, AuctionBid, Trade
from game_logic import calculate_pnl, calculate_market_maker_pnl, select_market_maker
from scraper import get_random_house

game_bp = Blueprint("game", __name__, url_prefix="/api")


# ---------------------------------------------------------------------------
# Auth decorators
# ---------------------------------------------------------------------------

def require_token(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get("X-Player-Token")
        if not token:
            return jsonify({"error": "Missing X-Player-Token header"}), 401
        player = Player.query.filter_by(token=token).first()
        if not player:
            return jsonify({"error": "Invalid token"}), 401
        # Ensure the player belongs to the game in the URL
        game_id = kwargs.get("game_id")
        if game_id and player.game_id != game_id:
            return jsonify({"error": "Token does not belong to this game"}), 403
        g.player = player
        return f(*args, **kwargs)
    return decorated


def require_host(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not g.player.is_host:
            return jsonify({"error": "Host access required"}), 403
        return f(*args, **kwargs)
    return decorated


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _game_state(game, reveal_price=False):
    players = []
    for p in game.players:
        players.append({
            "id": p.id,
            "name": p.name,
            "balance": p.balance,
            "isMarketMaker": p.is_market_maker,
            "isHost": p.is_host,
        })

    trades = []
    for t in game.trades:
        trades.append({
            "id": t.id,
            "playerId": t.player_id,
            "direction": t.direction,
            "price": t.price,
            "pnl": t.pnl,
        })

    house = dict(game.house_data)
    if not reveal_price:
        house.pop("price", None)

    # Expose the agreed spread (winning auction bid) once a market maker is selected
    agreed_spread = None
    mm_player = next((p for p in game.players if p.is_market_maker), None)
    if mm_player:
        mm_bid = AuctionBid.query.filter_by(game_id=game.id, player_id=mm_player.id).first()
        if mm_bid:
            agreed_spread = mm_bid.spread

    return {
        "id": game.id,
        "status": game.status,
        "house": house,
        "trueValue": game.true_value if reveal_price else None,
        "agreedSpread": agreed_spread,
        "marketBid": game.market_bid,
        "marketAsk": game.market_ask,
        "players": players,
        "trades": trades,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@game_bp.route("/random-house", methods=["GET"])
def random_house():
    house = get_random_house()
    if not house or house.get("error"):
        return jsonify({"error": "Failed to scrape house data"}), 502
    return jsonify(house)


@game_bp.route("/games", methods=["POST"])
def create_game():
    body = request.get_json(silent=True) or {}
    host_name = body.get("name", "Host")

    house = get_random_house()
    if not house or house.get("error"):
        return jsonify({"error": "Failed to scrape house data"}), 502

    true_value = house.get("price")
    if not true_value:
        return jsonify({"error": "House has no price"}), 502

    game = Game(
        id=str(uuid.uuid4()),
        status="lobby",
        house_data=house,
        true_value=float(true_value),
    )
    db.session.add(game)
    db.session.flush()

    host = Player(
        game_id=game.id,
        name=host_name,
        is_host=True,
    )
    db.session.add(host)
    db.session.commit()

    return jsonify({
        "gameId": game.id,
        "playerId": host.id,
        "token": host.token,
    }), 201


@game_bp.route("/games/<game_id>/join", methods=["POST"])
def join_game(game_id):
    game = Game.query.get_or_404(game_id)
    if game.status != "lobby":
        return jsonify({"error": "Game is not in lobby"}), 409

    body = request.get_json(silent=True) or {}
    name = body.get("name", "Player")

    player = Player(game_id=game.id, name=name)
    db.session.add(player)
    db.session.commit()

    socketio.emit("player_joined", {"playerId": player.id, "name": player.name}, room=game_id)

    return jsonify({
        "playerId": player.id,
        "token": player.token,
    }), 201


@game_bp.route("/games/<game_id>", methods=["GET"])
@require_token
def get_game(game_id):
    game = Game.query.get_or_404(game_id)
    reveal = game.status == "settlement"
    return jsonify(_game_state(game, reveal_price=reveal))


@game_bp.route("/games/<game_id>/start-auction", methods=["POST"])
@require_token
@require_host
def start_auction(game_id):
    game = Game.query.get_or_404(game_id)
    if game.status != "lobby":
        return jsonify({"error": "Game must be in lobby to start auction"}), 409

    game.status = "auction"
    db.session.commit()

    socketio.emit("auction_started", {"gameId": game_id}, room=game_id)
    return jsonify({"status": game.status})


@game_bp.route("/games/<game_id>/bid", methods=["POST"])
@require_token
def submit_bid(game_id):
    game = Game.query.get_or_404(game_id)
    if game.status != "auction":
        return jsonify({"error": "Game is not in auction phase"}), 409

    body = request.get_json(silent=True) or {}
    spread = body.get("spread")

    if spread is None:
        return jsonify({"error": "spread is required"}), 400
    spread = float(spread)
    if spread <= 0:
        return jsonify({"error": "spread must be positive"}), 400

    # Upsert: update existing bid or create new one
    # bid_price/ask_price are placeholders; the actual quotes are set in the quoting phase
    existing = AuctionBid.query.filter_by(game_id=game_id, player_id=g.player.id).first()
    if existing:
        existing.spread = spread
        existing.submitted_at = datetime.utcnow()
    else:
        existing = AuctionBid(
            game_id=game_id,
            player_id=g.player.id,
            bid_price=0.0,
            ask_price=spread,
            spread=spread,
        )
        db.session.add(existing)

    db.session.commit()

    socketio.emit("new_bid", {
        "playerName": g.player.name,
        "spread": spread,
    }, room=game_id)

    return jsonify({"spread": spread})


@game_bp.route("/games/<game_id>/finish-auction", methods=["POST"])
@require_token
@require_host
def finish_auction(game_id):
    game = Game.query.get_or_404(game_id)
    if game.status != "auction":
        return jsonify({"error": "Game is not in auction phase"}), 409

    bids = AuctionBid.query.filter_by(game_id=game_id).all()
    winner_bid = select_market_maker(bids)
    if not winner_bid:
        return jsonify({"error": "No bids submitted"}), 409

    winner = Player.query.get(winner_bid.player_id)
    winner.is_market_maker = True

    game.status = "quoting"
    db.session.commit()

    socketio.emit("market_maker_selected", {
        "playerName": winner.name,
        "spread": winner_bid.spread,
    }, room=game_id)

    return jsonify({
        "marketMaker": winner.name,
        "spread": winner_bid.spread,
    })


@game_bp.route("/games/<game_id>/set-quotes", methods=["POST"])
@require_token
def set_quotes(game_id):
    game = Game.query.get_or_404(game_id)
    if game.status != "quoting":
        return jsonify({"error": "Game is not in quoting phase"}), 409
    if not g.player.is_market_maker:
        return jsonify({"error": "Only the market maker can set quotes"}), 403

    body = request.get_json(silent=True) or {}
    bid_price = body.get("bid")
    ask_price = body.get("ask")

    if bid_price is None or ask_price is None:
        return jsonify({"error": "bid and ask are required"}), 400

    bid_price = float(bid_price)
    ask_price = float(ask_price)

    if ask_price <= bid_price:
        return jsonify({"error": "ask must be greater than bid"}), 400

    submitted_spread = ask_price - bid_price

    # Enforce the agreed spread from the auction
    mm_bid = AuctionBid.query.filter_by(game_id=game_id, player_id=g.player.id).first()
    if mm_bid and abs(submitted_spread - mm_bid.spread) > 0.01:
        return jsonify({"error": f"Spread must equal the agreed auction spread of {mm_bid.spread}"}), 400

    game.market_bid = bid_price
    game.market_ask = ask_price
    game.status = "trading"
    db.session.commit()

    socketio.emit("quotes_set", {"bid": bid_price, "ask": ask_price}, room=game_id)
    return jsonify({"bid": bid_price, "ask": ask_price})


@game_bp.route("/games/<game_id>/trade", methods=["POST"])
@require_token
def make_trade(game_id):
    game = Game.query.get_or_404(game_id)
    if game.status != "trading":
        return jsonify({"error": "Game is not in trading phase"}), 409
    if g.player.is_market_maker:
        return jsonify({"error": "Market maker cannot trade"}), 403

    # Check if player already traded
    existing_trade = Trade.query.filter_by(game_id=game_id, player_id=g.player.id).first()
    if existing_trade:
        return jsonify({"error": "You have already made a trade this round"}), 409

    body = request.get_json(silent=True) or {}
    direction = body.get("direction")
    if direction not in ("buy", "sell"):
        return jsonify({"error": "direction must be 'buy' or 'sell'"}), 400

    price = game.market_ask if direction == "buy" else game.market_bid

    trade = Trade(
        game_id=game_id,
        player_id=g.player.id,
        direction=direction,
        price=price,
    )
    db.session.add(trade)
    db.session.commit()

    socketio.emit("new_trade", {
        "playerName": g.player.name,
        "direction": direction,
        "price": price,
    }, room=game_id)

    return jsonify({"direction": direction, "price": price})


@game_bp.route("/games/<game_id>/settle", methods=["POST"])
@require_token
@require_host
def settle(game_id):
    game = Game.query.get_or_404(game_id)
    if game.status != "trading":
        return jsonify({"error": "Game is not in trading phase"}), 409

    true_value = game.true_value
    trades = Trade.query.filter_by(game_id=game_id).all()

    # Calculate and persist P&L for each trader
    for trade in trades:
        pnl = calculate_pnl(trade.direction, trade.price, true_value)
        trade.pnl = pnl
        player = Player.query.get(trade.player_id)
        player.balance += pnl

    # Calculate and apply market maker P&L
    mm_pnl = calculate_market_maker_pnl(trades, true_value)
    mm = Player.query.filter_by(game_id=game_id, is_market_maker=True).first()
    if mm:
        mm.balance += mm_pnl

    game.status = "settlement"
    db.session.commit()

    state = _game_state(game, reveal_price=True)
    socketio.emit("settled", state, room=game_id)

    return jsonify(state)
