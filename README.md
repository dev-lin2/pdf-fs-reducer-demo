# pdf-fs-reducer demo

Simple demo app for `pdf-fs-reducer` using a Hono backend and a plain HTML/CSS/JS frontend.

## Prerequisites

- Node.js 18 or newer
- Ghostscript installed and available in your PATH

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

Then open `http://localhost:3000`.

## How It Works

The UI uploads a PDF and optional compression settings to `POST /compress`. The server saves the upload to `uploads/`, calls `PdfFilesizeReducer.reduce(...)`, stores the compressed file in `outputs/`, returns compression stats, and exposes a temporary download link via `GET /download/:filename`.

## Ghostscript Install

| Platform | Command |
| --- | --- |
| macOS (Homebrew) | `brew install ghostscript` |
| Ubuntu / Debian | `sudo apt-get update && sudo apt-get install -y ghostscript` |
| Windows (Chocolatey) | `choco install ghostscript` |

