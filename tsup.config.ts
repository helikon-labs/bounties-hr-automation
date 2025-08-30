import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/cli.ts'],
    format: ['cjs'],
    target: 'node18',
    outDir: 'dist',
    clean: true,
    minify: false,
    sourcemap: true,
    // Preserve the shebang for CLI
    banner: {
        js: '#!/usr/bin/env node',
    },
});
