import { useCallback, useEffect, useMemo, useState } from "react";
import { getDbStatus, getDynasties, selectDbFile } from "./services/api";
import SearchPage from "./pages/SearchPage";
import GraphPage from "./pages/GraphPage";
import MapPage from "./pages/MapPage";
import StatsPage from "./pages/StatsPage";

const PERSON_HISTORY_LIMIT = 50;
const PERSON_HISTORY_STORAGE_KEY = "cbdb.person.history.v1";

const tabs = [
  { id: "search", label: "人物检索" },
  { id: "graph", label: "关系图谱" },
  { id: "map", label: "地理分布" },
  { id: "stats", label: "统计分析" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("search");
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [personHistory, setPersonHistory] = useState(() => {
    try {
      const raw = window.localStorage.getItem(PERSON_HISTORY_STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter(
          (row) => row && Number.isFinite(Number(row.id)) && typeof row.name === "string" && row.name
        )
        .slice(0, PERSON_HISTORY_LIMIT)
        .map((row) => ({
          id: Number(row.id),
          name: row.name,
        }));
    } catch {
      return [];
    }
  });
  const [historyMenu, setHistoryMenu] = useState(null);
  const [dbStatus, setDbStatus] = useState({
    connected: false,
    dbPath: null,
    writable: false,
    error: null,
  });
  const [dynasties, setDynasties] = useState([]);
  const [globalError, setGlobalError] = useState("");

  const loadGlobalData = async () => {
    try {
      const status = await getDbStatus();
      setDbStatus(status);
      setGlobalError(status.error || "");
      if (status.connected) {
        const dynastyRows = await getDynasties();
        setDynasties(dynastyRows);
      }
    } catch (error) {
      setGlobalError(error.message);
    }
  };

  useEffect(() => {
    loadGlobalData();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PERSON_HISTORY_STORAGE_KEY, JSON.stringify(personHistory));
    } catch {
      // ignore localStorage write failures
    }
  }, [personHistory]);

  useEffect(() => {
    if (!historyMenu) {
      return;
    }
    const closeMenu = () => setHistoryMenu(null);
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setHistoryMenu(null);
      }
    };
    window.addEventListener("click", closeMenu);
    window.addEventListener("blur", closeMenu);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("blur", closeMenu);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [historyMenu]);

  const handleSelectDb = async () => {
    try {
      const result = await selectDbFile();
      if (!result.canceled) {
        await loadGlobalData();
      }
    } catch (error) {
      setGlobalError(error.message);
    }
  };

  const pushSearchHistory = useCallback((person) => {
    if (!person?.id || !person?.name) {
      return;
    }
    setPersonHistory((prev) => {
      const deduped = prev.filter((row) => row.id !== person.id);
      return [{ id: person.id, name: person.name }, ...deduped].slice(0, PERSON_HISTORY_LIMIT);
    });
  }, []);

  const handleSelectSearchPerson = useCallback(
    (person) => {
      setSelectedPerson(person);
      pushSearchHistory(person);
    },
    [pushSearchHistory]
  );

  const handleGraphNavigatePerson = useCallback((person) => {
    setSelectedPerson(person);
    setActiveTab("graph");
  }, []);

  const handlePickHistoryPerson = useCallback((person) => {
    setSelectedPerson({ id: person.id, name: person.name });
  }, []);

  const handleHistoryChipContextMenu = useCallback((event, person) => {
    event.preventDefault();
    const maxX = Math.max(12, window.innerWidth - 220);
    const maxY = Math.max(12, window.innerHeight - 120);
    setHistoryMenu({
      x: Math.min(event.clientX, maxX),
      y: Math.min(event.clientY, maxY),
      person,
    });
  }, []);

  const handleDeleteHistoryFromMenu = useCallback(() => {
    if (!historyMenu?.person) {
      return;
    }
    const person = historyMenu.person;
    setHistoryMenu(null);
    const confirmed = window.confirm(`确认删除历史人物“${person.name}”吗？`);
    if (!confirmed) {
      return;
    }
    setPersonHistory((prev) => prev.filter((row) => row.id !== person.id));
  }, [historyMenu]);

  const clearPersonHistory = () => {
    setPersonHistory([]);
    setHistoryMenu(null);
  };

  const tabContent = useMemo(() => {
    if (activeTab === "search") {
      return (
        <SearchPage
          dynasties={dynasties}
          selectedPerson={selectedPerson}
          onSelectPerson={handleSelectSearchPerson}
          dbConnected={dbStatus.connected}
        />
      );
    }
    if (activeTab === "graph") {
      return (
        <GraphPage selectedPerson={selectedPerson} onNavigatePerson={handleGraphNavigatePerson} />
      );
    }
    if (activeTab === "map") {
      return <MapPage dynasties={dynasties} selectedPerson={selectedPerson} />;
    }
    return <StatsPage />;
  }, [
    activeTab,
    dbStatus.connected,
    dynasties,
    handleGraphNavigatePerson,
    handleSelectSearchPerson,
    selectedPerson,
  ]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>CBDB Explorer</h1>
          <p>中国历代人物传记数据库离线应用</p>
        </div>

        <div className="db-panel">
          <div className={`status-dot ${dbStatus.connected ? "online" : "offline"}`} />
          <div>
            <strong>{dbStatus.connected ? "数据库已连接" : "数据库未连接"}</strong>
            <p>{dbStatus.dbPath || "尚未加载 SQLite 文件"}</p>
          </div>
        </div>

        <button className="btn-secondary" onClick={handleSelectDb}>
          选择数据库文件
        </button>

        <nav className="tab-list">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <section className="sidebar-history">
          <div className="sidebar-history-head">
            <strong>人物历史</strong>
            <span>{personHistory.length} / {PERSON_HISTORY_LIMIT}</span>
            <button
              className="btn-secondary"
              type="button"
              onClick={clearPersonHistory}
              disabled={personHistory.length === 0}
            >
              清空
            </button>
          </div>
          <div className="sidebar-history-chips">
            {personHistory.map((person) => (
              <button
                key={`${person.id}-${person.name}`}
                className={`sidebar-history-chip ${
                  person.id === selectedPerson?.id ? "active" : ""
                }`}
                onClick={() => handlePickHistoryPerson(person)}
                onContextMenu={(event) => handleHistoryChipContextMenu(event, person)}
                type="button"
                title={person.name}
              >
                {person.name}
              </button>
            ))}
            {personHistory.length === 0 && <span className="muted">暂无历史记录</span>}
          </div>
        </section>

        {historyMenu && (
          <div
            className="sidebar-history-menu"
            style={{
              left: `${historyMenu.x}px`,
              top: `${historyMenu.y}px`,
            }}
          >
            <button type="button" onClick={handleDeleteHistoryFromMenu}>
              删除“{historyMenu.person.name}”
            </button>
          </div>
        )}

        <div className="current-person">
          <span>当前人物</span>
          <strong>{selectedPerson?.name || "未选择"}</strong>
        </div>

        {globalError && <div className="error-box">{globalError}</div>}
      </aside>

      <main className="main">{tabContent}</main>
    </div>
  );
}
