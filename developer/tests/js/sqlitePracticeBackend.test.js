#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

function loadScript(relativePath, context) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

function createRepositoryHarness(seedRecords = []) {
    const practiceState = seedRecords.map((record) => JSON.parse(JSON.stringify(record)));
    const metaState = new Map();
    return {
        repositories: {
            practice: {
                async list() {
                    return practiceState.map((record) => JSON.parse(JSON.stringify(record)));
                },
                async overwrite(records) {
                    practiceState.splice(0, practiceState.length, ...records.map((record) => JSON.parse(JSON.stringify(record))));
                    return true;
                },
                async upsert(record) {
                    throw new Error('SQLite path must not upsert into browser repository');
                }
            },
            meta: {
                async get(key, fallback = null) {
                    return metaState.has(key)
                        ? JSON.parse(JSON.stringify(metaState.get(key)))
                        : JSON.parse(JSON.stringify(fallback));
                },
                async set(key, value) {
                    metaState.set(key, JSON.parse(JSON.stringify(value)));
                    return true;
                },
                async remove(key) {
                    metaState.delete(key);
                    return true;
                }
            }
        },
        practiceState,
        metaState
    };
}

function createFetchMock(initialRecords = []) {
    const state = {
        records: initialRecords.map((record) => JSON.parse(JSON.stringify(record))),
        meta: new Map(),
        calls: []
    };
    const jsonResponse = (status, payload) => ({
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return JSON.parse(JSON.stringify(payload));
        }
    });
    const fetch = async (url, options = {}) => {
        const method = String(options.method || 'GET').toUpperCase();
        const parsed = new URL(url, 'http://127.0.0.1:8081/');
        const body = options.body ? JSON.parse(options.body) : {};
        state.calls.push({ method, path: parsed.pathname, body });
        if (parsed.pathname === '/api/sqlite/status' && method === 'GET') {
            return jsonResponse(200, { ok: true, backend: 'sqlite', recordCount: state.records.length });
        }
        if (parsed.pathname === '/api/sqlite/practice-records' && method === 'GET') {
            return jsonResponse(200, { ok: true, records: state.records, count: state.records.length });
        }
        if (parsed.pathname === '/api/sqlite/practice-records/summary' && method === 'GET') {
            return jsonResponse(200, {
                ok: true,
                records: state.records.map((record) => ({
                    id: record.id,
                    examId: record.examId,
                    title: record.title,
                    duration: record.duration || 0,
                    accuracy: record.accuracy || 0,
                    totalQuestions: record.totalQuestions || 0,
                    correctAnswers: record.correctAnswers || 0,
                    date: record.date || record.endTime || null,
                    scoreInfo: record.scoreInfo || {},
                    metadata: record.metadata || {}
                }))
            });
        }
        if (parsed.pathname === '/api/sqlite/practice-records' && method === 'POST') {
            const record = body.record;
            const index = state.records.findIndex((entry) => String(entry.id) === String(record.id));
            if (index >= 0) {
                state.records[index] = record;
            } else {
                state.records.unshift(record);
            }
            return jsonResponse(200, { ok: true, record });
        }
        if (parsed.pathname === '/api/sqlite/practice-records/replace' && method === 'POST') {
            state.records = (body.records || []).map((record) => JSON.parse(JSON.stringify(record)));
            return jsonResponse(200, { ok: true, records: state.records, count: state.records.length });
        }
        if (parsed.pathname.startsWith('/api/sqlite/practice-records/') && method === 'GET') {
            const id = decodeURIComponent(parsed.pathname.rsplit ? parsed.pathname.rsplit('/', 1)[0] : parsed.pathname.split('/').pop());
            const record = state.records.find((entry) => String(entry.id) === String(id));
            return record
                ? jsonResponse(200, { ok: true, record })
                : jsonResponse(404, { ok: false, error: 'record not found' });
        }
        if (parsed.pathname.startsWith('/api/sqlite/meta/')) {
            const key = decodeURIComponent(parsed.pathname.split('/').pop());
            if (method === 'GET') {
                return jsonResponse(200, { ok: true, key, value: state.meta.has(key) ? state.meta.get(key) : null });
            }
            if (method === 'PUT') {
                state.meta.set(key, body.value);
                return jsonResponse(200, { ok: true, key, value: body.value });
            }
        }
        return jsonResponse(404, { ok: false, error: 'not found' });
    };
    return { fetch, state };
}

function createContext(fetch, repositories) {
    const windowStub = {
        console,
        fetch,
        location: { protocol: 'http:', href: 'http://127.0.0.1:8081/' },
        practiceRecords: [],
        setPracticeRecordsState(records) {
            this.practiceRecords = Array.isArray(records) ? records.slice() : [];
            return this.practiceRecords;
        }
    };
    const sandbox = {
        window: windowStub,
        globalThis: windowStub,
        console,
        fetch,
        location: windowStub.location,
        setTimeout,
        clearTimeout,
        Date,
        Math,
        JSON,
        URL
    };
    const context = vm.createContext(sandbox);
    loadScript('js/core/practiceCore.js', context);
    context.window.PracticeCore.__installInternalRepositories(repositories);
    loadScript('js/core/sqlitePracticeBackend.js', context);
    loadScript('js/core/practiceRecordAPI.js', context);
    return context.window.PracticeRecordAPI;
}

async function testBackendListWinsOverBrowserCache() {
    const local = createRepositoryHarness([{ id: 'local-stale', examId: 'p1-high-01', type: 'reading', score: 1, date: '2026-07-01T00:00:00.000Z' }]);
    const backendRecord = { id: 'backend-current', examId: 'p1-high-02', type: 'reading', title: 'Backend', score: 1, totalQuestions: 1, correctAnswers: 1, date: '2026-07-02T00:00:00.000Z' };
    const fetchMock = createFetchMock([backendRecord]);
    const api = createContext(fetchMock.fetch, local.repositories);

    const records = await api.list();
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].id, 'backend-current');
    assert(!fetchMock.state.calls.some((call) => call.path === '/api/sqlite/practice-records/replace'), '后端已有记录时不能用本地缓存覆盖');
}

async function testEmptyBackendSeedsFromBrowserRecordsOnce() {
    const localRecord = { id: 'local-real', examId: 'p1-medium-63', type: 'reading', title: 'Local', score: 1, totalQuestions: 1, correctAnswers: 1, date: '2026-07-03T00:00:00.000Z' };
    const local = createRepositoryHarness([localRecord]);
    local.metaState.set('user_stats', { totalPractices: 1, totalTimeSpent: 120, averageScore: 1, practiceDays: ['2026-07-03'] });
    const fetchMock = createFetchMock([]);
    const api = createContext(fetchMock.fetch, local.repositories);

    const records = await api.list();
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].id, 'local-real');
    assert(fetchMock.state.calls.some((call) => call.path === '/api/sqlite/practice-records/replace'), '空 SQLite 应从浏览器旧记录安全导入一次');
    assert.strictEqual(fetchMock.state.meta.get('user_stats').totalPractices, 1);
}

async function testSaveUsesBackendAndGetByIdDoesNotReadStaleLocalOnMiss() {
    const local = createRepositoryHarness([{ id: 'stale-only-local', examId: 'p1-high-88', type: 'reading', score: 1, date: '2026-07-04T00:00:00.000Z' }]);
    const fetchMock = createFetchMock([{ id: 'backend-existing', examId: 'p1-high-01', type: 'reading', score: 1, totalQuestions: 1, correctAnswers: 1, date: '2026-07-04T00:00:00.000Z' }]);
    const api = createContext(fetchMock.fetch, local.repositories);

    const saved = await api.saveRecord({
        id: 'backend-saved',
        examId: 'p1-high-99',
        type: 'reading',
        title: 'Saved',
        score: 1,
        totalQuestions: 1,
        correctAnswers: 1,
        date: '2026-07-05T00:00:00.000Z'
    }, { updateStats: false });
    assert.strictEqual(saved.id, 'backend-saved');
    assert(fetchMock.state.records.some((record) => record.id === 'backend-saved'), '保存应写入 SQLite 后端');

    const stale = await api.getById('stale-only-local');
    assert.strictEqual(stale, null, 'SQLite 后端可用时，getById 缺失不能回旧浏览器缓存捞脏数据');
}

async function main() {
    await testBackendListWinsOverBrowserCache();
    await testEmptyBackendSeedsFromBrowserRecordsOnce();
    await testSaveUsesBackendAndGetByIdDoesNotReadStaleLocalOnMiss();
    console.log(JSON.stringify({
        status: 'pass',
        detail: 'SQLite PracticeRecordAPI bridge covered',
        passed: 3,
        total: 3
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    console.log(JSON.stringify({ status: 'fail', detail: error.message }, null, 2));
    process.exit(1);
});
