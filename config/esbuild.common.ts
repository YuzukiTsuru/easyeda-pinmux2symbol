import type esbuild from 'esbuild';

const sharedOptions = {
	assetNames: '[name]',
	bundle: true, // 用于内部方法调用，请勿修改
	minify: false, // 用于内部方法调用，请勿修改
	loader: {},
	sourcemap: undefined,
	platform: 'browser', // 用于内部方法调用，请勿修改
	format: 'iife', // 用于内部方法调用，请勿修改
	globalName: 'edaEsbuildExportName', // 用于内部方法调用，请勿修改
	treeShaking: true,
	ignoreAnnotations: true,
	define: {},
	external: [],
} satisfies Parameters<(typeof esbuild)['build']>[0];

export const configurator = {
	...sharedOptions,
	entryPoints: ['./src/configurator'],
	outfile: './iframe/configurator.js',
} satisfies Parameters<(typeof esbuild)['build']>[0];

export default {
	...sharedOptions,
	entryPoints: {
		index: './src/index',
	},
	entryNames: '[name]',
	outdir: './dist/',
} satisfies Parameters<(typeof esbuild)['build']>[0];
