/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('configurator assets use extension-root paths and controls have fallback defaults', async () => {
	const html = await readFile(new URL('../iframe/index.html', import.meta.url), 'utf8');
	assert.match(html, /href="\/iframe\/app\.css"/);
	assert.match(html, /src="\/iframe\/configurator\.js"/);

	const expectedDefaults: Record<string, string> = {
		rowPitch: '1',
		headerHeight: '2',
		bankGap: '2',
		pinLength: '2',
		titleGap: '2',
		cellPadding: '1',
		muxColumnMinWidth: '7',
		muxColumnMaxWidth: '18',
		disableColumnMinWidth: '7',
		pinColumnMinWidth: '5',
		minBodyWidth: '0',
		powerRowHeight: '1',
		titleFontSize: '0.12',
		bankFontSize: '0.10',
		headerFontSize: '0.09',
		cellFontSize: '0.08',
		pinNameFontSize: '0.08',
		pinNumberFontSize: '0.07',
		outerLineWidth: '2',
		headerLineWidth: '2',
		titleColor: '#1f2328',
		accentColor: '#c73737',
		textColor: '#4e565e',
		mutedColor: '#737b83',
		pinColor: '#880000',
	};

	for (const [id, value] of Object.entries(expectedDefaults)) {
		const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		assert.match(html, new RegExp(`<input\\s+id="${id}"[^>]*\\s+value="${escapedValue}"`), `${id} should default to ${value}`);
	}
	assert.doesNotMatch(html, /<input\s+id="powerRowEnabled"[^>]*checked/, 'power row should be disabled by default');
	assert.doesNotMatch(html, /id="powerLabel"|id="powerPinName"|id="powerPinNumber"/, 'power row should not prefill content fields');
});
