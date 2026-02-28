const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cbdbApi", {
  getDbStatus: () => ipcRenderer.invoke("db:get-status"),
  selectDbFile: () => ipcRenderer.invoke("db:pick-file"),
  searchPeople: (payload) => ipcRenderer.invoke("search:people", payload),
  getPersonDetail: (personId) => ipcRenderer.invoke("person:detail", personId),
  getRelationshipGraph: (personId) => ipcRenderer.invoke("graph:relations", personId),
  getGeoDistribution: (payload) => ipcRenderer.invoke("geo:distribution", payload),
  getStats: () => ipcRenderer.invoke("stats:overview"),
  getDynasties: () => ipcRenderer.invoke("lookup:dynasties"),
});

