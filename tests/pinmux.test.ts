/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { errorMessage, isDuplicateLibraryNameError } from '../src/generator.js';
import {
	createSymbolLayout,
	fontSizeInches,
	normalizeSymbolLayoutOptions,
	parsePinmuxCsv,
	SYMBOL_GRID,
} from '../src/pinmux.js';

async function referenceTable() {
	const csv = await readFile(new URL('../reference/pinout.csv', import.meta.url), 'utf8');
	return parsePinmuxCsv(csv);
}

function assertGridAligned(value: number, label: string): void {
	assert.ok(Math.abs(value % SYMBOL_GRID) === 0, `${label} (${value}) must align to ${SYMBOL_GRID}`);
}

test('reference pinout is grouped by GPIO bank and preserves shared-pad semantics', async () => {
	const table = await referenceTable();
	const layout = createSymbolLayout(table);
	assert.equal(table.rows.length, 56);
	assert.deepEqual(layout.banks.map(bank => bank.name), ['PA', 'PC', 'PD', 'PL']);
	assert.deepEqual(layout.banks.map(bank => bank.rows.length), [13, 14, 21, 8]);
	assert.equal(layout.rows[0].displayPinName, 'PA0');
	assert.equal(layout.rows[0].disableFunction, 'ADC0-2');
	assert.equal(layout.rows[0].row.pinName, 'GPADC0-2/PA0');
});

test('every generated geometry coordinate is aligned to the 100 mil grid', async () => {
	const layout = createSymbolLayout(await referenceTable());
	const layoutValues = [layout.bodyX, layout.bodyY, layout.bodyWidth, layout.bodyHeight, layout.pinLength, layout.titleY];
	layoutValues.forEach((value, index) => assertGridAligned(value, `layout[${index}]`));

	for (const bank of layout.banks) {
		[bank.bodyX, bank.bodyY, bank.bodyWidth, bank.bodyHeight, bank.labelY, bank.headerY, bank.headerBottomY]
			.forEach((value, index) => assertGridAligned(value, `${bank.name}.geometry[${index}]`));
		for (const column of bank.columns) {
			assertGridAligned(column.x, `${bank.name}.${column.label}.x`);
			assertGridAligned(column.width, `${bank.name}.${column.label}.width`);
		}
		for (const row of bank.rows) {
			assertGridAligned(row.y, `${bank.name}.${row.displayPinName}.y`);
			assertGridAligned(row.pinX, `${bank.name}.${row.displayPinName}.pinX`);
			assertGridAligned(row.pinNameX, `${bank.name}.${row.displayPinName}.pinNameX`);
			assertGridAligned(row.pinNumberX, `${bank.name}.${row.displayPinName}.pinNumberX`);
		}
	}
});

test('arbitrary geometry settings are normalized before layout', async () => {
	const options = normalizeSymbolLayoutOptions({
		rowPitch: 18,
		headerHeight: 27,
		bankGap: 33,
		pinLength: 17,
		cellPadding: 13,
		muxColumnMinWidth: 73,
		muxColumnMaxWidth: 161,
		minBodyWidth: 853,
	});
	assert.equal(options.rowPitch, 20);
	assert.equal(options.headerHeight, 30);
	assert.equal(options.bankGap, 30);
	assert.equal(options.pinLength, 20);
	assert.equal(options.cellPadding, 10);
	assert.equal(options.muxColumnMinWidth, 70);
	assert.equal(options.muxColumnMaxWidth, 160);
	assert.equal(options.minBodyWidth, 850);

	const layout = createSymbolLayout(await referenceTable(), options);
	for (const bank of layout.banks) {
		assert.ok(bank.bodyWidth >= 850);
		assertGridAligned(bank.bodyX, `${bank.name}.bodyX`);
		assertGridAligned(bank.bodyWidth, `${bank.name}.bodyWidth`);
	}
});

test('font sizes accept inch input and convert to EasyEDA native values', () => {
	assert.equal(fontSizeInches(8), 0.08);
	assert.equal(normalizeSymbolLayoutOptions({ pinNameFontSize: 0.08 }).pinNameFontSize, 8);
	assert.equal(normalizeSymbolLayoutOptions({ pinNameFontSize: 8 }).pinNameFontSize, 8);
});

test('EasyEDA method-style errors retain duplicate-name details', () => {
	const apiError = {
		message: () => '标题已存在',
		action: () => 'SYMBOL_SAME_NAMA_EXISTS',
	};
	assert.equal(errorMessage(apiError), '标题已存在 (SYMBOL_SAME_NAMA_EXISTS)');
	assert.equal(isDuplicateLibraryNameError(apiError), true);
});
