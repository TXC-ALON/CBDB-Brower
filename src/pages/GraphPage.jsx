import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function toNumericStep(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isUnknownStep(step) {
  if (step === null) {
    return true;
  }
  return step >= 90;
}

function inferByRelationFallback(relationName) {
  const relation = String(relationName || "");
  if (!relation) {
    return { bucket: "other", generation: 0, directSpouse: false };
  }

  const tokens = relation
    .split(/[，,、;；/|]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const text = tokens.join("|");
  const hasToken = (list) => tokens.some((token) => list.includes(token));
  const hasPattern = (pattern) => pattern.test(text);

  if (hasPattern(/高祖|曾祖|祖父|祖母|外祖|祖/) || hasPattern(/父|母|伯|叔|舅|姑|姨|翁|岳父|岳母/)) {
    return { bucket: hasPattern(/父|母|伯|叔|舅|姑|姨|翁|岳父|岳母/) ? "parent" : "ancestor", generation: -1, directSpouse: false };
  }
  if (
    hasToken(["夫", "妻", "丈夫", "妻子", "配偶", "元配", "继室", "繼室"]) ||
    hasPattern(/妻|丈夫|夫婿|夫君|前夫|後夫|后夫|再婚丈夫|前妻|後妻|后妻|再嫁|第二任妻|第二任丈夫|配偶|婚姻|妾|夫人/)
  ) {
    return { bucket: "spouse", generation: 0, directSpouse: true };
  }
  if (hasPattern(/孫|孙|曾孫|曾孙|玄孫|玄孙/)) {
    return { bucket: hasPattern(/孫|孙|外孫|外孙/) ? "grandchild" : "greatGrandchild", generation: 2, directSpouse: false };
  }
  if (hasPattern(/子|女|婿|媳/)) {
    return { bucket: "child", generation: 1, directSpouse: false };
  }
  if (hasPattern(/兄|弟|姐|妹|堂|表/)) {
    return { bucket: "sibling", generation: 0, directSpouse: false };
  }
  return { bucket: "other", generation: 0, directSpouse: false };
}

function analyzeFamilyByKinship(link) {
  const up = toNumericStep(link.upStep);
  const down = toNumericStep(link.downStep);
  const mar = toNumericStep(link.marriageStep) ?? 0;
  const col = toNumericStep(link.collateralStep) ?? 0;

  if (!isUnknownStep(up) && !isUnknownStep(down)) {
    const generation = down - up;
    const directSpouse = generation === 0 && mar > 0 && col === 0;

    if (generation <= -2) {
      return { bucket: "ancestor", generation, directSpouse: false };
    }
    if (generation === -1) {
      return { bucket: "parent", generation, directSpouse: false };
    }
    if (generation === 0) {
      if (directSpouse) {
        return { bucket: "spouse", generation, directSpouse: true };
      }
      if (col > 0 && mar === 0) {
        return { bucket: "sibling", generation, directSpouse: false };
      }
      if (col > 0 && mar > 0) {
        return { bucket: "sibling", generation, directSpouse: false };
      }
      return { bucket: "other", generation, directSpouse: false };
    }
    if (generation === 1) {
      return { bucket: "child", generation, directSpouse: false };
    }
    if (generation === 2) {
      return { bucket: "grandchild", generation, directSpouse: false };
    }
    if (generation >= 3) {
      return { bucket: "greatGrandchild", generation, directSpouse: false };
    }
  }

  return inferByRelationFallback(link.name);
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

const malePalette = ["#1f3f67", "#27517b", "#316492", "#3f79a8", "#5291ba", "#73aad0", "#97c2df", "#bdd9ee"];
const femalePalette = [
  "#7b2e55",
  "#8e3a63",
  "#a34a74",
  "#b95f89",
  "#cc779e",
  "#dd98b6",
  "#e9b6cb",
  "#f3d2df",
];
const unknownPalette = ["#62584f", "#71665d", "#82786e", "#938a7f", "#a79f94", "#bdb4a9", "#d1c9bf", "#e5ddd3"];

function paletteIndexByGeneration(generation) {
  if (!Number.isFinite(generation)) {
    return 4;
  }
  if (generation <= -4) {
    return 0;
  }
  if (generation === -3) {
    return 1;
  }
  if (generation === -2) {
    return 2;
  }
  if (generation === -1) {
    return 3;
  }
  if (generation === 0) {
    return 4;
  }
  if (generation === 1) {
    return 5;
  }
  if (generation === 2) {
    return 6;
  }
  return 7;
}

function normalizeGender(female) {
  if (female === 1 || female === "1") {
    return "female";
  }
  if (female === 0 || female === "0") {
    return "male";
  }
  return "unknown";
}

function nodeColorByGenderAndGeneration(female, generation, fallbackColor) {
  const index = paletteIndexByGeneration(generation);
  const gender = normalizeGender(female);
  if (gender === "male") {
    return malePalette[index];
  }
  if (gender === "female") {
    return femalePalette[index];
  }
  return fallbackColor || unknownPalette[index];
}

function buildBucketNodes(items, options) {
  const laid = spreadByLine(items, options.y, options.spacing).map((item) => ({
    ...item,
    x: item.x + (options.xShift || 0),
    category: options.category,
    symbol: options.symbol,
    symbolSize: options.symbolSize,
    value: item.name,
    itemStyle: {
      color: nodeColorByGenderAndGeneration(item.female, item.generation, options.color),
    },
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

  const bucketWeight = {
    spouse: 120,
    parent: 110,
    child: 110,
    ancestor: 100,
    grandchild: 100,
    greatGrandchild: 95,
    sibling: 90,
    other: 20,
  };

  const relativesMap = new Map();
  for (const link of familyLinks) {
    const targetId = String(link.target);
    if (!targetId || targetId === rootId) {
      continue;
    }
    const node = nodeById.get(targetId);
    const analyzed = analyzeFamilyByKinship(link);
    const candidate = {
      id: targetId,
      name: node?.name || `人物 ${targetId}`,
      female: node?.female ?? null,
      relation: link.name || "亲属",
      bucket: analyzed.bucket,
      generation: analyzed.generation,
      directSpouse: analyzed.directSpouse,
      upStep: link.upStep ?? null,
      downStep: link.downStep ?? null,
      marriageStep: link.marriageStep ?? null,
      collateralStep: link.collateralStep ?? null,
      kinCode: link.kinCode ?? null,
    };
    const score =
      (bucketWeight[candidate.bucket] || 0) +
      (Number.isFinite(candidate.generation) ? 12 - Math.min(10, Math.abs(candidate.generation)) : 0) +
      (candidate.directSpouse ? 25 : 0);
    candidate._score = score;

    const existing = relativesMap.get(targetId);
    if (!existing || candidate._score > existing._score) {
      relativesMap.set(targetId, candidate);
    }
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
    female: rootNode.female ?? null,
    category: 0,
    symbol: "circle",
    symbolSize: 58,
    x: 0,
    y: 0,
    value: rootNode.name,
    itemStyle: {
      color: nodeColorByGenderAndGeneration(rootNode.female, 0, "#c7512f"),
    },
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
    y: -58,
    spacing: 220,
    xShift: 0,
    category: 3,
    symbol: "diamond",
    symbolSize: 34,
    color: "#a36b2d",
  }).map((item) => ({
    ...item,
    x: item.x >= 0 ? item.x + 260 : item.x - 260 || -260,
    label: {
      show: true,
      position: "top",
      color: "#211a12",
    },
  }));

  const siblingNodes = buildBucketNodes(groups.sibling, {
    y: 62,
    spacing: 170,
    xShift: 0,
    category: 4,
    symbol: "circle",
    symbolSize: 28,
    color: "#756592",
  }).map((item) => ({
    ...item,
    x: item.x >= 0 ? item.x + 470 : item.x - 470 || -470,
    label: {
      show: true,
      position: item.x >= 0 ? "right" : "left",
      color: "#211a12",
    },
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
  const helperNodes = [];
  const links = [];
  let helperCounter = 0;
  let railCounter = 0;

  const createRail = (y, color, relationType) => {
    const railId = `__family_rail_${railCounter}`;
    railCounter += 1;
    helperNodes.push({
      id: railId,
      name: "",
      value: "",
      x: 0,
      y,
      category: 8,
      symbolSize: 1,
      fixed: true,
      draggable: false,
      label: { show: false },
      itemStyle: { opacity: 0 },
      tooltip: { show: false },
      emphasis: { disabled: true },
    });
    links.push({
      source: rootId,
      target: railId,
      relationType: "helper",
      name: "",
      value: "",
      lineStyle: { color, width: 1.8, opacity: 0.78 },
      label: { show: false },
      tooltip: { show: false },
    });
    return { id: railId, y, color, relationType };
  };

  const connectViaRail = (rail, item, lineStyle) => {
    const elbowId = `__family_elbow_${helperCounter}`;
    helperCounter += 1;
    helperNodes.push({
      id: elbowId,
      name: "",
      value: "",
      x: item.x,
      y: rail.y,
      category: 8,
      symbolSize: 1,
      fixed: true,
      draggable: false,
      label: { show: false },
      itemStyle: { opacity: 0 },
      tooltip: { show: false },
      emphasis: { disabled: true },
    });
    links.push({
      source: rail.id,
      target: elbowId,
      relationType: rail.relationType,
      name: item.relation,
      value: item.relation,
      lineStyle: { ...lineStyle, opacity: 0.72 },
      label: { show: true },
    });
    links.push({
      source: elbowId,
      target: item.id,
      relationType: "helper",
      name: "",
      value: "",
      lineStyle: { ...lineStyle, opacity: 0.72 },
      label: { show: false },
      tooltip: { show: false },
    });
  };

  const connectGroupByRail = (items, railY, color, relationType, style) => {
    if (!items.length) {
      return;
    }
    const rail = createRail(railY, color, relationType);
    for (const item of items) {
      connectViaRail(rail, item, {
        color,
        width: style.width,
        type: style.type || "solid",
      });
    }
  };

  connectGroupByRail(ancestorNodes, -280, "#4f6074", "ancestor", { width: 2.1 });
  connectGroupByRail(parentNodes, -130, "#60788d", "parent", { width: 2.2 });

  for (const item of spouseNodes) {
    links.push({
      source: rootId,
      target: item.id,
      name: item.relation,
      value: item.relation,
      relationType: "spouse",
      lineStyle: { color: "#9b6a32", width: 2.3, type: "dashed" },
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

  connectGroupByRail(childNodes, 120, "#2f7c5a", "child", { width: 2.2 });
  connectGroupByRail(grandchildNodes, 290, "#3f8f66", "grandchild", { width: 2.0 });
  connectGroupByRail(greatGrandchildNodes, 450, "#51a879", "greatGrandchild", { width: 1.9 });
  connectGroupByRail(otherNodes, 560, "#7e7367", "other", { width: 1.5, type: "dotted" });

  return {
    nodes: [...nodes, ...helperNodes],
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

export default function GraphPage({ selectedPerson, onNavigatePerson }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [graph, setGraph] = useState({ nodes: [], links: [], rootName: "", rootId: null });
  const [dynamicLayout, setDynamicLayout] = useState(false);
  const [viewMode, setViewMode] = useState("network");
  const [nodeJumpLoading, setNodeJumpLoading] = useState(false);
  const [visitHistory, setVisitHistory] = useState({ items: [], index: -1 });
  const historyNavRef = useRef(false);

  useEffect(() => {
    if (!selectedPerson?.id) {
      return;
    }

    setVisitHistory((prev) => {
      const person = {
        id: selectedPerson.id,
        name: selectedPerson.name || `人物 ${selectedPerson.id}`,
      };

      if (historyNavRef.current) {
        historyNavRef.current = false;
        return prev;
      }

      const current = prev.items[prev.index];
      if (current && Number(current.id) === Number(person.id)) {
        return prev;
      }

      const nextItems = [...prev.items.slice(0, prev.index + 1), person];
      return {
        items: nextItems,
        index: nextItems.length - 1,
      };
    });
  }, [selectedPerson?.id, selectedPerson?.name]);

  const canGoBack = visitHistory.index > 0;
  const canGoForward = visitHistory.index >= 0 && visitHistory.index < visitHistory.items.length - 1;

  const goHistory = useCallback(
    (step) => {
      setVisitHistory((prev) => {
        const nextIndex = prev.index + step;
        if (nextIndex < 0 || nextIndex >= prev.items.length) {
          return prev;
        }
        const target = prev.items[nextIndex];
        if (target?.id) {
          historyNavRef.current = true;
          onNavigatePerson?.({ id: target.id, name: target.name || `人物 ${target.id}` });
        }
        return {
          ...prev,
          index: nextIndex,
        };
      });
    },
    [onNavigatePerson]
  );

  const goBack = useCallback(() => {
    goHistory(-1);
  }, [goHistory]);

  const goForward = useCallback(() => {
    goHistory(1);
  }, [goHistory]);

  useEffect(() => {
    const handleMouseButton = (event) => {
      if (event.button === 3) {
        if (!canGoBack) {
          return;
        }
        event.preventDefault();
        goBack();
      }
      if (event.button === 4) {
        if (!canGoForward) {
          return;
        }
        event.preventDefault();
        goForward();
      }
    };

    window.addEventListener("mousedown", handleMouseButton, true);
    window.addEventListener("auxclick", handleMouseButton, true);
    return () => {
      window.removeEventListener("mousedown", handleMouseButton, true);
      window.removeEventListener("auxclick", handleMouseButton, true);
    };
  }, [canGoBack, canGoForward, goBack, goForward]);

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

  const handleNodeDoubleClick = useCallback(
    async (params) => {
      if (params?.dataType !== "node") {
        return;
      }
      const clicked = params.data || {};
      const nodeIdText = String(clicked.id || "").trim();
      if (!nodeIdText || nodeIdText.startsWith("__center_anchor_")) {
        return;
      }

      const personId = Number(nodeIdText);
      if (!Number.isFinite(personId) || personId <= 0) {
        return;
      }

      try {
        setNodeJumpLoading(true);
        const relation = await getRelationshipGraph(personId);
        const hasGraph = Boolean(relation?.links?.length);
        const personName = clicked.name || relation?.rootName || `人物 ${personId}`;

        if (hasGraph) {
          onNavigatePerson?.({ id: personId, name: personName });
          return;
        }
        window.alert(`${personName} 没有可展示的关系图谱。`);
      } catch (err) {
        window.alert(`无法加载该人物关系图谱：${err.message}`);
      } finally {
        setNodeJumpLoading(false);
      }
    },
    [onNavigatePerson]
  );

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
              rotate: 0,
              position: "middle",
              distance: 6,
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
        <button className="btn-secondary" disabled={!canGoBack} onClick={goBack}>
          后退
        </button>
        <button className="btn-secondary" disabled={!canGoForward} onClick={goForward}>
          前进
        </button>
        <span className="subtle">
          历史 {visitHistory.items.length === 0 ? 0 : visitHistory.index + 1} / {visitHistory.items.length}
          （支持鼠标侧键）
        </span>
      </div>

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
          家谱按“祖辈 → 父辈 → 核心人物 → 子辈 → 孙辈 → 曾孙及下”纵向分层；配偶为菱形标记，子孙为三角标记。颜色按性别与辈分：男性蓝系、女性粉系，辈分越高颜色越深。
        </p>
      )}

      {error && <div className="error-box">{error}</div>}
      {loading && <div className="muted">正在构建关系网络...</div>}
      {nodeJumpLoading && <div className="muted">正在跳转人物关系图谱...</div>}

      {!loading && graph.nodes.length > 0 && chartOption && (
        <ReactECharts
          option={chartOption}
          style={{ height: "680px", width: "100%" }}
          onEvents={{ dblclick: handleNodeDoubleClick }}
        />
      )}
    </section>
  );
}
