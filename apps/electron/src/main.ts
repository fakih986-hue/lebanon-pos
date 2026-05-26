/// <reference types="node" />

import { app, BrowserWindow } from "electron"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)

const __dirname = path.dirname(__filename)

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,

    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  })

  win.loadURL("http://localhost:5173")
}

app.whenReady().then(() => {
  createWindow()
})