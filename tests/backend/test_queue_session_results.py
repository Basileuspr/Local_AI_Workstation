from concurrent.futures import ThreadPoolExecutor
import pytest
from services import session_store


def test_concurrent_results_append_without_losing_other_messages(sessions_dir):
    session = session_store.create_session()
    session_id = session["id"]
    messages = [{"id": f"result-{index}", "role": "assistant", "content": str(index)} for index in range(20)]
    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(lambda message: session_store.append_messages(session_id, [message]), messages))
    saved = session_store.get_session(session_id)
    assert {message["id"] for message in saved["messages"]} == {message["id"] for message in messages}
    session_store.append_messages(session_id, [{**messages[0], "content": "updated"}])
    saved = session_store.get_session(session_id)
    assert len(saved["messages"]) == 20
    assert next(message for message in saved["messages"] if message["id"] == "result-0")["content"] == "updated"


def test_append_rejects_traversal_and_missing_ids(sessions_dir):
    with pytest.raises(ValueError):
        session_store.append_messages("../secret", [])
    session = session_store.create_session()
    with pytest.raises(ValueError):
        session_store.append_messages(session["id"], [{"role": "user", "content": "missing id"}])
    assert session_store.append_messages("deleted-session", []) is None
