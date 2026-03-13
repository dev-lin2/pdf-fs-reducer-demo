import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { PdfFilesizeReducer } from 'pdf-fs-reducer'

type Preset = 'screen' | 'ebook' | 'printer' | 'prepress'
type BodyValue = string | File | (string | File)[]

const PORT = 3000
const ROOT_DIR = process.cwd()
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads')
const OUTPUTS_DIR = path.join(ROOT_DIR, 'outputs')
const ALLOWED_PRESETS = new Set<Preset>(['screen', 'ebook', 'printer', 'prepress'])

const app = new Hono()

app.post('/compress', async (c) => {
  let inputPath: string | null = null

  try {
    const body = (await c.req.parseBody()) as Record<string, BodyValue>
    const fileValue = getSingleBodyValue(body.file)
    const file = fileValue instanceof File ? fileValue : null

    if (!file) {
      return c.json({ error: 'A PDF file is required.' }, 400)
    }

    const originalName = sanitizeFileName(file.name || 'document.pdf')
    const hasPdfMimeType = file.type === 'application/pdf'
    const hasPdfExtension = originalName.toLowerCase().endsWith('.pdf')

    if (!hasPdfMimeType && !hasPdfExtension) {
      return c.json({ error: 'Only PDF files are allowed.' }, 400)
    }

    const preset = parsePreset(getSingleBodyValue(body.preset))
    const dpi = parseOptionalNumber(getSingleBodyValue(body.dpi), 'dpi', 1, 1200)
    const size = parseOptionalNumber(getSingleBodyValue(body.size), 'size', 1, 99)

    const timestamp = Date.now()
    inputPath = path.join(UPLOADS_DIR, `${timestamp}-${originalName}`)
    const outputFileName = `${timestamp}-reduced-${originalName}`
    const outputPath = path.join(OUTPUTS_DIR, outputFileName)

    await fs.writeFile(inputPath, Buffer.from(await file.arrayBuffer()))

    const result = await PdfFilesizeReducer.reduce({
      input: inputPath,
      output: outputPath,
      preset,
      ...(dpi !== undefined ? { dpi } : {}),
      ...(size !== undefined ? { size } : {})
    })

    return c.json({
      inputSize: result.inputSize,
      outputSize: result.outputSize,
      saved: result.saved,
      percent: result.percent,
      effectiveDpi: result.effectiveDpi,
      downloadUrl: `/download/${encodeURIComponent(outputFileName)}`
    })
  } catch (error) {
    if (error instanceof HttpError) {
      return c.json({ error: error.message }, error.status)
    }

    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: `Compression failed: ${message}` }, 500)
  } finally {
    if (inputPath) {
      await fs.rm(inputPath, { force: true }).catch(() => undefined)
    }
  }
})

app.get('/download/:filename', async (c) => {
  const rawFilename = c.req.param('filename')
  let filename: string

  try {
    filename = decodeURIComponent(rawFilename)
  } catch {
    return c.json({ error: 'Invalid file name.' }, 400)
  }

  const outputPath = path.resolve(OUTPUTS_DIR, filename)
  const relativePath = path.relative(OUTPUTS_DIR, outputPath)

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return c.json({ error: 'Invalid file path.' }, 400)
  }

  try {
    await fs.access(outputPath)
  } catch {
    return c.json({ error: 'File not found.' }, 404)
  }

  const nodeStream = createReadStream(outputPath)
  nodeStream.on('close', () => {
    void fs.rm(outputPath, { force: true }).catch(() => undefined)
  })

  const headers = new Headers()
  headers.set('Content-Disposition', `attachment; filename="${path.basename(filename)}"`)
  headers.set('Content-Type', 'application/pdf')

  return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
    headers
  })
})

app.get(
  '/*',
  serveStatic({
    root: './public',
    rewriteRequestPath: (requestPath) => (requestPath === '/' ? '/index.html' : requestPath)
  })
)

await cleanDirectory(UPLOADS_DIR)
await cleanDirectory(OUTPUTS_DIR)

serve({
  fetch: app.fetch,
  port: PORT
})

console.log(`Server running at http://localhost:${PORT}`)

function getSingleBodyValue(value: BodyValue | undefined): string | File | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

function parsePreset(value: string | File | undefined): Preset {
  if (typeof value !== 'string') {
    return 'ebook'
  }

  const normalizedPreset = value.trim().toLowerCase() as Preset
  if (ALLOWED_PRESETS.has(normalizedPreset)) {
    return normalizedPreset
  }

  return 'ebook'
}

function parseOptionalNumber(
  value: string | File | undefined,
  fieldName: string,
  min: number,
  max: number
): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new HttpError(`${fieldName} must be a number.`)
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return undefined
  }

  const parsedValue = Number(trimmed)
  if (!Number.isFinite(parsedValue)) {
    throw new HttpError(`${fieldName} must be a valid number.`)
  }

  if (parsedValue < min || parsedValue > max) {
    throw new HttpError(`${fieldName} must be between ${min} and ${max}.`)
  }

  return parsedValue
}

function sanitizeFileName(name: string): string {
  const basename = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_')
  const safeName = basename.length > 0 ? basename : 'document.pdf'
  return safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`
}

async function cleanDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
  const entries = await fs.readdir(dirPath, { withFileTypes: true })

  await Promise.all(
    entries.map((entry) => fs.rm(path.join(dirPath, entry.name), { recursive: true, force: true }))
  )
}

class HttpError extends Error {
  status: 400

  constructor(message: string) {
    super(message)
    this.status = 400
  }
}
