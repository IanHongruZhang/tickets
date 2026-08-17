import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import './TicketListPage.css';
import remarkGfm from 'remark-gfm';

// 1. 提取票券主售价
const getTicketMainPrice = (tItem) => {
  if (typeof tItem.price_adult_jpy === 'number' && !isNaN(tItem.price_adult_jpy) && tItem.price_adult_jpy > 0) {
    return tItem.price_adult_jpy;
  }
  if (typeof tItem.min_price === 'number' && !isNaN(tItem.min_price) && tItem.min_price > 0) {
    return tItem.min_price;
  }

  const rawPrice = tItem.price_text || tItem.price || tItem['料金'] || '';
  if (!rawPrice || typeof rawPrice !== 'string') return 0;

  const adultMatch = rawPrice.match(/大人[：:]?\s*([0-9,]+)\s*円/);
  if (adultMatch && adultMatch[1]) {
    return parseInt(adultMatch[1].replace(/,/g, ''), 10);
  }

  const matches = rawPrice.replace(/,/g, '').match(/\d+/g);
  if (!matches) return 0;
  const validPrices = matches.map(n => parseInt(n, 10)).filter(n => n >= 100);
  
  return validPrices.length > 0 ? Math.min(...validPrices) : 0;
};

// 2. UI 展现格式化
const parseMinPrice = (tItem) => {
  const price = getTicketMainPrice(tItem);
  if (!price || price === 0) {
    const rawPrice = tItem.price_text || tItem.price || '-';
    return typeof rawPrice === 'string' ? rawPrice.split('\n')[0].trim() : '-';
  }
  return `¥${price.toLocaleString()} ~`;
};

// 3. 运营公司显示格式化
const formatOperator = (operatorStr, currentLang) => {
  if (!operatorStr || typeof operatorStr !== 'string') return '-';
  const trimmed = operatorStr.trim();
  const parts = trimmed.split(/[\s ]+/);
  if (parts.length > 1) {
    const suffix = currentLang === 'zh' ? '等' : 'など';
    return `${parts[0]} ${suffix}`;
  }
  return trimmed;
};

// 多语言 UI 文案
const I18N = {
  ja: {
    title: '全日本お得なきっぷ百科',
    subtitle: 'JR・私鉄の周遊券を一元網羅',
    aiBtn: '✨ AIアシスタント',
    searchPlaceholder: 'チケット名、会社名、エリア...',
    searchBtn: '検索',
    resetBtn: '🔄 条件をリセット',
    filterToggleOpen: '🔍 条件絞り込み',
    filterToggleClose: '✕ 絞り込みを閉じる',
    filterStatusLabel: '発売状態',
    allMedia: 'すべての媒体',
    mobileOnly: 'スマホ/デジタル券',
    paperOnly: '紙チケット',
    allStatus: 'すべての発売状態',
    statusActive: '発売中',
    statusEnded: '発売終了',
    allOperators: 'すべての鉄道会社',
    foundTotal: '該当チケット:',
    pageStatus: (p, total) => `${p} / ${total} ページ`,
    paper: '📄 紙',
    mobile: '📲 スマホ',
    adultPrice: '料金',
    detailBtn: '詳細 →',
    prevPage: '← 前へ',
    nextPage: '次へ →',
    langToggle: '🇨🇳 中文版',
    aiModalTitle: '🤖 AI 票券助手 (RAG Demo)',
    aiAskBtn: '質問する',
    aiPlaceholder: '例: 東京から仙台まで3日間でお得に行けるチケットは？',
    colOperator: '会社名',
    colTicketName: 'フリーきっぷ / 種類',
    colPrice: '料金',
    colStatus: '状態',
    regions: [
      { code: 'zenkoku', label: '全国通用のみ' },
      { code: 'kanto', label: '関東' },
      { code: 'hokkaido', label: '北海道' },
      { code: 'tohoku', label: '東北' },
      { code: 'tokai', label: '東海' },
      { code: 'hokusinetu', label: '北信越' },
      { code: 'kinki', label: '近畿・関西' },
      { code: 'tyugoku', label: '中国' },
      { code: 'sikoku', label: '四国' },
      { code: 'kyusyu', label: '九州' },
      { code: 'all', label: 'すべての地域（全国）' },
    ],
    operators: [
      { code: 'all', label: 'すべての鉄道会社' },
      { code: 'JR北海道', label: 'JR北海道' },
      { code: 'JR東日本', label: 'JR東日本' },
      { code: 'JR東海', label: 'JR東海' },
      { code: 'JR西日本', label: 'JR西日本' },
      { code: 'JR四国', label: 'JR四国' },
      { code: 'JR九州', label: 'JR九州' },
      { code: '大手私鉄・その他', label: '大手私鉄・地方私鉄' },
    ],
  },
  zh: {
    title: '全日本优惠车票百科',
    subtitle: 'JR/私铁周游券高密度一览',
    aiBtn: '✨ AI 票券助手',
    searchPlaceholder: '搜索票券、公司、区间...',
    searchBtn: '搜索',
    resetBtn: '🔄 重置所有筛选',
    filterToggleOpen: '🔍 筛选条件',
    filterToggleClose: '✕ 收起筛选',
    filterStatusLabel: '发售状态',
    allMedia: '所有媒介',
    mobileOnly: '仅看电子票',
    paperOnly: '仅看纸质票',
    allStatus: '所有发售状态',
    statusActive: '正在发售',
    statusEnded: '已结束发售',
    allOperators: '所有铁道公司',
    foundTotal: '找到相关票券:',
    pageStatus: (p, total) => `${p} / ${total} 页`,
    paper: '🎫 纸质',
    mobile: '📲 电子',
    adultPrice: '售价',
    detailBtn: '详情 →',
    prevPage: '← 上一页',
    nextPage: '下一页 →',
    langToggle: '🇯🇵 日本語',
    aiModalTitle: '🤖 AI 票券助手 (RAG Demo)',
    aiAskBtn: '提问',
    aiPlaceholder: '例如：想从东京去仙台玩3天，有什么推荐的优惠券？',
    colOperator: '铁道公司',
    colTicketName: '优惠票券名称 / 类型',
    colPrice: '售价',
    colStatus: '状态',
    regions: [
      { code: 'zenkoku', label: '仅全国通用票' },
      { code: 'kanto', label: '关东' },
      { code: 'hokkaido', label: '北海道' },
      { code: 'tohoku', label: '东北' },
      { code: 'tokai', label: '东海' },
      { code: 'hokusinetu', label: '北信越' },
      { code: 'kinki', label: '关西/近畿' },
      { code: 'tyugoku', label: '中国地区' },
      { code: 'sikoku', label: '四国' },
      { code: 'kyusyu', label: '九州' },
      { code: 'all', label: '所有地区（全国）' },
    ],
    operators: [
      { code: 'all', label: '所有铁道公司' },
      { code: 'JR北海道', label: 'JR 北海道' },
      { code: 'JR東日本', label: 'JR 东日本' },
      { code: 'JR東海', label: 'JR 东海' },
      { code: 'JR西日本', label: 'JR 西日本' },
      { code: 'JR四国', label: 'JR 四国' },
      { code: 'JR九州', label: 'JR 九州' },
      { code: '大手私鉄・その他', label: '私铁/地方铁道公司' },
    ],
  },
};

export default function TicketListPage() {
  const navigate = useNavigate();

  const [lang, setLang] = useState('ja');
  const t = I18N[lang];

  const [tickets, setTickets] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // 筛选状态
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  
  const [selectedRegion, setSelectedRegion] = useState('zenkoku');
  const [mediaType, setMediaType] = useState('all');
  const [saleStatus, setSaleStatus] = useState('active');
  const [selectedOperator, setSelectedOperator] = useState('all');
  const [page, setPage] = useState(1);

  // 移动端筛选框折叠状态
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);

  // AI 问答弹窗状态
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiQuery, setAiQuery] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);

  const pageSize = 25;
  const totalPages = Math.ceil(total / pageSize) || 1;

  useEffect(() => {
    if (showAiModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showAiModal]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
      setPage(1);
    }, 300);

    return () => clearTimeout(handler);
  }, [searchQuery]);

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        lang: lang,
        page: page.toString(),
        page_size: pageSize.toString(),
        query: debouncedSearchQuery,
        region: selectedRegion,
        media_type: mediaType,
        sale_status: saleStatus,
        operator: selectedOperator,
      });

      // 💡 提取 API BASE，适应线上 Vercel 反向代理
      const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
      const res = await fetch(`${API_BASE}/api/v1/tickets?${params}`);
      
      const data = await res.json();
      setTickets(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('加载数据失败', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [lang, page, selectedRegion, mediaType, saleStatus, selectedOperator, debouncedSearchQuery]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setDebouncedSearchQuery(searchQuery);
    setPage(1);
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setDebouncedSearchQuery('');
    setSelectedRegion('zenkoku');
    setMediaType('all');
    setSaleStatus('active');
    setSelectedOperator('all');
    setPage(1);
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleAiAsk = async (e) => {
    e.preventDefault();
    if (!aiQuery.trim()) return;

    setAiLoading(true);
    try {
      // 💡 提取 API BASE，适应线上 Vercel 反向代理
      const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
      const res = await fetch(`${API_BASE}/api/v1/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: aiQuery, lang }),
      });
      const data = await res.json();
      setAiResult(data);
    } catch (err) {
      console.error('AI 提问失败', err);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="compact-page-container">
      <div className="compact-layout">
        
        {/* 左侧/上方 筛选侧边栏 */}
        <aside className="sidebar-panel">
          <div className="sidebar-header">
            <div>
              <h1 className="sidebar-title">{t.title}</h1>
              <p className="sidebar-subtitle">{t.subtitle}</p>
            </div>
            <button
              className="btn-lang-toggle"
              onClick={() => setLang(lang === 'ja' ? 'zh' : 'ja')}
            >
              🌐 {t.langToggle}
            </button>
          </div>

          <div className="filter-card">
            <form onSubmit={handleSearchSubmit} className="search-box-vertical">
              <input
                type="text"
                placeholder={t.searchPlaceholder}
                className="search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button type="submit" className="btn-search">{t.searchBtn}</button>
            </form>

            <button 
              type="button" 
              onClick={handleResetFilters}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                fontSize: '12px',
                cursor: 'pointer',
                textAlign: 'right',
                padding: '2px 0',
                textDecoration: 'underline'
              }}
            >
              {t.resetBtn}
            </button>

            <button
              type="button"
              className="btn-filter-toggle-mobile"
              onClick={() => setIsFilterExpanded(!isFilterExpanded)}
            >
              {isFilterExpanded ? t.filterToggleClose : t.filterToggleOpen}
            </button>

            <div className={`filter-vertical-group ${isFilterExpanded ? 'is-expanded' : ''}`}>
              <div className="filter-item">
                <label className="filter-label">🗺️ {lang === 'zh' ? '地区' : '地域'}</label>
                <select
                  className="select-filter"
                  value={selectedRegion}
                  onChange={(e) => { setSelectedRegion(e.target.value); setPage(1); }}
                >
                  {t.regions.map((r) => (
                    <option key={r.code} value={r.code}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div className="filter-item">
                <label className="filter-label">🎫 {lang === 'zh' ? '媒介' : '媒体'}</label>
                <select
                  className="select-filter"
                  value={mediaType}
                  onChange={(e) => { setMediaType(e.target.value); setPage(1); }}
                >
                  <option value="all">{t.allMedia}</option>
                  <option value="mobile">{t.mobileOnly}</option>
                  <option value="paper">{t.paperOnly}</option>
                </select>
              </div>

              <div className="filter-item">
                <label className="filter-label">📌 {t.filterStatusLabel}</label>
                <select
                  className="select-filter"
                  value={saleStatus}
                  onChange={(e) => { setSaleStatus(e.target.value); setPage(1); }}
                >
                  <option value="all">{t.allStatus}</option>
                  <option value="active">{t.statusActive}</option>
                  <option value="ended">{t.statusEnded}</option>
                </select>
              </div>

              <div className="filter-item">
                <label className="filter-label">🏢 {t.colOperator}</label>
                <select
                  className="select-filter"
                  value={selectedOperator}
                  onChange={(e) => { setSelectedOperator(e.target.value); setPage(1); }}
                >
                  {t.operators.map((op) => (
                    <option key={op.code} value={op.code}>{op.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="sidebar-meta">
            <span>{t.foundTotal} <strong>{total}</strong> 件</span>
            <span>{t.pageStatus(page, totalPages)}</span>
          </div>
        </aside>

        {/* 右侧/下方 数据列表直接渲染后端排序完的结果 */}
        <main className="main-content-panel">
          {loading ? (
            <div className="loading-state">Loading...</div>
          ) : (
            <div className="table-wrapper">
              <table className="ticket-table">
                <thead>
                  <tr>
                    <th style={{ width: '22%', minWidth: '130px' }}>{t.colOperator}</th>
                    <th style={{ width: '50%' }}>{t.colTicketName}</th>
                    <th style={{ width: '16%' }}>{t.colPrice}</th>
                    <th style={{ width: '12%' }}>{t.colStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((tItem, index) => {
                    const rawPrice = tItem.price || tItem.price_text || tItem.price_raw || tItem['料金'] || '-';
                    const isEnded = tItem.is_ended || (tItem.sale_status_raw && tItem.sale_status_raw.includes('終了'));

                    // 💡 修复：按照展示文案进行对比，防止会社名长短不一导致异常分割线
                    const currentDisplayOp = formatOperator(tItem.operator, lang);
                    const prevDisplayOp = index > 0 ? formatOperator(tickets[index - 1].operator, lang) : null;
                    const isNewOperatorGroup = index > 0 && currentDisplayOp !== prevDisplayOp;

                    return (
                      <tr 
                        key={tItem.ticket_id} 
                        className={`ticket-table-row clickable-row ${isNewOperatorGroup ? 'company-group-start' : ''}`}
                        onClick={() => navigate(`/ticket/${tItem.ticket_id}?lang=${lang}`)}
                      >
                        {/* 1. 会社名 */}
                        <td className="td-operator">
                          <span className="operator-tag" title={tItem.operator}>
                            {currentDisplayOp}
                          </span>
                        </td>

                        {/* 2. チケット名 */}
                        <td className="td-name">
                          <div className="name-wrapper">
                            <span className="badge-inline-group" style={{ display: 'flex', gap: '4px' }}>
                              {tItem.is_paper_ticket && (
                                <span className="mini-badge badge-paper">{t.paper}</span>
                              )}
                              {tItem.is_mobile_ticket && (
                                <span className="mini-badge badge-mobile">{t.mobile}</span>
                              )}
                              {!tItem.is_paper_ticket && !tItem.is_mobile_ticket && (
                                <span className="mini-badge badge-paper">{t.paper}</span>
                              )}
                            </span>
                            <span className="ticket-link-title" title={tItem.ticket_name}>
                              {tItem.ticket_name}
                            </span>
                          </div>
                        </td>

                        {/* 3. 料金 */}
                        <td className="td-price">
                          <span className="price-text-bold" title={rawPrice}>
                            {parseMinPrice(tItem)}
                          </span>
                        </td>

                        {/* 4. 発売期間・状態 */}
                        <td className="td-status">
                          <span className={`status-pill ${isEnded ? 'status-ended' : 'status-active'}`}>
                            <span className="status-dot">{isEnded ? '⚪' : '🟢'}</span>
                            <span className="status-text">{isEnded ? t.statusEnded : t.statusActive}</span>
                          </span>
                          <span className="card-arrow-icon">›</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* 翻页组件 */}
              {totalPages > 1 && (
                <div className="pagination-bar">
                  <button
                    className="btn-page"
                    disabled={page <= 1}
                    onClick={() => handlePageChange(page - 1)}
                  >
                    {t.prevPage}
                  </button>

                  <span className="page-status">
                    {page} / {totalPages}
                  </span>

                  <button
                    className="btn-page"
                    disabled={page >= totalPages}
                    onClick={() => handlePageChange(page + 1)}
                  >
                    {t.nextPage}
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* 右下角悬浮 AI 按钮 */}
      <button className="btn-ai-float" onClick={() => setShowAiModal(true)}>
        <span className="ai-float-icon">✨</span>
        <span className="ai-float-text">{t.aiBtn}</span>
      </button>

      {/* AI 助手弹窗 */}
      {showAiModal && (
        <div className="ai-modal-overlay" onClick={() => setShowAiModal(false)}>
          <div className="ai-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="ai-modal-header">
              <h3>{t.aiModalTitle}</h3>
              <button className="btn-close" onClick={() => setShowAiModal(false)}>✕</button>
            </div>

            <form onSubmit={handleAiAsk} className="ai-modal-form">
              <textarea
                className="ai-input"
                rows={3}
                placeholder={t.aiPlaceholder}
                value={aiQuery}
                onChange={(e) => setAiQuery(e.target.value)}
              />
              <button type="submit" className="btn-search" disabled={aiLoading}>
                {aiLoading ? (lang === 'zh' ? '正在智能检索中...' : 'Thinking...') : t.aiAskBtn}
              </button>
            </form>

            {aiResult && (
              <div className="ai-result-box" style={{ maxHeight: '420px', overflowY: 'auto', marginTop: '12px', padding: '16px' }}>
                <div className="markdown-body" style={{ fontSize: '14px', lineHeight: '1.7', color: '#1e293b' }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiResult.answer}</ReactMarkdown>
                </div>

                {aiResult.sources && aiResult.sources.length > 0 && (
                  <div className="ai-sources" style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px dashed #cbd5e1' }}>
                    <small style={{ color: '#64748b', fontWeight: 'bold' }}>
                      {lang === 'zh' ? '🔗 关联参考票券（点击查看详情）：' : '🔗 参考チケット:'}
                    </small>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                      {aiResult.sources.map((s) => (
                        <span
                          key={s.ticket_id}
                          className="price-notice-badge"
                          style={{
                            cursor: 'pointer',
                            background: '#e0e7ff',
                            color: '#4338ca',
                            padding: '6px 12px',
                            borderRadius: '8px',
                            fontSize: '12px',
                            fontWeight: '600',
                            transition: 'all 0.2s ease',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                          }}
                          onClick={() => {
                            setShowAiModal(false);
                            navigate(`/ticket/${s.ticket_id}?lang=${lang}`);
                          }}
                        >
                          🎫 {s.ticket_name} ↗
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}