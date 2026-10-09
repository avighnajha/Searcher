const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('searcher', {
  search: (q,m,c) => ipcRenderer.invoke('search',q,m,c),
  status: () => ipcRenderer.invoke('status'),
  open: (id,q,action) => ipcRenderer.invoke('open',id,q,action),
  settings: (action,value) => ipcRenderer.invoke('settings',action,value),
  hide: () => ipcRenderer.send('hide'),
  onFocus: callback => ipcRenderer.on('focus-search',callback)
});
