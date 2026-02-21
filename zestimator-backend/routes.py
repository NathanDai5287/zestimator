from flask import Blueprint, jsonify

main = Blueprint("main", __name__)


@main.route("/health")
def health():
    return jsonify({"status": "ok"})
