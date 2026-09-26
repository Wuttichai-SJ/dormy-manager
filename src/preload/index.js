import { contextBridge, ipcRenderer } from 'electron'

// สะพานเดียวระหว่าง renderer กับ main — คืน { success, data | error }
contextBridge.exposeInMainWorld('electron', {
  invoke: (channel, data) => ipcRenderer.invoke(channel, data)
})
