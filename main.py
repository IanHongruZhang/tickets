import os
import re
import json
import asyncio
from typing import Optional, List, Any
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import pandas as pd
import numpy as np
import requests
from dotenv import load_dotenv

# 引入 ChromaDB 与 LangChain Core
from langchain_chroma import Chroma
from langchain_core.embeddings import Embeddings
import dashscope
from dashscope import TextEmbedding, Generation

# 加载环境变量
load_dotenv()

# =====================================================================
# 1. 数据全局内存缓存与 Lifespan 预加载路径配置
# =====================================================================
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
PARQUET_JA_PATH = os.path.join(DATA_DIR, "tickets_jp_cleaned.parquet")
PARQUET_ZH_PATH = os.path.join(DATA_DIR, "tickets_cn_cleaned.parquet")
CSV_FALLBACK_PATH = os.path.join(os.path.dirname(__file__), "tickets_en.csv")

MAPS_DIR = os.path.join(DATA_DIR, "raw", "maps") if os.path.exists(os.path.join(DATA_DIR, "raw", "maps")) else "/Users/hongruzyj/Desktop/tickets/data/raw/maps"

# 全局内存数据集缓存
DATASET_CACHE = {
    "ja": pd.DataFrame(),
    "zh": pd.DataFrame()
}

def load_dataset_from_disk(lang: str = "ja") -> pd.DataFrame:
    """从磁盘读取数据的底层逻辑"""
    target_parquet = PARQUET_ZH_PATH if lang == "zh" else PARQUET_JA_PATH

    if os.path.exists(target_parquet):
        try:
            df = pd.read_parquet(target_parquet)
        except Exception:
            df = pd.read_parquet(target_parquet, engine="fastparquet")
    elif os.path.exists(CSV_FALLBACK_PATH):
        df = pd.read_csv(CSV_FALLBACK_PATH)
    else:
        df = pd.DataFrame()
    return df

@asynccontextmanager
async def lifespan(app: FastAPI):
    """服务启动时预加载全量数据到内存，服务关闭时自动释放"""
    print("🚀 [System] 正在预加载票券数据集到内存...")
    DATASET_CACHE["ja"] = load_dataset_from_disk("ja")
    DATASET_CACHE["zh"] = load_dataset_from_disk("zh")
    print(f"✅ [System] 数据集预加载成功！日文库: {len(DATASET_CACHE['ja'])} 条, 中文库: {len(DATASET_CACHE['zh'])} 条")
    yield
    DATASET_CACHE.clear()

app = FastAPI(title="Japan Rail Pass Encyclopedia & AI RAG API", lifespan=lifespan)

# 允许前端跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局 500 异常拦截器
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"❌ [Server Error] {request.method} {request.url.path} - Exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"error": "Internal Server Error", "detail": str(exc)},
        headers={"Access-Control-Allow-Origin": "*"}
    )

# 挂载静态地图目录
if os.path.exists(MAPS_DIR):
    app.mount("/maps", StaticFiles(directory=MAPS_DIR), name="maps")
else:
    print(f"⚠️ [Warning] 地图静态路径不存在: {MAPS_DIR}")


# =====================================================================
# 2. 原生 DashScope (通义千问) + 本地 ChromaDB 向量检索与 LLM RAG 服务
# =====================================================================
class NativeDashScopeEmbeddings(Embeddings):
    """避开 OpenAI tiktoken 和 Rust 编译依赖的原生 Embedding 实现"""
    def __init__(self, key: str, model: str = "qwen3.7-text-embedding"):  # 💡 保持与 build_rag.py 一致
        self.key = key
        self.model = model

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        batch_size = 10
        all_embeddings = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            resp = TextEmbedding.call(model=self.model, input=batch, api_key=self.key)
            if resp.status_code == 200:
                all_embeddings.extend([item['embedding'] for item in resp.output['embeddings']])
            else:
                raise Exception(f"DashScope Embedding Error: {resp.message}")
        return all_embeddings

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]


class LocalChromaRAGService:
    def __init__(self):
        self.api_key = os.getenv("DASHSCOPE_API_KEY", "").strip()
        self.vectorstore = None

        BASE_DIR = Path(__file__).resolve().parent
        CHROMA_DIR = BASE_DIR / "data" / "chroma_db"
        if not CHROMA_DIR.exists():
            CHROMA_DIR = BASE_DIR / "chroma_db"

        if self.api_key and CHROMA_DIR.exists():
            try:
                embeddings = NativeDashScopeEmbeddings(key=self.api_key)
                self.vectorstore = Chroma(
                    persist_directory=str(CHROMA_DIR),
                    embedding_function=embeddings
                )
                print(f"✅ [RAG] 本地 ChromaDB 向量库已就绪: {CHROMA_DIR}")
            except Exception as e:
                print(f"❌ [RAG] 初始化 ChromaDB 异常: {e}")
        else:
            print(f"⚠️ [RAG] 数据库或 API Key 未准备就绪 (Key 存在: {bool(self.api_key)}, Path 存在: {CHROMA_DIR.exists()})")

    async def answer_question(self, query: str, lang: str = "ja", top_k: int = 5) -> dict: # 💡 1. top_k 改为 5
        if not self.api_key or not self.vectorstore:
            return {"answer": "服务未配置 DASHSCOPE_API_KEY 或向量数据库未配置", "sources": []}

        try:
            # 1. 多条件硬编码过滤字典 ($and 逻辑)
            filter_conditions = []

            # 在售状态硬过滤
            if any(kw in query for kw in ["在卖", "正在发售", "在售", "现售", "还能买", "目前有"]):
                filter_conditions.append({"is_ended": False})

            # 地域/全国硬过滤
            if any(kw in query for kw in ["全国", "全日本", "Japan Rail Pass", "全国通用"]):
                filter_conditions.append({"is_national": True})
            elif "关东" in query or "関東" in query:
                filter_conditions.append({"region_code": "kanto"})
            elif "关西" in query or "関西" in query or "近畿" in query:
                filter_conditions.append({"region_code": "kinki"})
            elif "北海道" in query:
                filter_conditions.append({"region_code": "hokkaido"})
            elif "九州" in query:
                filter_conditions.append({"region_code": "kyusyu"})

            if len(filter_conditions) == 1:
                filter_condition = filter_conditions[0]
            elif len(filter_conditions) > 1:
                filter_condition = {"$and": filter_conditions}
            else:
                filter_condition = None

            # 2. 检索 top_k=5 条数据
            results = await asyncio.to_thread(
                self.vectorstore.similarity_search,
                query,
                k=top_k,
                filter=filter_condition
            )

            sources = []
            context_text = ""
            for idx, doc in enumerate(results, 1):
                t_id = doc.metadata.get("ticket_id", f"TICK-{idx}")
                t_name = doc.metadata.get("ticket_name", "未知票券")
                sources.append({"ticket_id": t_id, "ticket_name": t_name})
                context_text += f"\n--- 资料 {idx} ---\n{doc.page_content}\n"

            # 3. 引导提供多备选的 Prompt
            is_zh = (lang == "zh")
            system_prompt = (
                "你是专业的日本交通票券助手。请【严格仅凭】提供的【门票资料】回答。\n\n"
                "【核心规则】：\n"
                "1. 如果【门票资料】中有多个符合用户条件的票券，请【尽可能全部列出】作为备选推荐！\n"
                "2. 绝对不要推荐写明“绝对非全国通用票券”或不满足要求的票券！\n"
                "3. 若资料中没有任何符合条件的票，才直接回答：'资料库中暂未找到符合条件的票券。'\n"
                "4. 格式要求：全篇使用中文列表（* 或 -）排版，严禁使用 HTML 及 Markdown 表格。"
            )

            user_prompt = f"【门票资料】：\n{context_text}\n\n【用户提问】：\n{query}\n\n请列出所有符合要求的备选票券并简要说明理由与售价："

            def call_llm():
                return Generation.call(
                    model="qwen-turbo",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    api_key=self.api_key,
                    result_format='message'
                )

            llm_resp = await asyncio.to_thread(call_llm)

            if llm_resp.status_code != 200:
                return {"answer": f"生成失败: {llm_resp.message}", "sources": sources}

            clean_text = llm_resp.output.choices[0].message.content.strip()

            final_sources = sources
            if "未找到符合" in clean_text or "未检索到" in clean_text or "暂未找到" in clean_text:
                final_sources = []

            return {
                "answer": clean_text,
                "referenced_ticket_ids": [s["ticket_id"] for s in final_sources],
                "sources": final_sources
            }

        except Exception as e:
            print(f"❌ [RAG Exception]: {e}")
            return {"answer": f"服务运行异常: {str(e)}", "sources": []}

rag_service = LocalChromaRAGService()


# =====================================================================
# 3. 数据类型转换与设备结构映射逻辑
# =====================================================================
def to_python_native(val: Any) -> Any:
    """递归清洗数据，彻底解决 FastAPI JSON 序列化 500 错误"""
    if val is None:
        return None

    if isinstance(val, (list, tuple)):
        return [to_python_native(x) for x in val]
    if isinstance(val, np.ndarray):
        return [to_python_native(x) for x in val.tolist()]

    try:
        if pd.isna(val):
            return None
    except Exception:
        pass

    if isinstance(val, (np.integer, np.int64, np.int32, np.int16, np.int8)):
        return int(val)
    if isinstance(val, (np.floating, np.float64, np.float32)):
        return float(val)
    if isinstance(val, (np.bool_,)):
        return bool(val)

    if isinstance(val, (pd.Timestamp,)):
        return val.isoformat()

    return val


def safe_int(val) -> Optional[int]:
    """提取数字并转为 int，精准支持浮点数字符串如 '2000.0'"""
    cleaned = to_python_native(val)
    if cleaned is None:
        return None
    try:
        return int(float(cleaned))
    except (ValueError, TypeError):
        try:
            clean_str = re.sub(r"[^\d]", "", str(cleaned))
            return int(clean_str) if clean_str else None
        except Exception:
            return None


def safe_bool(val) -> bool:
    """安全地转换为布尔值"""
    cleaned = to_python_native(val)
    if cleaned is None:
        return False
    if isinstance(cleaned, bool):
        return cleaned
    str_v = str(cleaned).strip().lower()
    return str_v in ["true", "1", "t", "y", "yes"]


def normalize_facilities_structure(val: Any) -> Any:
    """直接反序列化 JSON，不做任何强制拼接，原样透传给前端"""
    if not val:
        return val

    if isinstance(val, str):
        trimmed = val.strip()
        if trimmed.startswith('{') and trimmed.endswith('}'):
            try:
                return json.loads(trimmed)
            except Exception:
                return val
    return val


def load_dataset(lang: str = "ja") -> pd.DataFrame:
    """快速从内存读取全局缓存数据"""
    df = DATASET_CACHE.get(lang)
    if df is None or df.empty:
        return load_dataset_from_disk(lang)
    return df


def row_to_dict(row: pd.Series) -> dict:
    """安全的行转字典映射，输出 Python 原生字典"""
    raw_dict = {
        str(k): to_python_native(v) 
        for k, v in row.to_dict().items()
    }

    ticket_id = str(raw_dict.get("チケットID") or "")

    # 1. 提取真实的运营公司名称
    raw_op = (
        raw_dict.get("全運営会社")
        or raw_dict.get("運営会社")
    )
    
    clean_op = ""
    if raw_op:
        if isinstance(raw_op, list):
            clean_op = ", ".join([str(x) for x in raw_op if x])
        else:
            clean_op = (
                str(raw_op)
                .replace("[", "")
                .replace("]", "")
                .replace("'", "")
                .replace('"', "")
                .strip()
            )

        if not clean_op or clean_op in ["nan", "None", "-", ""]:
            if ticket_id.startswith("jrwest"):
                clean_op = "ＪＲ西日本"
            elif ticket_id.startswith("jreast"):
                clean_op = "ＪＲ東日本"
            elif ticket_id.startswith("jrhokkaido"):
                clean_op = "ＪＲ北海道"
            elif ticket_id.startswith("jrcentral"):
                clean_op = "ＪＲ東海"
            elif ticket_id.startswith("jrshikoku"):
                clean_op = "ＪＲ四国"
            elif ticket_id.startswith("jrkyushu"):
                clean_op = "ＪＲ九州"
            elif ticket_id.startswith("tizukyu"):
                clean_op = "智頭急行"
            elif ticket_id.startswith("ibara"):
                clean_op = "井原鉄道"
            elif ticket_id.startswith("nishik"):
                clean_op = "錦川鉄道"
            elif ticket_id.startswith("mizush"):
                clean_op = "水島臨海鉄道"
            elif ticket_id.startswith("wakasa"):
                clean_op = "若桜鉄道"
            elif ticket_id.startswith("itibat"):
                clean_op = "一畑電車"
            elif ticket_id.startswith("hirode") or ticket_id.startswith("hirosh"):
                clean_op = "広島電鉄"
            elif ticket_id.startswith("okaden"):
                clean_op = "岡山電気軌道"
            elif ticket_id.startswith("astrum"):
                clean_op = "アストラムライン"
            else:
                clean_op = "ＪＲ西日本"

    # 2. 销售状态解析
    status_code = str(raw_dict.get("発売状況コード") or "").strip().lower()
    is_ended = status_code == "ended"

    # 3. 路线图文件解析
    raw_map_val = raw_dict.get("区間地図")
    map_filename = None

    if raw_map_val:
        gif_matches = re.findall(r"([\w\-\.]+\.gif)", str(raw_map_val), re.IGNORECASE)
        if gif_matches:
            map_filename = gif_matches[-1]

    if not map_filename:
        map_filename = f"{ticket_id}.gif"

    map_file_path = os.path.join(MAPS_DIR, map_filename)
    has_map = os.path.exists(map_file_path)
    map_url = f"/maps/{map_filename}" if has_map else None

    # 4. 提取铁道公司分类字段
    company_category = raw_dict.get("鉄道会社分類") or ""

    # 5. 利用可能设备结构自动规整转换
    facilities_data = normalize_facilities_structure(raw_dict.get("利用可能設備"))

    result = {
        "ticket_id": ticket_id,
        "ticket_name": str(raw_dict.get("チケット名") or ""),
        "operator": clean_op,
        "all_operators": raw_dict.get("全運営会社"),
        "company_category": company_category,
        "company_count": safe_int(raw_dict.get("会社数")),
        "is_joint": safe_bool(raw_dict.get("联名フラグ")),
        "region_code": str(raw_dict.get("地域コード") or "zenkoku"),
        "region": str(raw_dict.get("地域") or ""),
        "region_zh": str(raw_dict.get("地域(中)") or ""),
        "is_cross_region": safe_bool(raw_dict.get("跨地域")),
        "sale_type_code": raw_dict.get("発売タイプコード"),
        "sale_type": raw_dict.get("発売タイプ"),
        "sale_type_zh": raw_dict.get("発売タイプ(中)"),
        "media": raw_dict.get("媒体"),
        "is_paper_ticket": safe_bool(raw_dict.get("紙チケット")),
        "is_mobile_ticket": safe_bool(raw_dict.get("スマホチケット")),
        "sale_status_code": status_code,
        "is_ended": is_ended,
        "sale_status_legend": raw_dict.get("発売状況図例"),
        "sale_status_raw": raw_dict.get("発売状況図例") or raw_dict.get("発売状況"),
        "sale_start": raw_dict.get("発売開始"),
        "sale_end": raw_dict.get("発売終了"),
        "price_adult_jpy": safe_int(raw_dict.get("大人料金")),
        "price_child_jpy": safe_int(raw_dict.get("小人料金")),
        "min_price": safe_int(raw_dict.get("最低料金")),
        "price_text": raw_dict.get("料金"),
        "validity_period_text": raw_dict.get("有効期間"),
        "valid_days": safe_int(raw_dict.get("有効日数")),
        "sales_period_text": raw_dict.get("発売期間"),
        "use_period_text": raw_dict.get("利用期間"),
        "free_area_note": raw_dict.get("フリー区間"),
        "map_raw": raw_dict.get("区間地図"),
        "available_facilities": facilities_data,
        "usage_conditions": raw_dict.get("制限事項"),
        "restriction_count": safe_int(raw_dict.get("制限数")),
        "sales_locations": raw_dict.get("発売箇所"),
        "inquiries": raw_dict.get("問合せ"),
        "remarks": raw_dict.get("備考"),
        "official_url": raw_dict.get("公式URL"),
        "official_link": raw_dict.get("公式リンク"),
        "extra_items": raw_dict.get("拡張項目"),
        "detail_url": raw_dict.get("詳細URL"),
        "saved_file": raw_dict.get("保存ファイル"),
        "display_order": safe_int(raw_dict.get("表示順")),
        "fetch_time": raw_dict.get("取得日時"),
        "title": raw_dict.get("タイトル"),
        "sale_quantity": raw_dict.get("発売数量"),
        "apply_period": raw_dict.get("申込期間"),
        "apply_location": raw_dict.get("申込場所"),
        "original_index": raw_dict.get("元索引"),
        "map_url": map_url,
    }

    for col, val in raw_dict.items():
        if col not in result:
            result[col] = val

    return result


def get_company_weight_backend(row: pd.Series) -> int:
    """后端计算公司分类权重: 1: JR各社 > 2: 大手私铁 > 3: 地方私铁/其他"""
    category = str(row.get("鉄道会社分類") or "").strip().lower()
    
    raw_op = row.get("全運営会社") or row.get("運営会社") or ""
    if isinstance(raw_op, list):
        operator = ", ".join([str(x) for x in raw_op if x])
    else:
        operator = str(raw_op)

    # 1. JR 各社
    if "jr" in category or "ｊｒ" in category or re.search(r'^(JR|ＪＲ)', operator, re.IGNORECASE):
        return 1

    # 2. 16 大大手私铁名录
    major_private = [
        '東武', '西武', '京成', '京王', '小田急', '東急', '京急', '東京メトロ', '相模',
        '名鉄', '近鉄', '南海', '京阪', '阪急', '阪神', '西日本鉄道', '西鉄'
    ]
    if "大手" in category or any(m in operator for m in major_private):
        return 2

    # 3. 地方私铁/第三部门铁道
    return 3


# =====================================================================
# 4. API 路由
# =====================================================================
# ✅ 双装饰器：精准防 405 Method Not Allowed 错误，全面支持 UptimeRobot 保活
@app.get("/api/v1/tickets")
@app.head("/api/v1/tickets")
async def get_tickets(
    lang: str = Query("ja", description="语言选择: ja | zh"),
    page: int = Query(1, ge=1),
    page_size: int = Query(18, ge=1, le=100),
    query: Optional[str] = Query(None, description="搜索关键词"),
    region: Optional[str] = Query(None, description="地域筛选"),
    media_type: Optional[str] = Query("all", description="媒介类型"),
    company: Optional[str] = Query(None, description="铁道公司筛选"),
    operator: Optional[str] = Query(None, description="别名兼容"),
    status: Optional[str] = Query(None, description="销售状态"),
    sale_status: Optional[str] = Query(None, description="别名兼容"),
):
    df = load_dataset(lang)

    if df.empty:
        return {"items": [], "total": 0, "page": page, "page_size": page_size}

    operator_col = "全運営会社" if "全運営会社" in df.columns else "運営会社"

    def stringify_op(val):
        if isinstance(val, (list, tuple, np.ndarray)):
            return ", ".join([str(x) for x in val if x])
        if pd.isna(val) or val is None:
            return ""
        return str(val)

    op_clean_series = df[operator_col].apply(stringify_op)

    # 1. 关键词搜索
    if query and query.strip():
        q = query.strip().lower()
        mask = (
            df["チケット名"].fillna("").astype(str).str.lower().str.contains(q, na=False)
            | op_clean_series.str.lower().str.contains(q, na=False)
            | df["フリー区間"].fillna("").astype(str).str.lower().str.contains(q, na=False)
        )
        df = df[mask]
        op_clean_series = op_clean_series[mask]

    # 2. 地域筛选
    if region and region != "all":
        mask = (
            (df.get("地域コード").fillna("").astype(str) == region)
            | (df.get("地域").fillna("").astype(str) == region)
            | (df.get("地域(中)").fillna("").astype(str) == region)
        )
        df = df[mask]
        op_clean_series = op_clean_series[mask]

    # 3. 铁道公司筛选
    target_company = company or operator
    if target_company and target_company != "all":
        search_series = op_clean_series.str.replace('ＪＲ', 'JR', regex=False)
        if target_company in ["大手私鉄・その他", "私铁/地方铁道公司"]:
            mask = ~search_series.str.contains("JR", case=False, na=False)
        else:
            search_op = target_company.replace('ＪＲ', 'JR')
            mask = search_series.str.contains(search_op, case=False, na=False)
        
        df = df[mask]
        op_clean_series = op_clean_series[mask]

    # 4. 销售状态筛选
    target_status = status or sale_status or "all"
    if target_status and target_status != "all":
        if "発売状況コード" in df.columns:
            status_series = df["発売状況コード"].fillna("").astype(str).str.strip().str.lower()
            if target_status in ["ended", "终了", "終了", "発売終了"]:
                mask = (status_series == "ended")
            elif target_status in ["active", "selling", "on_sale", "period", "在售", "再买", "発売中"]:
                mask = (status_series != "ended")
            else:
                mask = pd.Series(True, index=df.index)
            
            df = df[mask]
            op_clean_series = op_clean_series[mask]

    # 5. 媒介类型筛选
    if media_type == "mobile":
        mask = (df["スマホチケット"] == True)
        df = df[mask]
        op_clean_series = op_clean_series[mask]
    elif media_type == "paper":
        mask = (df["紙チケット"] == True)
        df = df[mask]
        op_clean_series = op_clean_series[mask]

    # 6. 后端全量切片前排序 (1: JR > 2: 大手私铁 > 3: 其他)
    try:
        df["_weight"] = df.apply(get_company_weight_backend, axis=1)
        df["_temp_op_str"] = op_clean_series
        if "大人料金" in df.columns:
            df["_adult_price"] = pd.to_numeric(df["大人料金"], errors='coerce').fillna(0)
        else:
            df["_adult_price"] = 0

        # 执行严格的三级多列复合排序
        df = df.sort_values(
            by=["_weight", "_temp_op_str", "_adult_price"],
            ascending=[True, True, False],
            na_position='last'
        )

        df = df.drop(columns=["_weight", "_temp_op_str", "_adult_price"])
    except Exception as e:
        print(f"⚠️ [Warning] 后端全量排序异常: {e}")

    # 7. 全局排序完成后切片分页
    total = len(df)
    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size
    page_df = df.iloc[start_idx:end_idx]

    items = [row_to_dict(row) for _, row in page_df.iterrows()]

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@app.get("/api/v1/tickets/{ticket_id}")
def get_ticket_detail(ticket_id: str, lang: str = Query("ja")):
    df = load_dataset(lang)
    if df.empty:
        raise HTTPException(status_code=404, detail="Data file not found")

    match = df[df["チケットID"].astype(str) == ticket_id]
    if match.empty:
        raise HTTPException(status_code=404, detail="Ticket not found")

    return row_to_dict(match.iloc[0])


# =====================================================================
# 5. AI RAG 问答接口
# =====================================================================
class AIChatRequest(BaseModel):
    query: str
    lang: Optional[str] = "ja"

@app.post("/api/v1/ai/chat")
async def ai_chat_endpoint(req: AIChatRequest):
    if not req.query or not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    res = await rag_service.answer_question(query=req.query, lang=req.lang)
    return res