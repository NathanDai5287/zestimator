from flask import Flask, jsonify
from scraper import get_random_house

app = Flask(__name__)


@app.route("/")
def hello():
    return "Hello, World!"


@app.route("/api/random-house", methods=["GET"])
def random_house():
    data = get_random_house()
    if data and data.get("error"):
        return jsonify(data), 502
    return jsonify(data)


if __name__ == "__main__":
    app.run(debug=True)
