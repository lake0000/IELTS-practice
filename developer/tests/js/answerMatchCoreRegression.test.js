#!/usr/bin/env node
import assert from 'assert';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const core = require(path.join(repoRoot, 'js/utils/answerMatchCore.js'));

function run() {
    assert.strictEqual(
        core.normalizeToken('a panoramic camera'),
        'a panoramic camera',
        'lowercase article phrase must not collapse to option letter'
    );
    assert.strictEqual(
        core.normalizeToken('A. panoramic camera'),
        'A',
        'explicit option label with punctuation should still normalize to the letter'
    );
    assert.strictEqual(
        core.compareAnswers('panoramic camera', ['a panoramic camera', 'panoramic camera']),
        true,
        'accepted-answer arrays should still accept textual alternates'
    );
    assert.strictEqual(
        core.compareAnswers('A', ['a panoramic camera', 'panoramic camera']),
        false,
        'single option letter must not falsely match a textual accepted answer'
    );
    assert.strictEqual(
        core.compareAnswers('B MBA graduates', 'B'),
        true,
        'dragged option text with leading letter should match a single-letter answer key'
    );
    assert.strictEqual(
        core.compareAnswers('E magic formula', 'E'),
        true,
        'lowercase option text after an uppercase label should still match the letter'
    );
    assert.strictEqual(
        core.compareAnswers('I human nature', 'I'),
        true,
        'I-labeled option text should match the single-letter answer key'
    );
    assert.strictEqual(
        core.compareAnswers('A business leaders', 'H'),
        false,
        'wrong leading option label must still be marked incorrect'
    );
    assert.strictEqual(
        core.compareAnswers('A C', 'A'),
        false,
        'multi-letter answers separated by spaces must not be collapsed to the first option'
    );
    assert.strictEqual(
        core.compareAnswers('a panoramic camera', 'A'),
        false,
        'lowercase article phrase must not be treated as option A'
    );

    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: 'answerMatchCore accepted-answer regression checks passed'
    }));
}

try {
    run();
} catch (error) {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
}
