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

function normalizeRelationText(value) {
  return String(value || "").replace(/\s+/g, "");
}

function inferGenderFromRelation(relationName) {
  const text = normalizeRelationText(relationName);
  if (!text) {
    return "unknown";
  }

  const femaleSignal = /岳母|母|妻|女|姐|妹|姑|姨|婆|嫂|媳|妾|夫人/.test(text);
  const maleSignal = /岳父|父|夫|子|兄|弟|伯|叔|舅|翁|公|婿/.test(text);

  if (femaleSignal && !maleSignal) {
    return "female";
  }
  if (maleSignal && !femaleSignal) {
    return "male";
  }
  return "unknown";
}

function analyzeRelationTextSignals(relationName) {
  const text = normalizeRelationText(relationName);
  if (!text) {
    return {
      spouse: false,
      wifeCollateral: false,
      inLawParent: false,
      ancestor: false,
      parent: false,
      sibling: false,
      child: false,
      grandchild: false,
      greatDescendant: false,
    };
  }

  const wifeCollateral = /妻[兄弟姐妺妹]|内[兄弟姐妺妹]|內[兄弟姐妺妹]|姻[兄弟姐妺妹]|妻舅|妻姨/.test(text);
  const spouse =
    !wifeCollateral &&
    /配偶|元配|继室|繼室|前妻|后妻|後妻|第二任妻|第二任丈夫|再娶|再婚|丈夫|妻子|夫人|妾|前夫|后夫|後夫|續弦|续弦|^妻$|^夫$/.test(
      text
    );

  return {
    spouse,
    wifeCollateral,
    inLawParent: /岳父|岳母|丈人|丈母|公公|婆婆|翁姑|舅姑|^翁$|^姑$/.test(text),
    ancestor: /高祖|曾祖|祖父|祖母|外祖|太祖|祖/.test(text),
    parent: /父|母|伯|叔|舅|姑|姨/.test(text),
    sibling: /兄|弟|姐|妹|堂|表/.test(text),
    child: /子|女|兒|儿|婿|媳/.test(text),
    grandchild: /孫|孙/.test(text),
    greatDescendant: /曾孫|曾孙|玄孫|玄孙|來孫|来孙|晜孫|昆孙/.test(text),
  };
}

function analyzeStepSignals(link) {
  const up = toNumericStep(link.upStep);
  const down = toNumericStep(link.downStep);
  const mar = toNumericStep(link.marriageStep) ?? 0;
  const col = toNumericStep(link.collateralStep) ?? 0;
  const hasStep = !isUnknownStep(up) && !isUnknownStep(down);
  const generation = hasStep ? down - up : null;

  let stepLane = "other";
  if (Number.isFinite(generation)) {
    if (generation < 0) {
      stepLane = "ancestor";
    } else if (generation > 0) {
      stepLane = "descendant";
    } else if (mar > 0 && col === 0) {
      stepLane = "spouse";
    } else if (col > 0) {
      stepLane = "sibling";
    }
  }

  return {
    up,
    down,
    mar,
    col,
    hasStep,
    generation,
    stepLane,
  };
}

function classifyFamilyRelation(link) {
  const relation = String(link.name || "亲属");
  const textSignals = analyzeRelationTextSignals(relation);
  const stepSignals = analyzeStepSignals(link);
  const inferredGender = inferGenderFromRelation(relation);

  let lane = stepSignals.stepLane;
  let generation = Number.isFinite(stepSignals.generation) ? stepSignals.generation : 0;
  let relationClass = "other";
  let relationRank = 90;

  if (textSignals.wifeCollateral) {
    lane = "sibling";
    generation = 0;
    relationClass = "wife_collateral";
    relationRank = 20;
  } else if (textSignals.spouse) {
    lane = "spouse";
    generation = 0;
    relationClass = "spouse";
    relationRank = 10;
  } else if (textSignals.inLawParent) {
    lane = "ancestor";
    generation = Number.isFinite(stepSignals.generation) && stepSignals.generation < 0 ? stepSignals.generation : -1;
    relationClass = "inlaw_ancestor";
    relationRank = 16;
  } else if (textSignals.parent) {
    lane = "ancestor";
    generation = Number.isFinite(stepSignals.generation) && stepSignals.generation < 0 ? stepSignals.generation : -1;
    relationClass = "parent";
    relationRank = 24;
  } else if (textSignals.ancestor) {
    lane = "ancestor";
    generation = Number.isFinite(stepSignals.generation) && stepSignals.generation < 0 ? stepSignals.generation : -2;
    relationClass = "ancestor";
    relationRank = 26;
  } else if (textSignals.sibling) {
    lane = "sibling";
    generation = 0;
    relationClass = "sibling";
    relationRank = 30;
  } else if (textSignals.child) {
    lane = "descendant";
    generation = Number.isFinite(stepSignals.generation) && stepSignals.generation > 0 ? stepSignals.generation : 1;
    relationClass = "child";
    relationRank = 40;
  } else if (textSignals.greatDescendant) {
    lane = "descendant";
    generation = Number.isFinite(stepSignals.generation) && stepSignals.generation > 0 ? stepSignals.generation : 3;
    relationClass = "great_descendant";
    relationRank = 44;
  } else if (textSignals.grandchild) {
    lane = "descendant";
    generation = Number.isFinite(stepSignals.generation) && stepSignals.generation > 0 ? stepSignals.generation : 2;
    relationClass = "grandchild";
    relationRank = 42;
  } else if (stepSignals.hasStep && stepSignals.stepLane !== "other") {
    lane = stepSignals.stepLane;
    relationClass = `step_${lane}`;
    relationRank = 52;
  }

  if (lane === "ancestor") {
    generation = Number.isFinite(generation) ? Math.min(-1, generation) : -1;
  } else if (lane === "descendant") {
    generation = Number.isFinite(generation) ? Math.max(1, generation) : 1;
  } else if (lane === "sibling" || lane === "spouse") {
    generation = 0;
  } else {
    generation = Number.isFinite(generation) ? generation : 0;
  }

  return {
    lane,
    generation,
    relationClass,
    relationRank,
    inferredGender,
    relation,
    directSpouse: lane === "spouse",
    upStep: link.upStep ?? null,
    downStep: link.downStep ?? null,
    marriageStep: link.marriageStep ?? null,
    collateralStep: link.collateralStep ?? null,
    kinCode: link.kinCode ?? null,
  };
}

function compareZhText(left, right) {
  return String(left || "").localeCompare(String(right || ""), "zh-Hans-CN-u-co-pinyin");
}

function compareFamilyNodeOrder(left, right) {
  if (left.generation !== right.generation) {
    return left.generation - right.generation;
  }
  if (left.relationRank !== right.relationRank) {
    return left.relationRank - right.relationRank;
  }
  const relationComp = compareZhText(left.relation, right.relation);
  if (relationComp !== 0) {
    return relationComp;
  }
  const nameComp = compareZhText(left.name, right.name);
  if (nameComp !== 0) {
    return nameComp;
  }
  return String(left.id).localeCompare(String(right.id));
}

function estimateTextWidth(text) {
  const name = String(text || "");
  if (!name) {
    return 72;
  }

  let unit = 0;
  for (const char of name) {
    if (/[\u4e00-\u9fff]/.test(char)) {
      unit += 1;
    } else if (/[A-Za-z0-9]/.test(char)) {
      unit += 0.68;
    } else {
      unit += 0.56;
    }
  }

  return Math.max(72, Math.round(unit * 21 + 34));
}

function layoutLayerItems(items, y, gap = 28) {
  if (!items.length) {
    return [];
  }

  const sorted = [...items].sort(compareFamilyNodeOrder);
  const widths = sorted.map((item) => estimateTextWidth(item.name));
  const totalWidth = widths.reduce((acc, value) => acc + value, 0) + (sorted.length - 1) * gap;
  let cursor = -totalWidth / 2;

  return sorted.map((item, index) => {
    const width = widths[index];
    const x = cursor + width / 2;
    cursor += width + gap;
    return {
      ...item,
      x: Math.round(x),
      y,
    };
  });
}

function layoutSideLaneItems(items, lane) {
  if (!items.length) {
    return [];
  }

  const sorted = [...items].sort(compareFamilyNodeOrder);
  const widths = sorted.map((item) => estimateTextWidth(item.name));
  const startOffset = 240;
  const horizontalGap = 34;
  let cursor = startOffset;

  return sorted.map((item, index) => {
    const width = widths[index];
    const center = cursor + width / 2;
    const x = lane === "spouse" ? -Math.round(center) : Math.round(center);
    cursor += width + horizontalGap;
    return {
      ...item,
      x,
      y: 0,
    };
  });
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

function nodeColorByGenderAndGeneration(female, generation, fallbackColor, inferredGender = "unknown") {
  const index = paletteIndexByGeneration(generation);
  const explicitGender = normalizeGender(female);
  const gender = explicitGender === "unknown" ? inferredGender : explicitGender;

  if (gender === "male") {
    return malePalette[index];
  }
  if (gender === "female") {
    return femalePalette[index];
  }
  return fallbackColor || unknownPalette[index];
}

const laneColorMap = {
  ancestor: "#4f6074",
  spouse: "#9b6a32",
  sibling: "#756592",
  descendant: "#2f7c5a",
  other: "#7e6a55",
};

function symbolByLane(lane) {
  if (lane === "ancestor") {
    return "rect";
  }
  if (lane === "spouse") {
    return "diamond";
  }
  if (lane === "descendant") {
    return "triangle";
  }
  if (lane === "sibling") {
    return "circle";
  }
  return "roundRect";
}

function symbolSizeByLane(lane, generation) {
  if (lane === "spouse") {
    return 34;
  }
  if (lane === "ancestor") {
    return generation <= -3 ? 28 : 32;
  }
  if (lane === "descendant") {
    if (generation >= 3) {
      return 26;
    }
    if (generation === 2) {
      return 30;
    }
    return 34;
  }
  if (lane === "sibling") {
    return 29;
  }
  return 24;
}

function computeLayerY(lane, generation) {
  const generationGap = 300;
  if (lane === "spouse") {
    return 0;
  }
  if (lane === "sibling") {
    return 0;
  }
  return generation * generationGap;
}

function computeRailY(nodeY, lane) {
  if (lane === "ancestor" || lane === "descendant") {
    return Math.round(nodeY * 0.62);
  }
  if (lane === "spouse" || lane === "sibling") {
    return Math.round(nodeY * 0.82);
  }
  return Math.round(nodeY * 0.62);
}

function computeLabelPosition(lane, x) {
  if (lane === "spouse") {
    return "top";
  }
  if (lane === "sibling") {
    return "bottom";
  }
  if (lane === "ancestor") {
    return "top";
  }
  if (lane === "descendant") {
    return "bottom";
  }
  return x >= 0 ? "right" : "left";
}

function buildFamilyTreeGraph(graph) {
  const rootId = String(graph.rootId || "");
  const rootNode = graph.nodes.find((node) => String(node.id) === rootId);
  if (!rootNode) {
    return null;
  }

  const nodeById = new Map(graph.nodes.map((node) => [String(node.id), node]));
  const familyLinks = graph.links.filter((link) => link.relationType === "family");

  const classWeight = {
    spouse: 130,
    wife_collateral: 120,
    inlaw_ancestor: 118,
    parent: 112,
    ancestor: 108,
    sibling: 105,
    child: 102,
    grandchild: 100,
    great_descendant: 98,
    step_ancestor: 90,
    step_descendant: 88,
    step_sibling: 84,
    step_spouse: 82,
    other: 10,
  };

  const relativesMap = new Map();
  for (const link of familyLinks) {
    const targetId = String(link.target);
    if (!targetId || targetId === rootId) {
      continue;
    }

    const node = nodeById.get(targetId);
    const analyzed = classifyFamilyRelation(link);
    const candidate = {
      id: targetId,
      name: node?.name || `人物 ${targetId}`,
      female: node?.female ?? null,
      relation: analyzed.relation,
      lane: analyzed.lane,
      generation: analyzed.generation,
      relationClass: analyzed.relationClass,
      relationRank: analyzed.relationRank,
      inferredGender: analyzed.inferredGender,
      directSpouse: analyzed.directSpouse,
      upStep: analyzed.upStep,
      downStep: analyzed.downStep,
      marriageStep: analyzed.marriageStep,
      collateralStep: analyzed.collateralStep,
      kinCode: analyzed.kinCode,
    };

    const score =
      (classWeight[candidate.relationClass] || classWeight.other) +
      (Number.isFinite(candidate.generation) ? 12 - Math.min(10, Math.abs(candidate.generation)) : 0) +
      (candidate.directSpouse ? 25 : 0);
    candidate._score = score;

    const existing = relativesMap.get(targetId);
    if (!existing || candidate._score > existing._score) {
      relativesMap.set(targetId, candidate);
    }
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
    label: {
      show: true,
      position: "inside",
      color: "#fffdf8",
    },
    itemStyle: {
      color: nodeColorByGenderAndGeneration(rootNode.female, 0, "#c7512f"),
    },
  };

  const layerMap = new Map();
  for (const relative of relativesMap.values()) {
    const layerKey = `${relative.lane}:${relative.generation}`;
    if (!layerMap.has(layerKey)) {
      layerMap.set(layerKey, []);
    }
    layerMap.get(layerKey).push(relative);
  }

  const categoryByLane = {
    ancestor: 1,
    spouse: 2,
    sibling: 3,
    descendant: 4,
    other: 5,
  };

  const placedRelatives = [];
  for (const [key, items] of layerMap.entries()) {
    const [lane, generationText] = key.split(":");
    const generation = Number(generationText);
    const y = computeLayerY(lane, generation);
    const laid =
      lane === "spouse" || lane === "sibling"
        ? layoutSideLaneItems(items, lane)
        : layoutLayerItems(items, y, 28);

    for (const item of laid) {
      placedRelatives.push({
        ...item,
        lane,
        generation,
      });
    }
  }

  const relativeNodes = placedRelatives.map((item) => ({
    id: item.id,
    name: item.name,
    value: item.name,
    female: item.female,
    relation: item.relation,
    lane: item.lane,
    generation: item.generation,
    relationClass: item.relationClass,
    category: categoryByLane[item.lane] ?? categoryByLane.other,
    symbol: symbolByLane(item.lane),
    symbolSize: symbolSizeByLane(item.lane, item.generation),
    x: item.x,
    y: item.y,
    label: {
      show: false,
      position: "top",
      color: "#211a12",
    },
    itemStyle: {
      color: nodeColorByGenderAndGeneration(
        item.female,
        item.generation,
        laneColorMap[item.lane] || laneColorMap.other,
        item.inferredGender
      ),
    },
  }));

  const compositeLabelNodes = [];
  for (const item of relativeNodes) {
    const nameOffset = Math.max(40, Number(item.symbolSize || 28) + 8);
    const relationOffset = Math.max(48, Number(item.symbolSize || 28) + 15);

    // compositeLabelNodes.push({
    //   id: `__family_name_label_${item.id}`,
    //   name: "",
    //   value: item.name,
    //   ownerId: item.id,
    //   relation: item.relation,
    //   isLabelNode: true,
    //   labelKind: "name",
    //   x: item.x,
    //   y: item.y - nameOffset,
    //   category: item.category,
    //   symbolSize: 1,
    //   fixed: true,
    //   silent: true,
    //   draggable: false,
    //   itemStyle: { opacity: 0 },
    //   tooltip: { show: false },
    //   emphasis: { disabled: true },
    //   label: {
    //     show: true,
    //     position: "inside",
    //     color: "#211a12",
    //     formatter: item.name,
    //     fontSize: 13,
    //   },
    // });

    compositeLabelNodes.push({
      id: `__family_relation_label_${item.id}`,
      name: "",
      value: item.relation,
      ownerId: item.id,
      relation: item.relation,
      isLabelNode: true,
      labelKind: "relation",
      x: item.x,
      y: item.y + relationOffset,
      category: item.category,
      symbolSize: 1,
      fixed: true,
      silent: true,
      draggable: false,
      itemStyle: { opacity: 0 },
      tooltip: { show: false },
      emphasis: { disabled: true },
      label: {
        show: true,
        position: "inside",
        color: "#6a6052",
        formatter: item.relation,
        fontSize: 12,
      },
    });
  }

  const nodes = [root, ...relativeNodes, ...compositeLabelNodes];
  const helperNodes = [];
  const links = [];
  const pathByNodeId = {};
  let helperCounter = 0;
  let railCounter = 0;

  const createRail = (y, lane, generation) => {
    const color = laneColorMap[lane] || laneColorMap.other;
    const railNo = railCounter;
    const railId = `__family_rail_${railNo}`;
    const rootEdgeId = `__family_edge_root_rail_${railNo}`;
    railCounter += 1;

    helperNodes.push({
      id: railId,
      name: "",
      value: "",
      isHelper: true,
      x: 0,
      y,
      category: 6,
      symbolSize: 1,
      fixed: true,
      draggable: false,
      label: { show: false },
      itemStyle: { opacity: 0 },
      tooltip: { show: false },
      emphasis: { disabled: true },
    });

    links.push({
      id: rootEdgeId,
      source: rootId,
      target: railId,
      relationType: `${lane}_rail`,
      relativeId: null,
      railId,
      generation,
      name: "",
      value: "",
      lineStyle: { color, width: 1.8, opacity: 0.78 },
      showRelationLabel: false,
      label: { show: false },
      tooltip: { show: false },
    });

    return { id: railId, y, color, lane, generation, rootEdgeId };
  };

  const connectViaRail = (rail, item, lineStyle) => {
    const elbowNo = helperCounter;
    const elbowId = `__family_elbow_${elbowNo}`;
    const railToElbowEdgeId = `__family_edge_rail_elbow_${elbowNo}`;
    const elbowToNodeEdgeId = `__family_edge_elbow_node_${elbowNo}`;
    helperCounter += 1;

    helperNodes.push({
      id: elbowId,
      name: "",
      value: "",
      isHelper: true,
      x: item.x,
      y: rail.y,
      category: 6,
      symbolSize: 1,
      fixed: true,
      draggable: false,
      label: { show: false },
      itemStyle: { opacity: 0 },
      tooltip: { show: false },
      emphasis: { disabled: true },
    });

    links.push({
      id: railToElbowEdgeId,
      source: rail.id,
      target: elbowId,
      relationType: item.relationClass,
      relativeId: item.id,
      railId: rail.id,
      name: item.relation,
      value: item.relation,
      lineStyle: { ...lineStyle, opacity: 0.72 },
      showRelationLabel: false,
      label: { show: false },
    });

    links.push({
      id: elbowToNodeEdgeId,
      source: elbowId,
      target: item.id,
      relationType: `${item.relationClass}_drop`,
      relativeId: item.id,
      railId: rail.id,
      name: "",
      value: "",
      lineStyle: { ...lineStyle, opacity: 0.72 },
      showRelationLabel: false,
      label: { show: false },
      tooltip: { show: false },
    });

    pathByNodeId[item.id] = {
      nodeIds: [rootId, rail.id, elbowId, item.id],
      edgeIds: [rail.rootEdgeId, railToElbowEdgeId, elbowToNodeEdgeId],
    };
  };

  const createSideHub = (lane, generation) => {
    const color = laneColorMap[lane] || laneColorMap.other;
    const hubNo = railCounter;
    const hubId = `__family_side_hub_${hubNo}`;
    const rootEdgeId = `__family_edge_root_side_hub_${hubNo}`;
    railCounter += 1;

    helperNodes.push({
      id: hubId,
      name: "",
      value: "",
      isHelper: true,
      x: lane === "spouse" ? -150 : 150,
      y: 0,
      category: 6,
      symbolSize: 1,
      fixed: true,
      draggable: false,
      label: { show: false },
      itemStyle: { opacity: 0 },
      tooltip: { show: false },
      emphasis: { disabled: true },
    });

    links.push({
      id: rootEdgeId,
      source: rootId,
      target: hubId,
      relationType: `${lane}_side_hub`,
      relativeId: null,
      railId: hubId,
      generation,
      name: "",
      value: "",
      lineStyle: { color, width: 2.0, opacity: 0.82, type: lane === "spouse" ? "dashed" : "dotted" },
      showRelationLabel: false,
      label: { show: false },
      tooltip: { show: false },
    });

    return { id: hubId, color, lane, generation, rootEdgeId };
  };

  const connectViaSideHub = (hub, item, lineStyle) => {
    const hubToNodeEdgeId = `__family_edge_side_hub_node_${helperCounter}`;
    helperCounter += 1;

    links.push({
      id: hubToNodeEdgeId,
      source: hub.id,
      target: item.id,
      relationType: item.relationClass,
      relativeId: item.id,
      railId: hub.id,
      name: item.relation,
      value: item.relation,
      lineStyle: { ...lineStyle, opacity: 0.8 },
      showRelationLabel: false,
      label: { show: false },
    });

    pathByNodeId[item.id] = {
      nodeIds: [rootId, hub.id, item.id],
      edgeIds: [hub.rootEdgeId, hubToNodeEdgeId],
    };
  };

  const connectGroupByRail = (items, lane, generation) => {
    if (!items.length) {
      return;
    }

    const laneStyle =
      lane === "spouse"
        ? { width: 2.3, type: "dashed" }
        : lane === "sibling"
          ? { width: 1.8, type: "dotted" }
          : lane === "ancestor"
            ? { width: 2.1, type: "solid" }
            : lane === "descendant"
              ? { width: 2.05, type: "solid" }
              : { width: 1.6, type: "dotted" };

    if (lane === "spouse" || lane === "sibling") {
      const hub = createSideHub(lane, generation);
      for (const item of items) {
        connectViaSideHub(hub, item, {
          color: hub.color,
          width: laneStyle.width,
          type: laneStyle.type,
        });
      }
      return;
    }

    const railY = computeRailY(items[0].y, lane);
    const rail = createRail(railY, lane, generation);
    for (const item of items) {
      connectViaRail(rail, item, {
        color: rail.color,
        width: laneStyle.width,
        type: laneStyle.type,
      });
    }
  };

  const railGroups = new Map();
  for (const item of placedRelatives) {
    const key = `${item.lane}:${item.generation}`;
    if (!railGroups.has(key)) {
      railGroups.set(key, []);
    }
    railGroups.get(key).push(item);
  }

  const sortedRailEntries = Array.from(railGroups.entries()).sort(([leftKey], [rightKey]) => {
    const [leftLane, leftGenerationText] = leftKey.split(":");
    const [rightLane, rightGenerationText] = rightKey.split(":");
    const leftGeneration = Number(leftGenerationText);
    const rightGeneration = Number(rightGenerationText);

    if (leftGeneration !== rightGeneration) {
      return leftGeneration - rightGeneration;
    }
    return leftLane.localeCompare(rightLane);
  });

  for (const [key, items] of sortedRailEntries) {
    const [lane, generationText] = key.split(":");
    connectGroupByRail(items, lane, Number(generationText));
  }

  return {
    nodes: [...nodes, ...helperNodes],
    links,
    categories: [
      { name: "核心人物" },
      { name: "上代" },
      { name: "配偶车道" },
      { name: "兄弟姐妹车道" },
      { name: "下代" },
      { name: "其他" },
      { name: "辅助结构" },
    ],
    legendCategories: ["核心人物", "上代", "配偶车道", "兄弟姐妹车道", "下代", "其他"],
    pathByNodeId,
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
  const [activeFamilyPath, setActiveFamilyPath] = useState({ nodeIds: [], edgeIds: [] });
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
      if (
        !nodeIdText ||
        nodeIdText.startsWith("__center_anchor_") ||
        nodeIdText.startsWith("__family_")
      ) {
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

  const familyTreeGraph = useMemo(() => {
    if (viewMode !== "familyTree") {
      return null;
    }
    return buildFamilyTreeGraph(graph);
  }, [graph, viewMode]);

  const clearFamilyPathHighlight = useCallback(() => {
    setActiveFamilyPath((prev) => {
      if (!prev.nodeIds.length && !prev.edgeIds.length) {
        return prev;
      }
      return { nodeIds: [], edgeIds: [] };
    });
  }, []);

  const setFamilyPathByNodeId = useCallback(
    (nodeId) => {
      if (!familyTreeGraph) {
        return;
      }
      const path = familyTreeGraph.pathByNodeId?.[String(nodeId)];
      if (!path) {
        clearFamilyPathHighlight();
        return;
      }

      const nextNodeIds = path.nodeIds.map((id) => String(id));
      const nextEdgeIds = path.edgeIds.map((id) => String(id));
      setActiveFamilyPath((prev) => {
        const sameNodes =
          prev.nodeIds.length === nextNodeIds.length &&
          prev.nodeIds.every((id, index) => id === nextNodeIds[index]);
        const sameEdges =
          prev.edgeIds.length === nextEdgeIds.length &&
          prev.edgeIds.every((id, index) => id === nextEdgeIds[index]);
        if (sameNodes && sameEdges) {
          return prev;
        }
        return { nodeIds: nextNodeIds, edgeIds: nextEdgeIds };
      });
    },
    [clearFamilyPathHighlight, familyTreeGraph]
  );

  const handleFamilyTreeMouseOver = useCallback(
    (params) => {
      if (viewMode !== "familyTree") {
        return;
      }
      if (params?.dataType !== "node") {
        return;
      }

      const nodeIdText = String(params.data?.id || "").trim();
      if (
        !nodeIdText ||
        nodeIdText === String(graph.rootId || "") ||
        nodeIdText.startsWith("__family_") ||
        nodeIdText.startsWith("__center_anchor_")
      ) {
        clearFamilyPathHighlight();
        return;
      }
      setFamilyPathByNodeId(nodeIdText);
    },
    [clearFamilyPathHighlight, graph.rootId, setFamilyPathByNodeId, viewMode]
  );

  const handleFamilyTreeGlobalOut = useCallback(() => {
    if (viewMode !== "familyTree") {
      return;
    }
    clearFamilyPathHighlight();
  }, [clearFamilyPathHighlight, viewMode]);

  const handleFamilyTreeMouseOut = useCallback(
    (params) => {
      if (viewMode !== "familyTree") {
        return;
      }
      if (params?.dataType === "node") {
        clearFamilyPathHighlight();
      }
    },
    [clearFamilyPathHighlight, viewMode]
  );

  useEffect(() => {
    clearFamilyPathHighlight();
  }, [clearFamilyPathHighlight, familyTreeGraph, graph.rootId, viewMode]);

  const chartOption = useMemo(() => {
    if (viewMode === "familyTree") {
      const treeGraph = familyTreeGraph;
      if (!treeGraph) {
        return null;
      }

      const activeNodeSet = new Set((activeFamilyPath.nodeIds || []).map((id) => String(id)));
      const activeEdgeSet = new Set((activeFamilyPath.edgeIds || []).map((id) => String(id)));
      const hasActivePath = activeNodeSet.size > 0 && activeEdgeSet.size > 0;

      const renderNodes = treeGraph.nodes.map((node) => {
        const nodeId = String(node.id);
        const ownerId = node.ownerId ? String(node.ownerId) : "";
        const inPath = hasActivePath ? activeNodeSet.has(nodeId) || (ownerId && activeNodeSet.has(ownerId)) : false;
        const isHelper = Boolean(node.isHelper);
        const isLabelNode = Boolean(node.isLabelNode);

        const nextItemStyle = {
          ...(node.itemStyle || {}),
        };
        const nextLabel = {
          ...(node.label || {}),
        };

        if (isHelper) {
          nextItemStyle.opacity = 0;
          nextLabel.show = false;
        } else if (isLabelNode) {
          nextItemStyle.opacity = 0;
          if (hasActivePath) {
            nextLabel.show = inPath;
            nextLabel.opacity = inPath ? 1 : 0;
          } else {
            nextLabel.show = true;
            nextLabel.opacity = 1;
          }
        } else if (hasActivePath) {
          nextItemStyle.opacity = inPath ? 1 : 0.18;
          if (inPath) {
            nextItemStyle.shadowBlur = 14;
            nextItemStyle.shadowColor = "rgba(40, 28, 19, 0.35)";
          }
          nextLabel.show = inPath;
          nextLabel.opacity = inPath ? 1 : 0;
        } else {
          nextItemStyle.opacity = 1;
          nextLabel.show = true;
          nextLabel.opacity = 1;
        }

        return {
          ...node,
          itemStyle: nextItemStyle,
          label: nextLabel,
        };
      });

      const renderLinks = treeGraph.links.map((link) => {
        const linkId = String(link.id || "");
        const inPath = hasActivePath ? activeEdgeSet.has(linkId) : false;

        const baseLineStyle = {
          ...(link.lineStyle || {}),
        };
        const baseLabel = {
          ...(link.label || {}),
        };

        const showRelationLabel = false;
        if (hasActivePath) {
          if (inPath) {
            baseLineStyle.opacity = 1;
            baseLineStyle.width = Math.max(3.8, Number(baseLineStyle.width || 1.8));
          } else {
            baseLineStyle.opacity = 0.08;
            baseLineStyle.width = Math.min(1.2, Number(baseLineStyle.width || 1.2));
          }
        }

        baseLabel.show = showRelationLabel;
        baseLabel.opacity = 0;

        return {
          ...link,
          showRelationLabel,
          lineStyle: baseLineStyle,
          label: baseLabel,
        };
      });

      return {
        backgroundColor: "transparent",
        tooltip: {
          formatter: (params) => {
            if (params.dataType === "edge") {
              return params.data?.showRelationLabel ? params.data?.name || "亲属关系" : "";
            }
            if (params.data?.isLabelNode) {
              return "";
            }
            const name = params.data?.name || "";
            const relation = params.data?.relation;
            if (relation) {
              return `${name}<br/>关系：${relation}`;
            }
            return name;
          },
        },
        legend: [
          {
            data: treeGraph.legendCategories || treeGraph.categories.map((c) => c.name),
            top: 6,
            textStyle: { color: "#3f3b35" },
          },
        ],
        series: [
          {
            type: "graph",
            layout: "none",
            data: renderNodes,
            links: renderLinks,
            categories: treeGraph.categories,
            roam: true,
            draggable: false,
            edgeLabel: {
              show: true,
              formatter: (params) =>
                params.data?.showRelationLabel ? params.data?.name || params.data?.value || "关系" : "",
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
              opacity: 0.7,
              width: 1.6,
              curveness: 0,
            },
            emphasis: {
              focus: "none",
              lineStyle: { width: 4.4, opacity: 1 },
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
  }, [activeFamilyPath, dynamicLayout, familyTreeGraph, graph, viewMode]);

  const chartEvents = useMemo(
    () => ({
      dblclick: handleNodeDoubleClick,
      mouseover: handleFamilyTreeMouseOver,
      mouseout: handleFamilyTreeMouseOut,
      globalout: handleFamilyTreeGlobalOut,
    }),
    [handleFamilyTreeGlobalOut, handleFamilyTreeMouseOut, handleFamilyTreeMouseOver, handleNodeDoubleClick]
  );

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
          家谱按代际纵向分层（上代/核心/下代），配偶与兄弟姐妹改为核心同代左右“水平分支树”（左配偶树、右同辈树）；每个亲属采用复合节点：姓名在上、与核心关系在下，连线统一接入中心连接点。颜色按性别与辈分：男性蓝系、女性粉系，辈分越高颜色越深。
        </p>
      )}

      {error && <div className="error-box">{error}</div>}
      {loading && <div className="muted">正在构建关系网络...</div>}
      {nodeJumpLoading && <div className="muted">正在跳转人物关系图谱...</div>}

      {!loading && graph.nodes.length > 0 && chartOption && (
        <ReactECharts
          option={chartOption}
          style={{ height: "700px", width: "100%" }}
          onEvents={chartEvents}
        />
      )}
    </section>
  );
}
