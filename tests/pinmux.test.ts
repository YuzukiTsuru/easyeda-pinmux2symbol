/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { errorMessage, isDuplicateLibraryNameError } from '../src/generator.js';
import {
	createSymbolLayout,
	fontSizeInches,
	generateSymbolSource,
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
	assert.equal(layout.rows[0].pinNumber, '1');
});

test('PIN column supplies package pin numbers and is excluded from mux functions', () => {
	const table = parsePinmuxCsv([
		'Pin Name,PIN,IO Type,Function2,Function14',
		'PA0,D10,I/O,GPADC1_1,PA_EINT0',
		'PA1,B5,I/O,NCSI_D8,PA_EINT1',
	].join('\n'));
	assert.deepEqual(table.functionHeaders, ['Function2', 'Function14']);
	assert.deepEqual(table.rows.map(row => row.pinNumber), ['D10', 'B5']);
	assert.deepEqual(table.rows[0].muxValues, ['GPADC1_1', 'PA_EINT0']);

	const layout = createSymbolLayout(table);
	assert.deepEqual(layout.rows.map(row => row.pinNumber), ['D10', 'B5']);
	const source = generateSymbolSource(table, { name: 'PIN_NUMBER_TEST' });
	assert.match(source, /"key":"NUMBER","value":"D10"/);
	assert.match(source, /"key":"NUMBER","value":"B5"/);
});

test('legacy CSV without a PIN column keeps sequential pin numbers', () => {
	const table = parsePinmuxCsv([
		'Pin Name,IO Type,Function2',
		'PA0,I/O,UART0_TX',
		'PA1,I/O,UART0_RX',
	].join('\n'));
	assert.deepEqual(table.rows.map(row => row.pinNumber), ['1', '2']);
});

test('every generated geometry coordinate is aligned to the 100 mil grid', async () => {
	const layout = createSymbolLayout(await referenceTable());
	const layoutValues = [layout.bodyX, layout.bodyY, layout.bodyWidth, layout.bodyHeight, layout.pinLength, layout.titleY];
	layoutValues.forEach((value, index) => assertGridAligned(value, `layout[${index}]`));

	for (const bank of layout.banks) {
		[bank.bodyX, bank.bodyY, bank.bodyWidth, bank.bodyHeight, bank.reservedRowHeight, bank.reservedRowBottomY, bank.labelY, bank.headerY, bank.headerBottomY]
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
	for (const bank of layout.banks) {
		assertGridAligned(bank.reservedRowHeight, `${bank.name}.reservedRowHeight`);
	}
});

test('power row reserves one blank row in every Bank', async () => {
	const table = await referenceTable();
	const enabled = createSymbolLayout(table);
	assert.equal(enabled.options.powerRowEnabled, false);
	assert.equal(enabled.options.powerRowHeight, 10);

	const disabled = createSymbolLayout(table, { powerRowEnabled: false });
	const reserved = createSymbolLayout(table, { powerRowEnabled: true });
	assert.equal(enabled.banks.length, disabled.banks.length);
	assert.equal(reserved.bodyHeight, disabled.bodyHeight + reserved.banks.length * 10);
	for (let index = 0; index < reserved.banks.length; index++) {
		const enabledBank = reserved.banks[index];
		const disabledBank = disabled.banks[index];
		assert.equal(enabledBank.reservedRowHeight, 10);
		assert.equal(disabledBank.reservedRowHeight, 0);
		assert.equal(enabledBank.bodyWidth, disabledBank.bodyWidth, 'reserved row must not widen a Bank');
		assert.equal(enabledBank.bodyHeight, disabledBank.bodyHeight + 10);
		assert.equal(enabledBank.reservedRowBottomY, enabledBank.bodyY - enabledBank.reservedRowHeight);
		assert.equal(disabledBank.reservedRowBottomY, disabledBank.bodyY);
		assert.equal(enabledBank.bodyY - enabledBank.headerBottomY, disabledBank.bodyY - disabledBank.headerBottomY + 10);
		assert.equal(enabledBank.headerBottomY - enabledBank.rows[0].y, disabledBank.headerBottomY - disabledBank.rows[0].y);
	}
});

test('generated symbol source leaves the reserved row blank', async () => {
	const table = await referenceTable();
	const source = generateSymbolSource(table, { name: 'POWER_TEST' });
	assert.match(source, /POWER_TEST\s+\|\s+56 pins/);
	assert.doesNotMatch(source, /POWER \(1V8 Only\)|VDD18-DRAM|J11/);
	assert.equal((source.match(/"type":"PIN"/g) ?? []).length, table.rows.length);
	assert.equal((generateSymbolSource(table, { powerRowEnabled: false }).match(/"type":"PIN"/g) ?? []).length, table.rows.length);
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
