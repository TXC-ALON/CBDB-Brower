import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { getStats } from "../services/api";

export default function StatsPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    getStats()
      .then((data) => {
        if (!cancelled) {
          setStats(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const dynastyOption = useMemo(() => {
    const source = stats?.dynastyDistribution || [];
    return {
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "value",
      },
      yAxis: {
        type: "category",
        data: source.map((item) => item.dynasty).reverse(),
      },
      series: [
        {
          type: "bar",
          data: source.map((item) => item.count).reverse(),
          itemStyle: {
            color: "#885428",
          },
        },
      ],
      grid: { left: 120, right: 20, top: 20, bottom: 20 },
    };
  }, [stats]);

  const entryOption = useMemo(() => {
    const source = stats?.entryTrend || [];
    return {
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: source.map((item) => item.decade),
      },
      yAxis: {
        type: "value",
      },
      series: [
        {
          type: "line",
          smooth: true,
          data: source.map((item) => item.count),
          areaStyle: {
            color: "rgba(47, 111, 125, 0.22)",
          },
          lineStyle: { color: "#2f6f7d" },
          itemStyle: { color: "#2f6f7d" },
        },
      ],
      grid: { left: 50, right: 20, top: 20, bottom: 40 },
    };
  }, [stats]);

  const officeOption = useMemo(() => {
    const source = stats?.officeDistribution || [];
    return {
      tooltip: { trigger: "item" },
      series: [
        {
          type: "pie",
          radius: ["30%", "70%"],
          data: source.map((item) => ({
            name: item.office,
            value: item.count,
          })),
        },
      ],
    };
  }, [stats]);

  const familyOption = useMemo(() => {
    const source = stats?.familyNetworkScale || [];
    return {
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        axisLabel: { interval: 0, rotate: 20 },
        data: source.map((item) => item.name),
      },
      yAxis: { type: "value" },
      series: [
        {
          type: "bar",
          data: source.map((item) => item.kinCount),
          itemStyle: { color: "#a3403b" },
        },
      ],
      grid: { left: 50, right: 20, top: 20, bottom: 90 },
    };
  }, [stats]);

  return (
    <section className="panel">
      <h2>统计分析</h2>
      <p className="subtle">包含朝代人物规模、科举趋势、官职分布与家族网络规模。</p>

      {error && <div className="error-box">{error}</div>}
      {loading && <div className="muted">统计计算中...</div>}

      {stats && (
        <>
          <div className="summary-cards">
            <article>
              <span>人物总数</span>
              <strong>{stats.summary.people.toLocaleString()}</strong>
            </article>
            <article>
              <span>官职记录</span>
              <strong>{stats.summary.offices.toLocaleString()}</strong>
            </article>
            <article>
              <span>亲属关系</span>
              <strong>{stats.summary.kinships.toLocaleString()}</strong>
            </article>
            <article>
              <span>科举记录</span>
              <strong>{stats.summary.entries.toLocaleString()}</strong>
            </article>
            <article>
              <span>社会关系</span>
              <strong>{stats.summary.associations.toLocaleString()}</strong>
            </article>
          </div>

          <div className="chart-grid">
            <div className="chart-card">
              <h4>各朝代人物数量 Top 30</h4>
              <ReactECharts option={dynastyOption} style={{ height: 360 }} />
            </div>
            <div className="chart-card">
              <h4>科举录取趋势（按十年）</h4>
              <ReactECharts option={entryOption} style={{ height: 360 }} />
            </div>
            <div className="chart-card">
              <h4>官职分布 Top 20</h4>
              <ReactECharts option={officeOption} style={{ height: 360 }} />
            </div>
            <div className="chart-card">
              <h4>家族网络规模 Top 20</h4>
              <ReactECharts option={familyOption} style={{ height: 360 }} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

