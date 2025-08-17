# CREATE FILE: services/rag_agent/app.py

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import json
import os
import numpy as np
from datetime import datetime

# Conditional imports for embeddings and vector storage
try:
    from sentence_transformers import SentenceTransformer
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    SENTENCE_TRANSFORMERS_AVAILABLE = False

try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False

app = FastAPI(title="RAG Agent Service", version="1.0.0")

class DocumentRequest(BaseModel):
    content_id: str
    content_type: str = Field(..., description="Type of content: order, driver, location, policy")
    text: str
    metadata: Optional[Dict[str, Any]] = None

class QueryRequest(BaseModel):
    query: str
    content_types: Optional[List[str]] = None
    top_k: int = Field(5, ge=1, le=20)
    similarity_threshold: float = Field(0.7, ge=0.0, le=1.0)

class DocumentMatch(BaseModel):
    content_id: str
    content_type: str
    text: str
    similarity_score: float
    metadata: Dict[str, Any]

class QueryResponse(BaseModel):
    query: str
    matches: List[DocumentMatch]
    llm_response: str
    processing_time_ms: int

class MockEmbeddingModel:
    """Mock embedding model for when sentence-transformers is not available"""
    
    def __init__(self):
        self.embedding_dim = 384
        print("Warning: Using mock embedding model. Install sentence-transformers for real embeddings.")
    
    def encode(self, texts: List[str]) -> np.ndarray:
        """Generate mock embeddings"""
        # Generate deterministic fake embeddings based on text hash
        embeddings = []
        for text in texts:
            # Simple hash-based embedding for consistency
            hash_val = hash(text) % (2**31)
            np.random.seed(hash_val % 10000)  # Deterministic seed
            embedding = np.random.normal(0, 1, self.embedding_dim)
            # Normalize
            embedding = embedding / np.linalg.norm(embedding)
            embeddings.append(embedding)
        
        return np.array(embeddings)

class RAGEngine:
    """RAG engine with embedding-based document retrieval"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.embedding_dim = config.get("embedding_dim", 384)
        self.top_k = config.get("top_k_results", 5)
        self.similarity_threshold = config.get("similarity_threshold", 0.7)
        
        # Initialize embedding model
        if SENTENCE_TRANSFORMERS_AVAILABLE:
            model_name = config.get("embedding_model", "sentence-transformers/all-MiniLM-L6-v2")
            try:
                self.embedding_model = SentenceTransformer(model_name)
                print(f"Loaded embedding model: {model_name}")
            except Exception as e:
                print(f"Failed to load {model_name}, using mock model: {e}")
                self.embedding_model = MockEmbeddingModel()
        else:
            self.embedding_model = MockEmbeddingModel()
        
        # Initialize vector storage
        self.documents = {}  # content_id -> document data
        self.index = None
        self.content_ids = []  # Map index positions to content_ids
        
        if FAISS_AVAILABLE:
            self.index = faiss.IndexFlatIP(self.embedding_dim)  # Inner product for cosine similarity
            self.use_faiss = True
            print("Using FAISS for vector search")
        else:
            self.use_faiss = False
            self.embeddings = []  # Store embeddings manually
            print("FAISS not available, using manual vector search")
    
    def add_document(self, content_id: str, content_type: str, text: str, 
                    metadata: Optional[Dict[str, Any]] = None) -> bool:
        """Add a document to the vector index"""
        try:
            # Generate embedding
            embedding = self.embedding_model.encode([text])[0]
            
            # Normalize for cosine similarity
            embedding = embedding / np.linalg.norm(embedding)
            
            # Store document
            doc_data = {
                "content_id": content_id,
                "content_type": content_type,
                "text": text,
                "metadata": metadata or {},
                "embedding": embedding,
                "added_at": datetime.now().isoformat()
            }
            
            if self.use_faiss:
                # Add to FAISS index
                if content_id in self.documents:
                    # Update existing document
                    idx = self.content_ids.index(content_id)
                    # FAISS doesn't support updates, so we'd need to rebuild
                    # For simplicity, we'll just add it as new
                    pass
                
                self.index.add(embedding.reshape(1, -1))
                self.content_ids.append(content_id)
                
            else:
                # Manual storage
                if content_id in self.documents:
                    # Update existing
                    idx = next(i for i, cid in enumerate(self.content_ids) if cid == content_id)
                    self.embeddings[idx] = embedding
                else:
                    # Add new
                    self.embeddings.append(embedding)
                    self.content_ids.append(content_id)
            
            self.documents[content_id] = doc_data
            return True
            
        except Exception as e:
            print(f"Error adding document {content_id}: {e}")
            return False
    
    def search_documents(self, query: str, content_types: Optional[List[str]] = None,
                        top_k: int = 5, similarity_threshold: float = 0.7) -> List[DocumentMatch]:
        """Search for similar documents"""
        if not self.documents:
            return []
        
        try:
            # Generate query embedding
            query_embedding = self.embedding_model.encode([query])[0]
            query_embedding = query_embedding / np.linalg.norm(query_embedding)
            
            if self.use_faiss and self.index.ntotal > 0:
                # FAISS search
                similarities, indices = self.index.search(query_embedding.reshape(1, -1), min(top_k * 2, self.index.ntotal))
                
                matches = []
                for sim, idx in zip(similarities[0], indices[0]):
                    if idx >= len(self.content_ids):
                        continue
                    
                    content_id = self.content_ids[idx]
                    doc = self.documents[content_id]
                    
                    # Filter by content type
                    if content_types and doc["content_type"] not in content_types:
                        continue
                    
                    # Filter by similarity threshold
                    if sim < similarity_threshold:
                        continue
                    
                    matches.append(DocumentMatch(
                        content_id=doc["content_id"],
                        content_type=doc["content_type"],
                        text=doc["text"],
                        similarity_score=float(sim),
                        metadata=doc["metadata"]
                    ))
                    
                    if len(matches) >= top_k:
                        break
                
            else:
                # Manual search
                similarities = []
                for i, (content_id, doc) in enumerate(self.documents.items()):
                    # Filter by content type
                    if content_types and doc["content_type"] not in content_types:
                        continue
                    
                    # Calculate cosine similarity
                    doc_embedding = doc["embedding"]
                    similarity = np.dot(query_embedding, doc_embedding)
                    
                    if similarity >= similarity_threshold:
                        similarities.append((similarity, content_id, doc))
                
                # Sort by similarity and take top k
                similarities.sort(key=lambda x: x[0], reverse=True)
                
                matches = []
                for sim, content_id, doc in similarities[:top_k]:
                    matches.append(DocumentMatch(
                        content_id=doc["content_id"],
                        content_type=doc["content_type"],
                        text=doc["text"],
                        similarity_score=float(sim),
                        metadata=doc["metadata"]
                    ))
            
            return matches
            
        except Exception as e:
            print(f"Error searching documents: {e}")
            return []
    
    def generate_response(self, query: str, context_matches: List[DocumentMatch]) -> str:
        """Generate LLM response using retrieved context"""
        if not context_matches:
            return "I don't have enough information to answer that question based on the available documents."
        
        # Build context from matches
        context_parts = []
        for match in context_matches:
            context_parts.append(f"[{match.content_type.upper()}] {match.text}")
        
        context = "\n\n".join(context_parts)
        
        # For this implementation, we'll return a structured response
        # In a real implementation, you'd call an LLM API here
        response_parts = [
            f"Based on the available information, here's what I found:",
            "",
            f"Query: {query}",
            "",
            "Relevant context:",
        ]
        
        for i, match in enumerate(context_matches, 1):
            response_parts.append(f"{i}. [{match.content_type}] {match.text[:200]}...")
            response_parts.append(f"   Similarity: {match.similarity_score:.2f}")
        
        response_parts.extend([
            "",
            "Note: This is a mock response. In a production system, this would be generated by an LLM like GPT-4 or Claude using the retrieved context."
        ])
        
        return "\n".join(response_parts)

def load_config():
    """Load RAG configuration"""
    config_path = os.path.join(os.path.dirname(__file__), '../../config/defaults.json')
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
            return config.get("rag", {
                "embedding_model": "sentence-transformers/all-MiniLM-L6-v2",
                "embedding_dim": 384,
                "top_k_results": 5,
                "similarity_threshold": 0.7
            })
    except FileNotFoundError:
        return {
            "embedding_model": "sentence-transformers/all-MiniLM-L6-v2",
            "embedding_dim": 384,
            "top_k_results": 5,
            "similarity_threshold": 0.7
        }

config = load_config()
rag_engine = RAGEngine(config)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"ok": True}

@app.post("/ingest")
async def ingest_document(request: DocumentRequest):
    """
    Ingest a document into the RAG system.
    
    Converts text to embeddings and adds to the vector index for future retrieval.
    """
    try:
        success = rag_engine.add_document(
            request.content_id,
            request.content_type,
            request.text,
            request.metadata
        )
        
        if success:
            return {
                "success": True,
                "content_id": request.content_id,
                "content_type": request.content_type,
                "message": "Document ingested successfully"
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to ingest document")
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Document ingestion failed: {str(e)}")

@app.post("/query", response_model=QueryResponse)
async def query_documents(request: QueryRequest):
    """
    Query the RAG system for relevant documents and generate a response.
    
    Uses semantic search to find similar documents and generates a response
    based on the retrieved context.
    """
    try:
        start_time = datetime.now()
        
        # Search for relevant documents
        matches = rag_engine.search_documents(
            request.query,
            request.content_types,
            request.top_k,
            request.similarity_threshold
        )
        
        # Generate LLM response
        llm_response = rag_engine.generate_response(request.query, matches)
        
        end_time = datetime.now()
        processing_time = int((end_time - start_time).total_seconds() * 1000)
        
        return QueryResponse(
            query=request.query,
            matches=matches,
            llm_response=llm_response,
            processing_time_ms=processing_time
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query processing failed: {str(e)}")

@app.get("/stats")
async def get_stats():
    """Get RAG system statistics"""
    try:
        total_docs = len(rag_engine.documents)
        content_type_counts = {}
        
        for doc in rag_engine.documents.values():
            content_type = doc["content_type"]
            content_type_counts[content_type] = content_type_counts.get(content_type, 0) + 1
        
        return {
            "total_documents": total_docs,
            "content_type_breakdown": content_type_counts,
            "embedding_model": config.get("embedding_model", "mock"),
            "vector_storage": "faiss" if rag_engine.use_faiss else "manual",
            "embedding_dimension": rag_engine.embedding_dim
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stats retrieval failed: {str(e)}")

@app.delete("/documents/{content_id}")
async def delete_document(content_id: str):
    """Delete a document from the RAG system"""
    try:
        if content_id in rag_engine.documents:
            # Remove from documents dict
            del rag_engine.documents[content_id]
            
            # For FAISS, we'd need to rebuild the index to remove items
            # For simplicity, we'll just mark it as deleted
            # In a production system, you'd want to implement proper deletion
            
            return {
                "success": True,
                "content_id": content_id,
                "message": "Document deleted successfully"
            }
        else:
            raise HTTPException(status_code=404, detail="Document not found")
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Document deletion failed: {str(e)}")

@app.get("/config")
async def get_config():
    """Get current RAG configuration"""
    return config

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8005"))
    uvicorn.run(app, host="0.0.0.0", port=port)