import os
from pymongo import MongoClient
from datetime import datetime, timezone
import pymongo

MONGO_URI = os.getenv("MONGO_URI")

client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)

db = client["nicobot_db"]
collection = db["historial_chats"]

def init_db():
    try:
        client.admin.command('ping')
        print("✅ Conexión exitosa a MongoDB Atlas")
    except Exception as e:
        print(f"❌ Error conectando a Mongo: {e}")

def guardar_mensaje(jid, role, content):
    try:
        mensaje = {
            "jid": jid,
            "role": role,
            "content": content,
            "timestamp": datetime.now(timezone.utc)
        }
        collection.insert_one(mensaje)
    except Exception as e:
        print(f"Error guardando en Mongo: {e}")

def obtener_historial(jid, limite=10):
    try:
        # Mongo guarda las fechas con precisión de milisegundos: dos mensajes
        # guardados seguidos pueden empatar en timestamp. El _id (ObjectId)
        # crece con cada inserción y sirve de desempate.
        cursor = collection.find({"jid": jid})\
                           .sort([("timestamp", pymongo.DESCENDING), ("_id", pymongo.DESCENDING)])\
                           .limit(limite)
        
        mensajes = []
        for doc in cursor:
            mensajes.append({"role": doc["role"], "content": doc["content"]})
        
        return mensajes[::-1]
    except Exception as e:
        print(f"Error leyendo Mongo: {e}")
        return []