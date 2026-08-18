import os
import duckdb
import pandas as pd
from pathlib import Path
from dotenv import load_dotenv

import dashscope
from dashscope import TextEmbedding
from langchain_chroma import Chroma
from langchain_core.embeddings import Embeddings

# 1. 自动定位项目根目录并加载 .env
SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent if SCRIPT_DIR.name == "data" else SCRIPT_DIR

env_path = ROOT_DIR / ".env"
load_dotenv(dotenv_path=env_path)

api_key = os.getenv("DASHSCOPE_API_KEY")
if not api_key:
    api_key = input("🔑 请输入你的 DASHSCOPE_API_KEY (sk-...): ").strip()

# 2. 读取数据文件
parquet_path = ROOT_DIR / "data" / "tickets_cn_cleaned.parquet"
if not parquet_path.exists():
    parquet_path = ROOT_DIR / "tickets_cn_cleaned.parquet"

print(f"📖 正在读取 parquet 数据文件: {parquet_path}")
df = duckdb.query(f"SELECT * FROM '{parquet_path}'").df()

documents = []
metadatas = []

print("🧩 正在拼接票券知识库文本...")
for _, row in df.iterrows():
    ticket_id = str(row.get('チケットID') or row.get('ticket_id') or '')
    ticket_name = str(row.get('チケット名') or row.get('ticket_name') or '')
    company = str(row.get('運営会社') or row.get('operator') or '')
    area = str(row.get('フリー区間') or row.get('free_area') or '')
    price = str(row.get('料金') or row.get('price_text') or '')
    conditions = str(row.get('利用条件') or row.get('usage_conditions') or '')
    facilities = str(row.get('利用可能設備') or row.get('available_facilities') or '')
    
    text_content = f"""【票券名称】: {ticket_name}
【票券ID】: {ticket_id}
【运营公司】: {company}
【适用区域/自由区间】: {area}
【售价/价格】: {price}
【利用条件】: {conditions}
【可利用列车与设备】: {facilities}"""

    documents.append(text_content)
    metadatas.append({
        "ticket_id": ticket_id,
        "ticket_name": ticket_name
    })

# 3. 构造纯原生、无 tiktoken 依赖的 Embedding 类
class NativeDashScopeEmbeddings(Embeddings):
    def __init__(self, key: str, model: str = "text-embedding-v2"):
        self.key = key
        self.model = model

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        # 阿里云接口支持批量请求，分批次处理以防超限
        batch_size = 25
        all_embeddings = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            resp = TextEmbedding.call(
                model=self.model,
                input=batch,
                api_key=self.key
            )
            if resp.status_code == 200:
                all_embeddings.extend([item['embedding'] for item in resp.output['embeddings']])
            else:
                raise Exception(f"DashScope Embedding Error: {resp.message}")
        return all_embeddings

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]

print(f"📦 正在处理 {len(documents)} 条数据生成向量...")
embeddings = NativeDashScopeEmbeddings(key=api_key)

# 4. 生成 ChromaDB 文件
chroma_dir = ROOT_DIR / "data" / "chroma_db"
vectorstore = Chroma.from_texts(
    texts=documents,
    embedding=embeddings,
    metadatas=metadatas,
    persist_directory=str(chroma_dir)
)

print(f"🎉 成功！Chromadb 已成功生成在: {chroma_dir}")