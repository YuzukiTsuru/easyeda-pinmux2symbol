import type { PinmuxTable, SymbolLayoutOptions, SymbolLayoutOverrides } from './pinmux.js';
import { createSymbolLayout, electricType, fontSizeInches } from './pinmux.js';

export interface GenerationProgress {
	percent: number;
	message: string;
}

export type GenerationProgressCallback = (progress: GenerationProgress) => void;

export class DuplicateLibraryNameError extends Error {
	public constructor(public readonly itemName: string) {
		super(`个人库中已存在名为“${itemName}”的符号或器件。`);
		this.name = 'DuplicateLibraryNameError';
	}
}

const ERROR_NESTED_PROPERTIES = ['cause', 'error', 'data', 'detail', 'reason', 'response', 'body', 'message'];
const ERROR_METHOD_PROPERTIES = new Set(['_action', '_message', 'action', 'code', 'message', 'toJSON']);
const LIBRARY_SEARCH_PAGE_SIZE = 100;
const LIBRARY_SEARCH_MAX_PAGES = 20;

function readableErrorText(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const text = value.trim();
	return !text || text.includes('[object Object]') ? undefined : text;
}

function readErrorProperty(value: object, property: PropertyKey): unknown {
	let propertyValue: unknown;
	try {
		propertyValue = Reflect.get(value, property, value);
	}
	catch {
		return undefined;
	}
	if (typeof propertyValue === 'function' && typeof property === 'string' && ERROR_METHOD_PROPERTIES.has(property)) {
		try {
			return propertyValue.call(value);
		}
		catch {
			// Some host error accessors throw when called outside their request context.
		}
	}
	return propertyValue;
}

function enqueueErrorValue(queue: Array<unknown>, value: unknown): void {
	if ((typeof value === 'object' && value !== null) || typeof value === 'string') {
		queue.push(value);
	}
}

function errorProperty(error: unknown, properties: Array<string>): string | undefined {
	const queue: Array<unknown> = [error];
	const visited = new Set<object>();
	let inspected = 0;

	while (queue.length > 0 && inspected < 40) {
		const current = queue.shift();
		inspected++;
		if (typeof current === 'string') {
			const text = current.trim();
			if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
				try {
					queue.push(JSON.parse(text));
				}
				catch {
					// Continue through the normal string fallback.
				}
			}
			continue;
		}
		if (typeof current !== 'object' || current === null || visited.has(current)) {
			continue;
		}
		visited.add(current);

		for (const property of properties) {
			try {
				const value = readErrorProperty(current, property);
				const text = readableErrorText(value);
				if (text) {
					return text;
				}
				enqueueErrorValue(queue, value);
			}
			catch {
				// Some EasyEDA error fields are accessors that may throw.
			}
		}

		for (const property of ERROR_NESTED_PROPERTIES) {
			try {
				enqueueErrorValue(queue, readErrorProperty(current, property));
			}
			catch {
				// Ignore inaccessible wrapper fields.
			}
		}

		try {
			for (const property of Reflect.ownKeys(current)) {
				enqueueErrorValue(queue, readErrorProperty(current, property));
			}
		}
		catch {
			// Cross-realm proxy errors may not expose their own keys.
		}
	}
	return undefined;
}

function errorAction(error: unknown): string | undefined {
	return errorProperty(error, ['_action']) ?? errorProperty(error, ['action', 'code']);
}

export function isDuplicateLibraryNameError(error: unknown): boolean {
	if (error instanceof DuplicateLibraryNameError) {
		return true;
	}
	const action = errorAction(error)?.toUpperCase();
	const message = errorProperty(error, ['_message']) ?? errorProperty(error, ['message']);
	return action?.includes('_SAME_NAM') === true
		|| message?.includes('标题已存在') === true
		|| message?.toLowerCase().includes('name already exists') === true;
}

export function errorMessage(error: unknown): string {
	const message = errorProperty(error, ['_message']) ?? errorProperty(error, ['message']);
	const action = errorAction(error);
	if (message && action) {
		return `${message} (${action})`;
	}
	if (message) {
		return message;
	}
	const directText = readableErrorText(error);
	if (directText) {
		return directText;
	}
	return action ? `EasyEDA 操作失败 (${action})` : 'EasyEDA 操作失败，未返回错误详情。';
}

function operationError(operation: string, error: unknown): Error {
	const wrapped = new Error(`${operation}：${errorMessage(error)}`) as Error & { cause?: unknown };
	wrapped.cause = error;
	return wrapped;
}

export function nextSymbolName(symbolName: string): string {
	const match = /^(.*)_(\d+)$/.exec(symbolName);
	const suffix = match ? `_${Number(match[2]) + 1}` : '_2';
	const base = match ? match[1] : symbolName;
	return `${base.slice(0, Math.max(1, 128 - suffix.length))}${suffix}`;
}

interface LibraryNameSearchResult {
	available: boolean;
	names: Array<string>;
}

async function searchLibraryNames(fetchPage: (page: number) => Promise<unknown>): Promise<LibraryNameSearchResult> {
	const names: Array<string> = [];
	let available = false;
	for (let page = 1; page <= LIBRARY_SEARCH_MAX_PAGES; page++) {
		let result: unknown;
		try {
			result = await fetchPage(page);
			available = true;
		}
		catch {
			break;
		}
		if (!Array.isArray(result)) {
			break;
		}
		for (const item of result) {
			if (!item || typeof item !== 'object') {
				continue;
			}
			try {
				const name = Reflect.get(item, 'name');
				if (typeof name === 'string' && name.trim()) {
					names.push(name.trim());
				}
			}
			catch {
				// Ignore malformed library rows returned by older host builds.
			}
		}
		if (result.length < LIBRARY_SEARCH_PAGE_SIZE) {
			break;
		}
	}
	return { available, names };
}

/** Check both personal-library namespaces before invoking create, whose RPC error loses details. */
async function personalLibraryNameExists(libraryUuid: string, requestedName: string): Promise<boolean | undefined> {
	const [symbols, devices] = await Promise.all([
		searchLibraryNames(page => eda.lib_Symbol.search('', libraryUuid, [], undefined, LIBRARY_SEARCH_PAGE_SIZE, page)),
		searchLibraryNames(page => eda.lib_Device.search('', libraryUuid, [], undefined, LIBRARY_SEARCH_PAGE_SIZE, page)),
	]);
	if (!symbols.available && !devices.available) {
		console.warn('[Pinmux2Symbol] Personal-library name preflight is unavailable; continuing with EasyEDA create.');
		return undefined;
	}
	const normalizedName = requestedName.trim().toLocaleLowerCase();
	return [...symbols.names, ...devices.names].some(name => name.toLocaleLowerCase() === normalizedName);
}

function reportProgress(percent: number, message: string, callback?: GenerationProgressCallback): void {
	eda.sys_LoadingAndProgressBar.showProgressBar(percent, message);
	callback?.({ percent, message });
}

function pinType(ioType: string): ESCH_PrimitivePinType {
	switch (electricType(ioType)) {
		case 1:
			return ESCH_PrimitivePinType.IN;
		case 2:
			return ESCH_PrimitivePinType.OUT;
		case 3:
			return ESCH_PrimitivePinType.BI;
		default:
			return ESCH_PrimitivePinType.UNDEFINED;
	}
}

async function waitForSymbolEditor(symbolUuid: string, tabId: string): Promise<void> {
	await eda.dmt_EditorControl.activateDocument(tabId);
	for (let attempt = 0; attempt < 40; attempt++) {
		const document = await eda.dmt_SelectControl.getCurrentDocumentInfo();
		if (document?.uuid === symbolUuid && document.documentType === EDMT_EditorDocumentType.SYMBOL_COMPONENT) {
			return;
		}
		await new Promise<void>(resolve => setTimeout(resolve, 200));
	}
	throw new Error('符号编辑器加载超时。');
}

async function waitForSave(): Promise<void> {
	const saved = await Promise.race([
		eda.sch_Document.save(),
		new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 20000)),
	]);
	if (saved === false) {
		throw new Error('符号图元已生成，但保存文档失败。');
	}
	if (saved === 'timeout') {
		console.warn('[Pinmux2Symbol] Symbol save did not settle within 20 seconds; continuing after the editor-side save timeout.');
	}
}

async function createTableLine(x1: number, y1: number, x2: number, y2: number, color: string, lineWidth: number): Promise<void> {
	const line = await eda.sch_PrimitivePolygon.create([x1, y1, x2, y2], color, 'none', lineWidth, ESCH_PrimitiveLineType.SOLID);
	if (!line) {
		throw new Error('无法创建 MUX 表头分隔线。');
	}
}

interface PendingPinStyle {
	pin: ISCH_PrimitivePin;
	placement: PinStylePlacement;
}

interface PinStylePlacement {
	y: number;
	pinNameX: number;
	pinNumberX: number;
	pinNumber: string;
	displayPinName: string;
}

interface PinTextAttributes {
	name?: ISCH_PrimitiveAttribute;
	number?: ISCH_PrimitiveAttribute;
}

function pinAttributeKind(attribute: ISCH_PrimitiveAttribute, pending: PendingPinStyle): keyof PinTextAttributes | undefined {
	try {
		const key = attribute.getState_Key().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
		if (key === 'NAME' || key === 'PINNAME') {
			return 'name';
		}
		if (key === 'NUMBER' || key === 'PINNUMBER' || key === 'PINNO') {
			return 'number';
		}
	}
	catch {
		// Some EasyEDA builds return partially initialized attribute proxies.
	}

	try {
		const value = attribute.getState_Value();
		if (value === pending.placement.displayPinName) {
			return 'name';
		}
		if (value === pending.placement.pinNumber) {
			return 'number';
		}
	}
	catch {
		// Keep the attribute unclassified and use EasyEDA's default presentation.
	}
	return undefined;
}

function collectPinAttributes(
	attributes: Array<ISCH_PrimitiveAttribute>,
	pendingById: Map<string, PendingPinStyle>,
	collected: Map<string, PinTextAttributes>,
	scopedPinId?: string,
): void {
	for (const attribute of attributes) {
		let pinId = scopedPinId;
		if (!pinId) {
			try {
				pinId = attribute.getState_ParentPrimitiveId();
			}
			catch {
				continue;
			}
		}
		const pending = pendingById.get(pinId);
		if (!pending) {
			continue;
		}
		const kind = pinAttributeKind(attribute, pending);
		if (kind) {
			const pair = collected.get(pinId) ?? {};
			pair[kind] = attribute;
			collected.set(pinId, pair);
		}
	}
}

function hasCompletePinAttributes(pending: Array<PendingPinStyle>, collected: Map<string, PinTextAttributes>): boolean {
	return pending.every(({ pin }) => {
		const attributes = collected.get(pin.getState_PrimitiveId());
		return Boolean(attributes?.name && attributes.number);
	});
}

async function stylePinAttributes(pending: Array<PendingPinStyle>, options: SymbolLayoutOptions): Promise<void> {
	const pendingById = new Map(pending.map(item => [item.pin.getState_PrimitiveId(), item]));
	const collected = new Map<string, PinTextAttributes>();

	// Pin NAME/NUMBER attributes are created asynchronously by the editor. Query them only
	// after every pin exists and allow the editor time to expose the child primitives.
	for (let attempt = 0; attempt < 10 && !hasCompletePinAttributes(pending, collected); attempt++) {
		try {
			collectPinAttributes(await eda.sch_PrimitiveAttribute.getAll(), pendingById, collected);
		}
		catch (error: unknown) {
			if (attempt === 9) {
				console.warn('[Pinmux2Symbol] Failed to enumerate pin text attributes:', error);
			}
		}
		if (!hasCompletePinAttributes(pending, collected)) {
			await new Promise<void>(resolve => setTimeout(resolve, 150));
		}
	}

	// Some host builds only return child attributes when a parent ID is supplied.
	for (const { pin } of pending) {
		const pinId = pin.getState_PrimitiveId();
		const attributes = collected.get(pinId);
		if (attributes?.name && attributes.number) {
			continue;
		}
		try {
			collectPinAttributes(await eda.sch_PrimitiveAttribute.getAll(pinId), pendingById, collected, pinId);
		}
		catch (error: unknown) {
			console.warn(`[Pinmux2Symbol] Failed to read text attributes for pin ${pin.getState_PinNumber()}:`, error);
		}
	}

	const missing: Array<string> = [];
	for (const item of pending) {
		const pinId = item.pin.getState_PrimitiveId();
		const attributes = collected.get(pinId);
		if (!attributes?.name || !attributes.number) {
			missing.push(item.pin.getState_PinNumber());
		}
		try {
			if (attributes?.name) {
				await eda.sch_PrimitiveAttribute.modify(attributes.name, {
					x: item.placement.pinNameX,
					y: item.placement.y,
					rotation: 0,
					color: options.titleColor,
					fontName: 'Courier New',
					fontSize: fontSizeInches(options.pinNameFontSize),
					bold: true,
					alignMode: ESCH_PrimitiveTextAlignMode.RIGHT_MIDDLE,
					valueVisible: true,
				});
			}
			if (attributes?.number) {
				await eda.sch_PrimitiveAttribute.modify(attributes.number, {
					x: item.placement.pinNumberX,
					y: item.placement.y,
					rotation: 0,
					color: options.mutedColor,
					fontName: 'Courier New',
					fontSize: fontSizeInches(options.pinNumberFontSize),
					bold: true,
					alignMode: ESCH_PrimitiveTextAlignMode.LEFT_BOTTOM,
					valueVisible: true,
				});
			}
		}
		catch (error: unknown) {
			console.warn(`[Pinmux2Symbol] Failed to style text for pin ${item.pin.getState_PinNumber()}; keeping EasyEDA defaults:`, error);
		}
	}

	if (missing.length > 0) {
		console.warn(`[Pinmux2Symbol] EasyEDA did not expose complete text attributes for ${missing.length} pin(s); kept their default labels: ${missing.join(', ')}`);
	}
}

async function createPrimitives(
	table: PinmuxTable,
	symbolName: string,
	tabId: string,
	overrides: SymbolLayoutOverrides,
	onProgress?: GenerationProgressCallback,
): Promise<void> {
	const layout = createSymbolLayout(table, overrides);
	const options = layout.options;
	const title = `${symbolName}  |  ${table.rows.length} pins`;
	const pendingPinStyles: Array<PendingPinStyle> = [];
	const titleText = await eda.sch_PrimitiveText.create(0, layout.titleY, title, 0, options.titleColor, 'Courier New', options.titleFontSize, true, false, false, ESCH_PrimitiveTextAlignMode.CENTER);
	if (!titleText) {
		throw new Error('无法在符号编辑器中创建标题。');
	}

	for (const bank of layout.banks) {
		const bodyRight = bank.bodyX + bank.bodyWidth;
		const rectangle = await eda.sch_PrimitiveRectangle.create(
			bank.bodyX,
			bank.bodyY,
			bank.bodyWidth,
			bank.bodyHeight,
			0,
			0,
			options.accentColor,
			'none',
			options.outerLineWidth,
			ESCH_PrimitiveLineType.SOLID,
			ESCH_PrimitiveFillStyle.NONE,
		);
		if (!rectangle) {
			throw new Error(`无法创建 Bank ${bank.name} 的外框。`);
		}

		const bankLabel = await eda.sch_PrimitiveText.create(bank.bodyX, bank.labelY, `BANK ${bank.name}  |  ${bank.rows.length} IO`, 0, options.accentColor, 'Courier New', options.bankFontSize, true, false, false, ESCH_PrimitiveTextAlignMode.LEFT_MIDDLE);
		if (!bankLabel) {
			throw new Error(`无法创建 Bank ${bank.name} 的标题。`);
		}

		for (const column of bank.columns) {
			const pinColumn = column.kind === 'pin';
			const headerText = await eda.sch_PrimitiveText.create(
				pinColumn ? column.x + column.width - options.cellPadding : column.x + options.cellPadding,
				bank.headerY,
				column.label,
				0,
				options.accentColor,
				'Courier New',
				options.headerFontSize,
				true,
				false,
				false,
				pinColumn ? ESCH_PrimitiveTextAlignMode.RIGHT_MIDDLE : ESCH_PrimitiveTextAlignMode.LEFT_MIDDLE,
			);
			if (!headerText) {
				throw new Error(`无法创建 Bank ${bank.name} 的表头“${column.label}”。`);
			}
		}

		if (bank.reservedRowHeight > 0) {
			await createTableLine(bank.bodyX, bank.reservedRowBottomY, bodyRight, bank.reservedRowBottomY, options.mutedColor, options.headerLineWidth);
		}
		await createTableLine(bank.bodyX, bank.headerBottomY, bodyRight, bank.headerBottomY, options.mutedColor, options.headerLineWidth);

		for (const placement of bank.rows) {
			const { index, row, y, pinX, displayPinName, disableFunction } = placement;
			const pin = await eda.sch_PrimitivePin.create(pinX, y, String(index + 1), displayPinName, 0, layout.pinLength, options.pinColor, ESCH_PrimitivePinShape.NONE, pinType(row.ioType));
			if (!pin) {
				throw new Error(`无法创建第 ${index + 1} 个引脚“${row.pinName}”。`);
			}
			pendingPinStyles.push({ pin, placement });

			for (const column of bank.columns) {
				const value = column.kind === 'mux' ? row.muxValues[column.muxIndex ?? -1] ?? '' : column.kind === 'disable' ? disableFunction : '';
				if (!value) {
					continue;
				}
				const cellText = await eda.sch_PrimitiveText.create(column.x + options.cellPadding, y, value, 0, options.textColor, 'Courier New', options.cellFontSize, true, false, false, ESCH_PrimitiveTextAlignMode.LEFT_MIDDLE);
				if (!cellText) {
					throw new Error(`无法创建引脚“${row.pinName}”在 ${column.label} 列的功能文本。`);
				}
			}

			const progress = 15 + Math.round(((index + 1) / layout.rows.length) * 75);
			reportProgress(progress, `正在生成 ${symbolName} / Bank ${bank.name}`, onProgress);
		}
	}
	await stylePinAttributes(pendingPinStyles, options);

	reportProgress(93, `正在保存 ${symbolName}`, onProgress);
	await waitForSave();
	void eda.dmt_EditorControl.zoomToAllPrimitives(tabId).catch((error: unknown) => {
		console.warn('[Pinmux2Symbol] Failed to zoom to generated symbol:', error);
	});
}

/** Create a personal-library symbol and an associated device from one parsed pinmux table. */
export async function createSymbolAndDevice(
	fileName: string,
	symbolName: string,
	table: PinmuxTable,
	overrides: SymbolLayoutOverrides = {},
	onProgress?: GenerationProgressCallback,
): Promise<void> {
	const libraryUuid = await eda.lib_LibrariesList.getPersonalLibraryUuid();
	if (!libraryUuid) {
		throw new Error('当前工作区没有可用的个人库，无法保存符号。');
	}
	try {
		if (await personalLibraryNameExists(libraryUuid, symbolName)) {
			throw new DuplicateLibraryNameError(symbolName);
		}
	}
	catch (error: unknown) {
		if (error instanceof DuplicateLibraryNameError) {
			throw error;
		}
		console.warn('[Pinmux2Symbol] Failed to preflight personal-library name; continuing with EasyEDA create:', error);
	}
	const generatedPinCount = table.rows.length;
	const description = `Generated from ${fileName}; ${generatedPinCount} pin(s), ${table.functionHeaders.length} mux column(s)`;
	let symbolUuid: string | undefined;
	try {
		symbolUuid = await eda.lib_Symbol.create(libraryUuid, symbolName, [], ELIB_SymbolType.COMPONENT, description);
	}
	catch (error: unknown) {
		console.error('[Pinmux2Symbol] Failed to create symbol:', error);
		if (isDuplicateLibraryNameError(error)) {
			throw new DuplicateLibraryNameError(symbolName);
		}
		throw operationError('创建符号失败', error);
	}
	if (!symbolUuid) {
		throw new Error('创建符号失败，EasyEDA 没有返回符号 UUID。');
	}

	let tabId: string | undefined;
	let deviceUuid: string | undefined;
	try {
		reportProgress(5, `正在打开 ${symbolName}`, onProgress);
		tabId = await eda.lib_Symbol.openInEditor(symbolUuid, libraryUuid);
		if (!tabId) {
			throw new Error('新建符号无法在编辑器中打开。');
		}
		await waitForSymbolEditor(symbolUuid, tabId);
		reportProgress(15, `正在生成 ${symbolName}`, onProgress);
		await createPrimitives(table, symbolName, tabId, overrides, onProgress);

		reportProgress(97, `正在创建器件 ${symbolName}`, onProgress);
		try {
			deviceUuid = await eda.lib_Device.create(
				libraryUuid,
				symbolName,
				[],
				{ symbol: { uuid: symbolUuid, libraryUuid } },
				description,
				{ designator: 'U', addIntoBom: true, addIntoPcb: false },
			);
		}
		catch (error: unknown) {
			console.error('[Pinmux2Symbol] Failed to create associated device:', error);
			if (isDuplicateLibraryNameError(error)) {
				throw new DuplicateLibraryNameError(symbolName);
			}
			throw operationError('创建关联器件失败', error);
		}
		if (!deviceUuid) {
			throw new Error('创建关联器件失败，EasyEDA 没有返回器件 UUID。');
		}
	}
	catch (error: unknown) {
		if (deviceUuid) {
			try {
				await eda.lib_Device.delete(deviceUuid, libraryUuid);
			}
			catch (cleanupError: unknown) {
				console.error('[Pinmux2Symbol] Failed to delete incomplete device:', cleanupError);
			}
		}
		if (!tabId) {
			try {
				await eda.lib_Symbol.delete(symbolUuid, libraryUuid);
			}
			catch (cleanupError: unknown) {
				console.error('[Pinmux2Symbol] Failed to delete incomplete symbol:', cleanupError);
			}
		}
		else {
			console.warn('[Pinmux2Symbol] Kept the incomplete symbol open because closing an unsaved symbol is unstable in this EasyEDA build.');
		}
		eda.sys_LoadingAndProgressBar.destroyProgressBar();
		throw error;
	}
	reportProgress(100, `已生成 ${symbolName}`, onProgress);
	eda.sys_LoadingAndProgressBar.destroyProgressBar();
	eda.sys_Message.showToastMessage(`已生成器件“${symbolName}”并关联同名符号，共 ${generatedPinCount} 个引脚。`);
}
