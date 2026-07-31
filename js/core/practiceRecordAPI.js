(function initPracticeRecordAPI(global) {
    'use strict';

    const DEFAULT_VERSION = '0.6.2-fix';
    const DEFAULT_MAX_RECORDS = 1000;

    if (global.PracticeRecordAPI && global.PracticeRecordAPI.__stable === true) {
        return;
    }

    let recordStore = null;

    function getPracticeCore() {
        return global.PracticeCore || null;
    }

    function installRecordStore() {
        if (recordStore) {
            return recordStore;
        }
        const core = getPracticeCore();
        if (!core || typeof core.__installRecordAPI !== 'function') {
            return null;
        }
        recordStore = core.__installRecordAPI((store) => store || null);
        try {
            delete core.__installRecordAPI;
        } catch (_) {
            core.__installRecordAPI = undefined;
        }
        return recordStore;
    }

    function getRecordStore() {
        return recordStore || installRecordStore();
    }

    installRecordStore();

    let backendSeedPromise = null;
    let backendSeedChecked = false;

    function getSqliteBackend() {
        const backend = global.SqlitePracticeBackend;
        return backend && backend.__stable === true ? backend : null;
    }

    async function getAvailableSqliteBackend(options = {}) {
        const backend = getSqliteBackend();
        if (!backend || typeof backend.isAvailable !== 'function') {
            return null;
        }
        try {
            return await backend.isAvailable(options) ? backend : null;
        } catch (error) {
            console.warn('[SqliteBackend] status failed, fallback to browser storage:', error);
            return null;
        }
    }

    function syncPracticeRecordState(records) {
        const store = getRecordStore();
        if (store && typeof store.syncPracticeRecordState === 'function') {
            try {
                store.syncPracticeRecordState(Array.isArray(records) ? records : []);
            } catch (error) {
                console.warn('[SqliteBackend] sync state failed:', error);
            }
        }
    }

    async function seedSqliteBackendFromLocalIfNeeded(backend) {
        if (!backend || backendSeedChecked) {
            return;
        }
        if (!backendSeedPromise) {
            backendSeedPromise = (async () => {
                const store = getRecordStore();
                if (!store || typeof store.listPracticeRecords !== 'function') {
                    backendSeedChecked = true;
                    return;
                }
                let backendCount = null;
                try {
                    backendCount = typeof backend.count === 'function'
                        ? await backend.count()
                        : null;
                } catch (error) {
                    console.warn('[SqliteBackend] count failed:', error);
                    backendSeedChecked = true;
                    return;
                }
                if (Number(backendCount) > 0) {
                    backendSeedChecked = true;
                    return;
                }
                let localRecords = [];
                try {
                    localRecords = await store.listPracticeRecords();
                } catch (error) {
                    console.warn('[SqliteBackend] local seed read failed:', error);
                }
                if (!Array.isArray(localRecords) || localRecords.length === 0) {
                    backendSeedChecked = true;
                    return;
                }
                const localStats = store && typeof store.readMeta === 'function'
                    ? await store.readMeta('user_stats', null).catch(() => null)
                    : null;
                await backend.replace(localRecords, { maxRecords: DEFAULT_MAX_RECORDS });
                if (isPlainObject(localStats) && hasMeaningfulStats(localStats)) {
                    await backend.writeMeta('user_stats', localStats);
                }
                console.info('[SqliteBackend] seeded from browser records:', {
                    recordCount: localRecords.length,
                    statsSeeded: isPlainObject(localStats)
                });
                backendSeedChecked = true;
            })().finally(() => {
                backendSeedPromise = null;
            });
        }
        await backendSeedPromise;
    }

    async function withSqliteBackend(operation, fallback, options = {}) {
        const backend = await getAvailableSqliteBackend(options.status || {});
        if (!backend) {
            return await fallback();
        }
        try {
            await seedSqliteBackendFromLocalIfNeeded(backend);
            const result = await operation(backend);
            if (result !== null && result !== undefined) {
                return result;
            }
        } catch (error) {
            console.warn('[SqliteBackend] operation failed, fallback to browser storage:', error);
        }
        return await fallback();
    }

    function getDefaultSaveOptions(options = {}) {
        const source = options && typeof options === 'object' ? options : {};
        const normalized = {
            currentVersion: source.currentVersion || DEFAULT_VERSION,
            maxRecords: DEFAULT_MAX_RECORDS
        };
        const maxRecords = Number(source.maxRecords);
        if (Number.isFinite(maxRecords) && maxRecords > 0) {
            normalized.maxRecords = maxRecords;
        }
        Object.keys(source).forEach((key) => {
            if (source[key] !== undefined) {
                normalized[key] = source[key];
            }
        });
        normalized.currentVersion = normalized.currentVersion || DEFAULT_VERSION;
        normalized.maxRecords = Number.isFinite(Number(normalized.maxRecords)) && Number(normalized.maxRecords) > 0
            ? Number(normalized.maxRecords)
            : DEFAULT_MAX_RECORDS;
        return normalized;
    }

    function toIdString(value) {
        return value == null ? '' : String(value);
    }

    function isPlainObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value);
    }

    function clonePlainObject(value) {
        if (value == null || typeof value !== 'object') {
            return value ?? null;
        }
        if (Array.isArray(value)) {
            return value.map((item) => clonePlainObject(item));
        }
        const clone = {};
        Object.keys(value).forEach((key) => {
            clone[key] = clonePlainObject(value[key]);
        });
        return clone;
    }

    function normalizeWrongReason(value) {
        const source = value && typeof value === 'object'
            ? value
            : { category: value };
        const category = source.category ?? source.reason ?? source.type;
        const note = source.note ?? source.detail ?? source.text;
        const normalizedCategory = category == null ? '' : String(category).trim();
        const normalizedNote = note == null ? '' : String(note).trim();
        if (!normalizedCategory && !normalizedNote) {
            return null;
        }
        return {
            category: normalizedCategory,
            note: normalizedNote,
            updatedAt: source.updatedAt || new Date().toISOString()
        };
    }

    function normalizeWrongReasonMap(value) {
        if (!value || typeof value !== 'object') {
            return {};
        }
        const normalized = {};
        Object.entries(value).forEach(([questionId, reason]) => {
            const normalizedReason = normalizeWrongReason(reason);
            if (normalizedReason) {
                normalized[questionId] = normalizedReason;
            }
        });
        return normalized;
    }

    function isWrongReasonFallbackRecord(record) {
        return Boolean(
            record && typeof record === 'object'
            && (
                record.source === 'wrong-reason-fallback'
                || record.metadata?.source === 'wrong-reason-fallback'
                || record.realData?.source === 'wrong-reason-fallback'
            )
        );
    }

    function deriveExamIdFromSessionId(value) {
        const text = String(value || '').trim();
        if (!text) {
            return '';
        }
        const match = text.match(/^([pc]\d-(?:low|medium|high)-\d+)(?:_|$)/i);
        return match ? match[1] : '';
    }

    function getRecordExamId(record = {}) {
        const metadata = record.metadata || {};
        const realData = record.realData || {};
        return String(
            record.examId
            || record.dataKey
            || record.derivedExamId
            || metadata.examId
            || metadata.dataKey
            || metadata.derivedExamId
            || realData.examId
            || realData.dataKey
            || realData.derivedExamId
            || deriveExamIdFromSessionId(record.sessionId)
            || deriveExamIdFromSessionId(record.id)
            || ''
        ).trim();
    }

    function normalizeRecordTitle(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[’‘]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/[\s\-_/]+/g, ' ')
            .replace(/^[pc]\s*[123]\s*(low|medium|high|次高频|高频|中频|低频)?\s*/i, '')
            .trim();
    }

    function getRecordTitle(record = {}) {
        const metadata = record.metadata || {};
        const realData = record.realData || {};
        return normalizeRecordTitle(record.title || record.examTitle || metadata.examTitle || metadata.title || realData.title || realData.examTitle || '');
    }

    function recordsShareWrongReasonIdentity(left, right) {
        const leftExamId = getRecordExamId(left);
        const rightExamId = getRecordExamId(right);
        if (leftExamId && rightExamId && leftExamId === rightExamId) {
            return true;
        }
        const leftTitle = getRecordTitle(left);
        const rightTitle = getRecordTitle(right);
        return Boolean(
            leftTitle
            && rightTitle
            && (
                leftTitle === rightTitle
                || (leftTitle.length >= 12 && rightTitle.includes(leftTitle))
                || (rightTitle.length >= 12 && leftTitle.includes(rightTitle))
            )
        );
    }

    function collectWrongReasonsFromRecord(record) {
        return Object.assign(
            {},
            normalizeWrongReasonMap(record && record.wrongReasons),
            normalizeWrongReasonMap(record && record.realData && record.realData.wrongReasons),
            normalizeWrongReasonMap(record && record.rawData && record.rawData.wrongReasons)
        );
    }

    function recordContainsAnyQuestion(record, questionIds = []) {
        const ids = questionIds.map(String).filter(Boolean);
        if (ids.length === 0) {
            return true;
        }
        const maps = [
            record && record.answerComparison,
            record && record.answerDetails,
            record && record.scoreInfo && record.scoreInfo.details,
            record && record.realData && record.realData.answerComparison,
            record && record.realData && record.realData.answerDetails,
            record && record.realData && record.realData.scoreInfo && record.realData.scoreInfo.details,
            record && record.rawData && record.rawData.answerComparison,
            record && record.rawData && record.rawData.answerDetails,
            record && record.rawData && record.rawData.scoreInfo && record.rawData.scoreInfo.details
        ];
        return ids.some((questionId) => maps.some((map) => map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, questionId)));
    }

    function getWrongReasonRecordQuality(record) {
        if (!record || typeof record !== 'object') {
            return -1000;
        }
        const totalQuestions = Number(record.totalQuestions ?? record.scoreInfo?.total ?? record.realData?.totalQuestions ?? record.realData?.scoreInfo?.total ?? 0);
        const duration = Number(record.duration ?? record.scoreInfo?.duration ?? record.scoreInfo?.timeSpent ?? record.realData?.duration ?? 0);
        const answerCount = record.answerComparison && typeof record.answerComparison === 'object'
            ? Object.keys(record.answerComparison).length
            : 0;
        let score = isWrongReasonFallbackRecord(record) ? -1000 : 0;
        if (Number.isFinite(duration) && duration > 0) {
            score += 100;
        }
        if (Number.isFinite(totalQuestions) && totalQuestions > 1) {
            score += 50;
        }
        if (answerCount > 1) {
            score += 25;
        }
        return score;
    }

    function applyWrongReasonsToExistingRecord(record, incomingReasons) {
        const next = clonePlainObject(record);
        const mergedReasons = Object.assign({}, collectWrongReasonsFromRecord(next), incomingReasons || {});
        next.wrongReasons = mergedReasons;
        if (next.realData && typeof next.realData === 'object') {
            next.realData.wrongReasons = Object.assign({}, normalizeWrongReasonMap(next.realData.wrongReasons), mergedReasons);
        }
        [next.answerComparison, next.answerDetails, next.scoreInfo && next.scoreInfo.details, next.realData && next.realData.answerComparison, next.realData && next.realData.scoreInfo && next.realData.scoreInfo.details]
            .forEach((map) => {
                if (!map || typeof map !== 'object') {
                    return;
                }
                Object.entries(incomingReasons || {}).forEach(([questionId, reason]) => {
                    if (map[questionId] && typeof map[questionId] === 'object') {
                        map[questionId].wrongReason = reason;
                    }
                });
            });
        return next;
    }

    function mergeWrongReasonFallbackRecords(records) {
        const source = Array.isArray(records) ? records : [];
        const fallbackRecords = source.filter(isWrongReasonFallbackRecord);
        if (fallbackRecords.length === 0) {
            return source;
        }
        const finalRecords = source.filter((record) => !isWrongReasonFallbackRecord(record));
        fallbackRecords.forEach((fallbackRecord) => {
            const wrongReasons = collectWrongReasonsFromRecord(fallbackRecord);
            const questionIds = Object.keys(wrongReasons);
            if (questionIds.length === 0) {
                return;
            }
            const targetIndex = finalRecords
                .map((record, index) => ({ record, index }))
                .filter(({ record }) => recordsShareWrongReasonIdentity(record, fallbackRecord))
                .sort((a, b) => {
                    const questionDiff = Number(recordContainsAnyQuestion(b.record, questionIds)) - Number(recordContainsAnyQuestion(a.record, questionIds));
                    if (questionDiff) {
                        return questionDiff;
                    }
                    const qualityDiff = getWrongReasonRecordQuality(b.record) - getWrongReasonRecordQuality(a.record);
                    if (qualityDiff) {
                        return qualityDiff;
                    }
                    return getRecordTimestamp(b.record) - getRecordTimestamp(a.record);
                })[0]?.index;
            if (targetIndex === undefined) {
                return;
            }
            finalRecords[targetIndex] = applyWrongReasonsToExistingRecord(finalRecords[targetIndex], wrongReasons);
        });
        finalRecords.sort((a, b) => getRecordTimestamp(b) - getRecordTimestamp(a));
        return finalRecords;
    }

    async function readLocalWrongReasonFallbackRecords() {
        const store = getRecordStore();
        if (!store || typeof store.listPracticeRecords !== 'function') {
            return [];
        }
        try {
            const records = await store.listPracticeRecords();
            return (Array.isArray(records) ? records : []).filter(isWrongReasonFallbackRecord);
        } catch (error) {
            console.warn('[PracticeRecordAPI] 本地错因占位记录读取失败:', error);
            return [];
        }
    }

    function buildWrongReasonMergeSignature(records) {
        return JSON.stringify((Array.isArray(records) ? records : []).map((record) => ({
            id: record && (record.id || record.sessionId || ''),
            wrongReasons: collectWrongReasonsFromRecord(record)
        })));
    }

    function getDefaultStats() {
        if (global.ExamData && typeof global.ExamData.createDefaultUserStats === 'function') {
            return clonePlainObject(global.ExamData.createDefaultUserStats());
        }
        const now = new Date().toISOString();
        return {
            totalPractices: 0,
            totalTimeSpent: 0,
            averageScore: 0,
            categoryStats: {},
            questionTypeStats: {},
            streakDays: 0,
            practiceDays: [],
            lastPracticeDate: null,
            achievements: [],
            createdAt: now,
            updatedAt: now
        };
    }

    function toCamelCaseKey(key) {
        return String(key)
            .replace(/[-_\s]+([a-zA-Z0-9])/g, (_, group) => group.toUpperCase())
            .replace(/^[A-Z]/, match => match.toLowerCase());
    }

    function normalizeStatsAliases(stats) {
        if (!isPlainObject(stats)) {
            return {};
        }
        const normalized = {};
        Object.entries(stats).forEach(([key, value]) => {
            normalized[toCamelCaseKey(key)] = value;
        });
        return normalized;
    }

    function prepareStats(stats) {
        const source = normalizeStatsAliases(stats);
        const prepared = Object.assign({}, getDefaultStats(), clonePlainObject(source));
        prepared.categoryStats = isPlainObject(source.categoryStats) ? clonePlainObject(source.categoryStats) : {};
        prepared.questionTypeStats = isPlainObject(source.questionTypeStats) ? clonePlainObject(source.questionTypeStats) : {};
        prepared.practiceDays = Array.isArray(source.practiceDays) ? source.practiceDays.slice() : [];
        prepared.achievements = Array.isArray(source.achievements) ? source.achievements.slice() : [];
        prepared.updatedAt = source.updatedAt || new Date().toISOString();
        return prepared;
    }

    function getCoreContracts() {
        const core = getPracticeCore();
        return core && core.contracts ? core.contracts : null;
    }

    function normalizeRecord(record, options = {}) {
        if (!isPlainObject(record)) {
            return null;
        }

        const contracts = getCoreContracts();
        if (!contracts || typeof contracts.standardizeRecord !== 'function') {
            throw new Error('PracticeRecordAPI.normalizeRecord: PracticeCore.contracts.standardizeRecord not ready');
        }

        const preserveIds = options.preserveIds !== false;
        const safePrefix = options.fallbackIdPrefix || 'record';
        const sourceId = record.id
            ?? record.recordId
            ?? record.record_id
            ?? record.practiceId
            ?? record.practice_id
            ?? record.sessionId
            ?? record.sessionID
            ?? record.timestamp
            ?? record.uuid;
        const candidate = clonePlainObject(record) || {};

        let id = preserveIds && sourceId ? String(sourceId).trim() : '';
        if (!id) {
            const index = Number.isFinite(Number(options.index)) ? Number(options.index) : 0;
            id = `${safePrefix}_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`;
        }
        candidate.id = id;

        if (record.recordStatus !== undefined && candidate.status === undefined) {
            candidate.status = record.recordStatus;
        }

        const generateRecordId = typeof options.generateRecordId === 'function'
            ? options.generateRecordId
            : () => id;
        const standardized = contracts.standardizeRecord(candidate, Object.assign({}, options, {
            currentVersion: options.currentVersion || DEFAULT_VERSION,
            generateRecordId
        }));
        return standardized && standardized.examId ? standardized : null;
    }

    function normalizeDateValue(value) {
        if (!value) {
            return null;
        }
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return value.toISOString();
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return new Date(value).toISOString();
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) {
                return null;
            }
            if (/^\d+$/.test(trimmed)) {
                const numeric = Number(trimmed);
                if (Number.isFinite(numeric)) {
                    const milliseconds = trimmed.length > 10 ? numeric : numeric * 1000;
                    return new Date(milliseconds).toISOString();
                }
            }
            const parsed = new Date(trimmed);
            if (!Number.isNaN(parsed.getTime())) {
                return parsed.toISOString();
            }
        }
        return null;
    }

    function getRecordTimestamp(record) {
        if (!record || typeof record !== 'object') {
            return 0;
        }
        const candidates = [
            record.updatedAt,
            record.createdAt,
            record.endTime,
            record.startTime,
            record.timestamp,
            record.date
        ];
        for (let index = 0; index < candidates.length; index += 1) {
            const iso = normalizeDateValue(candidates[index]);
            if (iso) {
                const time = new Date(iso).getTime();
                if (Number.isFinite(time)) {
                    return time;
                }
            }
        }
        return 0;
    }

    function mergeRecordDetails(existing, incoming, options = {}) {
        const merged = Object.assign({}, existing || {}, incoming || {});
        if (isPlainObject(existing && existing.metadata) || isPlainObject(incoming && incoming.metadata)) {
            merged.metadata = Object.assign(
                {},
                isPlainObject(existing && existing.metadata) ? existing.metadata : {},
                isPlainObject(incoming && incoming.metadata) ? incoming.metadata : {}
            );
        }
        if (isPlainObject(existing && existing.realData) || isPlainObject(incoming && incoming.realData)) {
            merged.realData = Object.assign(
                {},
                isPlainObject(existing && existing.realData) ? existing.realData : {},
                isPlainObject(incoming && incoming.realData) ? incoming.realData : {}
            );
        }
        return normalizeRecord(merged, Object.assign({}, options, {
            generateRecordId: () => String(merged.id || (incoming && incoming.id) || (existing && existing.id) || `record_${Date.now()}`)
        }));
    }

    async function readStats(options = {}) {
        const fallback = Object.prototype.hasOwnProperty.call(options, 'fallback')
            ? options.fallback
            : getDefaultStats();

        return await withSqliteBackend(
            async (backend) => prepareStats(await backend.readMeta('user_stats', fallback)),
            async () => {
                const store = getRecordStore();
                if (!store || typeof store.readMeta !== 'function') {
                    throw new Error('PracticeRecordAPI.readStats: unified meta store not ready');
                }

                return prepareStats(await store.readMeta('user_stats', fallback));
            }
        );
    }

    async function writeStats(stats) {
        const finalStats = prepareStats(stats);
        return await withSqliteBackend(
            async (backend) => {
                await backend.writeMeta('user_stats', finalStats);
                return finalStats;
            },
            async () => {
                const store = getRecordStore();

                if (store && typeof store.writeMeta === 'function') {
                    await store.writeMeta('user_stats', finalStats);
                    return finalStats;
                }

                throw new Error('PracticeRecordAPI.writeStats: unified meta store not ready');
            }
        );
    }

    function normalizeDay(value) {
        if (!value) return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date.toISOString().slice(0, 10);
    }

    function calculateStreakDays(days) {
        const sorted = Array.isArray(days) ? days.slice().sort() : [];
        if (sorted.length === 0) return 0;
        let streak = 1;
        for (let index = sorted.length - 1; index > 0; index -= 1) {
            const current = new Date(sorted[index]);
            const previous = new Date(sorted[index - 1]);
            const diffDays = Math.round((current - previous) / 86400000);
            if (diffDays === 1) {
                streak += 1;
                continue;
            }
            if (diffDays > 1) break;
        }
        return streak;
    }

    function hasMeaningfulStats(stats) {
        if (!isPlainObject(stats)) {
            return false;
        }
        if (Number(stats.totalPractices) > 0 || Number(stats.totalTimeSpent) > 0) {
            return true;
        }
        if (Array.isArray(stats.practiceDays) && stats.practiceDays.length > 0) {
            return true;
        }
        return Number(stats.streakDays) > 0 || Number(stats.averageScore) > 0;
    }

    function normalizeAccuracyForStats(record) {
        const values = [
            record && record.accuracy,
            record && record.scoreInfo && record.scoreInfo.accuracy,
            record && record.realData && record.realData.scoreInfo && record.realData.scoreInfo.accuracy
        ];
        for (let index = 0; index < values.length; index += 1) {
            const numeric = Number(values[index]);
            if (Number.isFinite(numeric)) {
                if (numeric > 1 && numeric <= 100) {
                    return numeric / 100;
                }
                return Math.max(0, Math.min(1, numeric));
            }
        }
        const correct = Number(record && (record.correctAnswers ?? record.scoreInfo?.correct ?? record.score));
        const total = Number(record && (record.totalQuestions ?? record.scoreInfo?.total));
        return Number.isFinite(correct) && Number.isFinite(total) && total > 0
            ? Math.max(0, Math.min(1, correct / total))
            : 0;
    }

    function applyRecordToStats(stats, record) {
        if (!stats || !record || typeof record !== 'object') {
            return;
        }

        const duration = Math.max(0, Number(record.duration) || 0);
        const accuracy = normalizeAccuracyForStats(record);
        const category = String((record.metadata && record.metadata.category) || record.category || record.type || '').trim();
        const day = normalizeDay(record.date || record.endTime || record.startTime || record.createdAt);

        stats.totalPractices += 1;
        stats.totalTimeSpent += duration;
        const totalScore = (stats.averageScore * (stats.totalPractices - 1)) + accuracy;
        stats.averageScore = stats.totalPractices > 0 ? totalScore / stats.totalPractices : 0;

        stats.categoryStats = isPlainObject(stats.categoryStats) ? stats.categoryStats : {};
        if (category) {
            if (!stats.categoryStats[category]) {
                stats.categoryStats[category] = {
                    practices: 0,
                    avgScore: 0,
                    timeSpent: 0,
                    bestScore: 0,
                    totalQuestions: 0,
                    correctAnswers: 0
                };
            }
            const categoryStats = stats.categoryStats[category];
            categoryStats.practices += 1;
            categoryStats.timeSpent += duration;
            categoryStats.bestScore = Math.max(categoryStats.bestScore || 0, accuracy);
            categoryStats.totalQuestions += Number(record.totalQuestions) || 0;
            categoryStats.correctAnswers += Number(record.correctAnswers) || 0;
            categoryStats.avgScore = ((categoryStats.avgScore || 0) * (categoryStats.practices - 1) + accuracy) / categoryStats.practices;
        }

        stats.questionTypeStats = isPlainObject(stats.questionTypeStats) ? stats.questionTypeStats : {};
        if (isPlainObject(record.questionTypePerformance)) {
            Object.entries(record.questionTypePerformance).forEach(([type, performance]) => {
                if (!stats.questionTypeStats[type]) {
                    stats.questionTypeStats[type] = {
                        practices: 0,
                        accuracy: 0,
                        totalQuestions: 0,
                        correctAnswers: 0
                    };
                }
                const typeStats = stats.questionTypeStats[type];
                typeStats.practices += 1;
                typeStats.totalQuestions += Number(performance && performance.total) || 0;
                typeStats.correctAnswers += Number(performance && performance.correct) || 0;
                typeStats.accuracy = typeStats.totalQuestions > 0
                    ? typeStats.correctAnswers / typeStats.totalQuestions
                    : 0;
            });
        }

        if (day) {
            const days = new Set(Array.isArray(stats.practiceDays) ? stats.practiceDays : []);
            days.add(day);
            stats.practiceDays = Array.from(days).sort();
            stats.lastPracticeDate = stats.practiceDays[stats.practiceDays.length - 1] || null;
            stats.streakDays = calculateStreakDays(stats.practiceDays);
        }
        stats.updatedAt = new Date().toISOString();
    }

    async function recalculateStats() {
        // 使用轻量 listSummary 避免反序列化+克隆完整记录（answers/suiteEntries/realData 等重字段）。
        // summary 已包含 applyRecordToStats 所需的全部字段：duration, accuracy, metadata.category,
        // date/endTime/startTime/createdAt, totalQuestions, correctAnswers, questionTypePerformance。
        const records = await listSummary();
        const stats = getDefaultStats();
        (Array.isArray(records) ? records : []).forEach((record) => applyRecordToStats(stats, record));
        return await writeStats(stats);
    }

    async function resetStats(stats = null) {
        return await writeStats(isPlainObject(stats) ? stats : getDefaultStats());
    }

    async function mergeStats(stats, options = {}) {
        if (!isPlainObject(stats)) {
            return await readStats();
        }

        const mergeMode = options.mergeMode || options.mode || 'merge';
        if (mergeMode === 'replace') {
            return await writeStats(stats);
        }

        const existing = await readStats({ fallback: {} });
        const merged = Object.assign({}, existing);
        Object.entries(stats).forEach(([key, value]) => {
            if (value === undefined || value === null) {
                return;
            }
            const current = existing[key];
            if (typeof value === 'number' && typeof current === 'number') {
                merged[key] = Math.max(value, current);
                return;
            }
            if (isPlainObject(value) && isPlainObject(current)) {
                merged[key] = Object.assign({}, current, value);
                return;
            }
            merged[key] = clonePlainObject(value);
        });

        return await writeStats(merged);
    }

    async function updateStatsForSavedRecord(record, options = {}) {
        if (!record || options.updateStats === false) {
            return false;
        }

        await recalculateStats();
        return true;
    }

    async function list() {
        return await withSqliteBackend(
            async (backend) => {
                const records = await backend.list();
                let finalRecords = mergeWrongReasonFallbackRecords(Array.isArray(records) ? records : []);
                const localFallbackRecords = await readLocalWrongReasonFallbackRecords();
                if (localFallbackRecords.length > 0) {
                    const mergedRecords = mergeWrongReasonFallbackRecords(finalRecords.concat(localFallbackRecords));
                    if (buildWrongReasonMergeSignature(mergedRecords) !== buildWrongReasonMergeSignature(finalRecords)) {
                        const savedRecords = await backend.replace(mergedRecords, { maxRecords: DEFAULT_MAX_RECORDS });
                        finalRecords = Array.isArray(savedRecords) ? savedRecords : mergedRecords;
                    } else {
                        finalRecords = mergedRecords;
                    }
                }
                syncPracticeRecordState(finalRecords);
                return finalRecords;
            },
            async () => {
                const store = getRecordStore();
                if (!store || typeof store.listPracticeRecords !== 'function') {
                    throw new Error('PracticeRecordAPI.list: unified store not ready');
                }

                const records = await store.listPracticeRecords();
                return mergeWrongReasonFallbackRecords(Array.isArray(records) ? records : []);
            }
        );
    }

    /**
     * 轻量投影查询：返回每条记录的元数据摘要，不含 answers/correctAnswerMap/
     * suiteEntries[]/realData 等重字段。底层以 clone:false 读取原始数组后即时映射，
     * 避免大数据量下 structuredClone 全部记录导致内存溢出和渲染卡顿。
     * 供练习历史列表签名、趋势图、热力图、成就统计等只需时间戳和元数据的消费者使用。
     */
    async function listSummary(options = {}) {
        return await withSqliteBackend(
            async (backend) => {
                const summaries = typeof backend.listSummary === 'function' ? await backend.listSummary() : null;
                return Array.isArray(summaries) ? summaries : null;
            },
            async () => {
                const store = getRecordStore();
                if (store && typeof store.listPracticeRecords === 'function') {
                    const records = await store.listPracticeRecords();
                    return mergeWrongReasonFallbackRecords(records).map(_projectSummary).filter(Boolean);
                }
                const records = await list();
                return records.map(_projectSummary).filter(Boolean);
            }
        );
    }

    /** 返回记录总数，不加载记录数组到内存 */
    async function count(options = {}) {
        return await withSqliteBackend(
            async (backend) => {
                const total = typeof backend.count === 'function' ? await backend.count() : null;
                return Number.isFinite(Number(total)) ? Number(total) : null;
            },
            async () => {
                const store = getRecordStore();
                if (store && typeof store.countPracticeRecords === 'function') {
                    return await store.countPracticeRecords();
                }
                // 回退：store 不支持 count 时从 summary 长度获取
                if (store && typeof store.listPracticeRecordSummaries === 'function') {
                    const summaries = await store.listPracticeRecordSummaries();
                    return Array.isArray(summaries) ? summaries.length : 0;
                }
                const records = await list();
                return Array.isArray(records) ? records.length : 0;
            }
        );
    }

    /** 返回去重后的 examId 列表，供 overview 统计使用 */
    async function distinctExamIds(options = {}) {
        const summaries = await listSummary(options);
        const seen = new Set();
        const result = [];
        for (let i = 0; i < summaries.length; i += 1) {
            const examId = summaries[i] && summaries[i].examId;
            if (examId && !seen.has(examId)) {
                seen.add(examId);
                result.push(examId);
            }
        }
        return result;
    }

    /** 纯函数投影：从单条完整记录提取轻量 summary */
    function _projectSummary(record) {
        if (!record || typeof record !== 'object') {
            return null;
        }
        const scoreInfo = record.scoreInfo || {};
        const metadata = record.metadata || {};
        const projectComparisonSummary = (source) => {
            if (!source || typeof source !== 'object') {
                return null;
            }
            const projected = {};
            Object.entries(source).forEach(([questionId, entry]) => {
                if (!entry || typeof entry !== 'object') {
                    return;
                }
                const reason = normalizeWrongReason(entry.wrongReason || entry.errorReason || entry.wrongReasonNote);
                projected[questionId] = {
                    isCorrect: typeof entry.isCorrect === 'boolean' ? entry.isCorrect : null,
                    questionNumber: entry.questionNumber || entry.displayNumber || entry.number || null,
                    displayNumber: entry.displayNumber || entry.questionNumber || entry.number || null
                };
                if (reason) {
                    projected[questionId].wrongReason = reason;
                }
            });
            return Object.keys(projected).length ? projected : null;
        };
        const projectWrongReasons = (recordLike) => Object.assign(
            {},
            normalizeWrongReasonMap(recordLike && recordLike.wrongReasons),
            normalizeWrongReasonMap(recordLike && recordLike.realData && recordLike.realData.wrongReasons),
            normalizeWrongReasonMap(recordLike && recordLike.rawData && recordLike.rawData.wrongReasons)
        );
        // 轻量 suiteEntries 投影：仅保留签名字段，不含 answers/correctAnswerMap/realData
        const rawSuiteEntries = Array.isArray(record.suiteEntries) ? record.suiteEntries : [];
        const suiteEntries = rawSuiteEntries.map(function (entry) {
            if (!entry || typeof entry !== 'object') { return null; }
            const entryMeta = entry.metadata || {};
            const entryScore = entry.scoreInfo || {};
            const entryWrongReasons = projectWrongReasons(entry);
            const entryComparison = projectComparisonSummary(
                entry.answerComparison || (entry.rawData && entry.rawData.answerComparison) || (entryScore && entryScore.details)
            );
            return {
                id: entry.id || '',
                examId: entry.examId || entryMeta.examId || '',
                title: entry.title || entryMeta.examTitle || '',
                percentage: Number(entry.percentage != null ? entry.percentage : entryScore.percentage) || 0,
                duration: Number(entry.duration != null ? entry.duration : (entry.rawData && entry.rawData.duration)) || 0,
                wrongReasons: entryWrongReasons,
                answerComparison: entryComparison
            };
        }).filter(Boolean);
        const wrongReasons = projectWrongReasons(record);
        const answerComparison = projectComparisonSummary(
            record.answerComparison || (record.realData && record.realData.answerComparison) || record.answerDetails || (scoreInfo && scoreInfo.details)
        );
        return {
            id: record.id || record.sessionId || '',
            sessionId: record.sessionId || null,
            examId: record.examId || metadata.examId || null,
            dataKey: record.dataKey || metadata.dataKey || null,
            title: record.title || metadata.examTitle || '',
            source: record.source || null,
            type: record.type || metadata.type || 'reading',
            practiceType: record.practiceType || metadata.practiceType || metadata.examType || null,
            url: record.url || metadata.url || null,
            startTime: record.startTime || null,
            endTime: record.endTime || null,
            date: record.date || null,
            duration: Number(record.duration != null ? record.duration : (scoreInfo.duration != null ? scoreInfo.duration : scoreInfo.timeSpent)) || 0,
            percentage: Number(record.percentage != null ? record.percentage : scoreInfo.percentage) || 0,
            accuracy: Number(record.accuracy != null ? record.accuracy : scoreInfo.accuracy) || 0,
            score: Number(record.score != null ? record.score : scoreInfo.score) || 0,
            totalQuestions: Number(record.totalQuestions != null ? record.totalQuestions : scoreInfo.total) || 0,
            correctAnswers: Number(record.correctAnswers != null ? record.correctAnswers : scoreInfo.correct) || 0,
            status: record.status || 'completed',
            suiteMode: Boolean(record.suiteMode),
            suiteEntryCount: rawSuiteEntries.length,
            suiteEntries: suiteEntries,
            wrongReasons,
            answerComparison,
            suiteSessionId: record.suiteSessionId || metadata.suiteSessionId || null,
            questionTypePerformance: record.questionTypePerformance || null,
            scoreInfo: {
                accuracy: scoreInfo.accuracy != null ? scoreInfo.accuracy : null,
                duration: scoreInfo.duration != null ? scoreInfo.duration : null,
                timeSpent: scoreInfo.timeSpent != null ? scoreInfo.timeSpent : null,
                percentage: scoreInfo.percentage != null ? scoreInfo.percentage : null,
                score: scoreInfo.score != null ? scoreInfo.score : null,
                total: scoreInfo.total != null ? scoreInfo.total : null,
                correct: scoreInfo.correct != null ? scoreInfo.correct : null
            },
            metadata: {
                category: metadata.category || record.category || null,
                examTitle: metadata.examTitle || record.title || '',
                frequency: metadata.frequency || record.frequency || 'unknown',
                type: metadata.type || record.type || null,
                examType: metadata.examType || null,
                practiceType: metadata.practiceType || null,
                examId: metadata.examId || null,
                dataKey: metadata.dataKey || null,
                source: metadata.source || null,
                title: metadata.title || null,
                url: metadata.url || null
            },
            updatedAt: record.updatedAt || null,
            createdAt: record.createdAt || null
        };
    }

    async function getById(recordId) {
        const targetId = toIdString(recordId);
        if (!targetId) {
            return null;
        }
        const backend = await getAvailableSqliteBackend();
        if (backend) {
            try {
                await seedSqliteBackendFromLocalIfNeeded(backend);
                return typeof backend.getById === 'function' ? await backend.getById(targetId) : null;
            } catch (error) {
                console.warn('[SqliteBackend] getById failed, fallback to browser storage:', error);
            }
        }
        const records = await list();
        return records.find((record) => {
            if (!record || typeof record !== 'object') {
                return false;
            }
            return toIdString(record.id) === targetId || toIdString(record.sessionId) === targetId;
        }) || null;
    }

    async function replace(records, options = {}) {
        if (!Array.isArray(records)) {
            throw new Error('PracticeRecordAPI.replace requires an array of records');
        }
        const finalRecords = records;
        const saveOptions = getDefaultSaveOptions(options);
        return await withSqliteBackend(
            async (backend) => {
                const normalizedRecords = finalRecords
                    .map((record, index) => normalizeRecord(record, Object.assign({}, saveOptions, {
                        preserveIds: options.preserveIds !== false,
                        fallbackIdPrefix: options.fallbackIdPrefix || 'record',
                        index
                    })))
                    .filter(Boolean);
                const savedRecords = await backend.replace(normalizedRecords, saveOptions);
                const resultRecords = Array.isArray(savedRecords) ? savedRecords : normalizedRecords;
                syncPracticeRecordState(resultRecords);
                if (options.updateStats !== false) {
                    await recalculateStats();
                }
                return resultRecords;
            },
            async () => {
                const store = getRecordStore();
                if (store && typeof store.replacePracticeRecords === 'function') {
                    await store.replacePracticeRecords(finalRecords, saveOptions);
                    if (options.updateStats !== false) {
                        await recalculateStats();
                    }
                    return finalRecords;
                }

                throw new Error('PracticeRecordAPI.replace: unified store not ready');
            }
        );
    }

    async function mergeRecords(records, options = {}) {
        if (!Array.isArray(records)) {
            throw new Error('PracticeRecordAPI.mergeRecords requires an array of records');
        }

        const mergeMode = options.mergeMode || options.mode || 'merge';
        const normalizeOptions = getDefaultSaveOptions(options);
        const incomingRecords = records
            .map((record, index) => normalizeRecord(record, Object.assign({}, normalizeOptions, {
                preserveIds: options.preserveIds !== false,
                fallbackIdPrefix: options.fallbackIdPrefix || 'record',
                index
            })))
            .filter(Boolean);
        const existingRecords = await list();

        if (mergeMode === 'replace') {
            await replace(incomingRecords, Object.assign({}, options, { updateStats: options.updateStats !== false }));
            return {
                importedCount: incomingRecords.length,
                updatedCount: existingRecords.length,
                skippedCount: 0,
                finalCount: incomingRecords.length,
                records: incomingRecords
            };
        }

        const indexMap = new Map();
        existingRecords.forEach((record, index) => {
            if (record && record.id !== undefined && record.id !== null) {
                indexMap.set(String(record.id), { record, index });
            }
        });

        const mergedRecords = existingRecords.slice();
        let importedCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;

        incomingRecords.forEach((record) => {
            if (!record || record.id === undefined || record.id === null) {
                return;
            }

            const key = String(record.id);
            const existing = indexMap.get(key);

            if (!existing) {
                mergedRecords.push(record);
                indexMap.set(key, { record, index: mergedRecords.length - 1 });
                importedCount += 1;
                return;
            }

            if (mergeMode === 'skip') {
                skippedCount += 1;
                return;
            }

            const existingTimestamp = getRecordTimestamp(existing.record);
            const incomingTimestamp = getRecordTimestamp(record);
            if (incomingTimestamp >= existingTimestamp) {
                const merged = mergeRecordDetails(existing.record, record, normalizeOptions);
                mergedRecords[existing.index] = merged;
                indexMap.set(key, { record: merged, index: existing.index });
                updatedCount += 1;
                return;
            }

            skippedCount += 1;
        });

        mergedRecords.sort((a, b) => getRecordTimestamp(b) - getRecordTimestamp(a));
        await replace(mergedRecords, Object.assign({}, options, { updateStats: options.updateStats !== false }));

        return {
            importedCount,
            updatedCount,
            skippedCount,
            finalCount: mergedRecords.length,
            records: mergedRecords
        };
    }

    async function restoreRecords(records, options = {}) {
        if (!Array.isArray(records)) {
            throw new Error('PracticeRecordAPI.restoreRecords requires an array of records');
        }
        if (records.length === 0 && options.allowEmptyRestore !== true) {
            throw new Error('PracticeRecordAPI.restoreRecords refused empty restore');
        }

        await replace(records, Object.assign({}, options, { updateStats: false }));
        if (isPlainObject(options.stats) && (records.length === 0 || hasMeaningfulStats(options.stats))) {
            await writeStats(options.stats);
        } else if (options.updateStats !== false) {
            await recalculateStats();
        }
        return {
            restoredCount: records.length,
            statsRestored: isPlainObject(options.stats)
        };
    }

    async function clear(options = {}) {
        await replace([], Object.assign({}, options, { updateStats: false }));
        if (options.updateStats === true) {
            await resetStats();
        }
        return true;
    }

    async function deleteMany(recordIds, options = {}) {
        const ids = Array.isArray(recordIds) ? recordIds.map(toIdString).filter(Boolean) : [];
        if (ids.length === 0) {
            return { deletedCount: 0, deletedRecords: [], records: await list() };
        }

        const backendDeleteResult = await withSqliteBackend(
            async (backend) => {
                const before = await backend.list();
                const result = typeof backend.deleteMany === 'function'
                    ? await backend.deleteMany(ids)
                    : null;
                if (!result) {
                    return null;
                }
                const records = Array.isArray(result.records) ? result.records : await backend.list();
                syncPracticeRecordState(records);
                if (options.updateStats !== false) {
                    await recalculateStats();
                }
                const idSetForDeleted = new Set(ids);
                return {
                    deletedCount: Number(result.deletedCount) || 0,
                    deletedRecords: (Array.isArray(before) ? before : []).filter((record) => record && idSetForDeleted.has(toIdString(record.id))),
                    records
                };
            },
            async () => null
        );
        if (backendDeleteResult) {
            return backendDeleteResult;
        }

        const idSet = new Set(ids);
        // 默认仅按 record.id 删除，避免共享 sessionId 的不同记录被误删。
        // matchBy: 'sessionId' 时才按 sessionId 匹配（用于 suite 子记录清理等显式场景）。
        const matchBySessionId = options.matchBy === 'sessionId';
        const records = await list();
        const deletedRecords = [];
        const remainingRecords = [];

        (Array.isArray(records) ? records : []).forEach((record) => {
            const recordId = toIdString(record && record.id);
            const sessionId = toIdString(record && record.sessionId);
            const idMatch = recordId && idSet.has(recordId);
            const sessionMatch = matchBySessionId && sessionId && idSet.has(sessionId);
            if (idMatch || sessionMatch) {
                deletedRecords.push(record);
                return;
            }
            remainingRecords.push(record);
        });

        if (deletedRecords.length > 0) {
            await replace(remainingRecords, options);
        }

        return {
            deletedCount: deletedRecords.length,
            deletedRecords,
            records: remainingRecords
        };
    }

    async function deleteById(recordId, options = {}) {
        const result = await deleteMany([recordId], options);
        return {
            deleted: result.deletedCount > 0,
            record: result.deletedRecords[0] || null,
            records: result.records
        };
    }

    async function saveRecord(record, options = {}) {
        if (!record || typeof record !== 'object') {
            throw new Error('PracticeRecordAPI.saveRecord requires a record object');
        }

        const saveOptions = getDefaultSaveOptions(options);
        const normalizedRecord = normalizeRecord(record, saveOptions);
        if (!normalizedRecord || !normalizedRecord.examId) {
            throw new Error('PracticeRecordAPI.saveRecord requires a canonical examId');
        }

        return await withSqliteBackend(
            async (backend) => {
                const savedRecord = await backend.saveRecord(normalizedRecord);
                const finalRecord = savedRecord || normalizedRecord;
                if (options.updateStats !== false) {
                    await updateStatsForSavedRecord(finalRecord, options);
                }
                return finalRecord;
            },
            async () => {
                const store = getRecordStore();
                if (!store || typeof store.savePracticeRecord !== 'function') {
                    throw new Error('PracticeRecordAPI.saveRecord: PracticeCore store not ready');
                }

                const savedRecord = await store.savePracticeRecord(normalizedRecord, saveOptions);

                if (options.updateStats !== false) {
                    await updateStatsForSavedRecord(savedRecord, options);
                }

                return savedRecord;
            }
        );
    }

    function fromCompletion(payload, context = {}, examEntry = null, options = {}) {
        const core = getPracticeCore();
        if (!core || !core.ingestor || typeof core.ingestor.fromCompletion !== 'function') {
            return null;
        }
        return core.ingestor.fromCompletion(payload, context || {}, examEntry || null, getDefaultSaveOptions(options));
    }

    async function saveCompletion(payload, context = {}, examEntry = null, options = {}) {
        const record = fromCompletion(payload, context, examEntry, options);
        if (!record) {
            throw new Error('PracticeRecordAPI.saveCompletion could not build canonical record');
        }
        return await saveRecord(record, options);
    }

    function normalizeAccuracy(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric < 0) {
            return 0;
        }
        if (numeric > 1 && numeric <= 100) {
            return numeric / 100;
        }
        return Math.min(numeric, 1);
    }

    function toSummaryMetrics(record = {}) {
        const total = Number(record.totalQuestions ?? record.scoreInfo?.total ?? record.scoreInfo?.totalQuestions ?? record.realData?.scoreInfo?.total ?? record.realData?.totalQuestions);
        const correct = Number(record.correctAnswers ?? record.score ?? record.scoreInfo?.correct ?? record.scoreInfo?.score ?? record.realData?.scoreInfo?.correct ?? record.realData?.score);
        const safeTotal = Number.isFinite(total) && total >= 0 ? total : 0;
        const safeCorrect = Number.isFinite(correct) && correct >= 0 ? correct : 0;

        let accuracy = normalizeAccuracy(record.accuracy ?? record.scoreInfo?.accuracy ?? record.realData?.scoreInfo?.accuracy ?? (safeTotal > 0 ? safeCorrect / safeTotal : 0));
        const percentageCandidate = Number(record.percentage ?? record.scoreInfo?.percentage ?? record.realData?.scoreInfo?.percentage);
        const percentage = Number.isFinite(percentageCandidate) && percentageCandidate >= 0 && percentageCandidate <= 100
            ? percentageCandidate
            : Math.round(accuracy * 100);
        const hasExplicitAccuracy = record.accuracy != null
            || record.scoreInfo?.accuracy != null
            || record.realData?.scoreInfo?.accuracy != null;
        accuracy = percentage > 1 && !hasExplicitAccuracy
            ? percentage / 100
            : accuracy;

        return {
            totalQuestions: safeTotal,
            correctAnswers: safeCorrect,
            accuracy,
            percentage,
            duration: Number(record.duration ?? record.realData?.duration) || 0
        };
    }

    function toReplayEntries(record, projector) {
        if (typeof projector === 'function') {
            return projector(record);
        }
        return [];
    }

    global.PracticeRecordAPI = {
        __stable: true,
        version: '0.6.2-fix',
        list,
        listSummary,
        count,
        distinctExamIds,
        getById,
        replace,
        mergeRecords,
        restoreRecords,
        clear,
        deleteById,
        deleteMany,
        saveRecord,
        normalizeRecord,
        fromCompletion,
        saveCompletion,
        toSummaryMetrics,
        toReplayEntries,
        getDefaultStats,
        prepareStats,
        readStats,
        writeStats,
        mergeStats,
        resetStats,
        recalculateStats,
        updateStatsForSavedRecord
    };

    if (global.persistentStore && typeof global.persistentStore.migrateLegacyData === 'function') {
        Promise.resolve()
            .then(() => global.persistentStore.migrateLegacyData({ skipReady: true }))
            .catch((error) => {
                console.warn('[PracticeRecordAPI] 延后练习记录迁移失败:', error);
            });
    }
})(typeof window !== 'undefined' ? window : globalThis);
