(function initSqlitePracticeBackend(global) {
    'use strict';

    if (global.SqlitePracticeBackend && global.SqlitePracticeBackend.__stable === true) {
        return;
    }

    const BASE_PATH = '/api/sqlite';
    const STATUS_TTL_MS = 5000;
    const VOCAB_STATE_META_KEY = 'vocab_state';
    let statusCache = null;
    let statusCheckedAt = 0;

    function isEnabled() {
        if (global.__IELTS_SQLITE_BACKEND_DISABLED === true) {
            return false;
        }
        if (typeof global.fetch !== 'function') {
            return false;
        }
        const location = global.location || {};
        const protocol = String(location.protocol || '').toLowerCase();
        return protocol === 'http:' || protocol === 'https:';
    }

    function clone(value) {
        if (value == null || typeof value !== 'object') {
            return value ?? null;
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return value;
        }
    }

    async function request(path, options = {}) {
        if (!isEnabled()) {
            return null;
        }
        const response = await global.fetch(`${BASE_PATH}${path}`, Object.assign({
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin'
        }, options));
        if (!response || response.status === 404) {
            return null;
        }
        let payload = null;
        try {
            payload = await response.json();
        } catch (_) {
            payload = null;
        }
        if (!response.ok || !payload || payload.ok === false) {
            const message = payload && payload.error ? payload.error : `HTTP ${response.status}`;
            throw new Error(message);
        }
        return payload;
    }

    async function status(options = {}) {
        if (!isEnabled()) {
            return null;
        }
        const now = Date.now();
        if (!options.force && statusCache && now - statusCheckedAt < STATUS_TTL_MS) {
            return statusCache;
        }
        try {
            statusCache = await request('/status');
            statusCheckedAt = now;
            return statusCache;
        } catch (error) {
            statusCache = null;
            statusCheckedAt = now;
            if (options.throwOnError) {
                throw error;
            }
            return null;
        }
    }

    async function isAvailable(options = {}) {
        const current = await status(options);
        return Boolean(current && current.ok);
    }

    async function list() {
        const payload = await request('/practice-records');
        return payload && Array.isArray(payload.records) ? payload.records : null;
    }

    async function listSummary() {
        const payload = await request('/practice-records/summary');
        return payload && Array.isArray(payload.records) ? payload.records : null;
    }

    async function count() {
        const current = await status({ force: true });
        return current && Number.isFinite(Number(current.recordCount)) ? Number(current.recordCount) : null;
    }

    async function getById(recordId) {
        const id = String(recordId || '').trim();
        if (!id) {
            return null;
        }
        const payload = await request(`/practice-records/${encodeURIComponent(id)}`);
        return payload && payload.record ? payload.record : null;
    }

    async function saveRecord(record) {
        const payload = await request('/practice-records', {
            method: 'POST',
            body: JSON.stringify({ record: clone(record) })
        });
        statusCache = null;
        return payload && payload.record ? payload.record : null;
    }

    async function saveWrongReasons(payload) {
        const responsePayload = await request('/practice-records/wrong-reasons', {
            method: 'POST',
            body: JSON.stringify(clone(payload) || {})
        });
        statusCache = null;
        return responsePayload && responsePayload.record ? responsePayload.record : null;
    }

    async function replace(records, options = {}) {
        const payload = await request('/practice-records/replace', {
            method: 'POST',
            body: JSON.stringify({
                records: Array.isArray(records) ? clone(records) : [],
                maxRecords: Number.isFinite(Number(options.maxRecords)) ? Number(options.maxRecords) : undefined
            })
        });
        statusCache = null;
        return payload && Array.isArray(payload.records) ? payload.records : null;
    }

    async function deleteMany(recordIds) {
        const payload = await request('/practice-records/delete', {
            method: 'POST',
            body: JSON.stringify({ ids: Array.isArray(recordIds) ? recordIds.map(String) : [] })
        });
        statusCache = null;
        return payload || null;
    }

    async function deleteById(recordId) {
        const id = String(recordId || '').trim();
        if (!id) {
            return null;
        }
        const payload = await request(`/practice-records/${encodeURIComponent(id)}`, { method: 'DELETE' });
        statusCache = null;
        return payload || null;
    }

    async function exportFullWrongRecords(recordIds = []) {
        const ids = Array.isArray(recordIds)
            ? recordIds.map((value) => String(value || '').trim()).filter(Boolean)
            : [];
        const payload = await request('/practice-records/full-wrong-export', {
            method: 'POST',
            body: JSON.stringify({ ids })
        });
        return payload && payload.export ? payload.export : null;
    }

    async function readMeta(key, fallback = null) {
        const payload = await request(`/meta/${encodeURIComponent(String(key))}`);
        return payload && Object.prototype.hasOwnProperty.call(payload, 'value')
            ? (payload.value == null ? fallback : payload.value)
            : fallback;
    }

    async function writeMeta(key, value) {
        const payload = await request(`/meta/${encodeURIComponent(String(key))}`, {
            method: 'PUT',
            body: JSON.stringify({ value: clone(value) })
        });
        return payload && Object.prototype.hasOwnProperty.call(payload, 'value') ? payload.value : value;
    }

    async function readVocabState(fallback = null) {
        return readMeta(VOCAB_STATE_META_KEY, fallback);
    }

    async function writeVocabState(snapshot) {
        return writeMeta(VOCAB_STATE_META_KEY, clone(snapshot) || {});
    }

    global.SqlitePracticeBackend = Object.freeze({
        __stable: true,
        version: '0.1.0',
        status,
        isAvailable,
        list,
        listSummary,
        count,
        getById,
        saveRecord,
        saveWrongReasons,
        replace,
        deleteMany,
        deleteById,
        exportFullWrongRecords,
        readMeta,
        writeMeta,
        readVocabState,
        writeVocabState
    });
})(typeof window !== 'undefined' ? window : globalThis);
