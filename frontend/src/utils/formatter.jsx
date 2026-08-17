import React from 'react';

/**
 * 渲染票券价格显示
 * @param {Object} ticketItem - 单张票券数据对象
 */
export const renderPriceDisplay = (ticketItem) => {
  if (!ticketItem) return <span className="price-amount">--</span>;

  // 兼容不同的价格字段命名 (如 adult_price / price / price_yen 等)
  const price = ticketItem.adult_price ?? ticketItem.price ?? ticketItem.price_yen;

  if (price !== undefined && price !== null) {
    const formattedPrice = typeof price === 'number' ? price.toLocaleString() : price;
    return (
      <span className="price-amount" style={{ fontWeight: 'bold', color: '#2563eb' }}>
        ¥{formattedPrice}
      </span>
    );
  }

  return <span className="price-amount" style={{ color: '#94a3b8' }}>未说明</span>;
};

/**
 * 渲染票券利用条件/使用限制
 * @param {Array|Object|string} conditions - 利用条件数据
 * @param {string} lang - 语言 ('ja' | 'zh')
 */
export const renderUsageConditions = (conditions, lang = 'ja') => {
  if (!conditions) {
    return (
      <span style={{ color: '#94a3b8' }}>
        {lang === 'zh' ? '暂无特殊限制' : '特になし'}
      </span>
    );
  }

  // 如果是字符串形式
  if (typeof conditions === 'string') {
    return <span>{conditions}</span>;
  }

  // 如果是数组形式
  if (Array.isArray(conditions)) {
    if (conditions.length === 0) {
      return <span>{lang === 'zh' ? '无特殊限制' : '特になし'}</span>;
    }
    return (
      <ul style={{ paddingLeft: '18px', margin: '4px 0', fontSize: '0.85rem' }}>
        {conditions.map((item, idx) => (
          <li key={idx}>{item}</li>
        ))}
      </ul>
    );
  }

  // 如果是对象形式 (如 { duration: '3 days', valid_days: 3 })
  if (typeof conditions === 'object') {
    const text = conditions[lang] || conditions.text || JSON.stringify(conditions);
    return <span>{text}</span>;
  }

  return <span>{String(conditions)}</span>;
};