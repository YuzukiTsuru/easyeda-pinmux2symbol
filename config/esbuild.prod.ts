import process from 'node:process';
import esbuild from 'esbuild';

import common, { configurator } from './esbuild.common.ts';

(async () => {
	const contexts = await Promise.all([
		esbuild.context(common),
		esbuild.context(configurator),
	]);
	if (process.argv.includes('--watch')) {
		await Promise.all(contexts.map(context => context.watch()));
	}
	else {
		await Promise.all(contexts.map(context => context.rebuild()));
		await Promise.all(contexts.map(context => context.dispose()));
		process.exit();
	}
})();
