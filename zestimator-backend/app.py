import os
from dotenv import load_dotenv

load_dotenv()

from extensions import db, socketio, migrate


def create_app():
    from flask import Flask
    from flask_cors import CORS

    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = os.environ["DATABASE_URL"]
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SECRET_KEY"] = os.environ["SECRET_KEY"]

    CORS(app)

    db.init_app(app)
    socketio.init_app(app, cors_allowed_origins="*")
    migrate.init_app(app, db)

    from routes import game_bp
    app.register_blueprint(game_bp)

    import socket_events  # noqa: F401 — registers SocketIO handlers

    return app


app = create_app()

if __name__ == "__main__":
    socketio.run(app, debug=True)
