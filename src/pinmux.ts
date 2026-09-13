export interface PinmuxRow {
	pinName: string;
	ioType: string;
	functions: Array<string>;
	muxValues: Array<string>;
}

export interface PinmuxTable {
	headers: Array<string>;
	functionHeaders: Array<string>;
	rows: Array<PinmuxRow>;
}

/** One schematic coordinate unit is 10 mil; ten units are one 100 mil (2.54 mm) grid. */
export const SYMBOL_GRID = 10;
export const SYMBOL_GRID_MM = 2.54;
/** Font sizes are kept as hundredths of an inch for layout calculations. */
export const SYMBOL_FONT_SIZE_SCALE = 100;

/** Convert the layout font-size unit to the inch value expected by EasyEDA's native API. */
export function fontSizeInches(value: number): number {
	return value / SYMBOL_FONT_SIZE_SCALE;
}

export interface SymbolLayoutOptions {
	rowPitch: number;
	headerHeight: number;
	bankGap: number;
	pinLength: number;
	titleGap: number;
	cellPadding: number;
	muxColumnMinWidth: number;
	muxColumnMaxWidth: number;
	disableColumnMinWidth: number;
	pinColumnMinWidth: number;
	minBodyWidth: number;
	powerRowEnabled: boolean;
	powerRowHeight: number;
	titleFontSize: number;
	bankFontSize: number;
	headerFontSize: number;
	cellFontSize: number;
	pinNameFontSize: number;
	pinNumberFontSize: number;
	outerLineWidth: number;
	headerLineWidth: number;
	titleColor: string;
	accentColor: string;
	textColor: string;
	mutedColor: string;
	pinColor: string;
}

export type SymbolLayoutOverrides = Partial<SymbolLayoutOptions>;

export interface SymbolSourceOptions extends SymbolLayoutOverrides {
	uuid?: string;
	partId?: string;
	name?: string;
	client?: string;
}

export interface SymbolLayoutRow {
	row: PinmuxRow;
	index: number;
	bankName: string;
	y: number;
	pinX: number;
	pinNameX: number;
	pinNumberX: number;
	pinNumber: string;
	displayPinName: string;
	disableFunction: string;
}

export interface SymbolLayoutColumn {
	kind: 'mux' | 'disable' | 'pin';
	label: string;
	x: number;
	width: number;
	muxIndex?: number;
}

export interface SymbolLayoutBank {
	name: string;
	bodyX: number;
	bodyY: number;
	bodyWidth: number;
	bodyHeight: number;
	reservedRowHeight: number;
	reservedRowBottomY: number;
	labelY: number;
	headerY: number;
	headerBottomY: number;
	columns: Array<SymbolLayoutColumn>;
	rows: Array<SymbolLayoutRow>;
}

export interface SymbolLayout {
	bodyX: number;
	bodyY: number;
	bodyWidth: number;
	bodyHeight: number;
	pinLength: number;
	titleY: number;
	options: SymbolLayoutOptions;
	banks: Array<SymbolLayoutBank>;
	rows: Array<SymbolLayoutRow>;
}

interface SourceRecord {
	type: string;
	id?: string;
	ticket?: number;
}

const HEADER_ALIASES = {
	pinName: ['pin name', 'pin', 'name', 'pin_name'],
	ioType: ['io type', 'i/o type', 'type', 'direction', 'io'],
};

export const DEFAULT_SYMBOL_LAYOUT_OPTIONS: Readonly<SymbolLayoutOptions> = Object.freeze({
	rowPitch: 10,
	headerHeight: 20,
	bankGap: 20,
	pinLength: 20,
	titleGap: 20,
	cellPadding: 10,
	muxColumnMinWidth: 70,
	muxColumnMaxWidth: 180,
	disableColumnMinWidth: 70,
	pinColumnMinWidth: 50,
	minBodyWidth: 0,
	powerRowEnabled: false,
	powerRowHeight: 10,
	titleFontSize: 12,
	bankFontSize: 10,
	headerFontSize: 9,
	cellFontSize: 8,
	pinNameFontSize: 8,
	pinNumberFontSize: 7,
	outerLineWidth: 1,
	headerLineWidth: 1,
	titleColor: '#1F2328',
	accentColor: '#C73737',
	textColor: '#4E565E',
	mutedColor: '#737B83',
	pinColor: '#880000',
});

function normalizeHeader(value: string): string {
	return value.trim().replace(/^\uFEFF/, '').toLowerCase().replace(/[\s_-]+/g, ' ');
}

function findHeader(headers: Array<string>, aliases: Array<string>): number {
	const normalized = headers.map(normalizeHeader);
	return aliases.map(normalizeHeader).reduce((found, alias) => found >= 0 ? found : normalized.indexOf(alias), -1);
}

/** Parse a CSV string while preserving commas and line breaks inside quoted values. */
export function parseCsvRecords(input: string): Array<Array<string>> {
	const records: Array<Array<string>> = [];
	let record: Array<string> = [];
	let field = '';
	let quoted = false;

	for (let index = 0; index < input.length; index++) {
		const character = input[index];
		if (quoted) {
			if (character === '"') {
				if (input[index + 1] === '"') {
					field += '"';
					index++;
				}
				else {
					quoted = false;
				}
			}
			else {
				field += character;
			}
			continue;
		}

		if (character === '"' && field.length === 0) {
			quoted = true;
		}
		else if (character === ',') {
			record.push(field.trim());
			field = '';
		}
		else if (character === '\n' || character === '\r') {
			if (character === '\r' && input[index + 1] === '\n') {
				index++;
			}
			record.push(field.trim());
			field = '';
			if (record.some(value => value.length > 0)) {
				records.push(record);
			}
			record = [];
		}
		else {
			field += character;
		}
	}

	if (field.length > 0 || record.length > 0) {
		record.push(field.trim());
		if (record.some(value => value.length > 0)) {
			records.push(record);
		}
	}

	return records;
}

/** Parse the pinmux CSV convention used by reference/pinout.csv. */
export function parsePinmuxCsv(input: string): PinmuxTable {
	const records = parseCsvRecords(input.replace(/^\uFEFF/, ''));
	if (records.length === 0) {
		throw new Error('CSV 文件为空。');
	}

	const headers = records[0].map(value => value.trim());
	const pinNameIndex = findHeader(headers, HEADER_ALIASES.pinName);
	const ioTypeIndex = findHeader(headers, HEADER_ALIASES.ioType);
	if (pinNameIndex < 0 || ioTypeIndex < 0) {
		throw new Error('CSV 必须包含 Pin Name 和 IO Type 两列表头。');
	}

	const functionIndexes = headers
		.map((_, index) => index)
		.filter(index => index !== pinNameIndex && index !== ioTypeIndex);
	const rows: Array<PinmuxRow> = [];
	for (const values of records.slice(1)) {
		const pinName = (values[pinNameIndex] ?? '').trim();
		if (!pinName) {
			continue;
		}
		const muxValues = functionIndexes.map(index => (values[index] ?? '').trim());
		const functions = muxValues.filter(Boolean);
		rows.push({
			pinName,
			ioType: (values[ioTypeIndex] ?? '').trim(),
			functions: [...new Set(functions)],
			muxValues,
		});
	}

	if (rows.length === 0) {
		throw new Error('CSV 中没有可用的引脚行。');
	}

	return {
		headers,
		functionHeaders: functionIndexes.map(index => headers[index]),
		rows,
	};
}

export function electricType(ioType: string): number {
	const normalized = ioType.trim().toUpperCase().replace(/[\s_-]+/g, '');
	if (normalized === 'I' || normalized === 'INPUT') {
		return 1;
	}
	if (normalized === 'O' || normalized === 'OUTPUT') {
		return 2;
	}
	if (normalized === 'IO' || normalized === 'I/O' || normalized === 'B' || normalized === 'BI' || normalized === 'BIDIRECTIONAL') {
		return 3;
	}
	return 0;
}

function finiteNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

export function snapToSymbolGrid(value: number): number {
	return Math.round(value / SYMBOL_GRID) * SYMBOL_GRID;
}

function gridOption(value: unknown, fallback: number, minimum: number, maximum: number): number {
	return snapToSymbolGrid(clamp(finiteNumber(value, fallback), minimum, maximum));
}

function scalarOption(value: unknown, fallback: number, minimum: number, maximum: number): number {
	return Math.round(clamp(finiteNumber(value, fallback), minimum, maximum));
}

function booleanOption(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function fontOption(value: unknown, fallback: number, minimum: number, maximum: number): number {
	const numeric = finiteNumber(value, fallback);
	// Accept both the legacy layout value (8) and the inch value (0.08) from
	// persisted configurations or callers using the native API's convention.
	const layoutValue = numeric > 0 && numeric <= 1 ? numeric * SYMBOL_FONT_SIZE_SCALE : numeric;
	return Math.round(clamp(layoutValue, minimum, maximum));
}

function colorOption(value: unknown, fallback: string): string {
	return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
}

/** Validate user configuration and quantize every geometric value to the 100 mil grid. */
export function normalizeSymbolLayoutOptions(overrides: SymbolLayoutOverrides = {}): SymbolLayoutOptions {
	const defaults = DEFAULT_SYMBOL_LAYOUT_OPTIONS;
	const muxColumnMinWidth = gridOption(overrides.muxColumnMinWidth, defaults.muxColumnMinWidth, 40, 400);
	const requestedMuxMaximum = gridOption(overrides.muxColumnMaxWidth, defaults.muxColumnMaxWidth, 40, 600);
	return {
		rowPitch: gridOption(overrides.rowPitch, defaults.rowPitch, 10, 60),
		headerHeight: gridOption(overrides.headerHeight, defaults.headerHeight, 20, 100),
		bankGap: gridOption(overrides.bankGap, defaults.bankGap, 20, 120),
		pinLength: gridOption(overrides.pinLength, defaults.pinLength, 10, 100),
		titleGap: gridOption(overrides.titleGap, defaults.titleGap, 20, 120),
		cellPadding: gridOption(overrides.cellPadding, defaults.cellPadding, 10, 50),
		muxColumnMinWidth,
		muxColumnMaxWidth: Math.max(muxColumnMinWidth, requestedMuxMaximum),
		disableColumnMinWidth: gridOption(overrides.disableColumnMinWidth, defaults.disableColumnMinWidth, 40, 400),
		pinColumnMinWidth: gridOption(overrides.pinColumnMinWidth, defaults.pinColumnMinWidth, 30, 300),
		minBodyWidth: gridOption(overrides.minBodyWidth, defaults.minBodyWidth, 0, 1600),
		powerRowEnabled: booleanOption(overrides.powerRowEnabled, defaults.powerRowEnabled),
		powerRowHeight: gridOption(overrides.powerRowHeight, defaults.powerRowHeight, 10, 100),
		titleFontSize: fontOption(overrides.titleFontSize, defaults.titleFontSize, 6, 24),
		bankFontSize: fontOption(overrides.bankFontSize, defaults.bankFontSize, 6, 20),
		headerFontSize: fontOption(overrides.headerFontSize, defaults.headerFontSize, 6, 20),
		cellFontSize: fontOption(overrides.cellFontSize, defaults.cellFontSize, 6, 18),
		pinNameFontSize: fontOption(overrides.pinNameFontSize, defaults.pinNameFontSize, 6, 18),
		pinNumberFontSize: fontOption(overrides.pinNumberFontSize, defaults.pinNumberFontSize, 6, 18),
		outerLineWidth: scalarOption(overrides.outerLineWidth, defaults.outerLineWidth, 1, 10),
		headerLineWidth: scalarOption(overrides.headerLineWidth, defaults.headerLineWidth, 1, 10),
		titleColor: colorOption(overrides.titleColor, defaults.titleColor),
		accentColor: colorOption(overrides.accentColor, defaults.accentColor),
		textColor: colorOption(overrides.textColor, defaults.textColor),
		mutedColor: colorOption(overrides.mutedColor, defaults.mutedColor),
		pinColor: colorOption(overrides.pinColor, defaults.pinColor),
	};
}

function muxLabel(header: string, index: number): string {
	const match = /(?:function|mux)[\s_-]*(\d+)/i.exec(header) ?? /(\d+)\s*$/.exec(header);
	return match ? `MUX${match[1]}` : header.trim() || `MUX${index + 1}`;
}

function splitPinName(pinName: string): { displayPinName: string; disableFunction: string } {
	const parts = pinName.split('/').map(value => value.trim()).filter(Boolean);
	const displayPinName = parts.at(-1) ?? pinName;
	const disableFunction = parts.slice(0, -1).join('/').replace(/^GP(?=ADC)/i, '');
	return { displayPinName, disableFunction };
}

function pinGroup(pinName: string): string {
	return /^P[A-Z]+/i.exec(pinName)?.[0].toUpperCase() ?? pinName.replace(/\d.*$/, '').toUpperCase();
}

function tableColumnWidth(label: string, values: Array<string>, fontSize: number, padding: number, minimum: number, maximum: number): number {
	const longest = values.reduce((length, value) => Math.max(length, value.length), label.length);
	const estimatedTextWidth = longest * Math.max(4, fontSize * 0.6);
	return gridOption(estimatedTextWidth + padding * 2, minimum, minimum, maximum);
}

/** Calculate one shared, grid-aligned layout for preview and native API generation. */
export function createSymbolLayout(table: PinmuxTable, overrides: SymbolLayoutOverrides = {}): SymbolLayout {
	const options = normalizeSymbolLayoutOptions(overrides);
	const groupedRows = new Map<string, Array<{ row: PinmuxRow; index: number; displayPinName: string; disableFunction: string }>>();
	table.rows.forEach((row, index) => {
		const identity = splitPinName(row.pinName);
		const bankName = pinGroup(identity.displayPinName);
		const bankRows = groupedRows.get(bankName) ?? [];
		bankRows.push({ row, index, ...identity });
		groupedRows.set(bankName, bankRows);
	});

	const bankDrafts = [...groupedRows].map(([name, bankRows]) => {
		const activeMuxIndexes = table.functionHeaders
			.map((_, muxIndex) => muxIndex)
			.filter(muxIndex => bankRows.some(({ row }) => Boolean(row.muxValues[muxIndex])));
		const columnDefinitions: Array<Omit<SymbolLayoutColumn, 'x'>> = activeMuxIndexes.map((muxIndex) => {
			const label = muxLabel(table.functionHeaders[muxIndex], muxIndex);
			return {
				kind: 'mux',
				label,
				muxIndex,
				width: tableColumnWidth(label, bankRows.map(({ row }) => row.muxValues[muxIndex] ?? ''), options.cellFontSize, options.cellPadding, options.muxColumnMinWidth, options.muxColumnMaxWidth),
			};
		});
		if (bankRows.some(row => Boolean(row.disableFunction))) {
			columnDefinitions.push({
				kind: 'disable',
				label: 'DISABLE',
				width: tableColumnWidth('DISABLE', bankRows.map(row => row.disableFunction), options.cellFontSize, options.cellPadding, options.disableColumnMinWidth, Math.max(options.disableColumnMinWidth, options.muxColumnMaxWidth)),
			});
		}
		columnDefinitions.push({
			kind: 'pin',
			label: 'PIN',
			width: tableColumnWidth('PIN', bankRows.map(row => row.displayPinName), options.pinNameFontSize, options.cellPadding, options.pinColumnMinWidth, Math.max(options.pinColumnMinWidth, options.muxColumnMaxWidth)),
		});
		const automaticBodyWidth = columnDefinitions.reduce((total, column) => total + column.width, 0);
		const bodyWidth = Math.max(automaticBodyWidth, options.minBodyWidth);
		columnDefinitions[columnDefinitions.length - 1].width += bodyWidth - automaticBodyWidth;
		return {
			name,
			bankRows,
			columnDefinitions,
			bodyWidth,
			bodyHeight: options.headerHeight + (bankRows.length + 1) * options.rowPitch + (options.powerRowEnabled ? options.powerRowHeight : 0),
		};
	});

	const bodyWidth = Math.max(options.minBodyWidth, ...bankDrafts.map(bank => bank.bodyWidth));
	const bodyHeight = bankDrafts.reduce((height, bank) => height + bank.bodyHeight, 0) + Math.max(0, bankDrafts.length - 1) * options.bankGap;
	let bankTop = Math.ceil(bodyHeight / (SYMBOL_GRID * 2)) * SYMBOL_GRID;
	const firstBankTop = bankTop;
	const overallBodyX = -Math.floor(bodyWidth / (SYMBOL_GRID * 2)) * SYMBOL_GRID;
	const reservedRowHeight = options.powerRowEnabled ? options.powerRowHeight : 0;
	const banks = bankDrafts.map((draft) => {
		const bodyX = -Math.floor(draft.bodyWidth / (SYMBOL_GRID * 2)) * SYMBOL_GRID;
		let columnX = bodyX;
		const columns = draft.columnDefinitions.map((column) => {
			const layoutColumn = { ...column, x: columnX };
			columnX += column.width;
			return layoutColumn;
		});
		const headerTopY = bankTop - reservedRowHeight;
		const headerBottomY = headerTopY - options.headerHeight;
		const pinColumn = columns.at(-1);
		const bodyRight = bodyX + draft.bodyWidth;
		const rows = draft.bankRows.map(({ row, index, displayPinName, disableFunction }, bankRowIndex) => ({
			row,
			index,
			bankName: draft.name,
			y: headerBottomY - (bankRowIndex + 1) * options.rowPitch,
			pinX: bodyRight + options.pinLength,
			pinNameX: (pinColumn?.x ?? bodyX) + (pinColumn?.width ?? 0) - options.cellPadding,
			pinNumberX: bodyRight,
			pinNumber: String(index + 1),
			displayPinName,
			disableFunction,
		}));
		const bank: SymbolLayoutBank = {
			name: draft.name,
			bodyX,
			bodyY: bankTop,
			bodyWidth: draft.bodyWidth,
			bodyHeight: draft.bodyHeight,
			reservedRowHeight,
			reservedRowBottomY: headerTopY,
			labelY: bankTop + SYMBOL_GRID,
			headerY: headerTopY - snapToSymbolGrid(options.headerHeight / 2),
			headerBottomY,
			columns,
			rows,
		};
		bankTop -= draft.bodyHeight + options.bankGap;
		return bank;
	});

	return {
		bodyX: overallBodyX,
		bodyY: firstBankTop,
		bodyWidth,
		bodyHeight,
		pinLength: options.pinLength,
		titleY: firstBankTop + options.titleGap + SYMBOL_GRID,
		options,
		banks,
		rows: banks.flatMap(bank => bank.rows),
	};
}

function id(prefix: string, index: number): string {
	return `${prefix}${index.toString(36)}`;
}

function record(type: string, payload: unknown, recordId?: string): string {
	const outer: SourceRecord = { type, ticket: 1 };
	if (recordId !== undefined) {
		outer.id = recordId;
	}
	return `${JSON.stringify(outer)}||${JSON.stringify(payload)}|`;
}

function primitivePayload(partId: string, zIndex: number, extra: Record<string, unknown>): Record<string, unknown> {
	return { partId, groupId: 0, locked: false, zIndex, ...extra };
}

function attribute(partId: string, parentId: string, key: string, value: string, x: number, y: number, align: number, fontSize: number, color: string): Record<string, unknown> {
	return {
		partId,
		groupId: 0,
		locked: true,
		zIndex: 0.1,
		parentId,
		key,
		value,
		keyVisible: false,
		valueVisible: true,
		positionX: x,
		positionY: y,
		rotation: 0,
		color,
		fillColor: null,
		fontFamily: 'Courier New',
		fontSize,
		strikeout: false,
		underline: false,
		italic: false,
		fontWeight: true,
		vAlign: 1,
		hAlign: align,
	};
}

function text(partId: string, value: string, x: number, y: number, fontSize: number, align: number, color: string): Record<string, unknown> {
	return primitivePayload(partId, 4.1, {
		positionX: x,
		positionY: y,
		rotation: 0,
		value,
		color,
		fillColor: '',
		fontFamily: 'Courier New',
		fontSize,
		strikeout: false,
		underline: false,
		italic: false,
		fontWeight: true,
		vAlign: 1,
		hAlign: align,
	});
}

function uuid(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `pinmux-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Build an EasyEDA SYMBOL document source from a parsed pinmux table. */
export function generateSymbolSource(table: PinmuxTable, sourceOptions: SymbolSourceOptions = {}): string {
	const symbolUuid = sourceOptions.uuid ?? uuid();
	const partId = sourceOptions.partId ?? '';
	const layout = createSymbolLayout(table, sourceOptions);
	const options = layout.options;
	const left = Math.min(...layout.banks.map(bank => bank.bodyX)) - layout.pinLength - 50;
	const right = Math.max(...layout.banks.map(bank => bank.bodyX + bank.bodyWidth)) + layout.pinLength + 50;
	const bottom = Math.min(...layout.banks.map(bank => bank.bodyY - bank.bodyHeight)) - 50;
	const top = layout.titleY + 50;
	const records: Array<string> = [
		record('DOCHEAD', { docType: 'SYMBOL', uuid: symbolUuid, client: sourceOptions.client ?? 'pinmux2symbol' }),
		record('CANVAS', { originX: 0, originY: 0 }),
		record('PART', { BBOX: [left, bottom, right, top] }, partId),
	];

	const title = sourceOptions.name ? `${sourceOptions.name}  |  ${table.rows.length} pins` : `Pinmux symbol  |  ${table.rows.length} pins`;
	records.push(record('TEXT', text(partId, title, 0, layout.titleY, options.titleFontSize, 1, options.titleColor), id('title-', 0)));
	for (const [bankIndex, bank] of layout.banks.entries()) {
		records.push(record('RECT', primitivePayload(partId, 1.1, {
			dotX1: bank.bodyX,
			dotY1: bank.bodyY,
			dotX2: bank.bodyX + bank.bodyWidth,
			dotY2: bank.bodyY - bank.bodyHeight,
			radiusX: 0,
			radiusY: 0,
			rotation: 0,
			strokeColor: options.accentColor,
			strokeStyle: 0,
			fillColor: '',
			strokeWidth: options.outerLineWidth,
			fillStyle: 1,
		}), id('body-', bankIndex)));
		records.push(record('TEXT', text(partId, `BANK ${bank.name}  |  ${bank.rows.length} IO`, bank.bodyX, bank.labelY, options.bankFontSize, 0, options.accentColor), id('bank-', bankIndex)));

		for (const [columnIndex, column] of bank.columns.entries()) {
			const align = column.kind === 'pin' ? 2 : 0;
			const x = column.kind === 'pin' ? column.x + column.width - options.cellPadding : column.x + options.cellPadding;
			records.push(record('TEXT', text(partId, column.label, x, bank.headerY, options.headerFontSize, align, options.accentColor), id(`header-${bankIndex}-`, columnIndex)));
		}

		for (const placement of bank.rows) {
			const { index, row, y, pinX, pinNameX, pinNumberX, pinNumber, displayPinName, disableFunction } = placement;
			const pinId = id('pin-', index);
			records.push(record('PIN', primitivePayload(partId, 2.1, {
				display: true,
				electric: electricType(row.ioType),
				positionX: pinX,
				positionY: y,
				length: layout.pinLength,
				rotation: 0,
				color: options.pinColor,
				pinShape: 0,
			}), pinId));
			records.push(record('ATTR', attribute(partId, pinId, 'NAME', displayPinName, pinNameX, y, 2, options.pinNameFontSize, options.titleColor), id('name-', index)));
			records.push(record('ATTR', attribute(partId, pinId, 'NUMBER', pinNumber, pinNumberX, y, 0, options.pinNumberFontSize, options.mutedColor), id('number-', index)));

			for (const [columnIndex, column] of bank.columns.entries()) {
				const value = column.kind === 'mux' ? row.muxValues[column.muxIndex ?? -1] ?? '' : column.kind === 'disable' ? disableFunction : '';
				if (value) {
					records.push(record('TEXT', text(partId, value, column.x + options.cellPadding, y, options.cellFontSize, 0, options.textColor), id(`cell-${bankIndex}-${columnIndex}-`, index)));
				}
			}
		}
	}

	return records.join('\n');
}

export function defaultSymbolName(fileName: string): string {
	const withoutExtension = fileName.replace(/\.[^.]+$/, '');
	const normalized = withoutExtension.trim().replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '');
	return normalized || 'PinmuxSymbol';
}
