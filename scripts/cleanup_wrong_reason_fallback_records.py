from pathlib import Path
import argparse
import json

from local_backup_server import (
    DEFAULT_BACKUP_DIR,
    DEFAULT_DB_FILENAME,
    PracticeSqliteStore,
    apply_wrong_reason_update,
    collect_wrong_reasons,
    is_wrong_reason_fallback_record,
    record_contains_questions,
    record_exam_id,
    record_matches_wrong_reason_identity,
    record_timestamp,
    resolve_wrong_reason_record,
    sort_wrong_reason_candidates,
)


def get_record_title(record):
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
    real_data = record.get("realData") if isinstance(record.get("realData"), dict) else {}
    return record.get("title") or record.get("examTitle") or metadata.get("examTitle") or metadata.get("title") or real_data.get("title") or ""


def build_payload_from_fallback(record):
    wrong_reasons = collect_wrong_reasons(record)
    return {
        "recordId": None,
        "sessionId": None,
        "suiteSessionId": None,
        "examId": record_exam_id(record),
        "dataKey": record_exam_id(record),
        "title": get_record_title(record),
        "examTitle": get_record_title(record),
        "wrongReasons": wrong_reasons,
        "updatedAt": record.get("updatedAt") or record_timestamp(record),
    }


def resolve_target(records, fallback_record, payload):
    target, reason = resolve_wrong_reason_record(records, payload)
    if target and not is_wrong_reason_fallback_record(target):
        return target, reason

    exam_id = payload.get("examId") or payload.get("dataKey") or ""
    title = payload.get("title") or payload.get("examTitle") or ""
    question_ids = list((payload.get("wrongReasons") or {}).keys())
    candidates = [
        record
        for record in records
        if record is not fallback_record
        and not is_wrong_reason_fallback_record(record)
        and record_matches_wrong_reason_identity(record, exam_id, title)
    ]
    question_matches = [
        record for record in sort_wrong_reason_candidates(candidates)
        if record_contains_questions(record, question_ids, exam_id)
    ]
    if question_matches:
        return question_matches[0], "cleanup-question-match"
    if len(candidates) == 1:
        return candidates[0], "cleanup-only-match"
    return None, reason


def cleanup(db_path, backup_dir):
    store = PracticeSqliteStore(db_path)
    records = store.list_records()
    fallback_records = [record for record in records if is_wrong_reason_fallback_record(record)]
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / "pre-wrongreason-fallback-cleanup.json"
    with backup_path.open("w", encoding="utf-8") as handle:
        json.dump({"records": records}, handle, ensure_ascii=False, indent=2)

    records_by_id = {str(record.get("id") or record.get("sessionId") or ""): record for record in records if isinstance(record, dict)}
    deleted_ids = []
    merged = []
    skipped = []

    for fallback_record in fallback_records:
        fallback_id = str(fallback_record.get("id") or fallback_record.get("sessionId") or "")
        payload = build_payload_from_fallback(fallback_record)
        if not payload["wrongReasons"]:
            deleted_ids.append(fallback_id)
            continue
        target, reason = resolve_target(list(records_by_id.values()), fallback_record, payload)
        if not target:
            skipped.append({"id": fallback_id, "reason": reason, "examId": payload.get("examId"), "title": payload.get("title")})
            continue
        target_id = str(target.get("id") or target.get("sessionId") or "")
        before = {
            "duration": target.get("duration"),
            "accuracy": target.get("accuracy"),
            "totalQuestions": target.get("totalQuestions"),
            "correctAnswers": target.get("correctAnswers"),
            "score": target.get("score"),
            "date": target.get("date"),
            "startTime": target.get("startTime"),
            "endTime": target.get("endTime"),
        }
        records_by_id[target_id] = apply_wrong_reason_update(target, payload["wrongReasons"], payload)
        deleted_ids.append(fallback_id)
        merged.append({
            "from": fallback_id,
            "to": target_id,
            "matchReason": reason,
            "questionIds": list(payload["wrongReasons"].keys()),
            "preserved": before,
        })

    final_records = [record for record_id, record in records_by_id.items() if record_id not in set(deleted_ids)]
    store.replace_records(final_records)

    return {
        "backup": str(backup_path),
        "found": len(fallback_records),
        "merged": merged,
        "deletedIds": deleted_ids,
        "skipped": skipped,
        "finalCount": len(final_records),
    }


def main():
    parser = argparse.ArgumentParser(description="Merge wrong-reason fallback records into completed practice records.")
    parser.add_argument("--backup-dir", default=DEFAULT_BACKUP_DIR)
    parser.add_argument("--db-path", default="")
    args = parser.parse_args()
    backup_dir = Path(args.backup_dir).resolve()
    db_path = Path(args.db_path).resolve() if args.db_path else (backup_dir / DEFAULT_DB_FILENAME).resolve()
    print(json.dumps(cleanup(db_path, backup_dir), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
