from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
import argparse
import json
import os
import sqlite3
import time


DEFAULT_BACKUP_DIR = r"E:\hnu\雅思\备份zyz"
LATEST_FILENAME = "practice-backup-latest.json"
DEFAULT_DB_FILENAME = "ielts-atlas.sqlite"


def _json_default(value):
    return str(value)


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def is_plain_object(value):
    return isinstance(value, dict)


def normalize_records_payload(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("practice_records", "practiceRecords", "records"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    data = payload.get("data")
    if isinstance(data, dict):
        return normalize_records_payload(data)
    return []


def normalize_stats_payload(payload):
    if not isinstance(payload, dict):
        return None
    for key in ("user_stats", "userStats", "stats"):
        value = payload.get(key)
        if isinstance(value, dict):
            return value
    data = payload.get("data")
    if isinstance(data, dict):
        return normalize_stats_payload(data)
    return None


def record_timestamp(record):
    if not isinstance(record, dict):
        return ""
    for key in ("updatedAt", "createdAt", "endTime", "startTime", "date", "timestamp"):
        value = record.get(key)
        if value:
            return str(value)
    return ""


def record_exam_id(record):
    if not isinstance(record, dict):
        return ""
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
    real_data = record.get("realData") if isinstance(record.get("realData"), dict) else {}
    for value in (
        record.get("examId"),
        record.get("dataKey"),
        record.get("derivedExamId"),
        metadata.get("examId"),
        metadata.get("dataKey"),
        real_data.get("examId"),
        real_data.get("dataKey"),
    ):
        if value:
            return str(value)
    return ""


def record_data_key(record):
    if not isinstance(record, dict):
        return ""
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
    real_data = record.get("realData") if isinstance(record.get("realData"), dict) else {}
    for value in (
        record.get("dataKey"),
        metadata.get("dataKey"),
        real_data.get("dataKey"),
        record_exam_id(record),
    ):
        if value:
            return str(value)
    return ""


def derive_exam_id_from_session_id(value):
    text = str(value or "").strip()
    if not text:
        return ""
    import re
    match = re.match(r"^([pc]\d-(?:low|medium|high)-\d+)(?:_|$)", text, re.I)
    return match.group(1) if match else ""


def normalize_question_id(value):
    text = str(value or "").strip().lower()
    if not text:
        return ""
    import re
    exact = re.match(r"^q?(\d+)$", text)
    if exact:
        return f"q{exact.group(1)}"
    match = re.search(r"q(\d+)", text)
    return f"q{match.group(1)}" if match else text


def question_ids_equal(left, right):
    left_text = str(left or "").strip()
    right_text = str(right or "").strip()
    if not left_text or not right_text:
        return False
    return left_text == right_text or normalize_question_id(left_text) == normalize_question_id(right_text)


def normalize_title(value):
    import re
    text = str(value or "").strip().lower()
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    text = re.sub(r"[\s\-_/]+", " ", text)
    text = re.sub(r"^[pc]\s*[123]\s*(low|medium|high|次高频|高频|中频|低频)?\s*", "", text, flags=re.I)
    return text.strip()


def record_exam_ids(record):
    if not isinstance(record, dict):
        return []
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
    real_data = record.get("realData") if isinstance(record.get("realData"), dict) else {}
    raw_data = record.get("rawData") if isinstance(record.get("rawData"), dict) else {}
    values = [
        record.get("examId"),
        record.get("dataKey"),
        record.get("derivedExamId"),
        metadata.get("examId"),
        metadata.get("dataKey"),
        metadata.get("derivedExamId"),
        real_data.get("examId"),
        real_data.get("dataKey"),
        real_data.get("derivedExamId"),
        raw_data.get("examId"),
        raw_data.get("dataKey"),
        raw_data.get("derivedExamId"),
        derive_exam_id_from_session_id(record.get("sessionId")),
        derive_exam_id_from_session_id(record.get("id")),
        derive_exam_id_from_session_id(metadata.get("sessionId")),
        derive_exam_id_from_session_id(real_data.get("sessionId")),
        derive_exam_id_from_session_id(raw_data.get("sessionId")),
    ]
    return [str(value).strip() for value in values if value]


def record_titles(record):
    if not isinstance(record, dict):
        return []
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
    real_data = record.get("realData") if isinstance(record.get("realData"), dict) else {}
    raw_data = record.get("rawData") if isinstance(record.get("rawData"), dict) else {}
    values = [
        record.get("title"),
        record.get("examTitle"),
        metadata.get("title"),
        metadata.get("examTitle"),
        real_data.get("title"),
        real_data.get("examTitle"),
        raw_data.get("title"),
        raw_data.get("examTitle"),
    ]
    return [normalize_title(value) for value in values if normalize_title(value)]


def record_matches_exam(record, exam_id):
    target = str(exam_id or "").strip()
    if not target:
        return True

    def normalize_id(value):
        import re
        return re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")

    normalized_target = normalize_id(target)
    for value in record_exam_ids(record):
        candidate = normalize_id(value)
        if candidate and (
            candidate == normalized_target
            or candidate.endswith(f"-{normalized_target}")
            or normalized_target.endswith(f"-{candidate}")
        ):
            return True
    return False


def record_matches_title(record, title):
    target = normalize_title(title)
    if not target:
        return False
    for candidate in record_titles(record):
        if candidate == target:
            return True
        if (len(candidate) >= 12 and candidate in target) or (len(target) >= 12 and target in candidate):
            return True
    return False


def record_matches_wrong_reason_identity(record, exam_id, title):
    return record_matches_exam(record, exam_id) or record_matches_title(record, title)


def comparison_map_has_question(value, question_id):
    if not isinstance(value, dict) or not question_id:
        return False
    for key, entry in value.items():
        if question_ids_equal(key, question_id):
            return True
        if isinstance(entry, dict) and (
            question_ids_equal(entry.get("questionId"), question_id)
            or question_ids_equal(entry.get("displayNumber"), question_id)
            or question_ids_equal(entry.get("questionNumber"), question_id)
        ):
            return True
    return False


def record_contains_questions(record, question_ids, target_exam_id=""):
    ids = [value for value in question_ids if value]
    if not isinstance(record, dict) or not ids:
        return False
    score_info = record.get("scoreInfo") if isinstance(record.get("scoreInfo"), dict) else {}
    real_data = record.get("realData") if isinstance(record.get("realData"), dict) else {}
    real_score = real_data.get("scoreInfo") if isinstance(real_data.get("scoreInfo"), dict) else {}
    raw_data = record.get("rawData") if isinstance(record.get("rawData"), dict) else {}
    raw_score = raw_data.get("scoreInfo") if isinstance(raw_data.get("scoreInfo"), dict) else {}
    maps = [
        record.get("answerComparison"),
        record.get("answerDetails"),
        score_info.get("details"),
        real_data.get("answerComparison"),
        real_data.get("answerDetails"),
        real_score.get("details"),
        raw_data.get("answerComparison"),
        raw_data.get("answerDetails"),
        raw_score.get("details"),
    ]
    if all(any(comparison_map_has_question(map_value, qid) for map_value in maps) for qid in ids):
        return True
    suite_entries = record.get("suiteEntries")
    if not isinstance(suite_entries, list):
        return False
    for entry in suite_entries:
        if not isinstance(entry, dict):
            continue
        if target_exam_id and not record_matches_exam(entry, target_exam_id):
            continue
        entry_score = entry.get("scoreInfo") if isinstance(entry.get("scoreInfo"), dict) else {}
        entry_raw = entry.get("rawData") if isinstance(entry.get("rawData"), dict) else {}
        entry_raw_score = entry_raw.get("scoreInfo") if isinstance(entry_raw.get("scoreInfo"), dict) else {}
        entry_maps = [
            entry.get("answerComparison"),
            entry.get("answerDetails"),
            entry_score.get("details"),
            entry_raw.get("answerComparison"),
            entry_raw.get("answerDetails"),
            entry_raw_score.get("details"),
        ]
        if all(any(comparison_map_has_question(map_value, qid) for map_value in entry_maps) for qid in ids):
            return True
    return False


def normalize_wrong_reason(value):
    source = value if isinstance(value, dict) else {"category": value}
    category = str(source.get("category") or source.get("reason") or source.get("type") or "").strip()
    note = str(source.get("note") or source.get("detail") or source.get("text") or "").strip()
    if not category and not note:
        return None
    return {"category": category, "note": note, "updatedAt": source.get("updatedAt") or now_iso()}


def collect_wrong_reasons(record, include_suite_entries=False):
    merged = {}
    if not isinstance(record, dict):
        return merged
    for source in (
        record.get("wrongReasons"),
        (record.get("realData") or {}).get("wrongReasons") if isinstance(record.get("realData"), dict) else None,
        (record.get("rawData") or {}).get("wrongReasons") if isinstance(record.get("rawData"), dict) else None,
    ):
        if not isinstance(source, dict):
            continue
        for key, value in source.items():
            reason = normalize_wrong_reason(value)
            if reason:
                merged[str(key)] = reason
    if include_suite_entries and isinstance(record.get("suiteEntries"), list):
        for entry in record.get("suiteEntries"):
            if not isinstance(entry, dict):
                continue
            entry_exam_id = record_exam_id(entry)
            if not entry_exam_id:
                continue
            for key, reason in collect_wrong_reasons(entry).items():
                merged[key if "::" in key else f"{entry_exam_id}::{key}"] = reason
    return merged


def is_suite_record(record, payload=None):
    payload = payload if isinstance(payload, dict) else {}
    metadata = record.get("metadata") if isinstance(record, dict) and isinstance(record.get("metadata"), dict) else {}
    frequency = str(record.get("frequency") or metadata.get("frequency") or "").lower() if isinstance(record, dict) else ""
    return bool(
        isinstance(record, dict)
        and (
            record.get("suiteMode")
            or (isinstance(record.get("suiteEntries"), list) and len(record.get("suiteEntries")) > 0)
            or frequency == "suite"
            or payload.get("suiteSessionId")
        )
    )


def is_wrong_reason_fallback_record(record):
    if not isinstance(record, dict):
        return False
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
    real_data = record.get("realData") if isinstance(record.get("realData"), dict) else {}
    return (
        record.get("source") == "wrong-reason-fallback"
        or metadata.get("source") == "wrong-reason-fallback"
        or real_data.get("source") == "wrong-reason-fallback"
    )


def wrong_reason_record_quality(record):
    if not isinstance(record, dict):
        return -1000
    score_info = record.get("scoreInfo") if isinstance(record.get("scoreInfo"), dict) else {}
    real_data = record.get("realData") if isinstance(record.get("realData"), dict) else {}
    real_score = real_data.get("scoreInfo") if isinstance(real_data.get("scoreInfo"), dict) else {}
    answer_count = len(record.get("answerComparison")) if isinstance(record.get("answerComparison"), dict) else 0
    try:
        total_questions = float(record.get("totalQuestions", score_info.get("total", real_data.get("totalQuestions", real_score.get("total", 0)))) or 0)
    except Exception:
        total_questions = 0
    try:
        duration = float(record.get("duration", score_info.get("duration", score_info.get("timeSpent", real_data.get("duration", 0)))) or 0)
    except Exception:
        duration = 0
    score = 0
    if is_wrong_reason_fallback_record(record):
        score -= 1000
    if duration > 0:
        score += 100
    if total_questions > 1:
        score += 50
    if answer_count > 1:
        score += 25
    return score


def sort_wrong_reason_candidates(records):
    return sorted(
        records,
        key=lambda record: (wrong_reason_record_quality(record), record_timestamp(record)),
        reverse=True,
    )


def map_wrong_reason_keys_for_record(record, wrong_reasons, payload):
    mapped = {}
    target_exam_id = str(payload.get("examId") or payload.get("dataKey") or derive_exam_id_from_session_id(payload.get("sessionId")) or "").strip()
    should_prefix = (
        is_suite_record(record, payload)
        and target_exam_id
        and target_exam_id != str(record.get("examId") or "")
        and not target_exam_id.startswith("suite-")
    )
    for question_id, value in (wrong_reasons or {}).items():
        key = f"{target_exam_id}::{question_id}" if should_prefix and "::" not in str(question_id) else str(question_id)
        mapped[key] = value
    return mapped


def merge_wrong_reason_map(existing, incoming):
    merged = dict(existing or {})
    for question_id, value in (incoming or {}).items():
        reason = normalize_wrong_reason(value)
        if reason:
            merged[str(question_id)] = reason
        elif str(question_id) in merged:
            del merged[str(question_id)]
    return merged


def apply_wrong_reasons_to_map(target, wrong_reasons):
    if not isinstance(target, dict):
        return
    for question_id, value in (wrong_reasons or {}).items():
        target_key = str(question_id) if str(question_id) in target else ""
        if not target_key:
            for key in target.keys():
                if question_ids_equal(key, question_id):
                    target_key = key
                    break
        entry = target.get(target_key) if target_key else None
        if not isinstance(entry, dict):
            continue
        reason = normalize_wrong_reason(value)
        if reason:
            entry["wrongReason"] = reason
        elif "wrongReason" in entry:
            del entry["wrongReason"]


def apply_wrong_reasons_to_suite_entries(record, local_wrong_reasons, payload):
    if not isinstance(record, dict) or not isinstance(record.get("suiteEntries"), list):
        return
    target_exam_id = str(payload.get("examId") or payload.get("dataKey") or derive_exam_id_from_session_id(payload.get("sessionId")) or "").strip()
    if not target_exam_id or target_exam_id == str(record.get("examId") or "") or target_exam_id.startswith("suite-"):
        return
    for entry in record.get("suiteEntries"):
        if not isinstance(entry, dict) or record_exam_id(entry) != target_exam_id:
            continue
        entry["wrongReasons"] = merge_wrong_reason_map(collect_wrong_reasons(entry), local_wrong_reasons)
        apply_wrong_reasons_to_map(entry.get("answerComparison"), local_wrong_reasons)
        score = entry.get("scoreInfo") if isinstance(entry.get("scoreInfo"), dict) else {}
        apply_wrong_reasons_to_map(score.get("details"), local_wrong_reasons)
        raw = entry.get("rawData") if isinstance(entry.get("rawData"), dict) else {}
        if raw:
            raw["wrongReasons"] = merge_wrong_reason_map(collect_wrong_reasons(raw), local_wrong_reasons)
            apply_wrong_reasons_to_map(raw.get("answerComparison"), local_wrong_reasons)
            raw_score = raw.get("scoreInfo") if isinstance(raw.get("scoreInfo"), dict) else {}
            apply_wrong_reasons_to_map(raw_score.get("details"), local_wrong_reasons)


def apply_wrong_reason_update(record, wrong_reasons, payload):
    next_record = json.loads(json.dumps(record, ensure_ascii=False, default=_json_default))
    original_timing = {
        key: next_record.get(key)
        for key in ("id", "sessionId", "startTime", "endTime", "date", "duration", "createdAt", "updatedAt")
        if key in next_record
    }
    mapped = map_wrong_reason_keys_for_record(next_record, wrong_reasons, payload)
    next_record["wrongReasons"] = merge_wrong_reason_map(
        collect_wrong_reasons(next_record, include_suite_entries=True),
        mapped,
    )
    if not isinstance(next_record.get("answerComparison"), dict):
        next_record["answerComparison"] = {}
    apply_wrong_reasons_to_map(next_record.get("answerComparison"), mapped)
    real_data = next_record.get("realData") if isinstance(next_record.get("realData"), dict) else None
    if real_data is not None:
        real_data["wrongReasons"] = json.loads(json.dumps(next_record["wrongReasons"], ensure_ascii=False))
        if not isinstance(real_data.get("answerComparison"), dict):
            real_data["answerComparison"] = json.loads(json.dumps(next_record.get("answerComparison") or {}, ensure_ascii=False))
        apply_wrong_reasons_to_map(real_data.get("answerComparison"), mapped)
        real_score = real_data.get("scoreInfo") if isinstance(real_data.get("scoreInfo"), dict) else {}
        apply_wrong_reasons_to_map(real_score.get("details"), mapped)
    apply_wrong_reasons_to_map(next_record.get("answerDetails"), mapped)
    score = next_record.get("scoreInfo") if isinstance(next_record.get("scoreInfo"), dict) else {}
    apply_wrong_reasons_to_map(score.get("details"), mapped)
    apply_wrong_reasons_to_suite_entries(next_record, wrong_reasons, payload)
    next_record.update(original_timing)
    metadata = next_record.get("metadata") if isinstance(next_record.get("metadata"), dict) else {}
    next_record["metadata"] = metadata
    canonical_exam_id = (
        next_record.get("examId")
        or next_record.get("dataKey")
        or payload.get("examId")
        or payload.get("dataKey")
        or derive_exam_id_from_session_id(next_record.get("sessionId"))
        or derive_exam_id_from_session_id(payload.get("sessionId"))
    )
    if canonical_exam_id:
        next_record.setdefault("examId", canonical_exam_id)
        next_record.setdefault("dataKey", canonical_exam_id)
        next_record.setdefault("derivedExamId", canonical_exam_id)
        metadata.setdefault("examId", canonical_exam_id)
        metadata.setdefault("dataKey", canonical_exam_id)
        metadata.setdefault("derivedExamId", canonical_exam_id)
        if real_data is not None:
            real_data.setdefault("examId", canonical_exam_id)
            real_data.setdefault("dataKey", canonical_exam_id)
            real_data.setdefault("derivedExamId", canonical_exam_id)
    metadata["wrongReasonUpdatedAt"] = payload.get("updatedAt") or now_iso()
    if real_data is not None:
        real_data["wrongReasonUpdatedAt"] = metadata["wrongReasonUpdatedAt"]
    return next_record


def record_has_wrong_reasons(record, wrong_reasons, payload):
    expected = map_wrong_reason_keys_for_record(record or {}, wrong_reasons, payload)
    persisted = collect_wrong_reasons(record, include_suite_entries=True)
    for question_id, value in expected.items():
        expected_reason = normalize_wrong_reason(value)
        if not expected_reason:
            continue
        persisted_reason = normalize_wrong_reason(persisted.get(question_id))
        if not persisted_reason:
            return False
        if persisted_reason.get("category") != expected_reason.get("category"):
            return False
        if persisted_reason.get("note") != expected_reason.get("note"):
            return False
    return True


def summarize_wrong_reason_payload(payload):
    wrong_reasons = payload.get("wrongReasons") if isinstance(payload.get("wrongReasons"), dict) else {}
    return {
        "recordId": payload.get("recordId") or payload.get("id"),
        "sessionId": payload.get("sessionId"),
        "suiteSessionId": payload.get("suiteSessionId"),
        "examId": payload.get("examId") or payload.get("dataKey") or derive_exam_id_from_session_id(payload.get("sessionId")),
        "title": payload.get("title") or payload.get("examTitle"),
        "questionIds": list(wrong_reasons.keys()),
    }


def resolve_wrong_reason_record(records, payload):
    record_id = str(payload.get("recordId") or payload.get("id") or "").strip()
    if record_id:
        for record in records:
            if str(record.get("id") or "") == record_id or str(record.get("sessionId") or "") == record_id:
                if not is_wrong_reason_fallback_record(record):
                    return record, "explicit-id"
                break
    suite_session_id = str(payload.get("suiteSessionId") or "").strip()
    if suite_session_id:
        suite_candidates = [
            record for record in records
            if not is_wrong_reason_fallback_record(record)
            and is_suite_record(record, payload)
            and (
                str(record.get("id") or "") == suite_session_id
                or str(record.get("sessionId") or "") == suite_session_id
                or str(record.get("suiteSessionId") or "") == suite_session_id
                or str((record.get("metadata") or {}).get("suiteSessionId") or "") == suite_session_id
                or str((record.get("realData") or {}).get("suiteSessionId") or "") == suite_session_id
            )
        ]
        if suite_candidates:
            return sort_wrong_reason_candidates(suite_candidates)[0], "suite-session"
        return None, "suite-session-miss"
    exam_id = str(payload.get("examId") or payload.get("dataKey") or derive_exam_id_from_session_id(payload.get("sessionId")) or "").strip()
    title = str(payload.get("title") or payload.get("examTitle") or "").strip()
    session_id = str(payload.get("sessionId") or "").strip()
    wrong_reasons = payload.get("wrongReasons") if isinstance(payload.get("wrongReasons"), dict) else {}
    question_ids = list(wrong_reasons.keys())
    same_exam = [
        record for record in records
        if not is_wrong_reason_fallback_record(record)
        and not is_suite_record(record, payload)
        and record_matches_wrong_reason_identity(record, exam_id, title)
    ]
    if session_id:
        same_session = [
            record for record in same_exam
            if str(record.get("sessionId") or "") == session_id
            or str((record.get("realData") or {}).get("sessionId") or "") == session_id
            or str((record.get("metadata") or {}).get("sessionId") or "") == session_id
        ]
        if same_session:
            return sort_wrong_reason_candidates(same_session)[0], "single-session"
    same_exam = sort_wrong_reason_candidates(same_exam)
    question_matched = [record for record in same_exam if record_contains_questions(record, question_ids, exam_id)]
    if question_matched:
        return question_matched[0], "single-exam-question"
    if len(same_exam) == 1:
        return same_exam[0], "single-exam-only"
    return None, "ambiguous" if same_exam else "no-match"


def project_summary(record):
    if not isinstance(record, dict):
        return None
    score_info = record.get("scoreInfo") if isinstance(record.get("scoreInfo"), dict) else {}
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
    return {
        "id": str(record.get("id") or record.get("sessionId") or ""),
        "sessionId": record.get("sessionId"),
        "examId": record_exam_id(record) or None,
        "dataKey": record_data_key(record) or None,
        "derivedExamId": record.get("derivedExamId") or metadata.get("derivedExamId") or record_exam_id(record) or None,
        "title": record.get("title") or metadata.get("examTitle") or "",
        "source": record.get("source"),
        "type": record.get("type") or metadata.get("type") or "reading",
        "practiceType": record.get("practiceType") or metadata.get("practiceType") or metadata.get("examType"),
        "startTime": record.get("startTime"),
        "endTime": record.get("endTime"),
        "date": record.get("date"),
        "duration": record.get("duration", score_info.get("duration", score_info.get("timeSpent", 0))) or 0,
        "percentage": record.get("percentage", score_info.get("percentage", 0)) or 0,
        "accuracy": record.get("accuracy", score_info.get("accuracy", 0)) or 0,
        "score": record.get("score", score_info.get("score", 0)) or 0,
        "totalQuestions": record.get("totalQuestions", score_info.get("total", 0)) or 0,
        "correctAnswers": record.get("correctAnswers", score_info.get("correct", 0)) or 0,
        "status": record.get("status") or "completed",
        "suiteMode": bool(record.get("suiteMode")),
        "suiteEntryCount": len(record.get("suiteEntries") or []) if isinstance(record.get("suiteEntries"), list) else 0,
        "wrongReasons": record.get("wrongReasons") or {},
        "answerComparison": record.get("answerComparison") or {},
        "suiteSessionId": record.get("suiteSessionId") or metadata.get("suiteSessionId"),
        "questionTypePerformance": record.get("questionTypePerformance"),
        "scoreInfo": {
            "accuracy": score_info.get("accuracy"),
            "duration": score_info.get("duration"),
            "timeSpent": score_info.get("timeSpent"),
            "percentage": score_info.get("percentage"),
            "score": score_info.get("score"),
            "total": score_info.get("total"),
            "correct": score_info.get("correct"),
        },
        "metadata": {
            "category": metadata.get("category") or record.get("category"),
            "examTitle": metadata.get("examTitle") or record.get("title") or "",
            "frequency": metadata.get("frequency") or record.get("frequency") or "unknown",
            "type": metadata.get("type") or record.get("type"),
            "examType": metadata.get("examType"),
            "practiceType": metadata.get("practiceType"),
            "examId": metadata.get("examId"),
            "dataKey": metadata.get("dataKey"),
            "source": metadata.get("source"),
            "title": metadata.get("title"),
            "url": metadata.get("url"),
        },
        "updatedAt": record.get("updatedAt"),
        "createdAt": record.get("createdAt"),
    }


class PracticeSqliteStore:
    def __init__(self, db_path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.init_db()

    def connect(self):
        conn = sqlite3.connect(str(self.db_path), timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def init_db(self):
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS practice_records (
                    id TEXT PRIMARY KEY,
                    exam_id TEXT,
                    data_key TEXT,
                    session_id TEXT,
                    title TEXT,
                    record_date TEXT,
                    updated_at TEXT,
                    payload TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_practice_records_exam_id ON practice_records(exam_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_practice_records_session_id ON practice_records(session_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_practice_records_date ON practice_records(record_date)")

    def count_records(self):
        with self.connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS count FROM practice_records").fetchone()
            return int(row["count"] if row else 0)

    def list_records(self):
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT payload FROM practice_records ORDER BY COALESCE(record_date, updated_at, '') DESC"
            ).fetchall()
        records = []
        for row in rows:
            try:
                records.append(json.loads(row["payload"]))
            except Exception:
                continue
        return records

    def list_summaries(self):
        return [summary for summary in (project_summary(record) for record in self.list_records()) if summary]

    def get_record(self, record_id):
        with self.connect() as conn:
            row = conn.execute("SELECT payload FROM practice_records WHERE id = ?", (str(record_id),)).fetchone()
        if not row:
            return None
        return json.loads(row["payload"])

    def _upsert_record_with_conn(self, conn, record):
        if not isinstance(record, dict):
            raise ValueError("record must be an object")
        record_id = str(record.get("id") or record.get("sessionId") or "").strip()
        if not record_id:
            raise ValueError("record.id is required")
        payload = json.dumps(record, ensure_ascii=False, default=_json_default)
        metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
        conn.execute("""
            INSERT INTO practice_records (id, exam_id, data_key, session_id, title, record_date, updated_at, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                exam_id = excluded.exam_id,
                data_key = excluded.data_key,
                session_id = excluded.session_id,
                title = excluded.title,
                record_date = excluded.record_date,
                updated_at = excluded.updated_at,
                payload = excluded.payload
        """, (
            record_id,
            record_exam_id(record),
            record_data_key(record),
            str(record.get("sessionId") or ""),
            str(record.get("title") or metadata.get("examTitle") or ""),
            record_timestamp(record),
            str(record.get("updatedAt") or now_iso()),
            payload,
        ))
        return record

    def upsert_record(self, record):
        with self.connect() as conn:
            return self._upsert_record_with_conn(conn, record)

    def save_wrong_reasons(self, payload):
        if not isinstance(payload, dict):
            raise ValueError("payload must be an object")
        wrong_reasons = payload.get("wrongReasons")
        if not isinstance(wrong_reasons, dict) or not wrong_reasons:
            raise ValueError("wrongReasons must be a non-empty object")
        records = self.list_records()
        record, match_reason = resolve_wrong_reason_record(records, payload)
        if not record:
            raise LookupError(json.dumps({
                "message": "target practice record not found",
                "matchReason": match_reason,
                "payload": summarize_wrong_reason_payload(payload),
                "recordCount": len(records),
            }, ensure_ascii=False))
        next_record = apply_wrong_reason_update(record, wrong_reasons, payload)
        saved = self.upsert_record(next_record)
        verified = record_has_wrong_reasons(saved, wrong_reasons, payload)
        if not verified:
            raise RuntimeError("wrong reason save verification failed")
        return saved, match_reason

    def replace_records(self, records, max_records=None):
        final_records = [record for record in records if isinstance(record, dict)]
        final_records.sort(key=record_timestamp, reverse=True)
        if isinstance(max_records, int) and max_records > 0:
            final_records = final_records[:max_records]
        with self.connect() as conn:
            conn.execute("DELETE FROM practice_records")
            for record in final_records:
                self._upsert_record_with_conn(conn, record)
        return final_records

    def delete_records(self, ids):
        final_ids = [str(value) for value in (ids or []) if value is not None and str(value)]
        if not final_ids:
            return 0
        with self.connect() as conn:
            placeholders = ",".join("?" for _ in final_ids)
            cursor = conn.execute(f"DELETE FROM practice_records WHERE id IN ({placeholders})", final_ids)
            return int(cursor.rowcount or 0)

    def read_meta(self, key, default_value=None):
        with self.connect() as conn:
            row = conn.execute("SELECT value FROM meta WHERE key = ?", (str(key),)).fetchone()
        if not row:
            return default_value
        try:
            return json.loads(row["value"])
        except Exception:
            return default_value

    def write_meta(self, key, value):
        payload = json.dumps(value, ensure_ascii=False, default=_json_default)
        with self.connect() as conn:
            conn.execute("""
                INSERT INTO meta (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
            """, (str(key), payload, now_iso()))
        return value


def seed_database_from_latest_backup(store, backup_dir):
    if store.count_records() > 0:
        return {"seeded": False, "reason": "database already has records", "recordCount": store.count_records()}
    latest = Path(backup_dir) / LATEST_FILENAME
    if not latest.is_file():
        return {"seeded": False, "reason": "latest backup not found", "recordCount": 0}
    payload = json.loads(latest.read_text(encoding="utf-8"))
    records = normalize_records_payload(payload)
    if not records:
        return {"seeded": False, "reason": "latest backup has no records", "recordCount": 0}
    final_records = store.replace_records(records)
    stats = normalize_stats_payload(payload)
    if stats:
        store.write_meta("user_stats", stats)
    return {"seeded": True, "recordCount": len(final_records), "backup": str(latest)}


class LocalBackupHandler(SimpleHTTPRequestHandler):
    backup_dir = Path(DEFAULT_BACKUP_DIR)
    sqlite_store = None

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/external-backup/latest":
            self.send_latest_backup()
            return
        if parsed.path == "/api/external-backup/status":
            self.send_backup_status()
            return
        if parsed.path.startswith("/api/sqlite/"):
            self.handle_sqlite_get(parsed.path)
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/sqlite/"):
            self.handle_sqlite_write("POST", parsed.path)
            return
        self.send_json(404, {"ok": False, "error": "not found"})

    def do_PUT(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/sqlite/"):
            self.handle_sqlite_write("PUT", parsed.path)
            return
        self.send_json(404, {"ok": False, "error": "not found"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/sqlite/"):
            self.handle_sqlite_write("DELETE", parsed.path)
            return
        self.send_json(404, {"ok": False, "error": "not found"})

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self):
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def get_sqlite_store(self):
        if not self.sqlite_store:
            raise RuntimeError("sqlite store is not configured")
        return self.sqlite_store

    def handle_sqlite_get(self, path):
        try:
            store = self.get_sqlite_store()
            if path == "/api/sqlite/status":
                self.send_json(200, {
                    "ok": True,
                    "dbPath": str(store.db_path),
                    "recordCount": store.count_records(),
                    "backend": "sqlite"
                })
                return
            if path == "/api/sqlite/practice-records":
                records = store.list_records()
                self.send_json(200, {"ok": True, "records": records, "count": len(records)})
                return
            if path == "/api/sqlite/practice-records/summary":
                summaries = store.list_summaries()
                self.send_json(200, {"ok": True, "records": summaries, "count": len(summaries)})
                return
            if path.startswith("/api/sqlite/practice-records/"):
                record_id = unquote(path.rsplit("/", 1)[-1])
                record = store.get_record(record_id)
                if not record:
                    self.send_json(404, {"ok": False, "error": "record not found", "id": record_id})
                    return
                self.send_json(200, {"ok": True, "record": record})
                return
            if path.startswith("/api/sqlite/meta/"):
                key = unquote(path.rsplit("/", 1)[-1])
                value = store.read_meta(key, None)
                self.send_json(200, {"ok": True, "key": key, "value": value})
                return
            self.send_json(404, {"ok": False, "error": "not found"})
        except LookupError as error:
            self.send_json(404, {"ok": False, "error": str(error)})
        except Exception as error:
            self.send_json(500, {"ok": False, "error": str(error)})

    def handle_sqlite_write(self, method, path):
        try:
            store = self.get_sqlite_store()
            body = self.read_json_body()
            if method == "POST" and path == "/api/sqlite/practice-records/replace":
                records = body.get("records") if isinstance(body, dict) else None
                if not isinstance(records, list):
                    self.send_json(400, {"ok": False, "error": "records must be an array"})
                    return
                max_records = body.get("maxRecords") if isinstance(body, dict) else None
                final_records = store.replace_records(records, int(max_records) if isinstance(max_records, int) else None)
                self.send_json(200, {"ok": True, "records": final_records, "count": len(final_records)})
                return
            if method == "POST" and path == "/api/sqlite/practice-records/delete":
                ids = body.get("ids") if isinstance(body, dict) else []
                deleted = store.delete_records(ids)
                self.send_json(200, {"ok": True, "deletedCount": deleted, "records": store.list_records()})
                return
            if method in ("POST", "PUT") and path == "/api/sqlite/practice-records/wrong-reasons":
                saved, match_reason = store.save_wrong_reasons(body)
                self.send_json(200, {
                    "ok": True,
                    "record": saved,
                    "recordId": saved.get("id") if isinstance(saved, dict) else None,
                    "matchReason": match_reason,
                    "verified": True,
                })
                return
            if method in ("POST", "PUT") and path == "/api/sqlite/practice-records":
                record = body.get("record") if isinstance(body, dict) else None
                saved = store.upsert_record(record)
                self.send_json(200, {"ok": True, "record": saved})
                return
            if method == "DELETE" and path.startswith("/api/sqlite/practice-records/"):
                record_id = unquote(path.rsplit("/", 1)[-1])
                deleted = store.delete_records([record_id])
                self.send_json(200, {"ok": True, "deletedCount": deleted, "records": store.list_records()})
                return
            if method in ("POST", "PUT") and path.startswith("/api/sqlite/meta/"):
                key = unquote(path.rsplit("/", 1)[-1])
                value = body.get("value") if isinstance(body, dict) and "value" in body else body
                saved = store.write_meta(key, value)
                self.send_json(200, {"ok": True, "key": key, "value": saved})
                return
            self.send_json(404, {"ok": False, "error": "not found"})
        except LookupError as error:
            self.send_json(404, {"ok": False, "error": str(error)})
        except Exception as error:
            self.send_json(500, {"ok": False, "error": str(error)})

    def send_backup_status(self):
        latest = self.backup_dir / LATEST_FILENAME
        self.send_json(200, {
            "ok": latest.is_file(),
            "backupDir": str(self.backup_dir),
            "latestFilename": LATEST_FILENAME,
            "latestExists": latest.is_file(),
            "latestMtime": latest.stat().st_mtime if latest.is_file() else None,
            "latestBytes": latest.stat().st_size if latest.is_file() else 0,
        })

    def send_latest_backup(self):
        latest = self.backup_dir / LATEST_FILENAME
        try:
            resolved_dir = self.backup_dir.resolve(strict=True)
            resolved_file = latest.resolve(strict=True)
            if resolved_dir not in resolved_file.parents:
                self.send_json(403, {"ok": False, "error": "backup file outside configured directory"})
                return
            text = resolved_file.read_text(encoding="utf-8")
            parsed = json.loads(text)
            self.send_json(200, {
                "ok": True,
                "backupDir": str(resolved_dir),
                "filename": LATEST_FILENAME,
                "mtime": resolved_file.stat().st_mtime,
                "bytes": resolved_file.stat().st_size,
                "payload": parsed,
            })
        except FileNotFoundError:
            self.send_json(404, {
                "ok": False,
                "backupDir": str(self.backup_dir),
                "filename": LATEST_FILENAME,
                "error": "latest backup not found",
            })
        except Exception as error:
            self.send_json(500, {
                "ok": False,
                "backupDir": str(self.backup_dir),
                "filename": LATEST_FILENAME,
                "error": str(error),
            })


def main():
    parser = argparse.ArgumentParser(description="Serve IELTS Atlas with a local backup bridge.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--backup-dir", default=os.environ.get("IELTS_BACKUP_DIR", DEFAULT_BACKUP_DIR))
    parser.add_argument("--db-path", default=os.environ.get("IELTS_DB_PATH", ""))
    args = parser.parse_args()

    root = Path(args.root).resolve()
    backup_dir = Path(args.backup_dir).resolve()
    db_path = Path(args.db_path).resolve() if args.db_path else (backup_dir / DEFAULT_DB_FILENAME).resolve()
    os.chdir(root)
    LocalBackupHandler.backup_dir = backup_dir
    LocalBackupHandler.sqlite_store = PracticeSqliteStore(db_path)
    seed_result = seed_database_from_latest_backup(LocalBackupHandler.sqlite_store, backup_dir)

    server = ThreadingHTTPServer((args.host, args.port), LocalBackupHandler)
    print(f"Serving {root} at http://{args.host}:{args.port}/")
    print(f"Backup bridge: {backup_dir / LATEST_FILENAME}")
    print(f"SQLite database: {db_path}")
    print(f"SQLite seed: {json.dumps(seed_result, ensure_ascii=False)}")
    server.serve_forever()


if __name__ == "__main__":
    main()
