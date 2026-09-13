import type { PinmuxTable, SymbolLayout, SymbolLayoutOptions } from './pinmux';
import { createSymbolAndDevice, errorMessage, isDuplicateLibraryNameError, nextSymbolName } from './generator.js';
import {
	createSymbolLayout,
	DEFAULT_SYMBOL_LAYOUT_OPTIONS,
	defaultSymbolName,
	normalizeSymbolLayoutOptions,
	parsePinmuxCsv,
	SYMBOL_FONT_SIZE_SCALE,
	SYMBOL_GRID,
	SYMBOL_GRID_MM,
} from './pinmux';

const CONFIGURATOR_IFRAME_ID = 'pinmux2symbol-configurator';
const CONFIG_STORAGE_KEY = 'pinmux2symbol.layout.v2';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const UNIT_MM = 0.254;

interface ViewBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface ConfiguratorState {
	fileName?: string;
	table?: PinmuxTable;
	layout?: SymbolLayout;
	options: SymbolLayoutOptions;
	viewBox?: ViewBox;
	fitBox?: ViewBox;
	busy: boolean;
}

function queryElement<T extends Element>(selector: string): T {
	const element = document.querySelector<T>(selector);
	if (!element) {
		throw new Error(`配置页缺少元素 ${selector}`);
	}
	return element;
}

const chooseFileButton = queryElement<HTMLButtonElement>('#choose-file');
const browserFileInput = queryElement<HTMLInputElement>('#browser-file');
const fileNameElement = queryElement<HTMLElement>('#file-name');
const symbolNameInput = queryElement<HTMLInputElement>('#symbol-name');
const statusElement = queryElement<HTMLElement>('#status');
const progressElement = queryElement<HTMLElement>('#progress');
const progressTrack = queryElement<HTMLElement>('.progress-track');
const generateButton = queryElement<HTMLButtonElement>('#generate');
const resetButton = queryElement<HTMLButtonElement>('#reset-options');
const cancelButton = queryElement<HTMLButtonElement>('#cancel');
const previewSummary = queryElement<HTMLElement>('#preview-summary');
const previewStage = queryElement<HTMLElement>('#preview-stage');
const previewSvg = queryElement<SVGSVGElement>('#symbol-preview');
const emptyPreview = queryElement<HTMLElement>('#empty-preview');
const optionInputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-option]'));

const state: ConfiguratorState = {
	options: normalizeSymbolLayoutOptions(),
	busy: false,
};

function hasEdaApi(): boolean {
	return typeof eda !== 'undefined';
}

function syncTheme(): void {
	try {
		const theme = window.parent.document.documentElement.getAttribute('data-theme');
		if (theme === 'dark') {
			document.documentElement.setAttribute('data-theme', 'dark');
		}
		else {
			document.documentElement.removeAttribute('data-theme');
		}
	}
	catch {
		// Standalone browser preview uses the default light theme.
	}
}

function watchTheme(): void {
	syncTheme();
	try {
		const target = window.parent.document.documentElement;
		new MutationObserver(syncTheme).observe(target, { attributes: true, attributeFilter: ['data-theme'] });
	}
	catch {
		// Parent DOM access is optional outside the EasyEDA host.
	}
}

function setStatus(message: string, kind: 'normal' | 'error' | 'success' = 'normal'): void {
	statusElement.textContent = message;
	statusElement.classList.toggle('error', kind === 'error');
	statusElement.classList.toggle('success', kind === 'success');
}

function setProgress(percent: number): void {
	const normalized = Math.min(100, Math.max(0, Math.round(percent)));
	progressElement.style.width = `${normalized}%`;
	progressTrack.setAttribute('aria-valuenow', String(normalized));
}

function setBusy(busy: boolean): void {
	state.busy = busy;
	chooseFileButton.disabled = busy;
	symbolNameInput.disabled = busy;
	resetButton.disabled = busy;
	cancelButton.disabled = busy;
	for (const input of optionInputs) {
		input.disabled = busy;
	}
	generateButton.disabled = busy || !state.table;
}

function gridMillimetres(gridCount: number): string {
	return `${(gridCount * SYMBOL_GRID_MM).toFixed(2)} mm`;
}

function syncOptionInputs(): void {
	for (const input of optionInputs) {
		const key = input.dataset.option as keyof SymbolLayoutOptions;
		const value = state.options[key];
		if (typeof value === 'number') {
			if (input.dataset.kind === 'grid') {
				input.value = String(value / SYMBOL_GRID);
			}
			else if (input.dataset.kind === 'font') {
				input.value = (value / SYMBOL_FONT_SIZE_SCALE).toFixed(2);
			}
			else {
				input.value = String(value);
			}
		}
		else {
			input.value = value;
		}
		if (input.dataset.kind === 'grid') {
			const output = document.querySelector<HTMLOutputElement>(`[data-unit-for="${key}"]`);
			if (output) {
				output.value = gridMillimetres(Number(input.value));
			}
		}
		if (input.dataset.kind === 'color') {
			const output = document.querySelector<HTMLOutputElement>(`[data-color-for="${key}"]`);
			if (output) {
				output.value = String(value).toUpperCase();
			}
		}
	}
}

function readOptionInputs(): SymbolLayoutOptions {
	const raw: Record<string, number | string> = {};
	for (const input of optionInputs) {
		const key = input.dataset.option;
		if (!key) {
			continue;
		}
		if (input.dataset.kind === 'color') {
			raw[key] = input.value;
		}
		else {
			const numberValue = Number(input.value);
			raw[key] = input.dataset.kind === 'grid'
				? numberValue * SYMBOL_GRID
				: input.dataset.kind === 'font' ? numberValue * SYMBOL_FONT_SIZE_SCALE : numberValue;
		}
	}
	return normalizeSymbolLayoutOptions(raw as unknown as Partial<SymbolLayoutOptions>);
}

let persistenceTimer: number | undefined;
function persistOptions(): void {
	if (!hasEdaApi()) {
		return;
	}
	window.clearTimeout(persistenceTimer);
	persistenceTimer = window.setTimeout(() => {
		void eda.sys_Storage.setExtensionUserConfig(CONFIG_STORAGE_KEY, state.options).catch((error: unknown) => {
			console.warn('[Pinmux2Symbol] Failed to persist layout options:', error);
		});
	}, 200);
}

function createSvgElement(name: string, attributes: Record<string, string | number> = {}): SVGElement {
	const element = document.createElementNS(SVG_NAMESPACE, name);
	for (const [key, value] of Object.entries(attributes)) {
		element.setAttribute(key, String(value));
	}
	return element;
}

function appendText(
	parent: SVGElement,
	value: string,
	x: number,
	y: number,
	fontSize: number,
	color: string,
	anchor: 'start' | 'middle' | 'end' = 'start',
	baseline = 'middle',
): void {
	const element = createSvgElement('text', {
		'x': x,
		'y': y,
		'fill': color,
		'font-family': 'Courier New, monospace',
		'font-size': fontSize,
		'font-weight': 700,
		'text-anchor': anchor,
		'dominant-baseline': baseline,
	});
	element.textContent = value;
	parent.append(element);
}

function calculateFitBox(layout: SymbolLayout): ViewBox {
	const left = Math.min(...layout.banks.map(bank => bank.bodyX)) - 30;
	const right = Math.max(...layout.banks.map(bank => bank.bodyX + bank.bodyWidth + layout.pinLength)) + 30;
	const top = -layout.titleY - 30;
	const bottom = Math.max(...layout.banks.map(bank => -(bank.bodyY - bank.bodyHeight))) + 30;
	return { x: left, y: top, width: right - left, height: bottom - top };
}

function applyViewBox(): void {
	if (!state.viewBox) {
		return;
	}
	const { x, y, width, height } = state.viewBox;
	previewSvg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
}

function fitPreview(): void {
	if (!state.fitBox) {
		return;
	}
	state.viewBox = { ...state.fitBox };
	applyViewBox();
}

function zoomPreview(factor: number, clientX?: number, clientY?: number): void {
	if (!state.viewBox || !state.fitBox) {
		return;
	}
	const rect = previewSvg.getBoundingClientRect();
	const xRatio = clientX === undefined || rect.width === 0 ? 0.5 : (clientX - rect.left) / rect.width;
	const yRatio = clientY === undefined || rect.height === 0 ? 0.5 : (clientY - rect.top) / rect.height;
	const minimumWidth = state.fitBox.width * 0.08;
	const maximumWidth = state.fitBox.width * 8;
	const nextWidth = Math.min(maximumWidth, Math.max(minimumWidth, state.viewBox.width * factor));
	const appliedFactor = nextWidth / state.viewBox.width;
	const nextHeight = state.viewBox.height * appliedFactor;
	const focusX = state.viewBox.x + state.viewBox.width * xRatio;
	const focusY = state.viewBox.y + state.viewBox.height * yRatio;
	state.viewBox = {
		x: focusX - nextWidth * xRatio,
		y: focusY - nextHeight * yRatio,
		width: nextWidth,
		height: nextHeight,
	};
	applyViewBox();
}

function drawPreview(layout: SymbolLayout, symbolName: string): void {
	const options = layout.options;
	const fitBox = calculateFitBox(layout);
	state.fitBox = fitBox;
	state.viewBox = { ...fitBox };
	previewSvg.replaceChildren();

	const defs = createSvgElement('defs');
	const pattern = createSvgElement('pattern', {
		id: 'grid-pattern',
		width: SYMBOL_GRID,
		height: SYMBOL_GRID,
		patternUnits: 'userSpaceOnUse',
	});
	pattern.append(createSvgElement('circle', { cx: 0, cy: 0, r: 0.65, fill: 'var(--border-strong)' }));
	defs.append(pattern);
	previewSvg.append(defs);
	previewSvg.append(createSvgElement('rect', {
		x: fitBox.x - fitBox.width * 4,
		y: fitBox.y - fitBox.height * 4,
		width: fitBox.width * 9,
		height: fitBox.height * 9,
		fill: 'url(#grid-pattern)',
	}));

	const drawing = createSvgElement('g');
	appendText(drawing, `${symbolName || 'PinmuxSymbol'}  |  ${layout.rows.length} pins`, 0, -layout.titleY, options.titleFontSize, options.titleColor, 'middle');

	for (const bank of layout.banks) {
		const top = -bank.bodyY;
		const bodyRight = bank.bodyX + bank.bodyWidth;
		drawing.append(createSvgElement('rect', {
			'x': bank.bodyX,
			'y': top,
			'width': bank.bodyWidth,
			'height': bank.bodyHeight,
			'fill': 'var(--surface)',
			'stroke': options.accentColor,
			'stroke-width': options.outerLineWidth,
			'vector-effect': 'non-scaling-stroke',
		}));
		appendText(drawing, `BANK ${bank.name}  |  ${bank.rows.length} IO`, bank.bodyX, -bank.labelY, options.bankFontSize, options.accentColor);

		for (const column of bank.columns) {
			const pinColumn = column.kind === 'pin';
			appendText(
				drawing,
				column.label,
				pinColumn ? column.x + column.width - options.cellPadding : column.x + options.cellPadding,
				-bank.headerY,
				options.headerFontSize,
				options.accentColor,
				pinColumn ? 'end' : 'start',
			);
		}

		drawing.append(createSvgElement('line', {
			'x1': bank.bodyX,
			'y1': -bank.headerBottomY,
			'x2': bodyRight,
			'y2': -bank.headerBottomY,
			'stroke': options.accentColor,
			'stroke-width': options.headerLineWidth,
			'vector-effect': 'non-scaling-stroke',
		}));

		for (const placement of bank.rows) {
			const y = -placement.y;
			for (const column of bank.columns) {
				const value = column.kind === 'mux'
					? placement.row.muxValues[column.muxIndex ?? -1] ?? ''
					: column.kind === 'disable' ? placement.disableFunction : '';
				if (value) {
					appendText(drawing, value, column.x + options.cellPadding, y, options.cellFontSize, options.textColor);
				}
			}

			appendText(drawing, placement.displayPinName, placement.pinNameX, y, options.pinNameFontSize, options.titleColor, 'end');
			drawing.append(createSvgElement('line', {
				'x1': bodyRight,
				'y1': y,
				'x2': placement.pinX,
				'y2': y,
				'stroke': options.pinColor,
				'stroke-width': 1.5,
				'vector-effect': 'non-scaling-stroke',
			}));
			appendText(drawing, String(placement.index + 1), placement.pinNumberX, y, options.pinNumberFontSize, options.mutedColor, 'start', 'text-after-edge');
		}
	}

	previewSvg.append(drawing);
	applyViewBox();
	emptyPreview.hidden = true;
	const totalWidth = layout.bodyWidth + layout.pinLength;
	previewSummary.textContent = `${layout.rows.length} pins · ${layout.banks.length} Banks · ${(totalWidth * UNIT_MM).toFixed(1)} × ${(layout.bodyHeight * UNIT_MM).toFixed(1)} mm · 100 mil 网格`;
}

function renderPreview(): void {
	if (!state.table) {
		state.layout = undefined;
		state.fitBox = undefined;
		state.viewBox = undefined;
		previewSvg.replaceChildren();
		emptyPreview.hidden = false;
		previewSummary.textContent = '100 mil 网格';
		return;
	}
	state.layout = createSymbolLayout(state.table, state.options);
	drawPreview(state.layout, symbolNameInput.value.trim());
}

async function acceptFile(file: File): Promise<void> {
	try {
		const table = parsePinmuxCsv(await file.text());
		state.fileName = file.name;
		state.table = table;
		fileNameElement.textContent = file.name;
		if (!symbolNameInput.value.trim()) {
			symbolNameInput.value = defaultSymbolName(file.name);
		}
		setStatus(`已读取 ${table.rows.length} 个引脚，分为 ${new Set(table.rows.map(row => row.pinName)).size > 0 ? createSymbolLayout(table, state.options).banks.length : 0} 个 Bank。`, 'success');
		setProgress(0);
		generateButton.disabled = false;
		renderPreview();
	}
	catch (error: unknown) {
		state.fileName = undefined;
		state.table = undefined;
		fileNameElement.textContent = '文件解析失败';
		setStatus(errorMessage(error), 'error');
		generateButton.disabled = true;
		renderPreview();
	}
}

async function chooseFile(): Promise<void> {
	if (!hasEdaApi()) {
		browserFileInput.click();
		return;
	}
	try {
		const file = await eda.sys_FileSystem.openReadFileDialog(['.csv', '.txt'], false);
		if (file) {
			await acceptFile(file);
		}
	}
	catch (error: unknown) {
		setStatus(errorMessage(error), 'error');
	}
}

async function closeConfigurator(): Promise<void> {
	if (hasEdaApi()) {
		await eda.sys_IFrame.closeIFrame(CONFIGURATOR_IFRAME_ID);
	}
}

async function generate(): Promise<void> {
	const symbolName = symbolNameInput.value.trim();
	if (!state.table || !state.fileName) {
		setStatus('请先选择有效的 pinmux CSV。', 'error');
		return;
	}
	if (!symbolName) {
		setStatus('器件名称不能为空。', 'error');
		symbolNameInput.focus();
		return;
	}
	if (!hasEdaApi()) {
		setStatus('生成操作只能在 EasyEDA 扩展窗口中执行。', 'error');
		return;
	}

	setBusy(true);
	setProgress(1);
	setStatus(`准备生成 ${symbolName}…`);
	try {
		await eda.sys_Storage.setExtensionUserConfig(CONFIG_STORAGE_KEY, state.options);
		await createSymbolAndDevice(state.fileName, symbolName, state.table, state.options, ({ percent, message }) => {
			setProgress(percent);
			setStatus(message, percent === 100 ? 'success' : 'normal');
		});
		await closeConfigurator();
	}
	catch (error: unknown) {
		console.error('[Pinmux2Symbol] Generation failed:', error);
		setProgress(0);
		if (isDuplicateLibraryNameError(error)) {
			const suggestedName = nextSymbolName(symbolName);
			symbolNameInput.value = suggestedName;
			setStatus(`个人库中已存在“${symbolName}”，已建议新名称“${suggestedName}”。`, 'error');
			symbolNameInput.focus();
			symbolNameInput.select();
			renderPreview();
		}
		else {
			setStatus(errorMessage(error), 'error');
		}
	}
	finally {
		setBusy(false);
	}
}

function installPreviewInteractions(): void {
	queryElement<HTMLButtonElement>('#zoom-in').addEventListener('click', () => zoomPreview(0.8));
	queryElement<HTMLButtonElement>('#zoom-out').addEventListener('click', () => zoomPreview(1.25));
	queryElement<HTMLButtonElement>('#fit-preview').addEventListener('click', fitPreview);
	previewStage.addEventListener('wheel', (event) => {
		if (!state.viewBox) {
			return;
		}
		event.preventDefault();
		zoomPreview(Math.exp(event.deltaY * 0.001), event.clientX, event.clientY);
	}, { passive: false });

	let pointerId: number | undefined;
	let pointerX = 0;
	let pointerY = 0;
	previewStage.addEventListener('pointerdown', (event) => {
		if (!state.viewBox) {
			return;
		}
		pointerId = event.pointerId;
		pointerX = event.clientX;
		pointerY = event.clientY;
		previewStage.setPointerCapture(pointerId);
		previewStage.classList.add('dragging');
	});
	previewStage.addEventListener('pointermove', (event) => {
		if (pointerId !== event.pointerId || !state.viewBox) {
			return;
		}
		const rect = previewStage.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) {
			return;
		}
		const deltaX = (event.clientX - pointerX) * state.viewBox.width / rect.width;
		const deltaY = (event.clientY - pointerY) * state.viewBox.height / rect.height;
		state.viewBox.x -= deltaX;
		state.viewBox.y -= deltaY;
		pointerX = event.clientX;
		pointerY = event.clientY;
		applyViewBox();
	});
	const releasePointer = (event: PointerEvent): void => {
		if (pointerId !== event.pointerId) {
			return;
		}
		pointerId = undefined;
		previewStage.classList.remove('dragging');
	};
	previewStage.addEventListener('pointerup', releasePointer);
	previewStage.addEventListener('pointercancel', releasePointer);
}

function initializeOptions(): void {
	if (hasEdaApi()) {
		try {
			const persisted = eda.sys_Storage.getExtensionUserConfig(CONFIG_STORAGE_KEY) as Partial<SymbolLayoutOptions> | undefined;
			state.options = normalizeSymbolLayoutOptions(persisted);
		}
		catch (error: unknown) {
			console.warn('[Pinmux2Symbol] Failed to read saved layout options:', error);
		}
	}
	syncOptionInputs();
}

function installFormInteractions(): void {
	for (const input of optionInputs) {
		input.addEventListener('input', () => {
			if (input.dataset.kind !== 'color' && (!input.value || !input.validity.valid)) {
				return;
			}
			state.options = readOptionInputs();
			syncOptionInputs();
			persistOptions();
			renderPreview();
		});
	}
	symbolNameInput.addEventListener('input', renderPreview);
	chooseFileButton.addEventListener('click', () => void chooseFile());
	browserFileInput.addEventListener('change', () => {
		const file = browserFileInput.files?.[0];
		if (file) {
			void acceptFile(file);
		}
	});
	resetButton.addEventListener('click', () => {
		state.options = normalizeSymbolLayoutOptions(DEFAULT_SYMBOL_LAYOUT_OPTIONS);
		syncOptionInputs();
		persistOptions();
		renderPreview();
		setStatus('已恢复默认布局参数。');
	});
	cancelButton.addEventListener('click', () => void closeConfigurator());
	generateButton.addEventListener('click', () => void generate());
}

watchTheme();
initializeOptions();
installFormInteractions();
installPreviewInteractions();
renderPreview();
