import os
import shutil
import pandas as pd
from pathlib import Path
from dotenv import load_dotenv

from langchain_chroma import Chroma
from langchain_core.documents import Document
from dashscope import TextEmbedding

# 加载环境变量
load_dotenv()

# DASHSCOPE API KEY
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "").strip()
if not DASHSCOPE_API_KEY:
    raise ValueError("❌ 请在 .env 文件中配置 DASHSCOPE_API_KEY！")

# =====================================================================
# 1. 智能路径自动寻址（彻底解决 data/data 路径重叠问题）
# =====================================================================
CURRENT_DIR = Path(__file__).resolve().parent

if (CURRENT_DIR / "tickets_cn_cleaned.parquet").exists() or (CURRENT_DIR / "tickets_jp_cleaned.parquet").exists():
    DATA_DIR = CURRENT_DIR
else:
    DATA_DIR = CURRENT_DIR / "data"

PARQUET_ZH_PATH = DATA_DIR / "tickets_cn_cleaned.parquet"
PARQUET_JA_PATH = DATA_DIR / "tickets_jp_cleaned.parquet"
CHROMA_DIR = DATA_DIR / "chroma_db"

# =====================================================================
# 2. 原生 Embedding 类（更换为带有免费额度的 qwen3.7-text-embedding）
# =====================================================================
class NativeDashScopeEmbeddings:
    def __init__(self, key: str, model: str = "qwen3.7-text-embedding"):
        self.key = key
        self.model = model

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        batch_size = 10  # 💡 核心修改：从 25 调整为 10（不超过 20 的限制）
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

# =====================================================================
# 3. 向量库构建主函数
# =====================================================================
def build_vector_db():
    if CHROMA_DIR.exists():
        print(f"🧹 正在清理旧的 ChromaDB 路径: {CHROMA_DIR}")
        shutil.rmtree(CHROMA_DIR)

    target_parquet = PARQUET_ZH_PATH if PARQUET_ZH_PATH.exists() else PARQUET_JA_PATH
    if not target_parquet.exists():
        raise FileNotFoundError(f"❌ 找不到数据文件！请检查路径: {PARQUET_ZH_PATH} 或 {PARQUET_JA_PATH}")

    print(f"📖 正在加载数据源: {target_parquet}")
    df = pd.read_parquet(target_parquet)

    documents = []

    for idx, row in df.iterrows():
        ticket_id = str(row.get("チケットID") or f"TICK-{idx}")
        ticket_name = str(row.get("チケット名") or "")
        operator = str(row.get("全運営会社") or row.get("運営会社") or "")
        
        # 1. 解析销售状态 (is_ended)
        status_code = str(row.get("発売状況コード") or "").strip().lower()
        is_ended = (status_code == "ended") or ("終了" in str(row.get("発売状況図例") or ""))
        sale_status_text = "【销售状态】：已停止发售/售罄" if is_ended else "【销售状态】：正在发售中"

        # 2. 严格的“全国通用”判定逻辑
        region_code = str(row.get("地域コード") or "").strip().lower()
        region_zh = str(row.get("地域(中)") or row.get("地域") or "")
        
        # 强否定关键词黑名单：如果包含局部关键词，100% 绝对不是全国通用票
        non_national_kws = ["北海道", "東日本", "西日本", "東海", "四国", "九州", "山陽", "関西", "関東", "北陸", "近畿"]
        has_regional_kw = any(kw in ticket_name or kw in region_zh for kw in non_national_kws)

        # 必须地域代码是 zenkoku，且名称/地域中不包含任何局部区域词汇，才标记为全国票
        is_national = (region_code == "zenkoku") and not has_regional_kw
        
        if is_national:
            national_notice = "【范围说明】：本票券为全日本全国通用票券。"
        else:
            national_notice = f"【范围说明】：本票券仅限【{region_zh}】局部地区使用，绝对非全国通用票券！严禁在其他区域使用！"

        free_area = str(row.get("フリー区間") or "未提供详细区间")
        usage_conditions = str(row.get("制限事項") or "无特别限制")
        price_text = str(row.get("料金") or "请咨询官网")

        content = f"""【票券名称】：{ticket_name}
【票券ID】：{ticket_id}
【运营公司】：{operator}
{sale_status_text}
【适用地域】：{region_zh}
{national_notice}
【自由乘车区间】：{free_area}
【票券售价】：{price_text}
【利用条件与注意事项】：{usage_conditions}
"""

        metadata = {
            "ticket_id": ticket_id,
            "ticket_name": ticket_name,
            "region_code": region_code,
            "is_national": is_national,
            "is_ended": is_ended,
            "operator": operator
        }

        doc = Document(page_content=content, metadata=metadata)
        documents.append(doc)

    print(f"📦 成功构造 {len(documents)} 条结构化向量文档，准备写入 ChromaDB...")

    embeddings = NativeDashScopeEmbeddings(key=DASHSCOPE_API_KEY)
    
    batch_size = 50
    vectorstore = None
    for i in range(0, len(documents), batch_size):
        batch_docs = documents[i:i + batch_size]
        if vectorstore is None:
            vectorstore = Chroma.from_documents(
                documents=batch_docs,
                embedding=embeddings,
                persist_directory=str(CHROMA_DIR)
            )
        else:
            vectorstore.add_documents(batch_docs)
        print(f"✅ 已完成写入: {min(i + batch_size, len(documents))}/{len(documents)}")

    print(f"🎉 ChromaDB 数据库成功重建完成！路径为: {CHROMA_DIR}")

if __name__ == "__main__":
    build_vector_db()