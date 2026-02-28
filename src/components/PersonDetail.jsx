import { useEffect, useState } from "react";
import { getPersonDetail } from "../services/api";
import { formatYear, formatYearRange } from "../utils/text";

function Section({ title, children }) {
  return (
    <section className="detail-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function KeyValue({ label, value }) {
  return (
    <div className="kv-item">
      <span>{label}</span>
      <strong>{value || "未详"}</strong>
    </div>
  );
}

export default function PersonDetail({ personId, personName }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!personId) {
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    getPersonDetail(personId)
      .then((result) => {
        if (!cancelled) {
          setData(result);
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
  }, [personId]);

  if (!personId) {
    return <div className="panel muted">选择人物后可查看详细信息。</div>;
  }

  if (loading) {
    return <div className="panel muted">正在加载 {personName || personId} 的详情...</div>;
  }

  if (error) {
    return <div className="panel error-box">{error}</div>;
  }

  if (!data || !data.person) {
    return <div className="panel muted">未找到该人物详情。</div>;
  }

  const { person } = data;
  const courtesyText = (data.courtesyNames || [])
    .map((item) => item.altNameChn || item.altName)
    .filter(Boolean)
    .join("、");
  const styleText = (data.styleNames || [])
    .map((item) => item.altNameChn || item.altName)
    .filter(Boolean)
    .join("、");

  return (
    <div className="panel detail-panel">
      <div className="detail-header">
        <h3>{person.nameChn || person.namePinyin || `人物 ${person.personId}`}</h3>
        <p>{person.namePinyin || "无拼音信息"}</p>
      </div>

      <div className="kv-grid">
        <KeyValue label="人物ID" value={person.personId} />
        <KeyValue label="朝代" value={person.dynasty} />
        <KeyValue label="生卒年" value={formatYearRange(person.birthYear, person.deathYear)} />
        <KeyValue label="性别" value={person.female === 1 ? "女" : "男/未详"} />
        <KeyValue label="姓氏" value={person.surnameChn} />
        <KeyValue label="名字" value={person.mingziChn} />
        <KeyValue label="表字" value={courtesyText} />
        <KeyValue label="号/别号" value={styleText} />
        <KeyValue label="族裔" value={person.ethnicity || person.tribe} />
      </div>

      <Section title={`字号与别名 (${data.altNames.length})`}>
        <div className="mini-table">
          {data.altNames.slice(0, 120).map((row, idx) => (
            <div key={`${row.typeCode}-${idx}`} className="mini-row">
              <span>{row.typeName}</span>
              <span>{row.altNameChn || row.altName || "未详"}</span>
            </div>
          ))}
          {data.altNames.length === 0 && <div className="muted">暂无字号与别名记录</div>}
        </div>
      </Section>

      <Section title={`官职履历 (${data.offices.length})`}>
        <div className="mini-table">
          {data.offices.slice(0, 100).map((row, idx) => (
            <div key={`${row.officeName}-${idx}`} className="mini-row">
              <span>{row.officeName}</span>
              <span>{formatYearRange(row.firstYear, row.lastYear)}</span>
            </div>
          ))}
          {data.offices.length === 0 && <div className="muted">暂无官职记录</div>}
        </div>
      </Section>

      <Section title={`家族关系 (${data.kinships.length})`}>
        <div className="mini-table">
          {data.kinships.slice(0, 120).map((row, idx) => (
            <div key={`${row.kinId}-${idx}`} className="mini-row">
              <span>{row.kinRelation}</span>
              <span>{row.kinName}</span>
            </div>
          ))}
          {data.kinships.length === 0 && <div className="muted">暂无亲属记录</div>}
        </div>
      </Section>

      <Section title={`科举记录 (${data.entries.length})`}>
        <div className="mini-table">
          {data.entries.slice(0, 80).map((row, idx) => (
            <div key={`${row.year}-${idx}`} className="mini-row">
              <span>
                {row.entryType} / {formatYear(row.year)}
              </span>
              <span>{row.examRank || row.examField || "未详"}</span>
            </div>
          ))}
          {data.entries.length === 0 && <div className="muted">暂无科举记录</div>}
        </div>
      </Section>

      <Section title={`社会关系 (${data.associations.length})`}>
        <div className="mini-table">
          {data.associations.slice(0, 120).map((row, idx) => (
            <div key={`${row.targetId}-${idx}`} className="mini-row">
              <span>{row.relation}</span>
              <span>
                {row.targetName} ({formatYearRange(row.firstYear, row.lastYear)})
              </span>
            </div>
          ))}
          {data.associations.length === 0 && <div className="muted">暂无社会关系</div>}
        </div>
      </Section>
    </div>
  );
}
