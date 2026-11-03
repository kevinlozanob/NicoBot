import database


def test_guardar_y_obtener_historial_en_orden(mongo_collection):
    database.guardar_mensaje("jid-1", "user", "hola")
    database.guardar_mensaje("jid-1", "assistant", "quiubo")
    database.guardar_mensaje("jid-2", "user", "otro chat")

    historial = database.obtener_historial("jid-1")

    assert historial == [
        {"role": "user", "content": "hola"},
        {"role": "assistant", "content": "quiubo"},
    ]


def test_obtener_historial_respeta_el_limite(mongo_collection):
    for i in range(15):
        database.guardar_mensaje("jid-1", "user", f"mensaje {i}")

    historial = database.obtener_historial("jid-1", limite=10)

    assert len(historial) == 10
    # Devuelve los 10 más recientes, del más viejo al más nuevo.
    assert historial[0]["content"] == "mensaje 5"
    assert historial[-1]["content"] == "mensaje 14"


def test_obtener_historial_vacio(mongo_collection):
    assert database.obtener_historial("desconocido") == []
