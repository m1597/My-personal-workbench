import { build } from 'vite'
export async function buildToolkitRecorder(outDir) {
  await build({
    configFile: false,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    esbuild: { jsx: 'automatic' },
    build: {
      outDir,
      emptyOutDir: false,
      lib: {
        entry: 'components/toolkit/recorder.tsx',
        name: 'FitBayRecorder',
        formats: ['iife'],
        fileName: () => 'recorder.js',
      },
    },
  })
}
