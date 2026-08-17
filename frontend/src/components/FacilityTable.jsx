import React, { useState, useMemo } from 'react';
import './FacilityTable.css';

/**
 * 🚆 利用可能設備组件（UI 优化版：分组 + 精简标签 + 隐藏冗余▲）
 */
export default function FacilityTable({ data, lang = 'ja' }) {
  const [viewMode, setViewMode] = useState('badges'); // 'badges' | 'table'

  if (!data) return null;

  let parsed = data;
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data);
    } catch (e) {
      return <div className="facility-plain-text">{data}</div>;
    }
  }

  if (typeof parsed !== 'object' || parsed === null) return null;

  const isJa = lang === 'ja';

  const i18n = {
    badgeTitle: isJa ? 'ご利用可能な設備' : '可利用列车/设备一览',
    btnToTable: isJa ? '📊 詳細表に切り替え' : '📊 切换为详细表格',
    btnToBadges: isJa ? '🏷️ 簡易表示に切り替え' : '🏷️ 切换为极简卡片',
    legendTitle: isJa ? '凡例：' : '图例：',
    noAllow: isJa ? 'ご利用可能な特急・新幹線設備はありません（乗車券のみ有効）' : '无特殊可利用新干线/特急设备',
  };

  // -----------------------------------------------------------------
  // 1. 解析多级表头并展开列定义
  // -----------------------------------------------------------------
  const { topHeaders, subHeaders, flatColumns, hasMultiLevel } = useMemo(() => {
    if (parsed.header_tree && Array.isArray(parsed.header_tree)) {
      const top = [];
      const sub = [];
      const flat = [];

      parsed.header_tree.forEach((group) => {
        const children = group.children || [];
        if (children.length > 0) {
          top.push({ name: group.name, colspan: children.length });
          children.forEach((child) => {
            const childName = typeof child === 'string' ? child : child?.name;
            sub.push({ name: childName, parentName: group.name });
            flat.push({
              fullName: childName !== '-' ? `${group.name} ${childName}` : group.name,
              shortName: childName !== '-' ? childName : group.name,
              category: group.name,
            });
          });
        } else {
          top.push({ name: group.name, colspan: 1 });
          sub.push({ name: '-', parentName: group.name });
          flat.push({ fullName: group.name, shortName: group.name, category: group.name });
        }
      });

      return { topHeaders: top, subHeaders: sub, flatColumns: flat, hasMultiLevel: true };
    } else {
      const cols = parsed.columns || [];
      const flat = cols.map((col) => ({
        fullName: col,
        shortName: col,
        category: '',
      }));
      return { topHeaders: [], subHeaders: [], flatColumns: flat, hasMultiLevel: false };
    }
  }, [parsed]);

  const status_rows = parsed.status_rows || [];
  const legend = parsed.legend || {};
  const notes = parsed.notes;

  if (flatColumns.length === 0 || status_rows.length === 0) {
    return null;
  }

  // -----------------------------------------------------------------
  // 2. 💡 胶囊卡片优化：仅展示 ○ 和 △，隐藏大量需补券的 ▲ 项，按分类分组
  // -----------------------------------------------------------------
  const groupedBadges = useMemo(() => {
    const groups = {};

    status_rows.forEach((row, rIdx) => {
      // 默认主要展示普通车用行（非第一行如全为空才展示后一行）
      if (rIdx > 0 && Object.keys(groups).length > 0) return;

      const rowSymbols = row.symbols || row.status || [];

      flatColumns.forEach((colObj, cIdx) => {
        const item = rowSymbols[cIdx];
        const symbol = typeof item === 'object' && item !== null ? item.symbol : item;

        // 💡 过滤掉不可乘坐 (×) 与 仅乘车券有效/需补券 (▲)，只留免费/配额乘坐的 ○ 和 △
        if (!symbol || symbol === '×' || symbol === '▲' || symbol === '－' || symbol === '-') return;

        let badgeClass = 'badge-partial';
        let icon = '🟡';
        if (symbol === '○' || symbol === '●') {
          badgeClass = 'badge-allow';
          icon = '🟢';
        }

        const cat = colObj.category || (isJa ? 'その他' : '其他');
        if (!groups[cat]) {
          groups[cat] = [];
        }

        const labelText = colObj.shortName !== '-' ? colObj.shortName : colObj.fullName;

        groups[cat].push({
          id: `${rIdx}-${cIdx}`,
          label: labelText,
          symbol,
          badgeClass,
          icon,
        });
      });
    });

    return groups;
  }, [flatColumns, status_rows, isJa]);

  const hasAnyBadge = Object.keys(groupedBadges).length > 0;

  return (
    <div className="facility-card-container">
      {/* 顶部视图切换 Header */}
      <div className="facility-view-header">
        <span className="facility-badge-title">{i18n.badgeTitle}</span>
        <button
          className="btn-view-toggle"
          onClick={() => setViewMode(viewMode === 'badges' ? 'table' : 'badges')}
        >
          {viewMode === 'badges' ? i18n.btnToTable : i18n.btnToBadges}
        </button>
      </div>

      {/* 模式 A：分组极简胶囊卡片视图 */}
      {viewMode === 'badges' ? (
        <div className="facility-grouped-badge-box">
          {hasAnyBadge ? (
            Object.entries(groupedBadges).map(([catName, badges]) => (
              <div key={catName} className="facility-badge-group">
                <div className="facility-group-title">📌 {catName}</div>
                <div className="facility-badge-grid">
                  {badges.map((badge) => (
                    <div key={badge.id} className={`facility-badge-item ${badge.badgeClass}`}>
                      <span className="badge-icon">{badge.icon}</span>
                      <span className="badge-label">{badge.label}</span>
                      <span className="badge-symbol">({badge.symbol})</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="facility-plain-text" style={{ color: '#64748b', fontSize: '13px', padding: '8px 0' }}>
              💡 {i18n.noAllow}
            </div>
          )}
        </div>
      ) : (
        /* 模式 B：详细矩阵表格视图 */
        <div className="facility-table-wrapper">
          <table className="facility-matrix-table">
            <thead>
              {hasMultiLevel ? (
                <>
                  <tr className="header-column-row">
                    <th className="th-corner" rowSpan={2}>
                      {isJa ? '列車・設備' : '列车/设备'}
                    </th>
                    {topHeaders.map((top, idx) => (
                      <th key={idx} className="th-col-group" colSpan={top.colspan}>
                        {top.name}
                      </th>
                    ))}
                  </tr>
                  <tr className="header-column-sub-row">
                    {subHeaders.map((sub, idx) => (
                      <th key={idx} className="th-col-sub-name">
                        {sub.name}
                      </th>
                    ))}
                  </tr>
                </>
              ) : (
                <tr className="header-column-row">
                  <th className="th-corner">{isJa ? '列車・設備' : '列车/设备'}</th>
                  {flatColumns.map((colObj, idx) => (
                    <th key={idx} className="th-col-name">
                      {colObj.fullName}
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {status_rows.map((row, rIdx) => {
                const rowSymbols = row.symbols || row.status || [];
                const rowLabel = row.label || (isJa ? '利用設備' : '可利用设备');

                return (
                  <tr key={rIdx} className="facility-row">
                    <td className="td-row-label">{rowLabel}</td>
                    {flatColumns.map((_, cIdx) => {
                      const item = rowSymbols[cIdx];
                      const symbol = typeof item === 'object' && item !== null ? item.symbol : item;

                      let statusClass = 'symbol-default';
                      if (symbol === '○' || symbol === '●') statusClass = 'symbol-allow';
                      else if (symbol === '▲' || symbol === '△' || symbol === '■') statusClass = 'symbol-partial';
                      else if (symbol === '×') statusClass = 'symbol-deny';

                      return (
                        <td key={cIdx} className={`td-symbol ${statusClass}`}>
                          {symbol || '-'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 凡例说明 */}
      {legend && typeof legend === 'object' && Object.keys(legend).length > 0 && (
        <div className="facility-legend-box">
          <span className="legend-title">{i18n.legendTitle}</span>
          {Object.entries(legend).map(([key, desc], idx) => {
            if (!key || key.trim() === '') return null;
            let symbolClass = 'partial';
            if (key === '○' || key === '●') symbolClass = 'allow';
            else if (key === '×') symbolClass = 'deny';

            return (
              <span key={idx} className="legend-item">
                <strong className={`legend-symbol symbol-${symbolClass}`}>{key}</strong>
                <span className="legend-desc">{desc}</span>
              </span>
            );
          })}
        </div>
      )}

      {notes && <div className="facility-notes-box">💡 {notes}</div>}
    </div>
  );
}