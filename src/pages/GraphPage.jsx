import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { getRelationshipGraph } from "../services/api";

export default function GraphPage({ selectedPerson }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [graph, setGraph] = useState({ nodes: [], links: [], rootName: "" });

  useEffect(() => {
    if (!selectedPerson?.id) {
      setGraph({ nodes: [], links: [], rootName: "" });
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    getRelationshipGraph(selectedPerson.id)
      .then((data) => {
        if (!cancelled) {
          setGraph(data);
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
  }, [selectedPerson?.id]);

  const chartOption = useMemo(() => {
    const categories = [
      { name: "核心人物" },
      { name: "家族关系" },
      { name: "社会关系" },
    ];

    const nodes = graph.nodes.map((node) => ({
      ...node,
      category: node.category === "root" ? 0 : node.category === "family" ? 1 : 2,
      value: node.name,
    }));

    return {
      backgroundColor: "transparent",
      tooltip: {
        formatter: (params) => {
          if (params.dataType === "edge") {
            return params.data.name || "关系";
          }
          return params.data.name || "";
        },
      },
      legend: [{ data: categories.map((c) => c.name), top: 6, textStyle: { color: "#3f3b35" } }],
      series: [
        {
          type: "graph",
          layout: "force",
          data: nodes,
          links: graph.links,
          categories,
          roam: true,
          draggable: true,
          edgeLabel: {
            show: true,
            formatter: "{c}",
            fontSize: 11,
            color: "#4b443b",
          },
          label: {
            show: true,
            position: "right",
            color: "#211a12",
            fontFamily: "'LXGW WenKai', 'KaiTi', serif",
          },
          force: {
            repulsion: 260,
            edgeLength: 130,
            gravity: 0.05,
          },
          lineStyle: {
            color: "#8e7f6d",
            opacity: 0.8,
            width: 1.5,
            curveness: 0.06,
          },
          emphasis: {
            focus: "adjacency",
            lineStyle: { width: 3 },
          },
        },
      ],
      color: ["#c7512f", "#1f7a8c", "#9d6b1a"],
    };
  }, [graph]);

  if (!selectedPerson?.id) {
    return <div className="panel muted">请先在“人物检索”中选择人物，再查看关系图谱。</div>;
  }

  return (
    <section className="panel">
      <h2>关系图谱可视化</h2>
      <p className="subtle">
        当前核心人物：{graph.rootName || selectedPerson.name}，关系边数 {graph.links.length}。
      </p>

      {error && <div className="error-box">{error}</div>}
      {loading && <div className="muted">正在构建关系网络...</div>}

      {!loading && graph.nodes.length > 0 && (
        <ReactECharts option={chartOption} style={{ height: "680px", width: "100%" }} />
      )}
    </section>
  );
}

