import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { getRelationshipGraph } from "../services/api";

function toNetworkCategoryIndex(nodeCategory) {
  if (nodeCategory === "root") {
    return 0;
  }
  if (nodeCategory === "family") {
    return 1;
  }
  return 2;
}

function placeGroup(nodes, radius, startAngle, endAngle) {
  if (nodes.length === 0) {
    return [];
  }
  if (nodes.length === 1) {
    const mid = (startAngle + endAngle) / 2;
    return [
      {
        ...nodes[0],
        x: Math.cos(mid) * radius,
        y: Math.sin(mid) * radius,
      },
    ];
  }

  const step = (endAngle - startAngle) / (nodes.length - 1);
  return nodes.map((node, index) => {
    const angle = startAngle + step * index;
    return {
      ...node,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });
}

function buildStaticLayout(nodes) {
  const root = nodes.find((node) => node.categoryKey === "root");
  const family = nodes.filter((node) => node.categoryKey === "family");
  const social = nodes.filter((node) => node.categoryKey === "social");
  const others = nodes.filter(
    (node) =>
      node.categoryKey !== "root" &&
      node.categoryKey !== "family" &&
      node.categoryKey !== "social"
  );

  const placed = [];
  if (root) {
    placed.push({ ...root, x: 0, y: 0, fixed: true });
  }

  const familyPlaced = placeGroup(family, 260, (2 * Math.PI) / 3, (4 * Math.PI) / 3);
  const socialPlaced = placeGroup(social, 340, -Math.PI / 3, Math.PI / 3);
  const othersPlaced = placeGroup(others, 420, Math.PI / 3, (5 * Math.PI) / 3);

  for (const node of [...familyPlaced, ...socialPlaced, ...othersPlaced]) {
    placed.push({ ...node, fixed: true });
  }

  return placed;
}

function buildDynamicLayout(nodes) {
  const seeded = buildStaticLayout(nodes);
  return seeded.map((node) => {
    if (node.categoryKey === "root") {
      return { ...node, x: 0, y: 0, fixed: false, draggable: true };
    }
    return { ...node, fixed: false, draggable: true };
  });
}

function addCenterAnchors(nodes, links, rootId) {
  if (!rootId) {
    return { nodes, links };
  }
  const rootIdText = String(rootId);
  const hasRoot = nodes.some((node) => String(node.id) === rootIdText);
  if (!hasRoot) {
    return { nodes, links };
  }

  const anchorCount = 6;
  const anchorRadius = 110;
  const anchorNodes = [];
  const anchorLinks = [];

  for (let i = 0; i < anchorCount; i += 1) {
    const angle = (2 * Math.PI * i) / anchorCount;
    const anchorId = `__center_anchor_${i}`;
    anchorNodes.push({
      id: anchorId,
      name: "",
      value: "",
      categoryKey: "anchor",
      symbolSize: 1,
      x: Math.cos(angle) * anchorRadius,
      y: Math.sin(angle) * anchorRadius,
      fixed: true,
      draggable: false,
      label: { show: false },
      itemStyle: { opacity: 0 },
      tooltip: { show: false },
      emphasis: { disabled: true },
    });

    anchorLinks.push({
      source: rootIdText,
      target: anchorId,
      relationType: "center_anchor",
      name: "",
      value: "",
      lineStyle: {
        opacity: 0,
        width: 0,
      },
      label: { show: false },
      tooltip: { show: false },
      symbol: ["none", "none"],
    });
  }

  return {
    nodes: [...nodes, ...anchorNodes],
    links: [...links, ...anchorLinks],
  };
}

function analyzeFamilyGeneration(relationName) {
  const relation = String(relationName || "");
  if (!relation) {
    return { bucket: "other", generation: 0 };
  }

  const tokens = relation
    .split(/[，,、;；/|]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const text = tokens.join("|");

  const hasToken = (list) => tokens.some((token) => list.includes(token));
  const hasPattern = (pattern) => pattern.test(text);

  if (hasPattern(/高祖|高祖父|高祖母/)) {
    return { bucket: "ancestor", generation: -4 };
  }
  if (hasPattern(/曾祖|曾祖父|曾祖母/)) {
    return { bucket: "ancestor", generation: -3 };
  }
  if (hasPattern(/祖父|祖母|外祖|祖翁|祖姑|祖/)) {
    return { bucket: "ancestor", generation: -2 };
  }
  if (
    hasPattern(
      /丈夫之父|丈夫之母|妻之父|妻之母|夫之父|夫之母|翁|翁姑|舅姑|公公|婆婆|岳父|岳母|丈人|丈母|父|母|伯|叔|舅|姑|姨|嫡母|庶母/
    )
  ) {
    return { bucket: "parent", generation: -1 };
  }

  if (hasPattern(/玄孫|玄孙/)) {
    return { bucket: "greatGrandchild", generation: 4 };
  }
  if (hasPattern(/曾孫|曾孙/)) {
    return { bucket: "greatGrandchild", generation: 3 };
  }
  if (hasPattern(/孫|孙|外孫|外孙/)) {
    return { bucket: "grandchild", generation: 2 };
  }
  if (hasPattern(/子|女|嗣子|養子|养子|繼子|继子|婿|媳|兒媳|儿媳/)) {
    return { bucket: "child", generation: 1 };
  }

  if (hasPattern(/兄|弟|姐|妹|堂|表/)) {
    return { bucket: "sibling", generation: 0 };
  }
  if (
    hasToken(["夫", "妻", "丈夫", "妻子", "配偶", "元配", "继室", "繼室"]) ||
    hasPattern(/丈夫|夫婿|夫君|前夫|後夫|后夫|再婚丈夫|配偶|婚姻|妾|夫人/)
  ) {
    return { bucket: "spouse", generation: 0 };
  }

  return { bucket: "other", generation: 0 };
}

function spreadByLine(items, y, spacing) {
  if (items.length === 0) {
    return [];
  }
  return items.map((item, index) => ({
    ...item,
    x: (index - (items.length - 1) / 2) * spacing,
    y,
  }));
}

function buildBucketNodes(items, options) {
  const laid = spreadByLine(items, options.y, options.spacing).map((item) => ({
    ...item,
    x: item.x + (options.xShift || 0),
    category: options.category,
    symbol: options.symbol,
    symbolSize: options.symbolSize,
    value: item.name,
    itemStyle: { color: options.color },
  }));
  return laid;
}

function buildFamilyTreeGraph(graph) {
  const rootId = String(graph.rootId || "");
  const rootNode = graph.nodes.find((node) => String(node.id) === rootId);
  if (!rootNode) {
    return null;
  }

  const nodeById = new Map(graph.nodes.map((node) => [String(node.id), node]));
  const familyLinks = graph.links.filter((link) => link.relationType === "family");

  const relativesMap = new Map();
  for (const link of familyLinks) {
    const targetId = String(link.target);
    if (!targetId || targetId === rootId || relativesMap.has(targetId)) {
      continue;
    }
    const node = nodeById.get(targetId);
    const analyzed = analyzeFamilyGeneration(link.name);
    relativesMap.set(targetId, {
      id: targetId,
      name: node?.name || `人物 ${targetId}`,
      relation: link.name || "亲属",
      bucket: analyzed.bucket,
      generation: analyzed.generation,
    });
  }

  const groups = {
    ancestor: [],
    parent: [],
    spouse: [],
    sibling: [],
    child: [],
    grandchild: [],
    greatGrandchild: [],
    other: [],
  };
  for (const relative of relativesMap.values()) {
    if (!groups[relative.bucket]) {
      groups.other.push(relative);
      continue;
    }
    groups[relative.bucket].push(relative);
  }

  const root = {
    id: rootId,
    name: rootNode.name,
    category: 0,
    symbol: "circle",
    symbolSize: 58,
    x: 0,
    y: 0,
    value: rootNode.name,
    itemStyle: { color: "#c7512f" },
  };

  const ancestorNodes = buildBucketNodes(groups.ancestor, {
    y: -360,
    spacing: 180,
    xShift: 0,
    category: 1,
    symbol: "rect",
    symbolSize: 32,
    color: "#4f6074",
  });

  const parentNodes = buildBucketNodes(groups.parent, {
    y: -190,
    spacing: 170,
    xShift: 0,
    category: 2,
    symbol: "rect",
    symbolSize: 34,
    color: "#60788d",
  });

  const spouseNodes = buildBucketNodes(groups.spouse, {
    y: 10,
    spacing: 170,
    xShift: 0,
    category: 3,
    symbol: "diamond",
    symbolSize: 34,
    color: "#a36b2d",
  }).map((item) => ({
    ...item,
    x: item.x >= 0 ? item.x + 190 : item.x - 190 || -190,
  }));

  const siblingNodes = buildBucketNodes(groups.sibling, {
    y: 10,
    spacing: 150,
    xShift: 0,
    category: 4,
    symbol: "circle",
    symbolSize: 28,
    color: "#756592",
  }).map((item) => ({
    ...item,
    x: item.x >= 0 ? item.x + 360 : item.x - 360 || -360,
  }));

  const childNodes = buildBucketNodes(groups.child, {
    y: 200,
    spacing: 170,
    xShift: 0,
    category: 5,
    symbol: "triangle",
    symbolSize: 34,
    color: "#2f7c5a",
  });

  const grandchildNodes = buildBucketNodes(groups.grandchild, {
    y: 360,
    spacing: 170,
    xShift: 0,
    category: 6,
    symbol: "triangle",
    symbolSize: 30,
    color: "#3f8f66",
  });

  const greatGrandchildNodes = buildBucketNodes(groups.greatGrandchild, {
    y: 510,
    spacing: 160,
    xShift: 0,
    category: 7,
    symbol: "triangle",
    symbolSize: 26,
    color: "#51a879",
  });

  const otherNodes = buildBucketNodes(groups.other, {
    y: 620,
    spacing: 165,
    xShift: 0,
    category: 8,
    symbol: "roundRect",
    symbolSize: 24,
    color: "#7e6a55",
  });

  const nodes = [
    root,
    ...ancestorNodes,
    ...parentNodes,
    ...spouseNodes,
    ...siblingNodes,
    ...childNodes,
    ...grandchildNodes,
    ...greatGrandchildNodes,
    ...otherNodes,
  ];
  const links = [];

  for (const item of ancestorNodes) {
    links.push({
      source: item.id,
      target: rootId,
      name: item.relation,
      value: item.relation,
      relationType: "ancestor",
      lineStyle: { color: "#4f6074", width: 2.2 },
    });
  }
  for (const item of parentNodes) {
    links.push({
      source: item.id,
      target: rootId,
      name: item.relation,
      value: item.relation,
      relationType: "parent",
      lineStyle: { color: "#60788d", width: 2.4 },
    });
  }
  for (const item of spouseNodes) {
    links.push({
      source: rootId,
      target: item.id,
      name: item.relation,
      value: item.relation,
      relationType: "spouse",
      lineStyle: { color: "#9b6a32", width: 2.4, type: "dashed" },
    });
  }
  for (const item of siblingNodes) {
    links.push({
      source: rootId,
      target: item.id,
      name: item.relation,
      value: item.relation,
      relationType: "sibling",
      lineStyle: { color: "#756592", width: 1.6, type: "dotted" },
    });
  }
  for (const item of childNodes) {
    links.push({
      source: rootId,
      target: item.id,
      name: item.relation,
      value: item.relation,
      relationType: "child",
      lineStyle: { color: "#2f7c5a", width: 2.4 },
    });
  }
  for (const item of grandchildNodes) {
    links.push({
      source: rootId,
      target: item.id,
      name: item.relation,
      value: item.relation,
      relationType: "grandchild",
      lineStyle: { color: "#3f8f66", width: 2.1 },
    });
  }
  for (const item of greatGrandchildNodes) {
    links.push({
      source: rootId,
      target: item.id,
      name: item.relation,
      value: item.relation,
      relationType: "greatGrandchild",
      lineStyle: { color: "#51a879", width: 1.9 },
    });
  }
  for (const item of otherNodes) {
    links.push({
      source: rootId,
      target: item.id,
      name: item.relation,
      value: item.relation,
      relationType: "other",
      lineStyle: { color: "#7e7367", width: 1.6, type: "dotted" },
    });
  }

  return {
    nodes,
    links,
    categories: [
      { name: "核心人物" },
      { name: "祖辈" },
      { name: "父辈" },
      { name: "配偶" },
      { name: "同辈" },
      { name: "子辈" },
      { name: "孙辈" },
      { name: "曾孙及下" },
      { name: "其他" },
    ],
  };
}

export default function GraphPage({ selectedPerson }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [graph, setGraph] = useState({ nodes: [], links: [], rootName: "", rootId: null });
  const [dynamicLayout, setDynamicLayout] = useState(false);
  const [viewMode, setViewMode] = useState("network");

  useEffect(() => {
    if (!selectedPerson?.id) {
      setGraph({ nodes: [], links: [], rootName: "", rootId: null });
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
    if (viewMode === "familyTree") {
      const treeGraph = buildFamilyTreeGraph(graph);
      if (!treeGraph) {
        return null;
      }

      return {
        backgroundColor: "transparent",
        tooltip: {
          formatter: (params) => {
            if (params.dataType === "edge") {
              return params.data?.name || "亲属关系";
            }
            return params.data?.name || "";
          },
        },
        legend: [
          {
            data: treeGraph.categories.map((c) => c.name),
            top: 6,
            textStyle: { color: "#3f3b35" },
          },
        ],
        series: [
          {
            type: "graph",
            layout: "none",
            data: treeGraph.nodes,
            links: treeGraph.links,
            categories: treeGraph.categories,
            roam: true,
            draggable: false,
            edgeLabel: {
              show: true,
              formatter: (params) => params.data?.name || params.data?.value || "关系",
              fontSize: 11,
              color: "#4b443b",
            },
            label: {
              show: true,
              position: "right",
              color: "#211a12",
              fontFamily: "'LXGW WenKai', 'KaiTi', serif",
            },
            lineStyle: {
              color: "#8e7f6d",
              opacity: 0.88,
              width: 1.7,
              curveness: 0,
            },
            emphasis: {
              focus: "adjacency",
              lineStyle: { width: 3 },
            },
          },
        ],
        color: [
          "#c7512f",
          "#4f6074",
          "#60788d",
          "#a36b2d",
          "#756592",
          "#2f7c5a",
          "#3f8f66",
          "#51a879",
          "#7e6a55",
        ],
      };
    }

    const categories = [
      { name: "核心人物" },
      { name: "家族关系" },
      { name: "社会关系" },
    ];

    const rawNodes = graph.nodes.map((node) => ({
      ...node,
      categoryKey: node.category,
      value: node.name,
    }));
    const layoutNodes = dynamicLayout ? buildDynamicLayout(rawNodes) : buildStaticLayout(rawNodes);
    let nodes = layoutNodes.map((node) => ({
      ...node,
      category: toNetworkCategoryIndex(node.categoryKey),
    }));

    let links = graph.links.map((link) => ({
      ...link,
      value: link.name || "关系",
    }));

    if (dynamicLayout) {
      const constrained = addCenterAnchors(nodes, links, graph.rootId);
      nodes = constrained.nodes.map((node) => ({
        ...node,
        category: toNetworkCategoryIndex(node.categoryKey),
      }));
      links = constrained.links;
    }

    return {
      backgroundColor: "transparent",
      tooltip: {
        formatter: (params) => {
          if (params.dataType === "edge") {
            if (params.data?.relationType === "center_anchor") {
              return "";
            }
            return params.data.name || "关系";
          }
          return params.data.name || "";
        },
      },
      legend: [{ data: categories.map((c) => c.name), top: 6, textStyle: { color: "#3f3b35" } }],
      series: [
        {
          type: "graph",
          layout: dynamicLayout ? "force" : "none",
          data: nodes,
          links,
          categories,
          roam: true,
          draggable: dynamicLayout,
          edgeLabel: {
            show: true,
            formatter: (params) =>
              params.data?.relationType === "center_anchor"
                ? ""
                : params.data?.name || params.data?.value || "关系",
            fontSize: 11,
            color: "#4b443b",
          },
          label: {
            show: true,
            position: "right",
            color: "#211a12",
            fontFamily: "'LXGW WenKai', 'KaiTi', serif",
          },
          ...(dynamicLayout
            ? {
                force: {
                  repulsion: 200,
                  edgeLength: [80, 150],
                  gravity: 0.24,
                  friction: 0.35,
                  layoutAnimation: true,
                },
              }
            : {}),
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
  }, [dynamicLayout, graph, viewMode]);

  if (!selectedPerson?.id) {
    return <div className="panel muted">请先在“人物检索”中选择人物，再查看关系图谱。</div>;
  }

  return (
    <section className="panel">
      <h2>关系图谱可视化</h2>
      <p className="subtle">
        当前核心人物：{graph.rootName || selectedPerson.name}，关系边数 {graph.links.length}。
      </p>

      <div className="graph-controls">
        <label className="graph-toggle">
          <input
            type="radio"
            name="graph-view-mode"
            checked={viewMode === "network"}
            onChange={() => setViewMode("network")}
          />
          综合关系网络
        </label>
        <label className="graph-toggle">
          <input
            type="radio"
            name="graph-view-mode"
            checked={viewMode === "familyTree"}
            onChange={() => setViewMode("familyTree")}
          />
          家族家谱视图（核心+家族）
        </label>
      </div>

      {viewMode === "network" && (
        <label className="graph-toggle">
          <input
            type="checkbox"
            checked={dynamicLayout}
            onChange={(e) => setDynamicLayout(e.target.checked)}
          />
          启用动态力导布局（关闭后关系图保持静止）
        </label>
      )}
      {viewMode === "familyTree" && (
        <p className="subtle">
          家谱按“祖辈 → 父辈 → 核心人物 → 子辈 → 孙辈 → 曾孙及下”纵向分层；配偶为菱形标记，子孙为三角标记。
        </p>
      )}

      {error && <div className="error-box">{error}</div>}
      {loading && <div className="muted">正在构建关系网络...</div>}

      {!loading && graph.nodes.length > 0 && chartOption && (
        <ReactECharts option={chartOption} style={{ height: "680px", width: "100%" }} />
      )}
    </section>
  );
}
