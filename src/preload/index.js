const { contextBridge, ipcRenderer } = require('electron')

// The ONLY bridge between renderer and main. Renderer never touches ipcRenderer directly;
// every call goes through window.electron.invoke(channel, data) and returns
// { success, data | error } from the matching ipcMain.handle in the main process.
contextBridge.exposeInMainWorld('electron', {
  invoke: (channel, data) => ipcRenderer.invoke(channel, data)
})
