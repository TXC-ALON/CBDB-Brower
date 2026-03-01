import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import ReactECharts from "echarts-for-react";
import chinaGeoJson from "../assets/china.geo.json";
import { getGeoDistribution, getPersonDetail } from "../services/api";

if (!echarts.getMap("china")) {
  echarts.registerMap("china", chinaGeoJson);
}

function toYearNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) {
    return null;
  }
  return Math.trunc(n);
}

function formatYearText(value) {
  const n = toYearNumber(value);
  return n === null ? "未详" : String(n);
}

function formatYearRangeText(start, end) {
  const s = toYearNumber(start);
  const e = toYearNumber(end);
  if (s === null && e === null) {
    return "年代未详";
  }
  if (s !== null && e !== null) {
    return `${s} - ${e}`;
  }
  return String(s ?? e);
}

function getVisitYear(visit) {
  return toYearNumber(visit?.firstYear) ?? toYearNumber(visit?.lastYear);
}

function getAgeAtYear(year, personDetail) {
  const birthYear = toYearNumber(personDetail?.person?.birthYear);
  if (year === null || birthYear === null) {
    return null;
  }
  const age = year - birthYear;
  return age >= 0 ? age : null;
}

function formatArrivalNarration(visit, personDetail) {
  const year = getVisitYear(visit);
  if (year === null) {
    return "年代未详，到达";
  }
  const age = getAgeAtYear(year, personDetail);
  if (age !== null) {
    return `${year}年，${age}岁到达`;
  }
  return `${year}年到达`;
}

function buildPointKey(row) {
  if (row?.addrId) {
    return `addr-${row.addrId}`;
  }
  return `geo-${row?.addrName || "未知地点"}-${row?.longitude || ""}-${row?.latitude || ""}`;
}

function overlapsWithRange(aStart, aEnd, bStart, bEnd) {
  const as = toYearNumber(aStart);
  const ae = toYearNumber(aEnd);
  const bs = toYearNumber(bStart);
  const be = toYearNumber(bEnd);
  const left = as ?? ae;
  const right = ae ?? as;
  const targetLeft = bs ?? be;
  const targetRight = be ?? bs;
  if (left === null || right === null || targetLeft === null || targetRight === null) {
    return false;
  }
  return Math.max(left, targetLeft) <= Math.min(right, targetRight);
}

function inferVisitReasons(visit, personDetail) {
  if (!personDetail) {
    return [];
  }
  const reasons = [];

  const officeHits = (personDetail.offices || [])
    .filter((item) => overlapsWithRange(visit.firstYear, visit.lastYear, item.firstYear, item.lastYear))
    .slice(0, 3)
    .map((item) => `${formatYearRangeText(item.firstYear, item.lastYear)} 任 ${item.officeName || "未知官职"}`);
  if (officeHits.length > 0) {
    reasons.push(...officeHits);
  }

  const entryHits = (personDetail.entries || [])
    .filter((item) => overlapsWithRange(visit.firstYear, visit.lastYear, item.year, item.year))
    .slice(0, 2)
    .map((item) => `${formatYearText(item.year)} 年 ${item.entryType || "入仕"}${item.examRank ? `（${item.examRank}）` : ""}`);
  if (entryHits.length > 0) {
    reasons.push(...entryHits);
  }

  const assocHits = (personDetail.associations || [])
    .filter((item) =>
      overlapsWithRange(visit.firstYear, visit.lastYear, item.firstYear, item.lastYear)
    )
    .slice(0, 2)
    .map((item) => `${formatYearRangeText(item.firstYear, item.lastYear)} ${item.relation || "社会关系"}：${item.targetName || "未详"}`);
  if (assocHits.length > 0) {
    reasons.push(...assocHits);
  }

  return reasons.slice(0, 6);
}

export default function MapPage({ dynasties, selectedPerson }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("aggregate");
  const [geoData, setGeoData] = useState({ points: [], timeline: [], yearExtent: null });
  const [personDetail, setPersonDetail] = useState(null);
  const [activeRouteIndex, setActiveRouteIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [filters, setFilters] = useState({
    dynastyId: "",
    startYear: "",
    endYear: "",
    followPerson: true,
  });
  const autoYearRef = useRef({ personId: null, startYear: "", endYear: "" });
  const loadRequestSeqRef = useRef(0);
  const waitingForPerson = filters.followPerson && !selectedPerson?.id;

  const loadData = async () => {
    const requestSeq = ++loadRequestSeqRef.current;
    setLoading(true);
    setError("");

    if (waitingForPerson) {
      if (requestSeq === loadRequestSeqRef.current) {
        setMode("person");
        setGeoData({ points: [], timeline: [], yearExtent: null });
        setLoading(false);
      }
      return;
    }

    try {
      const payload = {
        dynastyId: filters.dynastyId || null,
        startYear: filters.startYear || null,
        endYear: filters.endYear || null,
        personId: filters.followPerson ? selectedPerson?.id : null,
        includeTimeline: Boolean(filters.followPerson),
      };
      const result = await getGeoDistribution(payload);
      if (requestSeq !== loadRequestSeqRef.current) {
        return;
      }
      setMode(result.mode);
      setGeoData(result);
    } catch (err) {
      if (requestSeq !== loadRequestSeqRef.current) {
        return;
      }
      setError(err.message);
    } finally {
      if (requestSeq === loadRequestSeqRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadData();
  }, [
    filters.dynastyId,
    filters.startYear,
    filters.endYear,
    filters.followPerson,
    selectedPerson?.id,
    waitingForPerson,
  ]);

  useEffect(() => {
    if (!selectedPerson?.id) {
      setPersonDetail(null);
      return;
    }

    let cancelled = false;

    getPersonDetail(selectedPerson.id)
      .then((detail) => {
        if (cancelled || !detail?.person) {
          return;
        }
        setPersonDetail(detail);

        if (!filters.followPerson) {
          return;
        }

        const person = detail.person;
        const nextStart =
          Number.isFinite(Number(person.birthYear)) && Number(person.birthYear) !== 0
            ? String(person.birthYear)
            : "";
        const nextEnd =
          Number.isFinite(Number(person.deathYear)) && Number(person.deathYear) !== 0
            ? String(person.deathYear)
            : "";

        setFilters((prev) => {
          const prevAuto = autoYearRef.current;
          const canReplaceStart =
            !String(prev.startYear || "").trim() ||
            (prevAuto.personId && String(prev.startYear) === String(prevAuto.startYear));
          const canReplaceEnd =
            !String(prev.endYear || "").trim() ||
            (prevAuto.personId && String(prev.endYear) === String(prevAuto.endYear));

          const startYear = canReplaceStart ? nextStart : prev.startYear;
          const endYear = canReplaceEnd ? nextEnd : prev.endYear;

          if (startYear === prev.startYear && endYear === prev.endYear) {
            return prev;
          }
          return {
            ...prev,
            startYear,
            endYear,
          };
        });

        autoYearRef.current = {
          personId: selectedPerson.id,
          startYear: nextStart,
          endYear: nextEnd,
        };
      })
      .catch(() => {
        // Keep map usable even when detail fetch fails.
      });

    return () => {
      cancelled = true;
    };
  }, [filters.followPerson, selectedPerson?.id]);

  const personRoute = useMemo(() => {
    if (mode !== "person") {
      return [];
    }
    return geoData.points
      .filter((item) => Number.isFinite(Number(item.longitude)) && Number.isFinite(Number(item.latitude)))
      .map((item, index) => ({
        ...item,
        routeOrder: Number.isFinite(Number(item.sequence)) ? Number(item.sequence) : index,
        mapKey: buildPointKey(item),
      }))
      .sort((a, b) => {
        const aYear = toYearNumber(a.firstYear) ?? toYearNumber(a.lastYear) ?? 99999;
        const bYear = toYearNumber(b.firstYear) ?? toYearNumber(b.lastYear) ?? 99999;
        if (aYear !== bYear) {
          return aYear - bYear;
        }
        return a.routeOrder - b.routeOrder;
      });
  }, [geoData.points, mode]);

  const groupedPoints = useMemo(() => {
    if (mode !== "person") {
      return geoData.points;
    }
    const grouped = new Map();
    for (const row of personRoute) {
      const key = buildPointKey(row);
      if (!grouped.has(key)) {
        grouped.set(key, {
          addrId: row.addrId || null,
          mapKey: key,
          addrName: row.addrName || "未知地点",
          longitude: row.longitude,
          latitude: row.latitude,
          visits: [],
        });
      }
      grouped.get(key).visits.push(row);
    }

    return Array.from(grouped.values()).map((group) => {
      const visits = group.visits.sort((a, b) => {
        const aYear = toYearNumber(a.firstYear) ?? toYearNumber(a.lastYear) ?? 99999;
        const bYear = toYearNumber(b.firstYear) ?? toYearNumber(b.lastYear) ?? 99999;
        if (aYear !== bYear) {
          return aYear - bYear;
        }
        return (a.routeOrder || 0) - (b.routeOrder || 0);
      });

      const firstKnown = visits
        .map((item) => toYearNumber(item.firstYear) ?? toYearNumber(item.lastYear))
        .find((year) => year !== null);
      const lastKnown = visits
        .map((item) => toYearNumber(item.lastYear) ?? toYearNumber(item.firstYear))
        .filter((year) => year !== null)
        .at(-1);

      return {
        ...group,
        visitCount: visits.length,
        visits,
        firstYear: firstKnown,
        lastYear: lastKnown,
        addrTypeSummary: [...new Set(visits.map((item) => item.addrType).filter(Boolean))].join("、"),
      };
    });
  }, [geoData.points, mode, personRoute]);

  useEffect(() => {
    setSelectedPoint(null);
    setActiveRouteIndex(0);
    setAutoPlay(true);
  }, [selectedPerson?.id, filters.startYear, filters.endYear, filters.followPerson, mode]);

  useEffect(() => {
    if (mode !== "person" || personRoute.length < 2 || !autoPlay) {
      return;
    }
    const timer = window.setInterval(() => {
      setActiveRouteIndex((prev) => (prev + 1) % personRoute.length);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [autoPlay, mode, personRoute.length]);

  useEffect(() => {
    setActiveRouteIndex((prev) => {
      if (personRoute.length <= 0) {
        return 0;
      }
      return Math.min(prev, personRoute.length - 1);
    });
  }, [personRoute.length]);

  const activeRoutePoint =
    mode === "person" && personRoute.length > 0
      ? personRoute[Math.min(activeRouteIndex, personRoute.length - 1)]
      : null;
  const previousRoutePoint =
    mode === "person" && activeRouteIndex > 0 && personRoute.length > 1
      ? personRoute[Math.max(0, activeRouteIndex - 1)]
      : null;
  const passedPointKeys = useMemo(() => {
    if (mode !== "person" || personRoute.length === 0) {
      return new Set();
    }
    return new Set(
      personRoute.slice(0, Math.min(activeRouteIndex + 1, personRoute.length)).map((item) => item.mapKey)
    );
  }, [activeRouteIndex, mode, personRoute]);
  const currentLeg = useMemo(() => {
    if (!previousRoutePoint || !activeRoutePoint) {
      return null;
    }
    return {
      from: previousRoutePoint,
      to: activeRoutePoint,
    };
  }, [activeRoutePoint, previousRoutePoint]);
  const activeArrivalText = useMemo(
    () => (activeRoutePoint ? formatArrivalNarration(activeRoutePoint, personDetail) : ""),
    [activeRoutePoint, personDetail]
  );
  const fromDepartureText = useMemo(() => {
    if (!currentLeg) {
      return "";
    }
    const fromYear = getVisitYear(currentLeg.from);
    if (fromYear === null) {
      return "年代未详出发";
    }
    const fromAge = getAgeAtYear(fromYear, personDetail);
    if (fromAge !== null) {
      return `${fromYear}年，${fromAge}岁出发`;
    }
    return `${fromYear}年出发`;
  }, [currentLeg, personDetail]);

  const pointDetail = useMemo(() => {
    if (!selectedPoint) {
      return null;
    }
    if (mode !== "person") {
      return {
        title: selectedPoint.addrName || "未知地点",
        lines: [
          `当前筛选中涉及人物数：${selectedPoint.personCount || 0}`,
          "该模式为聚合点，暂不对应某一位人物的具体活动事由。",
        ],
        visits: [],
      };
    }

    const visits = (selectedPoint.visits || [selectedPoint]).map((visit) => ({
      ...visit,
      reasons: inferVisitReasons(visit, personDetail),
    }));

    return {
      title: selectedPoint.addrName || "未知地点",
      lines: [
        `到访次数：${visits.length} 次`,
        `主要类型：${selectedPoint.addrTypeSummary || selectedPoint.addrType || "活动地点"}`,
        `时间跨度：${formatYearRangeText(selectedPoint.firstYear, selectedPoint.lastYear)}`,
      ],
      visits,
    };
  }, [mode, personDetail, selectedPoint]);

  const stepRoute = (offset) => {
    if (personRoute.length === 0) {
      return;
    }
    setAutoPlay(false);
    setActiveRouteIndex((prev) => {
      const next = prev + offset;
      if (next < 0) {
        return 0;
      }
      if (next > personRoute.length - 1) {
        return personRoute.length - 1;
      }
      return next;
    });
  };

  const chartEvents = useMemo(
    () => ({
      click: (params) => {
        const raw = params?.data?.raw;
        if (!raw) {
          return;
        }
        setSelectedPoint(raw);
      },
    }),
    []
  );

  const chartOption = useMemo(() => {
    const sourcePoints = mode === "person" ? groupedPoints : geoData.points;
    const points = sourcePoints.map((p) => ({
      name: p.addrName,
      value: [Number(p.longitude), Number(p.latitude), p.personCount || 1],
      raw: p,
      pointState:
        mode === "person"
          ? activeRoutePoint?.mapKey === p.mapKey
            ? "active"
            : passedPointKeys.has(p.mapKey)
              ? "passed"
              : "pending"
          : "aggregate",
      symbolSize:
        mode === "person"
          ? 10 + Math.min(14, Math.max(0, (p.visitCount || 1) - 1) * 2)
          : Math.max(6, Math.min(20, (p.personCount || 0) / 7)),
    }));
    const aggregateHeatData =
      mode !== "person"
        ? geoData.points.map((p) => ({
            name: p.addrName,
            value: [Number(p.longitude), Number(p.latitude), Math.max(1, Number(p.personCount || 0))],
            raw: p,
          }))
        : [];
    const aggregateMaxCount =
      mode !== "person"
        ? Math.max(1, ...geoData.points.map((p) => Number(p.personCount || 0)))
        : 1;

    const lineData =
      mode === "person"
        ? personRoute
            .filter((item) => item.longitude && item.latitude)
            .map((item) => [Number(item.longitude), Number(item.latitude)])
        : [];
    const currentPathCoords =
      mode === "person" && lineData.length > 0
        ? lineData.slice(0, Math.min(activeRouteIndex + 1, lineData.length))
        : [];
    const currentLegCoords =
      mode === "person" && currentLeg
        ? [
            [Number(currentLeg.from.longitude), Number(currentLeg.from.latitude)],
            [Number(currentLeg.to.longitude), Number(currentLeg.to.latitude)],
          ]
        : [];
    const currentLegMidPoint =
      currentLegCoords.length > 1
        ? [
            (currentLegCoords[0][0] + currentLegCoords[1][0]) / 2,
            (currentLegCoords[0][1] + currentLegCoords[1][1]) / 2,
          ]
        : null;

    const activePointSeries =
      mode === "person" && activeRoutePoint
        ? [
            ...(previousRoutePoint
              ? [
                  {
                    type: "scatter",
                    coordinateSystem: "geo",
                    z: 8,
                    data: [
                      {
                        name: previousRoutePoint.addrName,
                        value: [Number(previousRoutePoint.longitude), Number(previousRoutePoint.latitude), 1],
                        raw: previousRoutePoint,
                      },
                    ],
                    symbolSize: 16,
                    itemStyle: {
                      color: "#2f6f7d",
                      borderColor: "#f6efe2",
                      borderWidth: 2,
                    },
                    label: {
                      show: true,
                      position: "bottom",
                      color: "#2e535c",
                      fontSize: 12,
                      formatter: "出发",
                    },
                  },
                ]
              : []),
            {
              type: "scatter",
              coordinateSystem: "geo",
              z: 9,
              data: [
                {
                  name: activeRoutePoint.addrName,
                  value: [Number(activeRoutePoint.longitude), Number(activeRoutePoint.latitude), 1],
                  raw: activeRoutePoint,
                },
              ],
              symbolSize: 24,
              itemStyle: {
                color: "#1565c0",
                borderColor: "#e6f1ff",
                borderWidth: 2.2,
                shadowColor: "rgba(21, 101, 192, 0.48)",
                shadowBlur: 18,
              },
            },
          ]
        : [];
    const legLabelSeries =
      mode === "person" && currentLeg && currentLegMidPoint
        ? [
            {
              type: "scatter",
              coordinateSystem: "geo",
              z: 11,
              symbolSize: 1,
              itemStyle: {
                color: "transparent",
              },
              data: [
                {
                  name: "当前跳转标签",
                  value: [currentLegMidPoint[0], currentLegMidPoint[1], 1],
                  raw: currentLeg,
                },
              ],
              label: {
                show: true,
                position: "top",
                color: "#144475",
                fontSize: 12,
                backgroundColor: "rgba(246, 252, 255, 0.94)",
                borderColor: "#6d9dc7",
                borderWidth: 1,
                borderRadius: 5,
                padding: [3, 6],
                formatter: () =>
                  `${currentLeg.from.addrName || "未知地点"} → ${currentLeg.to.addrName || "未知地点"}`,
              },
            },
          ]
        : [];

    return {
      visualMap:
        mode !== "person"
          ? {
              show: true,
              min: 0,
              max: aggregateMaxCount,
              calculable: true,
              orient: "horizontal",
              left: "center",
              bottom: 12,
              text: ["高", "低"],
              inRange: {
                color: ["#f7f2dd", "#f6c87f", "#ea8f4a", "#bc3f1f"],
              },
              textStyle: {
                color: "#4e4539",
              },
            }
          : undefined,
      tooltip: {
        trigger: "item",
        formatter: (params) => {
          const data = params.data?.raw;
          if (!data) {
            return params.name;
          }
          if (mode === "person") {
            return `${data.addrName}<br/>${data.addrTypeSummary || data.addrType || "活动地点"}<br/>${formatYearRangeText(
              data.firstYear,
              data.lastYear
            )}<br/>到访 ${data.visitCount || 1} 次`;
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
        ...(mode !== "person"
          ? [
              {
                type: "heatmap",
                coordinateSystem: "geo",
                data: aggregateHeatData,
                pointSize: 11,
                blurSize: 17,
                z: 3,
              },
              {
                type: "scatter",
                coordinateSystem: "geo",
                data: points,
                z: 4,
                itemStyle: {
                  color: "#fff7ec",
                  borderColor: "#8a6f4f",
                  borderWidth: 1.1,
                  opacity: 0.92,
                },
              },
            ]
          : [
              {
                type: "scatter",
                coordinateSystem: "geo",
                data: points,
                itemStyle: {
                  color: (params) => {
                    const state = params.data?.pointState;
                    if (state === "active") {
                      return "#1565c0";
                    }
                    if (state === "passed") {
                      return "#2f6f7d";
                    }
                    return "#b8a58e";
                  },
                  borderColor: "#f7efe1",
                  borderWidth: 1.4,
                  opacity: 0.95,
                },
              },
            ]),
        ...activePointSeries,
        ...legLabelSeries,
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
                  width: 1.2,
                  opacity: 0.22,
                },
              },
              ...(currentPathCoords.length > 1
                ? [
                    {
                      type: "lines",
                      coordinateSystem: "geo",
                      z: 7,
                      data: [
                        {
                          coords: currentPathCoords,
                        },
                      ],
                      polyline: true,
                      lineStyle: {
                        color: "#2f6f7d",
                        width: 3,
                        opacity: 0.62,
                      },
                    },
                  ]
                : []),
              ...(currentLegCoords.length > 1
                ? [
                    {
                      type: "lines",
                      coordinateSystem: "geo",
                      z: 10,
                      data: [
                        {
                          coords: currentLegCoords,
                          fromName: currentLeg.from.addrName || "未知地点",
                          toName: currentLeg.to.addrName || "未知地点",
                        },
                      ],
                      polyline: false,
                      symbol: ["none", "arrow"],
                      symbolSize: 11,
                      lineStyle: {
                        color: "#1565c0",
                        width: 4.2,
                        opacity: 0.98,
                      },
                    },
                  ]
                : []),
            ]
          : []),
      ],
    };
  }, [
    activeRouteIndex,
    activeRoutePoint,
    currentLeg,
    activeArrivalText,
    geoData,
    groupedPoints,
    mode,
    passedPointKeys,
    personRoute,
    personDetail,
    previousRoutePoint,
  ]);

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
      {waitingForPerson && !loading && (
        <div className="muted">请先在人物检索中选择人物</div>
      )}
      {loading && <div className="muted">地图数据加载中...</div>}

      {mode === "person" && activeRoutePoint && (
        <>
          <div className="map-live-badge">
            <strong>轨迹动画</strong>
            <span>
              第 {Math.min(activeRouteIndex + 1, personRoute.length)} / {personRoute.length} 站
            </span>
            <span>{activeArrivalText}</span>
            <span>{activeRoutePoint.addrName || "未知地点"}</span>
            <span>地点类型：{activeRoutePoint.addrType || "活动地点"}</span>
          </div>
          <div className="map-leg-badge">
            {currentLeg ? (
              <>
                <strong>当前跳转</strong>
                <span>
                  {currentLeg.from.addrName || "未知地点"} → {currentLeg.to.addrName || "未知地点"}
                </span>
                <span>
                  {fromDepartureText}，{activeArrivalText}
                </span>
              </>
            ) : (
              <>
                <strong>当前跳转</strong>
                <span>起点站（暂无前一站）</span>
              </>
            )}
          </div>

          <div className="map-route-controls">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={autoPlay}
                onChange={(e) => setAutoPlay(e.target.checked)}
              />
              自动播放
            </label>
            <button
              className="btn-secondary"
              disabled={personRoute.length <= 1}
              onClick={() => stepRoute(-1)}
            >
              上一步
            </button>
            <button
              className="btn-secondary"
              disabled={personRoute.length <= 1}
              onClick={() => stepRoute(1)}
            >
              下一步
            </button>
            <label className="map-route-slider">
              进度
              <input
                type="range"
                min={0}
                max={Math.max(personRoute.length - 1, 0)}
                step={1}
                value={Math.min(activeRouteIndex, Math.max(personRoute.length - 1, 0))}
                onChange={(e) => {
                  setAutoPlay(false);
                  setActiveRouteIndex(Number(e.target.value));
                }}
              />
            </label>
          </div>
        </>
      )}

      {!loading && (
        <div className="map-chart-wrap">
          <ReactECharts
            option={chartOption}
            style={{ height: "620px", width: "100%" }}
            onEvents={chartEvents}
          />
          {pointDetail && (
            <aside className="map-point-modal">
              <div className="map-point-modal-head">
                <h4>{pointDetail.title}</h4>
                <button className="btn-secondary" onClick={() => setSelectedPoint(null)}>
                  关闭
                </button>
              </div>
              {pointDetail.lines.map((line, idx) => (
                <p key={`point-line-${idx}`} className="subtle">
                  {line}
                </p>
              ))}
              {pointDetail.visits.length > 0 && (
                <div className="mini-table">
                  {pointDetail.visits.map((visit, idx) => (
                    <div className="mini-row map-visit-row" key={`visit-${idx}`}>
                      <div>
                        <strong>{formatYearRangeText(visit.firstYear, visit.lastYear)}</strong>
                        <div className="subtle">{visit.addrType || "活动地点"}</div>
                      </div>
                      <div className="map-visit-reasons">
                        {visit.reasons.length > 0 ? (
                          visit.reasons.map((reason, reasonIdx) => (
                            <div key={`visit-reason-${idx}-${reasonIdx}`}>{reason}</div>
                          ))
                        ) : (
                          <div className="subtle">未检索到更细的事件描述，当前依据为地点类型与年代。</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </aside>
          )}
        </div>
      )}

      {mode === "person" && (
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
      )}
    </section>
  );
}
