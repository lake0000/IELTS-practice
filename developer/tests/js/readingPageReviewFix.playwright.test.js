import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function loadPlaywright() {
  const candidates = [
    'playwright',
    process.env.PLAYWRIGHT_NODE_MODULES ? `${process.env.PLAYWRIGHT_NODE_MODULES}/playwright` : null
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) {
      // Try the next configured source.
    }
  }
  throw new Error('Playwright is required for this browser validation. Set PLAYWRIGHT_NODE_MODULES to a node_modules directory that contains playwright.');
}

const { chromium } = loadPlaywright();

const BASE_URL = 'http://127.0.0.1:8081/assets/generated/reading-exams/reading-practice-unified.html';
const VERSION = '20260819-highlight-control-guard';

async function prepareSubmittedPage(page, examId) {
  await page.route('**/api/sqlite/practice-records', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' || request.method() === 'PUT') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          record: { id: 'playwright-temp-record', recordId: 'playwright-temp-record' },
          records: []
        })
      });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/sqlite/practice-records/wrong-reasons', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, record: { id: 'playwright-temp-record' } })
    });
  });
  await page.goto(`${BASE_URL}?examId=${examId}&dataKey=${examId}&v=${VERSION}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (
    window.__IELTS_UNIFIED_READING_PAGE_TEST__
      && window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState
      && window.__IELTS_UNIFIED_READING_PAGE_TEST__.handleSubmit
  ), null, { timeout: 10000 });

  await page.evaluate(() => {
    const handledRadioGroups = new Set();
    document.querySelectorAll('input, textarea, select').forEach((control) => {
      if (!(control instanceof HTMLElement) || control.closest('.wrong-reason-controls')) {
        return;
      }
      if (control instanceof HTMLInputElement && control.type === 'radio') {
        if (!handledRadioGroups.has(control.name)) {
          control.checked = true;
          handledRadioGroups.add(control.name);
        }
        return;
      }
      if (control instanceof HTMLInputElement && control.type === 'checkbox') {
        control.checked = false;
        return;
      }
      if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
        control.value = '__wrong__';
        return;
      }
      if (control instanceof HTMLSelectElement && control.options.length > 1) {
        control.selectedIndex = 1;
      }
    });
  });

  await page.evaluate(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.handleSubmit());
}

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    window.__IELTS_READING_PAGE_TEST_HOOKS__ = true;
    window.__IELTS_PRACTICE_MESSAGE_ACK__ = true;
    window.PracticeRecordAPI = {
      saveCompletion: async () => ({ id: 'playwright-temp-record', recordId: 'playwright-temp-record' }),
      saveRecord: async (record) => record || { id: 'playwright-temp-record' },
      getById: async () => null,
      list: async () => []
    };
  });
  const results = {};

  await prepareSubmittedPage(page, 'p1-high-200');
  await page.waitForSelector('.reading-passage-explanation', { timeout: 10000 });
  results.dentist = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.reading-passage-explanation:not(.reading-passage-explanation-summary)')];
    return {
      count: cards.length,
      first: cards[0]?.querySelector('.reading-explanation-card__label')?.textContent?.trim(),
      last: cards.at(-1)?.querySelector('.reading-explanation-card__label')?.textContent?.trim()
    };
  });

  results.space = await page.evaluate(() => {
    const note = document.querySelector('.wrong-reason-note');
    note.value = '';
    note.focus();
    note.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    note.value = 'space works';
    note.dispatchEvent(new Event('input', { bubbles: true }));
    return note.value;
  });

  results.highlight = await page.evaluate(async () => {
    const left = document.querySelector('#left');
    const test = document.createElement('p');
    test.id = 'highlight-regression-text';
    test.textContent = 'alpha beta gamma';
    left.prepend(test);

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(test);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    document.querySelector('#btnHL')?.click();

    const primary = test.querySelector('.hl');
    const textNode = primary?.firstChild || test.firstChild;
    const offset = textNode.textContent.indexOf('beta');
    const range2 = document.createRange();
    range2.setStart(textNode, offset);
    range2.setEnd(textNode, offset + 4);
    selection.removeAllRanges();
    selection.addRange(range2);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    document.querySelector('#btnHL')?.click();

    const secondary = [...test.querySelectorAll('.hl[data-hl-level="secondary"]')].map((node) => node.textContent);
    return {
      html: test.innerHTML,
      secondary,
      outerSecondary: test.firstElementChild?.dataset?.hlLevel === 'secondary'
    };
  });

  results.highlightRestoreExcludesWrongReasonControls = await page.evaluate(() => {
    const shared = window.__READING_HIGHLIGHT_SHARED__;
    const root = document.createElement('div');
    root.innerHTML = [
      '<div class="wrong-reason-controls"><span class="hl">alpha beta gamma</span></div>',
      '<p class="restore-target">alpha beta gamma</p>'
    ].join('');
    document.body.appendChild(root);
    const restored = shared.restoreHighlights({ groups: root }, [{
      scope: 'groups',
      text: 'alpha beta gamma',
      start: 0,
      end: 16,
      startOffset: 0,
      endOffset: 16,
      occurrence: 0,
      kind: 'highlight',
      level: 'primary'
    }]);
    const controlHighlights = root.querySelectorAll('.wrong-reason-controls .hl').length;
    const targetHighlights = root.querySelectorAll('.restore-target .hl').length;
    const controlText = root.querySelector('.wrong-reason-controls')?.textContent?.trim();
    root.remove();
    return { restored, controlHighlights, targetHighlights, controlText };
  });

  results.highlightRestoresByTextContext = await page.evaluate(() => {
    const shared = window.__READING_HIGHLIGHT_SHARED__;
    const root = document.createElement('div');
    root.innerHTML = [
      '<p class="wrong-context">first alpha beta gamma tail</p>',
      '<p class="right-context">right alpha beta gamma done</p>'
    ].join('');
    document.body.appendChild(root);
    const restored = shared.restoreHighlights({ groups: root }, [{
      scope: 'groups',
      text: 'alpha beta gamma',
      start: 6,
      end: 22,
      startOffset: 6,
      endOffset: 22,
      before: 'right ',
      after: ' done',
      occurrence: 0,
      kind: 'highlight',
      level: 'primary'
    }]);
    const wrongContextHighlights = root.querySelectorAll('.wrong-context .hl').length;
    const rightContextHighlights = root.querySelectorAll('.right-context .hl').length;
    root.remove();
    return { restored, wrongContextHighlights, rightContextHighlights };
  });

  await browser.close();

  const ok = results.dentist.count === 10
    && results.dentist.first === 'Paragraph 1'
    && results.dentist.last === 'Paragraph 10'
    && results.space === 'space works'
    && results.highlight.secondary.length === 1
    && results.highlight.secondary[0] === 'beta'
    && !results.highlight.outerSecondary
    && results.highlightRestoreExcludesWrongReasonControls.restored === 1
    && results.highlightRestoreExcludesWrongReasonControls.controlHighlights === 0
    && results.highlightRestoreExcludesWrongReasonControls.targetHighlights === 1
    && results.highlightRestoresByTextContext.restored === 1
    && results.highlightRestoresByTextContext.wrongContextHighlights === 0
    && results.highlightRestoresByTextContext.rightContextHighlights === 1;

  console.log(JSON.stringify({ ok, results }, null, 2));
  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
