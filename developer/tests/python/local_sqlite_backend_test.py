import http.client
import importlib.util
import gc
import json
import shutil
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SERVER_PATH = REPO_ROOT / "scripts" / "local_backup_server.py"


def load_server_module():
    spec = importlib.util.spec_from_file_location("local_backup_server", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def request_json(port, method, path, payload=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json; charset=utf-8"} if body is not None else {}
    conn.request(method, path, body=body, headers=headers)
    response = conn.getresponse()
    raw = response.read().decode("utf-8")
    conn.close()
    return response.status, json.loads(raw) if raw else None


def make_record(record_id, exam_id, title="Passage"):
    return {
        "id": record_id,
        "examId": exam_id,
        "dataKey": exam_id,
        "type": "reading",
        "title": title,
        "score": 1,
        "totalQuestions": 1,
        "correctAnswers": 1,
        "accuracy": 1,
        "duration": 120,
        "date": "2026-07-27T10:00:00.000Z",
        "metadata": {"examId": exam_id, "dataKey": exam_id, "examTitle": title},
    }


def cleanup_temp_dir(path):
    for _ in range(10):
        try:
            shutil.rmtree(path)
            return
        except PermissionError:
            gc.collect()
            time.sleep(0.2)
    shutil.rmtree(path)


def main():
    module = load_server_module()
    tmp = tempfile.mkdtemp(prefix="ielts-sqlite-test-")
    try:
        root = Path(tmp)
        backup_dir = root / "backup"
        backup_dir.mkdir()
        db_path = root / "test.sqlite"
        backup_payload = {
            "practice_records": [make_record("seed-record", "p1-medium-63", "Seed")],
            "user_stats": {"totalPractices": 1, "totalTimeSpent": 120, "averageScore": 1},
            "vocab_state": {
                "schemaVersion": "VocabStateV1",
                "activeListId": "default",
                "config": {"masteryCount": 4},
                "reviewQueue": ["word-1"],
                "lists": {
                    "default": {
                        "id": "default",
                        "words": [{"id": "word-1", "word": "exact", "meaning": "精确的", "correctCount": 2}],
                    }
                },
            },
        }
        (backup_dir / module.LATEST_FILENAME).write_text(
            json.dumps(backup_payload, ensure_ascii=False),
            encoding="utf-8",
        )
        exam_dir = root / "assets" / "generated" / "reading-exams"
        exam_dir.mkdir(parents=True, exist_ok=True)
        (exam_dir / "p1-high-99.js").write_text(
            """(function registerReadingExamData(global) {
  'use strict';
  global.__READING_EXAM_DATA__ = global.__READING_EXAM_DATA__ || { register: function(id, data) { this[id] = data; } };
  global.__READING_EXAM_DATA__.register("p1-high-99", {
    "schemaVersion": "ReadingExamSourceV1",
    "examId": "p1-high-99",
    "meta": {"title": "Saved", "category": "P1", "frequency": "high"},
    "passage": {"blocks": [{"kind": "html", "html": "<h2>READING PASSAGE 1</h2><h3>Saved Passage</h3><p><strong>A</strong> This is the original passage paragraph.</p>"}]},
    "questionGroups": [{"groupId": "group-1", "kind": "short_answer", "questionIds": ["q1"], "bodyHtml": "<div class=\\"group\\"><h4>Questions 1</h4><div class=\\"question-item\\"><span class=\\"q-number\\">1</span> What is the sample question? <input name=\\"q1\\" type=\\"text\\"></div></div>"}],
    "answerKey": {"q1": "B"},
    "questionOrder": ["q1"],
    "questionDisplayMap": {"q1": "1"}
  });
})(typeof window !== "undefined" ? window : globalThis);
""",
            encoding="utf-8",
        )

        store = module.PracticeSqliteStore(db_path)
        seed = module.seed_database_from_latest_backup(store, backup_dir)
        assert seed["seeded"] is True
        assert seed["vocabStateSeeded"] is True
        assert store.count_records() == 1
        assert store.read_meta("vocab_state", {})["lists"]["default"]["words"][0]["word"] == "exact"

        class TestHandler(module.LocalBackupHandler):
            pass

        TestHandler.backup_dir = backup_dir
        TestHandler.content_root = root
        TestHandler.sqlite_store = store

        server = ThreadingHTTPServer(("127.0.0.1", 0), TestHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            status, data = request_json(port, "GET", "/api/sqlite/status")
            assert status == 200 and data["ok"] is True
            assert data["recordCount"] == 1

            new_record = make_record("saved-record", "p1-high-99", "Saved")
            new_record.update({
                "score": 0,
                "correctAnswers": 0,
                "accuracy": 0,
                "answerComparison": {
                    "q1": {
                        "questionId": "q1",
                        "userAnswer": "A",
                        "correctAnswer": "B",
                        "isCorrect": False,
                    }
                },
                "wrongReasons": {
                    "q1": {
                        "category": "定位错误",
                        "note": "export note",
                    }
                },
            })
            status, data = request_json(port, "POST", "/api/sqlite/practice-records", {"record": new_record})
            assert status == 200 and data["record"]["id"] == "saved-record"

            status, data = request_json(port, "GET", "/api/sqlite/practice-records/saved-record")
            assert status == 200 and data["record"]["examId"] == "p1-high-99"

            status, data = request_json(port, "POST", "/api/sqlite/practice-records/full-wrong-export", {"ids": ["saved-record"]})
            assert status == 200 and data["ok"] is True
            export = data["export"]
            assert export["schemaVersion"] == "PracticeFullWrongExportV1"
            exported_passage = export["records"][0]["passages"][0]
            assert "original passage paragraph" in exported_passage["passage"]["paragraphs"][0]["text"]
            assert "sample question" in exported_passage["questionGroups"][0]["questions"][0]["text"]
            assert exported_passage["wrongQuestions"][0]["userAnswer"] == "A"
            assert exported_passage["wrongQuestions"][0]["correctAnswer"] == "B"
            assert exported_passage["wrongQuestions"][0]["wrongReason"]["note"] == "export note"

            status, data = request_json(port, "GET", "/api/sqlite/practice-records/summary")
            assert status == 200 and data["count"] == 2
            assert any(record["id"] == "saved-record" for record in data["records"])

            stats = {"totalPractices": 2, "totalTimeSpent": 240, "averageScore": 1}
            status, data = request_json(port, "PUT", "/api/sqlite/meta/user_stats", {"value": stats})
            assert status == 200 and data["value"]["totalPractices"] == 2
            status, data = request_json(port, "GET", "/api/sqlite/meta/user_stats")
            assert status == 200 and data["value"]["totalTimeSpent"] == 240

            status, data = request_json(port, "GET", "/api/sqlite/meta/vocab_state")
            assert status == 200 and data["value"]["activeListId"] == "default"

            wrong_reason_record = make_record(
                "record_p1-medium-63_1785155471248_tci4wb41s",
                "p1-medium-63",
                "A Brief History of Humans and Food 人类食物的历史",
            )
            wrong_reason_record.update({
                "sessionId": "p1-medium-63_1785155471248_tci4wb41s",
                "startTime": "2026-07-27T12:31:11.246Z",
                "endTime": "2026-07-27T12:54:19.858Z",
                "date": "2026-07-27T12:54:19.858Z",
                "duration": 1388,
                "suiteEntries": [],
                "answerComparison": {
                    "q9": {
                        "questionId": "q9",
                        "userAnswer": "bacteria",
                        "correctAnswer": "glass",
                        "isCorrect": False,
                    }
                },
                "scoreInfo": {
                    "details": {
                        "q9": {
                            "questionId": "q9",
                            "userAnswer": "bacteria",
                            "correctAnswer": "glass",
                            "isCorrect": False,
                        }
                    }
                },
            })
            status, data = request_json(port, "POST", "/api/sqlite/practice-records", {"record": wrong_reason_record})
            assert status == 200
            fallback_duplicate = make_record(
                "record_p1-medium-63_wrong_reason_fallback",
                "p1-medium-63",
                "A Brief History of Humans and Food 人类食物的历史",
            )
            fallback_duplicate.update({
                "sessionId": "p1-medium-63_wrong_reason_fallback",
                "source": "wrong-reason-fallback",
                "metadata": {
                    "examId": "p1-medium-63",
                    "dataKey": "p1-medium-63",
                    "examTitle": "A Brief History of Humans and Food 人类食物的历史",
                    "source": "wrong-reason-fallback",
                },
                "date": "2026-07-28T08:14:26.156Z",
                "endTime": "2026-07-28T08:14:26.156Z",
                "duration": 0,
                "totalQuestions": 1,
                "correctAnswers": 0,
                "score": 0,
                "wrongReasons": {
                    "q9": {
                        "category": "定位错误",
                        "note": "",
                    }
                },
                "answerComparison": {
                    "q9": {
                        "questionId": "q9",
                        "userAnswer": "bacteria",
                        "correctAnswer": "glass",
                        "isCorrect": False,
                    }
                },
            })
            status, data = request_json(port, "POST", "/api/sqlite/practice-records", {"record": fallback_duplicate})
            assert status == 200
            before_count = store.count_records()
            status, data = request_json(port, "POST", "/api/sqlite/practice-records/wrong-reasons", {
                "sessionId": "p1-medium-63_new_review_session",
                "examId": "p1-medium-63",
                "dataKey": "p1-medium-63",
                "title": "A Brief History of Humans and Food 人类食物的历史",
                "wrongReasons": {
                    "q9": {
                        "category": "定位错误",
                        "note": "backend direct save",
                    }
                },
                "updatedAt": "2026-07-27T22:11:39.000Z",
            })
            assert status == 200 and data["ok"] is True
            assert data["record"]["id"] == "record_p1-medium-63_1785155471248_tci4wb41s"
            assert data["matchReason"] == "single-exam-question"
            assert data["record"]["wrongReasons"]["q9"]["note"] == "backend direct save"
            assert data["record"]["answerComparison"]["q9"]["wrongReason"]["category"] == "定位错误"
            assert data["record"]["duration"] == 1388
            assert store.count_records() == before_count

            status, data = request_json(port, "POST", "/api/sqlite/practice-records/wrong-reasons", {
                "sessionId": "p1-high-777_1785175725700_smo81maz8",
                "reviewSessionId": "review_ms3jj9ir_74qcnm",
                "examId": "p1-high-777",
                "dataKey": "p1-high-777",
                "title": "Fallback Passage",
                "wrongReasons": {
                    "q9": {
                        "category": "定位错误",
                        "note": "backend fallback save",
                    }
                },
                "wrongReasonTargets": [{
                    "questionId": "q9",
                    "userAnswer": "bacteria",
                    "correctAnswer": "glass",
                    "isCorrect": False,
                }],
                "updatedAt": "2026-07-28T02:08:55.000Z",
            })
            assert status == 404 and data["ok"] is False

            status, data = request_json(port, "POST", "/api/sqlite/practice-records/wrong-reasons", {
                "sessionId": "p1-high-999_missing_session",
                "examId": "p1-high-999",
                "wrongReasons": {
                    "q4": {
                        "category": "定位错误",
                        "note": "missing targets should still fail",
                    }
                },
            })
            assert status == 404 and data["ok"] is False
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
            TestHandler.sqlite_store = None
            gc.collect()

        print(json.dumps({
            "status": "pass",
            "detail": "local sqlite backend HTTP API covered",
            "passed": 1,
            "total": 1,
        }, ensure_ascii=False, indent=2))
    finally:
        cleanup_temp_dir(tmp)


if __name__ == "__main__":
    main()
