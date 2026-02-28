import { useEffect, useMemo, useState } from "react";
import PersonDetail from "../components/PersonDetail";
import { searchPeople } from "../services/api";
import { formatYearRange, highlightText } from "../utils/text";

const PAGE_SIZE = 20;

export default function SearchPage({ dynasties, selectedPerson, onSelectPerson, dbConnected }) {
  const [filters, setFilters] = useState({
    keyword: "",
    dynastyId: "",
    officeKeyword: "",
    entryKeyword: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState({
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    items: [],
    keywordVariants: [],
  });

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(result.total / result.pageSize));
  }, [result]);

  const runSearch = async (page = 1) => {
    if (!dbConnected) {
      return;
    }
    setLoading(true);
    setError("");

    try {
      const data = await searchPeople({
        ...filters,
        page,
        pageSize: PAGE_SIZE,
      });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runSearch(1);
  }, [dbConnected]);

  const handleSubmit = (event) => {
    event.preventDefault();
    runSearch(1);
  };

  return (
    <div className="grid two-col">
      <section className="panel">
        <h2>人物搜索系统</h2>
        <p className="subtle">
          支持姓名（中文/拼音）、表字/别号、朝代、官职与科举条件；内置繁简关键词兼容与分页加载。
        </p>

        <form className="search-form" onSubmit={handleSubmit}>
          <label>
            姓名 / 拼音
            <input
              type="text"
              value={filters.keyword}
              onChange={(e) => setFilters((prev) => ({ ...prev, keyword: e.target.value }))}
              placeholder="例：王阳明 / 王伯安 / Wang / 苏轼"
            />
          </label>

          <label>
            朝代
            <select
              value={filters.dynastyId}
              onChange={(e) => setFilters((prev) => ({ ...prev, dynastyId: e.target.value }))}
            >
              <option value="">全部朝代</option>
              {dynasties.map((row) => (
                <option key={row.dynastyId} value={row.dynastyId}>
                  {row.dynastyName}
                </option>
              ))}
            </select>
          </label>

          <label>
            官职关键字
            <input
              type="text"
              value={filters.officeKeyword}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, officeKeyword: e.target.value }))
              }
              placeholder="例：知府、侍郎"
            />
          </label>

          <label>
            科举关键字
            <input
              type="text"
              value={filters.entryKeyword}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, entryKeyword: e.target.value }))
              }
              placeholder="例：进士"
            />
          </label>

          <button className="btn-primary" type="submit">
            开始搜索
          </button>
        </form>

        {error && <div className="error-box">{error}</div>}
        {!dbConnected && <div className="error-box">请先加载 CBDB SQLite 数据库文件。</div>}

        <div className="search-meta">
          <strong>结果总数：{result.total.toLocaleString()}</strong>
          <span>
            第 {result.page} / {totalPages} 页
          </span>
          {result.keywordVariants.length > 1 && (
            <span>关键词变体：{result.keywordVariants.join(" / ")}</span>
          )}
        </div>

        <div className="result-table">
          {loading && <div className="muted">查询中...</div>}
          {!loading &&
            result.items.map((person) => (
              <button
                key={person.personId}
                className={`result-row ${
                  person.personId === selectedPerson?.id ? "selected" : ""
                }`}
                onClick={() =>
                  onSelectPerson({
                    id: person.personId,
                    name: person.nameChn || person.namePinyin || `人物 ${person.personId}`,
                  })
                }
              >
                <span className="name-block">
                  <span
                    dangerouslySetInnerHTML={{
                      __html: highlightText(
                        person.nameChn || person.namePinyin || "",
                        filters.keyword
                      ),
                    }}
                  />
                  {(person.courtesyName || person.styleName) && (
                    <small>
                      {person.courtesyName ? `字${person.courtesyName}` : ""}
                      {person.courtesyName && person.styleName ? " / " : ""}
                      {person.styleName ? `号${person.styleName}` : ""}
                    </small>
                  )}
                </span>
                <span>{person.dynasty}</span>
                <span>{formatYearRange(person.birthYear, person.deathYear)}</span>
                <span>{person.firstOffice || "未详官职"}</span>
              </button>
            ))}
        </div>

        <div className="pager">
          <button
            className="btn-secondary"
            disabled={result.page <= 1 || loading}
            onClick={() => runSearch(result.page - 1)}
          >
            上一页
          </button>
          <button
            className="btn-secondary"
            disabled={result.page >= totalPages || loading}
            onClick={() => runSearch(result.page + 1)}
          >
            下一页
          </button>
        </div>
      </section>

      <PersonDetail personId={selectedPerson?.id} personName={selectedPerson?.name} />
    </div>
  );
}
