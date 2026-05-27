import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';

const isProd = process.env.MINIFY === 'true';

export default {
    input: 'src/index.js',
    output: [
        {
            file: 'dist/htmlpdf.js',
            format: 'umd',
            name: 'htmlpdf',
            sourcemap: true,
            inlineDynamicImports: true
        },
        {
            file: 'dist/htmlpdf.esm.js',
            format: 'esm',
            sourcemap: true,
            inlineDynamicImports: true
        }
    ],
    plugins: [
        resolve({ exportConditions: ['browser', 'module', 'import', 'default'] }),
        json(),
        commonjs({ include: 'node_modules/**' }),
        isProd && terser()
    ].filter(Boolean)
};
