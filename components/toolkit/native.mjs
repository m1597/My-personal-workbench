import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function readSelectionOrOcr(png, hwnd, signal, layout = false) {
  const script = fileURLToPath(new URL(png ? 'ocr.ps1' : 'selection.ps1', import.meta.url))
  return new Promise((resolve, reject) => {
    const process = execFile(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-STA',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        ...(hwnd ? [hwnd] : []),
        ...(png && layout ? ['-Layout'] : []),
      ],
      { signal, windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (err, out) => {
        if (err)
          reject(
            Error(png ? 'Windows OCR 失败，请检查识别语言包或缩小选区' : '无法读取当前应用的选区'),
          )
        else if (!out.trim())
          reject(
            Error(
              png
                ? '选区没有识别到文字，请重新框选'
                : '没有读到文字，请在支持辅助功能的阅读器中划词后重试',
            ),
          )
        else resolve(out.trim())
      },
    )
    process.stdin.on('error', () => {})
    process.stdin.end(png)
  })
}

// Use the requested monitor's physical rectangle when the compositor returns a black frame.
export function readDisplayPixels({ x, y, width, height }) {
  const script = fileURLToPath(new URL('./capture-display.ps1', import.meta.url))
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        ...[x, y, width, height].map(String),
      ],
      {
        windowsHide: true,
        timeout: 12000,
        maxBuffer: width * height * 4 + 65536,
        encoding: 'buffer',
      },
      (err, png) => {
        if (err) reject(Error('未能读取当前显示器，请重新截图'))
        else resolve(png)
      },
    )
  })
}
