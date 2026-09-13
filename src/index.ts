/** Pinmux CSV to EasyEDA schematic symbol extension. */
import extensionConfig from '../extension.json' with { type: 'json' };

export const CONFIGURATOR_IFRAME_ID = 'pinmux2symbol-configurator';

/** Open the configuration and live-preview workspace. */
export async function importPinmuxCsv(): Promise<void> {
	try {
		await eda.sys_IFrame.closeIFrame(CONFIGURATOR_IFRAME_ID);
		const opened = await eda.sys_IFrame.openIFrame('/iframe/index.html', 1200, 760, CONFIGURATOR_IFRAME_ID, {
			title: 'Pinmux2Symbol 配置与预览',
			maximizeButton: true,
			minimizeButton: true,
			minimizeStyle: 'constricted',
			grayscaleMask: false,
		});
		if (!opened) {
			throw new Error('无法打开 Pinmux2Symbol 配置窗口。');
		}
	}
	catch (error: unknown) {
		console.error('[Pinmux2Symbol] Failed to open configurator:', error);
		const message = error instanceof Error ? error.message : '无法打开配置窗口。';
		eda.sys_Dialog.showInformationMessage(message, 'Pinmux2Symbol');
	}
}

export function about(): void {
	eda.sys_Dialog.showInformationMessage(
		`${eda.sys_I18n.text('EasyEDA extension SDK v', undefined, undefined, extensionConfig.version)}\n\n导入 pinmux CSV，实时配置并预览严格对齐 100 mil 网格的符号，然后在个人库中生成关联器件。`,
		'Pinmux2Symbol',
	);
}

// The extension host calls this hook after loading the package.
// eslint-disable-next-line unused-imports/no-unused-vars
export function activate(status?: 'onStartupFinished', arg?: string): void {}
