// build.mjs
import * as esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['src/main.js'],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    outfile: 'dist/diegetic.js',
    minify: false,
    legalComments: 'none',
    banner: { js: '// Diegetic — диегетические артефакты для JS-Slash-Runner. Сгенерировано из src/, не правь вручную.' },
});
console.log('dist/diegetic.js готов');
