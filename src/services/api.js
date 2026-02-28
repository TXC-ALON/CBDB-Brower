function requireDesktopApi() {
  if (!window.cbdbApi) {
    throw new Error("未检测到 Electron API，请使用 `npm run dev` 以桌面模式启动。");
  }
  return window.cbdbApi;
}

export async function getDbStatus() {
  return requireDesktopApi().getDbStatus();
}

export async function selectDbFile() {
  return requireDesktopApi().selectDbFile();
}

export async function getDynasties() {
  return requireDesktopApi().getDynasties();
}

export async function searchPeople(payload) {
  return requireDesktopApi().searchPeople(payload);
}

export async function getPersonDetail(personId) {
  return requireDesktopApi().getPersonDetail(personId);
}

export async function getRelationshipGraph(personId) {
  return requireDesktopApi().getRelationshipGraph(personId);
}

export async function getGeoDistribution(payload) {
  return requireDesktopApi().getGeoDistribution(payload);
}

export async function getStats() {
  return requireDesktopApi().getStats();
}

