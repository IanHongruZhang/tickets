import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import './TicketDetailPage.css';
import FacilityTable from '../components/FacilityTable';


// =================================================================
// 格式化函数：渲染利用条件与注意事项列表
// =================================================================
function renderUsageConditions(val, lang = 'ja') {
  const emptyText = lang === 'ja' ? '無' : '无';

  if (!val || val === '-' || val === '無' || val === '无') {
    return <div className="info-kv-value-text">{emptyText}</div>;
  }

  let items = [];

  if (Array.isArray(val)) {
    items = val;
  } else if (typeof val === 'string') {
    let text = val.trim();

    if (text.startsWith('[') && text.endsWith(']')) {
      const matches = text.match(/['"]([^'"]+)['"]/g);
      if (matches && matches.length > 0) {
        items = matches.map(m => m.slice(1, -1).trim());
      } else {
        items = text.slice(1, -1).split(/\n+/).map(s => s.trim()).filter(Boolean);
      }
    } else {
      items = text.split('\n').map(s => s.trim()).filter(Boolean);
    }
  } else {
    items = [String(val)];
  }

  if (items.length === 0) {
    return <div className="info-kv-value-text">{emptyText}</div>;
  }

  return (
    <ol className="usage-conditions-list">
      {items.map((item, idx) => (
        <li key={idx}>{item}</li>
      ))}
    </ol>
  );
}

// =================================================================
// 🚆 格式化函数：安全渲染 JSON / 矩阵表格的利用可能设备
// =================================================================
function renderAvailableFacilities(val, lang = 'ja') {
  const emptyText = lang === 'ja' ? '無' : '无';

  if (!val || val === '-' || val === '無' || val === '无') {
    return <div className="info-kv-value-text">{emptyText}</div>;
  }

  let data = val;

  // 1. 如果传过来的是字符串，尝试反序列化 JSON
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        data = JSON.parse(trimmed);
      } catch (e) {
        data = trimmed;
      }
    }
  }

  // 2. 💡 强制分发：只要对象中包含 status_rows 或 columns 或 header，绝对强制调用 FacilityTable 组件！
  if (
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data) &&
    (data.status_rows || data.columns || data.header)
  ) {
    return <FacilityTable data={data} lang={lang} />;
  }

  // 3. 数组类型渲染
  if (Array.isArray(data)) {
    if (data.length === 0) return <div className="info-kv-value-text">{emptyText}</div>;
    return (
      <ul className="usage-conditions-list" style={{ margin: 0, paddingLeft: '18px' }}>
        {data.map((item, idx) => (
          <li key={idx}>
            {typeof item === 'object' ? JSON.stringify(item) : String(item)}
          </li>
        ))}
      </ul>
    );
  }

  // 4. 普通纯文本
  return (
    <div className="facility-container-box">
      {String(data)}
    </div>
  );
}

export default function TicketDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const lang = searchParams.get('lang') || 'ja';

  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  // 控制路线图 Lightbox 放大的 Modal 状态
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);

  const isJa = lang === 'ja';

  useEffect(() => {
    const fetchTicketDetail = async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        // 💡 提取 API BASE，适应线上 Vercel 反向代理
        const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
        const res = await fetch(`${API_BASE}/api/v1/tickets/${id}?lang=${lang}`);
        
        if (!res.ok) {
          throw new Error(`HTTP Error: ${res.status}`);
        }
        const data = await res.json();
        if (data.error) {
          setErrorMsg(data.error);
        } else {
          setTicket(data);
        }
      } catch (err) {
        console.error('加载详情失败:', err);
        setErrorMsg(err.message || '网络或数据解析错误');
      } finally {
        setLoading(false);
      }
    };

    if (id) fetchTicketDetail();
  }, [id, lang]);

  if (loading) {
    return (
      <div className="detail-container" style={{ textAlign: 'center', paddingTop: '100px', color: '#94a3b8' }}>
        Loading...
      </div>
    );
  }

  if (errorMsg || !ticket) {
    return (
      <div className="detail-container">
        <button className="btn-back" onClick={() => navigate('/')}>
          {isJa ? '← 一覧へ戻る' : '← 返回列表'}
        </button>
        <div style={{ textAlign: 'center', padding: '60px', color: '#ef4444' }}>
          {isJa ? 'チケット情報が見つかりませんでした' : '未找到相关票券信息或接口报错'}
          {errorMsg && <div style={{ fontSize: '12px', marginTop: '8px', color: '#94a3b8' }}>{errorMsg}</div>}
        </div>
      </div>
    );
  }

  // 1. 处理料金字段
  const rawPrice = ticket.price_text || ticket.price || ticket.price_raw || ticket['料金'] || '-';
  const priceText = typeof rawPrice === 'string'
    ? rawPrice
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .join('\n')
    : String(rawPrice || '-');

  // 2. 自由乘车区间说明
  const hasFreeAreaNote = ticket.free_area_note && 
                          String(ticket.free_area_note).trim() !== '' && 
                          String(ticket.free_area_note).trim() !== '-';

  // 3. 补全完整图片 URL
  const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
  const fullMapUrl = ticket.map_url
    ? (ticket.map_url.startsWith('http') ? ticket.map_url : `${API_BASE}${ticket.map_url}`)
    : null;

  return (
    <div className="detail-container">
      <button className="btn-back" onClick={() => navigate('/')}>
        {isJa ? '← チケット一覧へ' : '← 返回票券列表'}
      </button>

      <div className="detail-card">
        <header className="detail-header">
          <div className="badge-group">
            {ticket.operator && <span className="badge badge-company">{ticket.operator}</span>}
            
            {ticket.is_paper_ticket && (
              <span className="badge badge-type badge-paper">
                {isJa ? '📄 紙チケット' : '🎫 纸质票'}
              </span>
            )}

            {ticket.is_mobile_ticket && (
              <span className="badge badge-type badge-mobile">
                {isJa ? '📲 スマホ券' : '📲 电子票'}
              </span>
            )}

            {!ticket.is_paper_ticket && !ticket.is_mobile_ticket && (
              <span className="badge badge-type">
                {isJa ? '📄 紙チケット' : '🎫 纸质票'}
              </span>
            )}

            {ticket.sale_status_raw && <span className="badge badge-type">{ticket.sale_status_raw}</span>}
          </div>
          <h1 className="detail-title">{ticket.ticket_name || '-'}</h1>
        </header>

        {/* 料金看板 */}
        <div className="price-hero">
          <div className="price-hero-item">
            <span className="price-hero-label">{isJa ? '料金' : '售价'}</span>
            <div className="price-hero-value">{priceText}</div>
          </div>
        </div>

        {/* 📌 基本信息主体 */}
        <div className="section-block">
          <h2 className="section-title">📌 {isJa ? '基本情報' : '票券基本信息'}</h2>
          
          {/* 🗺️ 1. 路线图 */}
          {fullMapUrl && (
            <div className="top-map-card">
              <div className="top-map-header">
                🗺️ {isJa ? 'フリーエリア路線図' : '自由乘车区间路线图'}
              </div>
              <img
                src={fullMapUrl}
                alt={isJa ? 'フリーエリア路線図' : '自由乘车区间路线图'}
                className="top-map-image"
                onClick={() => setIsMapModalOpen(true)}
                onError={(e) => {
                  const card = e.currentTarget.closest('.top-map-card');
                  if (card) card.style.display = 'none';
                }}
              />
              <span className="top-map-tip">🔍 {isJa ? 'クリックで拡大表示' : '点击查看大图'}</span>
            </div>
          )}

          {/* 2. 结构化 KV 信息列表 */}
          <div className="info-kv-card">
            {/* ⏱️ 有效期间 */}
            <div className="info-kv-row">
              <div className="info-kv-label">⏱️ {isJa ? '有効期間' : '有效期间'}</div>
              <div className="info-kv-value-text">{ticket.validity_period_text || '-'}</div>
            </div>

            {/* 📅 发售/利用期间 */}
            <div className="info-kv-row">
              <div className="info-kv-label">📅 {isJa ? '発売・利用期間' : '销售/利用期间'}</div>
              <div className="info-kv-value-text">{ticket.sales_period_text || ticket.use_period_text || '-'}</div>
            </div>

            {/* 利用可能设备 KV 展示行 */}
            <div className="info-kv-row">
              <div className="info-kv-label">
                🚆 {isJa ? '利用可能設備' : '可利用列车/设备'}
              </div>
              <div className="info-kv-value-container" style={{ flex: 1 }}>
                {renderAvailableFacilities(ticket.available_facilities || ticket['利用可能設備'], lang)}
              </div>
            </div>

            {/* 🗺️ 自由乘车区间 */}
            {hasFreeAreaNote && (
              <div className="info-kv-row">
                <div className="info-kv-label">🗺️ {isJa ? 'フリーエリア' : '自由乘车区间'}</div>
                <div className="info-kv-value-text">{ticket.free_area_note}</div>
              </div>
            )}

            {/* 💡 利用条件与注意事项 */}
            <div className="info-kv-row">
              <div className="info-kv-label">💡 {isJa ? '利用条件・注意事項' : '利用条件与注意事项'}</div>
              <div className="info-kv-value-container">
                {renderUsageConditions(ticket.usage_conditions, lang)}
              </div>
            </div>
          </div>
        </div>

        {/* 官网跳转链接 */}
        {ticket.official_url && (
          <footer className="detail-actions">
            <a
              href={ticket.official_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-official"
            >
              {isJa ? '公式サイトで詳細を見る ↗' : '前往官网查看更多信息 ↗'}
            </a>
          </footer>
        )}
      </div>

      {/* 💡 路线图 Lightbox 全屏预览弹窗 */}
      {isMapModalOpen && fullMapUrl && (
        <div className="lightbox-overlay" onClick={() => setIsMapModalOpen(false)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button className="lightbox-close-btn" onClick={() => setIsMapModalOpen(false)}>✕</button>
            <img
              src={fullMapUrl}
              alt="Expanded Map"
              className="lightbox-image"
            />
          </div>
        </div>
      )}
    </div>
  );
}