# CBDB 中国历代人物传记数据库 - 应用开发 Prompt

## 项目背景

CBDB (China Biographical Database) 是一个大型的中国历史人物数据库，包含：
- **657,000+** 历史人物记录
- **77个** 相关数据表
- **1000万+** 条关联数据
- 涵盖从先秦到清朝的85个朝代

### 核心数据表

| 表名 | 记录数 | 用途 |
|------|--------|------|
| BIOG_MAIN | 656,580 | 人物基本信息(姓名、生卒年、朝代) |
| POSTED_TO_OFFICE_DATA | 601,091 | 官职任职记录 |
| KIN_DATA | 553,504 | 亲属关系(父子、兄弟等) |
| BIOG_ADDR_DATA | 455,855 | 人物地理/地址信息 |
| ENTRY_DATA | 263,327 | 科举考试记录(进士等) |
| ASSOC_DATA | 186,944 | 社会关系/事件关联 |

### 数据库文件位置
- 路径: `e:\04Project\Codex\CBDB\cbdb_20260221.sqlite3`
- 大小: 557 MB
- 格式: SQLite3

---

## 开发需求

### 技术栈
- **前端**: React 19 + Vite
- **桌面**: Electron (打包为离线桌面应用)
- **数据库**: better-sqlite3 (Node.js端) 或 sql.js (浏览器端)
- **可视化**: 可选用 D3.js / ECharts / Cytoscape.js

### 核心功能模块

1. **人物搜索系统**
   - 支持按姓名(中文/拼音)、朝代、官职、科举等条件搜索
   - 实现分页加载和模糊匹配
   - 搜索结果高亮显示

2. **人物详情页面**
   - 基本信息: 姓名、生卒年、朝代、性别、族裔
   - 官职履历: 任职记录、任职时间、官职名称
   - 家族关系: 父母、配偶、子女、兄弟姐妹
   - 科举记录: 考试类型、成绩、年份、名次
   - 社会关系: 师徒、同年、同僚等

3. **关系图谱可视化**
   - 使用网络图展示人物关系
   - 支持缩放、拖拽、点击交互
   - 区分不同关系类型(家族/官场/学术等)

4. **地理分布地图**
   - 在中国地图上标注人物活动区域
   - 支持朝代筛选和时间轴浏览
   - 显示人物迁徒轨迹

5. **统计分析**
   - 各朝代人物数量统计
   - 科举录取人数趋势
   - 官职分布分析
   - 家族网络规模统计

---

## 实施建议

### 项目结构建议
```
cbdb-app/
├── electron/              # Electron主进程
│   ├── main.js
│   └── preload.js
├── src/
│   ├── components/       # React组件
│   ├── pages/            # 页面组件
│   ├── hooks/            # 自定义Hook
│   ├── services/         # 数据库服务
│   ├── utils/            # 工具函数
│   └── styles/           # 样式文件
├── db/                   # 数据库文件
│   └── cbdb_20260221.sqlite3
├── package.json
└── electron-builder.json
```

### 数据库查询优化
- 为常用搜索字段创建索引
- 使用分页查询避免一次性加载过多数据
- 实现搜索结果缓存

### 关键SQL查询示例

```sql
-- 搜索人物(支持中英文名模糊匹配)
SELECT c_personid, c_name, c_name_chn, c_surname, c_mingzi, c_dy
FROM BIOG_MAIN
WHERE c_name_chn LIKE '%王阳明%'
   OR c_name LIKE '%wang%'
LIMIT 20;

-- 获取人物官职记录
SELECT o.c_office_chn, o.c_office_pinyin, p.c_firstyear, p.c_lastyear
FROM POSTED_TO_OFFICE_DATA p
JOIN OFFICE_CODES o ON p.c_office_id = o.c_office_id
WHERE p.c_personid = ?
ORDER BY p.c_firstyear;

-- 获取家族关系
SELECT k.c_kin_id, m.c_name_chn, kc.c_kin_name
FROM KIN_DATA k
JOIN KINSHIP_CODES kc ON k.c_kin_code = kc.c_kin_code
JOIN BIOG_MAIN m ON k.c_kin_id = m.c_personid
WHERE k.c_personid = ?;
```

---

## 验证方式

1. 运行 `npm run dev` 启动开发服务器
2. 测试搜索: "王阳明"、"苏轼"、"曾国藩"
3. 查看人物详情页的官职、科举、家族数据
4. 使用 `electron-builder` 打包为 .exe
5. 测试离线模式下的所有功能
