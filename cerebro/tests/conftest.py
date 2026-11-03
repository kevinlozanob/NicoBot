import os

import mongomock
import pytest

# Evita que los tests dependan de un Mongo o una API key reales.
os.environ.setdefault("MONGO_URI", "mongodb://localhost:27017")
os.environ.pop("GROQ_API_KEY", None)

import database  # noqa: E402


@pytest.fixture
def mongo_collection(monkeypatch):
    collection = mongomock.MongoClient()["nicobot_db"]["historial_chats"]
    monkeypatch.setattr(database, "collection", collection)
    return collection
