import { useEffect, useMemo, useState } from "react";
import { getDbStatus, getDynasties, selectDbFile } from "./services/api";
import SearchPage from "./pages/SearchPage";
import GraphPage from "./pages/GraphPage";
import MapPage from "./pages/MapPage";
import StatsPage from "./pages/StatsPage";

const tabs = [
  { id: "search", label: "人物检索" },
  { id: "graph", label: "关系图谱" },
  { id: "map", label: "地理分布" },
  { id: "stats", label: "统计分析" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("search");
  const [selectedPerson, setSelectedPerson] = useState(null);
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

  const tabContent = useMemo(() => {
    if (activeTab === "search") {
      return (
        <SearchPage
          dynasties={dynasties}
          selectedPerson={selectedPerson}
          onSelectPerson={setSelectedPerson}
          dbConnected={dbStatus.connected}
        />
      );
    }
    if (activeTab === "graph") {
      return <GraphPage selectedPerson={selectedPerson} />;
    }
    if (activeTab === "map") {
      return <MapPage dynasties={dynasties} selectedPerson={selectedPerson} />;
    }
    return <StatsPage />;
  }, [activeTab, dbStatus.connected, dynasties, selectedPerson]);

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

