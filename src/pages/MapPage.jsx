import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts";
import ReactECharts from "echarts-for-react";
import chinaGeoJson from "../assets/china.geo.json";
import { getGeoDistribution } from "../services/api";

if (!echarts.getMap("china")) {
  echarts.registerMap("china", chinaGeoJson);
}

export default function MapPage({ dynasties, selectedPerson }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("aggregate");
  const [geoData, setGeoData] = useState({ points: [], timeline: [] });
  const [filters, setFilters] = useState({
    dynastyId: "",
    startYear: "",
    endYear: "",
    followPerson: true,
  });

  const loadData = async () => {
    setLoading(true);
    setError("");

    try {
      const payload = {
        dynastyId: filters.dynastyId || null,
        startYear: filters.startYear || null,
        endYear: filters.endYear || null,
        personId: filters.followPerson ? selectedPerson?.id : null,
      };
      const result = await getGeoDistribution(payload);
      setMode(result.mode);
      setGeoData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [filters.dynastyId, filters.startYear, filters.endYear, filters.followPerson, selectedPerson?.id]);

  const chartOption = useMemo(() => {
    const points = geoData.points.map((p) => ({
      name: p.addrName,
      value: [Number(p.longitude), Number(p.latitude), p.personCount || 1],
      raw: p,
      symbolSize: mode === "person" ? 12 : Math.max(6, Math.min(20, (p.personCount || 0) / 7)),
    }));

    const lineData =
      mode === "person"
        ? geoData.points
            .filter((item) => item.longitude && item.latitude)
            .map((item) => [Number(item.longitude), Number(item.latitude)])
        : [];

    return {
      tooltip: {
        trigger: "item",
        formatter: (params) => {
          const data = params.data?.raw;
          if (!data) {
            return params.name;
          }
          if (mode === "person") {
            return `${data.addrName}<br/>${data.addrType || "活动地点"}<br/>${data.firstYear || "?"} - ${
              data.lastYear || "?"
            }`;
          }
          return `${data.addrName}<br/>涉及人物：${data.personCount || 0} 人`;
        },
      },
      geo: {
        map: "china",
        roam: true,
        zoom: 1.14,
        itemStyle: {
          areaColor: "#f4e8ce",
          borderColor: "#9f8f79",
        },
        emphasis: {
          itemStyle: {
            areaColor: "#f0d7aa",
          },
        },
      },
      series: [
        {
          type: "effectScatter",
          coordinateSystem: "geo",
          data: points,
          rippleEffect: {
            scale: 4,
            brushType: "stroke",
          },
          itemStyle: {
            color: mode === "person" ? "#bc3f1f" : "#2f6f7d",
          },
        },
        ...(lineData.length > 1
          ? [
              {
                type: "lines",
                coordinateSystem: "geo",
                data: [
                  {
                    coords: lineData,
                  },
                ],
                polyline: true,
                lineStyle: {
                  color: "#8b4d2a",
                  width: 2.2,
                  opacity: 0.75,
                },
                effect: {
                  show: true,
                  period: 6,
                  trailLength: 0.2,
                  symbolSize: 6,
                },
              },
            ]
          : []),
      ],
    };
  }, [geoData, mode]);

  return (
    <section className="panel">
      <h2>地理分布地图</h2>
      <p className="subtle">
        {mode === "person"
          ? `人物轨迹模式：${selectedPerson?.name || "未选择人物"}`
          : "全局分布模式：显示人物活动高密度地点"}
      </p>

      <div className="inline-form">
        <label>
          朝代筛选
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
          起始年份
          <input
            type="number"
            value={filters.startYear}
            onChange={(e) => setFilters((prev) => ({ ...prev, startYear: e.target.value }))}
            placeholder="如 1000"
          />
        </label>

        <label>
          结束年份
          <input
            type="number"
            value={filters.endYear}
            onChange={(e) => setFilters((prev) => ({ ...prev, endYear: e.target.value }))}
            placeholder="如 1900"
          />
        </label>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={filters.followPerson}
            onChange={(e) => setFilters((prev) => ({ ...prev, followPerson: e.target.checked }))}
          />
          跟随当前选中人物
        </label>
      </div>

      {error && <div className="error-box">{error}</div>}
      {loading && <div className="muted">地图数据加载中...</div>}

      {!loading && <ReactECharts option={chartOption} style={{ height: "620px", width: "100%" }} />}

      <div className="timeline-strip">
        <h4>时间轴统计</h4>
        <div className="mini-table">
          {geoData.timeline.slice(0, 60).map((row, idx) => (
            <div className="mini-row" key={`timeline-${idx}`}>
              <span>{row.year ?? row.decade}</span>
              <span>{row.count}</span>
            </div>
          ))}
          {geoData.timeline.length === 0 && <div className="muted">无可用时间轴数据</div>}
        </div>
      </div>
    </section>
  );
}

