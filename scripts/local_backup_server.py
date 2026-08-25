from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
import argparse
import html
import json
import math
import os
import re
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


def add_wrong_reason_category(categories, value):
    for item in re.split(r"[、,，;；|/]+", str(value or "")):
        category = item.strip()
        if category and category not in categories:
            categories.append(category)


def normalize_wrong_reason_categories(value):
    source = value if isinstance(value, dict) else {"category": value}
    categories = []
    if isinstance(source.get("categories"), list):
        for item in source.get("categories"):
            add_wrong_reason_category(categories, item)
    add_wrong_reason_category(categories, source.get("category"))
    add_wrong_reason_category(categories, source.get("reason"))
    add_wrong_reason_category(categories, source.get("type"))
    return categories


def wrong_reason_categories_equal(left, right):
    left_categories = normalize_wrong_reason_categories(left)
    right_categories = normalize_wrong_reason_categories(right)
    return len(left_categories) == len(right_categories) and all(category in right_categories for category in left_categories)


def normalize_wrong_reason(value):
    source = value if isinstance(value, dict) else {"category": value}
    categories = normalize_wrong_reason_categories(source)
    category = categories[0] if categories else ""
    note = str(source.get("note") or source.get("detail") or source.get("text") or "").strip()
    if not category and not note:
        return None
    return {"category": category, "categories": categories, "note": note, "updatedAt": source.get("updatedAt") or now_iso()}


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
    return repair_record_score_fields(next_record)


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
        if not wrong_reason_categories_equal(persisted_reason, expected_reason):
            return False
        if persisted_reason.get("note") != expected_reason.get("note"):
            return False
    return True


def repair_record_score_fields(record):
    if not isinstance(record, dict):
        return record
    score_info = record.get("scoreInfo") if isinstance(record.get("scoreInfo"), dict) else {}
    def number_or_none(*values):
        for value in values:
            try:
                if value is None or value == "":
                    continue
                numeric = float(value)
                if math.isfinite(numeric):
                    return numeric
            except Exception:
                continue
        return None

    score = number_or_none(record.get("score"), score_info.get("score"), score_info.get("correct"), record.get("correctAnswers"))
    total = number_or_none(record.get("totalQuestions"), score_info.get("total"), score_info.get("totalQuestions"))
    accuracy = number_or_none(record.get("accuracy"), score_info.get("accuracy"))
    if (accuracy is None or accuracy <= 0) and total and total > 0 and score and score > 0:
        accuracy = score / total
    if accuracy is not None and accuracy > 1:
        accuracy = accuracy / 100
    percentage = number_or_none(record.get("percentage"), score_info.get("percentage"))
    if (percentage is None or percentage <= 0) and accuracy and accuracy > 0:
        percentage = round(accuracy * 100)
    if score is not None:
        record["score"] = int(score) if float(score).is_integer() else score
        score_info["score"] = record["score"]
        score_info["correct"] = record["score"]
    if total is not None:
        record["totalQuestions"] = int(total) if float(total).is_integer() else total
        score_info["total"] = record["totalQuestions"]
        score_info["totalQuestions"] = record["totalQuestions"]
    if accuracy is not None:
        record["accuracy"] = accuracy
        score_info["accuracy"] = accuracy
    if percentage is not None:
        record["percentage"] = int(percentage) if float(percentage).is_integer() else percentage
        score_info["percentage"] = record["percentage"]
    if "duration" in record and "duration" not in score_info:
        score_info["duration"] = record.get("duration")
    if "duration" in score_info and "timeSpent" not in score_info:
        score_info["timeSpent"] = score_info.get("duration")
    if score_info:
        record["scoreInfo"] = score_info
    real_data = record.get("realData") if isinstance(record.get("realData"), dict) else None
    if real_data is not None:
        real_score = real_data.get("scoreInfo") if isinstance(real_data.get("scoreInfo"), dict) else {}
        for key in ("score", "correct", "total", "totalQuestions", "accuracy", "percentage", "duration", "timeSpent"):
            if key in score_info and key not in real_score:
                real_score[key] = score_info[key]
        if real_score:
            real_data["scoreInfo"] = real_score
    return record


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
    def number_or_none(*values):
        for value in values:
            try:
                if value is None or value == "":
                    continue
                numeric = float(value)
                if math.isfinite(numeric):
                    return numeric
            except Exception:
                continue
        return None

    resolved_score = number_or_none(record.get("score"), score_info.get("score"), score_info.get("correct"), record.get("correctAnswers")) or 0
    resolved_total = number_or_none(record.get("totalQuestions"), score_info.get("total"), score_info.get("totalQuestions")) or 0
    raw_accuracy = number_or_none(record.get("accuracy"), score_info.get("accuracy"))
    if raw_accuracy is not None and raw_accuracy > 0:
        resolved_accuracy = raw_accuracy / 100 if raw_accuracy > 1 else raw_accuracy
    elif resolved_total > 0 and resolved_score > 0:
        resolved_accuracy = resolved_score / resolved_total
    else:
        resolved_accuracy = raw_accuracy or 0
    raw_percentage = number_or_none(record.get("percentage"), score_info.get("percentage"))
    if raw_percentage is not None and raw_percentage > 0:
        resolved_percentage = raw_percentage
    elif resolved_accuracy > 0:
        resolved_percentage = round(resolved_accuracy * 100)
    else:
        resolved_percentage = raw_percentage or 0
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
        "percentage": resolved_percentage,
        "accuracy": resolved_accuracy,
        "score": resolved_score,
        "totalQuestions": resolved_total,
        "correctAnswers": score_info.get("correct", record.get("score", record.get("correctAnswers", 0))) or 0,
        "status": record.get("status") or "completed",
        "suiteMode": bool(record.get("suiteMode")),
        "suiteEntryCount": len(record.get("suiteEntries") or []) if isinstance(record.get("suiteEntries"), list) else 0,
        "wrongReasons": record.get("wrongReasons") or {},
        "answerComparison": record.get("answerComparison") or {},
        "suiteSessionId": record.get("suiteSessionId") or metadata.get("suiteSessionId"),
        "questionTypePerformance": record.get("questionTypePerformance"),
        "scoreInfo": {
            "accuracy": resolved_accuracy,
            "duration": score_info.get("duration"),
            "timeSpent": score_info.get("timeSpent"),
            "percentage": resolved_percentage,
            "score": resolved_score,
            "total": resolved_total,
            "correct": score_info.get("correct", record.get("correctAnswers")),
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


def compact_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def strip_html_text(markup):
    if not markup:
        return ""
    text = str(markup)
    text = re.sub(r"(?is)<(script|style|select|button)[^>]*>.*?</\1>", " ", text)
    text = re.sub(r"(?is)<option[^>]*>.*?</option>", " ", text)
    text = re.sub(r"(?is)<input\b[^>]*>", " ", text)
    text = re.sub(r"(?is)<br\s*/?>", "\n", text)
    text = re.sub(r"(?is)</(p|li|h[1-6]|div|tr|label)>", "\n", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s+", "\n", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()


def load_reading_exam_dataset(content_root, exam_id):
    final_exam_id = compact_text(exam_id)
    if not final_exam_id:
        raise FileNotFoundError("examId is empty")
    source_path = Path(content_root) / "assets" / "generated" / "reading-exams" / f"{final_exam_id}.js"
    text = source_path.read_text(encoding="utf-8")
    marker = ".register("
    marker_at = text.find(marker)
    if marker_at < 0:
        marker_at = text.find("register(")
    if marker_at < 0:
        raise ValueError(f"reading exam register call not found: {source_path}")
    comma_at = text.find(",", marker_at)
    json_start = text.find("{", comma_at)
    if comma_at < 0 or json_start < 0:
        raise ValueError(f"reading exam payload not found: {source_path}")
    dataset, _ = json.JSONDecoder().raw_decode(text[json_start:])
    if not isinstance(dataset, dict):
        raise ValueError(f"reading exam payload is not an object: {source_path}")
    dataset["_sourcePath"] = str(source_path)
    return dataset


def extract_passage(dataset):
    passage = dataset.get("passage") if isinstance(dataset.get("passage"), dict) else {}
    html_chunks = []
    for block in passage.get("blocks") or []:
        if isinstance(block, dict):
            html_chunks.append(block.get("html") or block.get("bodyHtml") or "")
    markup = "\n".join(str(chunk) for chunk in html_chunks if chunk)
    headings = re.findall(r"(?is)<h[1-6][^>]*>(.*?)</h[1-6]>", markup)
    paragraphs = []
    for index, match in enumerate(re.findall(r"(?is)<p[^>]*>(.*?)</p>", markup), start=1):
        raw = match or ""
        label_match = re.match(r"(?is)\s*<strong[^>]*>\s*([A-Z])\s*</strong>\s*", raw)
        text = strip_html_text(raw)
        if not text or text.lower().startswith("you should spend"):
            continue
        label = label_match.group(1) if label_match else None
        if label and text.startswith(label):
            text = text[len(label):].strip()
        paragraphs.append({
            "index": len(paragraphs) + 1,
            "label": label,
            "text": text,
        })
    return {
        "title": strip_html_text(headings[-1]) if headings else compact_text((dataset.get("meta") or {}).get("title")),
        "paragraphs": paragraphs,
        "plainText": strip_html_text(markup),
    }


def html_attribute_patterns(qid):
    escaped = re.escape(str(qid))
    return [
        rf'(?is)<tr\b[^>]*>.*?\b(?:name|id)=["\'][^"\']*{escaped}[^"\']*["\'].*?</tr>',
        rf'(?is)<div\b[^>]*(?:question-item|completion-item)[^>]*>.*?\b(?:name|id)=["\'][^"\']*{escaped}[^"\']*["\'].*?</div>',
        rf'(?is)<p\b[^>]*>.*?\b(?:name|id)=["\'][^"\']*{escaped}[^"\']*["\'].*?</p>',
    ]


def extract_options(markup):
    options = []
    for label_html in re.findall(r"(?is)<label\b[^>]*>(.*?)</label>", markup or ""):
        value_match = re.search(r'(?is)\bvalue=["\']([^"\']+)["\']', label_html)
        option_text = strip_html_text(label_html)
        if option_text:
            options.append({
                "value": html.unescape(value_match.group(1)) if value_match else None,
                "text": option_text,
            })
    return options


def extract_question_text(markup, qid, display_number):
    number = compact_text(display_number).strip()
    for pattern in html_attribute_patterns(qid):
        match = re.search(pattern, markup or "")
        if match:
            return strip_html_text(match.group(0))
    if number:
        row_match = re.search(rf"(?is)<tr\b[^>]*>.*?<strong[^>]*>\s*{re.escape(number)}\s*</strong>.*?</tr>", markup or "")
        if row_match:
            return strip_html_text(row_match.group(0))
        item_match = re.search(rf"(?is)<div\b[^>]*(?:question-item|completion-item)[^>]*>.*?(?:q-number[^>]*>\s*{re.escape(number)}|<strong[^>]*>\s*{re.escape(number)}\s*</strong>).*?</div>", markup or "")
        if item_match:
            return strip_html_text(item_match.group(0))
    prompts = [
        strip_html_text(item)
        for item in re.findall(r"(?is)<p\b[^>]*>(.*?)</p>", markup or "")
        if strip_html_text(item)
    ]
    return " ".join(prompts[-2:]) if prompts else strip_html_text(markup)


def extract_question_groups(dataset):
    display_map = dataset.get("questionDisplayMap") if isinstance(dataset.get("questionDisplayMap"), dict) else {}
    answer_key = dataset.get("answerKey") if isinstance(dataset.get("answerKey"), dict) else {}
    groups = []
    for group in dataset.get("questionGroups") or []:
        if not isinstance(group, dict):
            continue
        markup = group.get("bodyHtml") or group.get("html") or ""
        question_ids = [str(qid) for qid in (group.get("questionIds") or []) if qid]
        groups.append({
            "groupId": group.get("groupId"),
            "kind": group.get("kind"),
            "questionIds": question_ids,
            "instructions": strip_html_text(markup),
            "options": extract_options(markup),
            "questions": [
                {
                    "questionId": qid,
                    "number": display_map.get(qid) or qid,
                    "text": extract_question_text(markup, qid, display_map.get(qid) or qid),
                    "correctAnswer": answer_key.get(qid),
                }
                for qid in question_ids
            ],
        })
    return groups


def normalize_answer_detail_map(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        result = {}
        for item in value:
            if isinstance(item, dict):
                qid = item.get("questionId") or item.get("id") or item.get("qid")
                if qid:
                    result[str(qid)] = item
        return result
    return {}


def get_nested_answer_maps(entry):
    score_info = entry.get("scoreInfo") if isinstance(entry.get("scoreInfo"), dict) else {}
    return [
        normalize_answer_detail_map(entry.get("answerComparison")),
        normalize_answer_detail_map(entry.get("answerDetails")),
        normalize_answer_detail_map(score_info.get("details")),
        normalize_answer_detail_map(score_info.get("answerDetails")),
    ]


def pick_first(*values):
    for value in values:
        if value is not None and value != "":
            return value
    return None


def get_answer_detail(entry, qid, exam_id, answer_key, parent_record=None):
    qid = str(qid)
    detail = {}
    for answer_map in get_nested_answer_maps(entry):
        if qid in answer_map and isinstance(answer_map[qid], dict):
            detail.update(answer_map[qid])
    answers = entry.get("answers") if isinstance(entry.get("answers"), dict) else {}
    correct_map = entry.get("correctAnswerMap") if isinstance(entry.get("correctAnswerMap"), dict) else {}
    user_answer = pick_first(detail.get("userAnswer"), detail.get("user"), detail.get("answer"), detail.get("selectedAnswer"), answers.get(qid))
    correct_answer = pick_first(detail.get("correctAnswer"), detail.get("standardAnswer"), detail.get("expectedAnswer"), correct_map.get(qid), answer_key.get(qid))
    is_correct = detail.get("isCorrect")
    if is_correct is None and detail.get("correct") is not None:
        is_correct = detail.get("correct")
    wrong_reason = get_wrong_reason_for_export(entry, exam_id, qid, detail, parent_record)
    return {
        "questionId": qid,
        "userAnswer": user_answer,
        "correctAnswer": correct_answer,
        "isCorrect": bool(is_correct) if isinstance(is_correct, bool) else is_correct,
        "wrongReason": wrong_reason,
    }


def get_wrong_reason_for_export(entry, exam_id, qid, detail=None, parent_record=None):
    detail = detail if isinstance(detail, dict) else {}
    if isinstance(detail.get("wrongReason"), dict):
        return detail.get("wrongReason")
    candidates = [qid, str(qid), f"{exam_id}::{qid}", f"{exam_id}:{qid}"]
    sources = [entry, parent_record]
    for source in sources:
        if not isinstance(source, dict):
            continue
        wrong_reasons = source.get("wrongReasons") if isinstance(source.get("wrongReasons"), dict) else {}
        for key in candidates:
            if key in wrong_reasons:
                return wrong_reasons.get(key)
    return None


def collect_question_ids(entry, dataset):
    ordered = []
    for source in (
        dataset.get("questionOrder") if isinstance(dataset, dict) else None,
        (dataset.get("answerKey") or {}).keys() if isinstance(dataset.get("answerKey"), dict) else None,
        (entry.get("answers") or {}).keys() if isinstance(entry.get("answers"), dict) else None,
        normalize_answer_detail_map(entry.get("answerComparison")).keys(),
        normalize_answer_detail_map((entry.get("scoreInfo") or {}).get("details") if isinstance(entry.get("scoreInfo"), dict) else None).keys(),
    ):
        if not source:
            continue
        for qid in source:
            text = str(qid)
            if text and text not in ordered:
                ordered.append(text)
    return ordered


def build_passage_export(entry, content_root, parent_record=None):
    metadata = entry.get("metadata") if isinstance(entry.get("metadata"), dict) else {}
    score_info = entry.get("scoreInfo") if isinstance(entry.get("scoreInfo"), dict) else {}
    exam_id = record_exam_id(entry) or metadata.get("examId") or entry.get("dataKey")
    try:
        dataset = load_reading_exam_dataset(content_root, exam_id)
        source_missing = False
        source_error = None
    except Exception as error:
        dataset = {"meta": {"title": entry.get("title") or metadata.get("examTitle") or "", "examId": exam_id}, "answerKey": {}}
        source_missing = True
        source_error = str(error)

    answer_key = dataset.get("answerKey") if isinstance(dataset.get("answerKey"), dict) else {}
    answer_rows = [get_answer_detail(entry, qid, exam_id, answer_key, parent_record) for qid in collect_question_ids(entry, dataset)]
    wrong_rows = [
        row for row in answer_rows
        if row.get("isCorrect") is False or row.get("wrongReason")
    ]
    return {
        "examId": exam_id,
        "title": entry.get("title") or metadata.get("examTitle") or (dataset.get("meta") or {}).get("title") or "",
        "category": metadata.get("category") or entry.get("category") or (dataset.get("meta") or {}).get("category"),
        "sourceFile": dataset.get("_sourcePath"),
        "sourceMissing": source_missing,
        "sourceError": source_error,
        "scoreInfo": {
            "score": score_info.get("score", entry.get("score")),
            "totalQuestions": score_info.get("total", entry.get("totalQuestions")),
            "correctAnswers": score_info.get("correct", entry.get("score", entry.get("correctAnswers"))),
            "accuracy": score_info.get("accuracy", entry.get("accuracy")),
            "percentage": score_info.get("percentage", entry.get("percentage")),
            "duration": entry.get("duration", score_info.get("duration", score_info.get("timeSpent"))),
        },
        "passage": extract_passage(dataset),
        "questionGroups": extract_question_groups(dataset),
        "answers": answer_rows,
        "wrongQuestions": wrong_rows,
    }


def build_record_full_wrong_export(record, content_root):
    score_info = record.get("scoreInfo") if isinstance(record.get("scoreInfo"), dict) else {}
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
    suite_entries = record.get("suiteEntries") if isinstance(record.get("suiteEntries"), list) else []
    entries = suite_entries if suite_entries else [record]
    return {
        "recordId": str(record.get("id") or record.get("sessionId") or ""),
        "sessionId": record.get("sessionId"),
        "suiteSessionId": record.get("suiteSessionId") or metadata.get("suiteSessionId"),
        "title": record.get("title") or metadata.get("examTitle") or "",
        "recordDate": record.get("date") or record.get("endTime") or record.get("startTime"),
        "duration": record.get("duration", score_info.get("duration", score_info.get("timeSpent", 0))) or 0,
        "score": score_info.get("score", record.get("score")),
        "totalQuestions": record.get("totalQuestions", score_info.get("total")),
        "correctAnswers": score_info.get("correct", record.get("score", record.get("correctAnswers"))),
        "accuracy": record.get("accuracy", score_info.get("accuracy")),
        "percentage": record.get("percentage", score_info.get("percentage")),
        "passages": [build_passage_export(entry, content_root, record) for entry in entries if isinstance(entry, dict)],
    }


def build_full_wrong_export(records, content_root):
    final_records = [record for record in records if isinstance(record, dict)]
    exported = [build_record_full_wrong_export(record, content_root) for record in final_records]
    return {
        "schemaVersion": "PracticeFullWrongExportV1",
        "generatedAt": now_iso(),
        "source": "sqlite-on-demand",
        "recordCount": len(exported),
        "records": exported,
    }


def normalize_vocab_state_payload(payload):
    if not isinstance(payload, dict):
        return None
    vocab_state = payload.get("vocab_state")
    if vocab_state is None:
        vocab_state = payload.get("vocabState")
    return vocab_state if isinstance(vocab_state, dict) else None


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

    def get_records_by_ids(self, record_ids):
        final_ids = [str(value).strip() for value in (record_ids or []) if value is not None and str(value).strip()]
        if not final_ids:
            return self.list_records()
        records = []
        with self.connect() as conn:
            for record_id in final_ids:
                row = conn.execute("SELECT payload FROM practice_records WHERE id = ?", (record_id,)).fetchone()
                if not row:
                    continue
                try:
                    records.append(json.loads(row["payload"]))
                except Exception:
                    continue
        return records

    def export_full_wrong_records(self, record_ids=None, content_root=None):
        records = self.get_records_by_ids(record_ids)
        root = Path(content_root or Path.cwd()).resolve()
        return build_full_wrong_export(records, root)

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
    latest = Path(backup_dir) / LATEST_FILENAME
    if not latest.is_file():
        return {"seeded": False, "reason": "latest backup not found", "recordCount": store.count_records()}
    payload = json.loads(latest.read_text(encoding="utf-8"))
    existing_vocab_state = store.read_meta("vocab_state", None)
    vocab_state = normalize_vocab_state_payload(payload)
    vocab_state_seeded = False
    if existing_vocab_state is None and vocab_state:
        store.write_meta("vocab_state", vocab_state)
        vocab_state_seeded = True

    record_count = store.count_records()
    if record_count > 0:
        return {
            "seeded": False,
            "reason": "database already has records",
            "recordCount": record_count,
            "vocabStateSeeded": vocab_state_seeded,
        }

    records = normalize_records_payload(payload)
    if not records:
        return {
            "seeded": False,
            "reason": "latest backup has no records",
            "recordCount": 0,
            "vocabStateSeeded": vocab_state_seeded,
        }
    final_records = store.replace_records(records)
    stats = normalize_stats_payload(payload)
    if stats:
        store.write_meta("user_stats", stats)
    return {
        "seeded": True,
        "recordCount": len(final_records),
        "backup": str(latest),
        "vocabStateSeeded": vocab_state_seeded,
    }


class LocalBackupHandler(SimpleHTTPRequestHandler):
    backup_dir = Path(DEFAULT_BACKUP_DIR)
    content_root = Path.cwd()
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
            if method == "POST" and path == "/api/sqlite/practice-records/full-wrong-export":
                ids = body.get("ids") if isinstance(body, dict) else []
                export = store.export_full_wrong_records(ids, self.content_root)
                self.send_json(200, {
                    "ok": True,
                    "export": export,
                    "count": export.get("recordCount", 0) if isinstance(export, dict) else 0,
                })
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
    LocalBackupHandler.content_root = root
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
