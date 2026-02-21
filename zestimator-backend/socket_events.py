from flask_socketio import join_room
from extensions import socketio
from models import Player


@socketio.on("join_game")
def on_join_game(data):
    token = data.get("token")
    if not token:
        return

    player = Player.query.filter_by(token=token).first()
    if not player:
        return

    join_room(player.game_id)
