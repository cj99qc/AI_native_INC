# CREATE FILE: services/rag_agent/app.py

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import json
import os
import numpy as np
from datetime import datetime

# Import the new hybrid retrieval system
from .retrieval import HybridRetriever, DocumentMatch as RetrievalMatch

app = FastAPI(title="RAG Agent Service", version="2.0.0")

class DocumentRequest(BaseModel):
    docs: List[Dict[str, Any]] = Field(..., description="List of documents to ingest")
    chunk_size: int = Field(512, ge=100, le=2000)
    chunk_overlap: int = Field(64, ge=0, le=500)

class IngestDocumentRequest(BaseModel):
    content_id: str
    content_type: str = Field(..., description="Type of content: order, driver, location, policy")
    text: str
    metadata: Optional[Dict[str, Any]] = None

class QueryRequest(BaseModel):
    q: str = Field(..., description="Query text")
    top_k: int = Field(5, ge=1, le=20)
    use_bm25: bool = Field(True, description="Use BM25 search component")
    rerank: bool = Field(False, description="Apply cross-encoder reranking")
    filters: Optional[Dict[str, Any]] = Field(None, description="Content filters")

class DocumentMatch(BaseModel):
    id: str
    score: float
    source: str
    text_snippet: str
    metadata: Dict[str, Any]

class QueryResponse(BaseModel):
    results: List[DocumentMatch]
    sources: List[str]
    processing_time_ms: Optional[int] = None

class IngestResponse(BaseModel):
    ingested: int
    task_id: str

class IndexStatusResponse(BaseModel):
    document_count: int
    index_type: str
    features_enabled: Dict[str, bool]
    last_updated: str

def load_config():
    """Load RAG configuration"""
    config_path = os.path.join(os.path.dirname(__file__), '../../config/defaults.json')
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
            return config.get('rag', {})
    except FileNotFoundError:
        # Fallback defaults
        return {
            "embedding_model": "sentence-transformers/all-MiniLM-L6-v2",
            "embedding_dim": 384,
            "top_k_results": 5,
            "similarity_threshold": 0.7,
            "use_hybrid": True,
            "use_reranker": False,
            "bm25_weight": 0.3,
            "vector_weight": 0.7
        }

# Initialize RAG engine
config = load_config()
retriever = HybridRetriever(config)

def chunk_text(text: str, chunk_size: int = 512, chunk_overlap: int = 64) -> List[str]:
    """Split text into overlapping chunks"""
    if len(text) <= chunk_size:
        return [text]
    
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        chunk = text[start:end]
        
        # Try to break at sentence boundary
        if end < len(text):
            last_period = chunk.rfind('.')
            last_newline = chunk.rfind('\n')
            last_break = max(last_period, last_newline)
            if last_break > start + chunk_size // 2:
                end = start + last_break + 1
                chunk = text[start:end]
        
        chunks.append(chunk.strip())
        start = end - chunk_overlap
        if start >= len(text):
            break
    
    return chunks

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "rag_agent",
        "version": "2.0.0",
        "features": retriever.get_stats()
    }

@app.post("/ingest", response_model=IngestResponse)
async def ingest_documents(request: DocumentRequest):
    """
    Ingest documents into the RAG system.
    
    Converts text to embeddings and adds to both BM25 and vector indexes.
    """
    try:
        task_id = f"ingest_{int(datetime.now().timestamp())}"
        ingested_count = 0
        
        for doc in request.docs:
            content_id = doc.get("id")
            text = doc.get("text", "")
            metadata = doc.get("metadata", {})
            content_type = metadata.get("content_type", "document")
            
            if not content_id or not text:
                continue
            
            # Chunk the document if it's large
            chunks = chunk_text(text, request.chunk_size, request.chunk_overlap)
            
            for i, chunk in enumerate(chunks):
                chunk_id = f"{content_id}_chunk_{i}" if len(chunks) > 1 else content_id
                chunk_metadata = {
                    **metadata,
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                    "parent_id": content_id
                }
                
                retriever.add_document(
                    content_id=chunk_id,
                    content_type=content_type,
                    text=chunk,
                    metadata=chunk_metadata
                )
                ingested_count += 1
        
        return IngestResponse(
            ingested=ingested_count,
            task_id=task_id
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Document ingestion failed: {str(e)}")

@app.post("/ingest_single")
async def ingest_single_document(request: IngestDocumentRequest):
    """
    Ingest a single document into the RAG system (legacy endpoint for backward compatibility).
    """
    try:
        retriever.add_document(
            content_id=request.content_id,
            content_type=request.content_type,
            text=request.text,
            metadata=request.metadata or {}
        )
        
        return {
            "success": True,
            "content_id": request.content_id,
            "content_type": request.content_type,
            "message": "Document ingested successfully"
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Document ingestion failed: {str(e)}")

@app.post("/query", response_model=QueryResponse)
async def query_documents(request: QueryRequest):
    """
    Query the RAG system for relevant documents.
    
    Uses hybrid search (BM25 + vector similarity) with optional reranking.
    """
    try:
        start_time = datetime.now()
        
        # Apply filters if specified
        # Note: This is a simplified filter implementation
        # In production, you'd want more sophisticated filtering
        
        # Search for relevant documents using hybrid retrieval
        matches = retriever.search(
            query=request.q,
            top_k=request.top_k,
            use_bm25=request.use_bm25,
            use_vector=True,  # Always use vector search
            rerank=request.rerank
        )
        
        # Convert to API response format
        results = []
        sources = set()
        
        for match in matches:
            results.append(DocumentMatch(
                id=match.content_id,
                score=match.score,
                source=match.content_type,
                text_snippet=match.text[:300] + "..." if len(match.text) > 300 else match.text,
                metadata=match.metadata
            ))
            sources.add(match.content_type)
        
        end_time = datetime.now()
        processing_time = int((end_time - start_time).total_seconds() * 1000)
        
        return QueryResponse(
            results=results,
            sources=list(sources),
            processing_time_ms=processing_time
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query processing failed: {str(e)}")

@app.get("/index_status", response_model=IndexStatusResponse)
async def get_index_status():
    """Get the current status of the RAG indexes"""
    try:
        stats = retriever.get_stats()
        
        return IndexStatusResponse(
            document_count=stats.get("document_count", 0),
            index_type=stats.get("store_type", "unknown"),
            features_enabled={
                "bm25": stats.get("bm25_available", False),
                "vector_search": stats.get("vector_available", False),
                "qdrant": stats.get("qdrant_available", False),
                "reranker": stats.get("reranker_available", False),
                "pii_redaction": stats.get("pii_redaction_enabled", False),
                "rag_v2": stats.get("feature_rag_v2_enabled", False)
            },
            last_updated=datetime.now().isoformat()
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Status check failed: {str(e)}")

# Legacy endpoint for backward compatibility
@app.post("/query_legacy")
async def query_documents_legacy(request: dict):
    """Legacy query endpoint for backward compatibility"""
    try:
        query_text = request.get("query", "")
        top_k = request.get("top_k", 5)
        content_types = request.get("content_types")
        
        # Convert to new format
        query_request = QueryRequest(
            q=query_text,
            top_k=top_k,
            use_bm25=True,
            rerank=False
        )
        
        response = await query_documents(query_request)
        
        # Convert back to legacy format
        return {
            "query": query_text,
            "matches": [
                {
                    "content_id": result.id,
                    "content_type": result.source,
                    "text": result.text_snippet,
                    "similarity_score": result.score,
                    "metadata": result.metadata
                }
                for result in response.results
            ],
            "llm_response": f"Found {len(response.results)} relevant documents for your query.",
            "processing_time_ms": response.processing_time_ms
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Legacy query failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8005"))
    uvicorn.run(app, host="0.0.0.0", port=port)

