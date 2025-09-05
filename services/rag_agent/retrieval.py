# CREATE FILE: services/rag_agent/retrieval.py

from typing import List, Dict, Any, Optional, Tuple
import numpy as np
import os
import json
from datetime import datetime
import re

# Conditional imports for different search backends
try:
    from whoosh.index import create_index, open_dir, exists_in
    from whoosh.fields import Schema, TEXT, ID, DATETIME, KEYWORD
    from whoosh.analysis import StandardAnalyzer
    from whoosh.qparser import QueryParser
    from whoosh import scoring
    WHOOSH_AVAILABLE = True
except ImportError:
    WHOOSH_AVAILABLE = False

try:
    from sentence_transformers import SentenceTransformer, CrossEncoder
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    SENTENCE_TRANSFORMERS_AVAILABLE = False

try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False

try:
    from qdrant_client import QdrantClient
    from qdrant_client.http.models import Distance, VectorParams, PointStruct
    QDRANT_AVAILABLE = True
except ImportError:
    QDRANT_AVAILABLE = False


class DocumentMatch:
    """Document match result with metadata"""
    def __init__(self, content_id: str, content_type: str, text: str, 
                 score: float, metadata: Dict[str, Any] = None):
        self.content_id = content_id
        self.content_type = content_type
        self.text = text
        self.score = score
        self.metadata = metadata or {}


class PIIRedactor:
    """Redact PII from text before embedding"""
    
    def __init__(self, enabled: bool = True):
        self.enabled = enabled
        # Basic PII patterns
        self.patterns = {
            'email': re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'),
            'phone': re.compile(r'\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b'),
            'ssn': re.compile(r'\b\d{3}-?\d{2}-?\d{4}\b'),
            'credit_card': re.compile(r'\b(?:\d{4}[-\s]?){3}\d{4}\b'),
        }
    
    def redact(self, text: str) -> str:
        """Redact PII from text"""
        if not self.enabled:
            return text
            
        redacted = text
        for pii_type, pattern in self.patterns.items():
            redacted = pattern.sub(f'[REDACTED_{pii_type.upper()}]', redacted)
        
        return redacted


class MockBM25:
    """Mock BM25 implementation when Whoosh is not available"""
    
    def __init__(self):
        self.documents = {}
        print("Warning: Using mock BM25. Install whoosh for real BM25 search.")
    
    def add_document(self, content_id: str, content_type: str, text: str, metadata: Dict[str, Any]):
        self.documents[content_id] = {
            'text': text.lower(),
            'content_type': content_type,
            'metadata': metadata
        }
    
    def search(self, query: str, top_k: int = 5) -> List[DocumentMatch]:
        """Simple term matching for mock BM25"""
        query_terms = set(query.lower().split())
        results = []
        
        for content_id, doc in self.documents.items():
            doc_terms = set(doc['text'].split())
            overlap = len(query_terms.intersection(doc_terms))
            if overlap > 0:
                # Simple scoring based on term overlap
                score = overlap / len(query_terms)
                results.append(DocumentMatch(
                    content_id=content_id,
                    content_type=doc.get('content_type', 'unknown'),
                    text=doc['text'][:200] + '...' if len(doc['text']) > 200 else doc['text'],
                    score=score,
                    metadata=doc.get('metadata', {})
                ))
        
        # Sort by score and return top_k
        results.sort(key=lambda x: x.score, reverse=True)
        return results[:top_k]


class WhoooshBM25:
    """Whoosh-based BM25 implementation"""
    
    def __init__(self, index_dir: str = "/tmp/rag_index"):
        self.index_dir = index_dir
        self.schema = Schema(
            content_id=ID(stored=True),
            content_type=KEYWORD(stored=True),
            text=TEXT(stored=True, analyzer=StandardAnalyzer()),
            metadata=TEXT(stored=True)  # JSON string
        )
        
        # Create or open index
        if not os.path.exists(index_dir):
            os.makedirs(index_dir)
        
        if exists_in(index_dir):
            self.index = open_dir(index_dir)
        else:
            self.index = create_index(index_dir, self.schema)
    
    def add_document(self, content_id: str, content_type: str, text: str, metadata: Dict[str, Any]):
        """Add document to BM25 index"""
        writer = self.index.writer()
        writer.add_document(
            content_id=content_id,
            content_type=content_type,
            text=text,
            metadata=json.dumps(metadata)
        )
        writer.commit()
    
    def search(self, query: str, top_k: int = 5) -> List[DocumentMatch]:
        """Search using BM25 scoring"""
        with self.index.searcher(weighting=scoring.BM25F()) as searcher:
            query_parser = QueryParser("text", self.index.schema)
            parsed_query = query_parser.parse(query)
            
            results = searcher.search(parsed_query, limit=top_k)
            matches = []
            
            for result in results:
                metadata = json.loads(result['metadata']) if result['metadata'] else {}
                matches.append(DocumentMatch(
                    content_id=result['content_id'],
                    content_type=result['content_type'],
                    text=result['text'],
                    score=result.score,
                    metadata=metadata
                ))
            
            return matches


class VectorStore:
    """Vector storage abstraction (FAISS or Qdrant)"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.embedding_dim = config.get("embedding_dim", 384)
        self.vector_db = config.get("vector_db", "faiss").lower()
        
        if self.vector_db == "qdrant" and QDRANT_AVAILABLE:
            self._init_qdrant()
        elif FAISS_AVAILABLE:
            self._init_faiss()
        else:
            self._init_mock()
    
    def _init_qdrant(self):
        """Initialize Qdrant client"""
        try:
            self.client = QdrantClient(host="localhost", port=6333)
            self.collection_name = "documents"
            
            # Create collection if it doesn't exist
            try:
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(
                        size=self.embedding_dim,
                        distance=Distance.COSINE
                    )
                )
            except Exception:
                pass  # Collection already exists
            
            self.store_type = "qdrant"
            print("Using Qdrant vector store")
        except Exception as e:
            print(f"Failed to initialize Qdrant: {e}, falling back to FAISS")
            self._init_faiss()
    
    def _init_faiss(self):
        """Initialize FAISS index"""
        self.index = faiss.IndexFlatIP(self.embedding_dim)
        self.content_ids = []
        self.documents = {}
        self.store_type = "faiss"
        print("Using FAISS vector store")
    
    def _init_mock(self):
        """Initialize mock vector store"""
        self.documents = {}
        self.embeddings = []
        self.content_ids = []
        self.store_type = "mock"
        print("Using mock vector store")
    
    def add_document(self, content_id: str, embedding: np.ndarray, 
                    content_type: str, text: str, metadata: Dict[str, Any]):
        """Add document to vector store"""
        if self.store_type == "qdrant":
            point = PointStruct(
                id=content_id,
                vector=embedding.tolist(),
                payload={
                    "content_type": content_type,
                    "text": text,
                    "metadata": metadata
                }
            )
            self.client.upsert(collection_name=self.collection_name, points=[point])
        
        elif self.store_type == "faiss":
            # Normalize for cosine similarity
            embedding = embedding / np.linalg.norm(embedding)
            self.index.add(embedding.reshape(1, -1))
            self.content_ids.append(content_id)
            self.documents[content_id] = {
                "content_type": content_type,
                "text": text,
                "metadata": metadata
            }
        
        else:  # mock
            self.embeddings.append(embedding)
            self.content_ids.append(content_id)
            self.documents[content_id] = {
                "content_type": content_type,
                "text": text,
                "metadata": metadata
            }
    
    def search(self, query_embedding: np.ndarray, top_k: int = 5) -> List[DocumentMatch]:
        """Search for similar documents"""
        if self.store_type == "qdrant":
            results = self.client.search(
                collection_name=self.collection_name,
                query_vector=query_embedding.tolist(),
                limit=top_k
            )
            
            matches = []
            for result in results:
                matches.append(DocumentMatch(
                    content_id=str(result.id),
                    content_type=result.payload.get("content_type", "unknown"),
                    text=result.payload.get("text", ""),
                    score=result.score,
                    metadata=result.payload.get("metadata", {})
                ))
            return matches
        
        elif self.store_type == "faiss" and len(self.content_ids) > 0:
            # Normalize query
            query_embedding = query_embedding / np.linalg.norm(query_embedding)
            scores, indices = self.index.search(query_embedding.reshape(1, -1), top_k)
            
            matches = []
            for score, idx in zip(scores[0], indices[0]):
                if idx < len(self.content_ids):
                    content_id = self.content_ids[idx]
                    doc = self.documents[content_id]
                    matches.append(DocumentMatch(
                        content_id=content_id,
                        content_type=doc["content_type"],
                        text=doc["text"],
                        score=float(score),
                        metadata=doc["metadata"]
                    ))
            return matches
        
        else:  # mock
            if not self.embeddings:
                return []
            
            # Simple cosine similarity
            similarities = []
            for i, doc_embedding in enumerate(self.embeddings):
                similarity = np.dot(query_embedding, doc_embedding) / (
                    np.linalg.norm(query_embedding) * np.linalg.norm(doc_embedding)
                )
                similarities.append((similarity, i))
            
            # Sort by similarity and take top_k
            similarities.sort(reverse=True)
            matches = []
            for similarity, idx in similarities[:top_k]:
                content_id = self.content_ids[idx]
                doc = self.documents[content_id]
                matches.append(DocumentMatch(
                    content_id=content_id,
                    content_type=doc["content_type"],
                    text=doc["text"],
                    score=float(similarity),
                    metadata=doc["metadata"]
                ))
            
            return matches


class HybridRetriever:
    """Hybrid retrieval combining BM25 and vector search with reranking"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.use_hybrid = config.get("use_hybrid", True)
        self.bm25_weight = config.get("bm25_weight", 0.3)
        self.vector_weight = config.get("vector_weight", 0.7)
        self.top_k_bm25 = config.get("top_k_bm25", 20)
        self.top_k_vector = config.get("top_k_vector", 20)
        self.final_top_k = config.get("top_k_results", 5)
        
        # Initialize PII redactor
        pii_redaction = os.getenv("PII_REDACTION", "true").lower() == "true"
        self.pii_redactor = PIIRedactor(enabled=pii_redaction)
        
        # Initialize BM25 search
        if WHOOSH_AVAILABLE and self.use_hybrid:
            self.bm25 = WhoooshBM25()
        else:
            self.bm25 = MockBM25()
        
        # Initialize vector store
        self.vector_store = VectorStore(config)
        
        # Initialize embedding model
        if SENTENCE_TRANSFORMERS_AVAILABLE:
            model_name = config.get("embedding_model", "sentence-transformers/all-MiniLM-L6-v2")
            try:
                self.embedding_model = SentenceTransformer(model_name)
                print(f"Loaded embedding model: {model_name}")
            except Exception as e:
                print(f"Failed to load embedding model: {e}")
                self.embedding_model = None
        else:
            self.embedding_model = None
            print("Sentence transformers not available, using mock embeddings")
        
        # Initialize reranker (optional)
        self.reranker = None
        if SENTENCE_TRANSFORMERS_AVAILABLE and config.get("use_reranker", False):
            try:
                reranker_model = config.get("reranker_model", "cross-encoder/ms-marco-MiniLM-L-6-v2")
                self.reranker = CrossEncoder(reranker_model)
                print(f"Loaded reranker model: {reranker_model}")
            except Exception as e:
                print(f"Failed to load reranker: {e}")
    
    def _encode_text(self, text: str) -> np.ndarray:
        """Encode text to embedding"""
        if self.embedding_model:
            return self.embedding_model.encode([text])[0]
        else:
            # Mock embedding
            hash_val = hash(text) % (2**31)
            np.random.seed(hash_val % 10000)
            embedding = np.random.normal(0, 1, self.config.get("embedding_dim", 384))
            return embedding / np.linalg.norm(embedding)
    
    def add_document(self, content_id: str, content_type: str, text: str, metadata: Dict[str, Any] = None):
        """Add document to both BM25 and vector indexes"""
        metadata = metadata or {}
        
        # Redact PII before processing
        clean_text = self.pii_redactor.redact(text)
        
        # Add to BM25 index
        self.bm25.add_document(content_id, content_type, clean_text, metadata)
        
        # Add to vector store
        embedding = self._encode_text(clean_text)
        self.vector_store.add_document(content_id, embedding, content_type, clean_text, metadata)
    
    def search(self, query: str, top_k: int = None, use_bm25: bool = True, 
              use_vector: bool = True, rerank: bool = False) -> List[DocumentMatch]:
        """Hybrid search combining BM25 and vector similarity"""
        top_k = top_k or self.final_top_k
        
        # Check feature flag for RAG v2
        use_rag_v2 = os.getenv("FEATURE_RAG_V2", "false").lower() == "true"
        if not use_rag_v2:
            # Fall back to simple vector search only
            use_bm25 = False
            use_vector = True
            rerank = False
        
        all_matches = {}  # content_id -> DocumentMatch
        
        # BM25 search
        if use_bm25:
            try:
                bm25_matches = self.bm25.search(query, self.top_k_bm25)
                for match in bm25_matches:
                    if match.content_id not in all_matches:
                        all_matches[match.content_id] = match
                        all_matches[match.content_id].score *= self.bm25_weight
                    else:
                        # Combine scores
                        all_matches[match.content_id].score += match.score * self.bm25_weight
            except Exception as e:
                print(f"BM25 search failed: {e}")
        
        # Vector search
        if use_vector:
            try:
                query_embedding = self._encode_text(query)
                vector_matches = self.vector_store.search(query_embedding, self.top_k_vector)
                for match in vector_matches:
                    if match.content_id not in all_matches:
                        all_matches[match.content_id] = match
                        all_matches[match.content_id].score *= self.vector_weight
                    else:
                        # Combine scores
                        all_matches[match.content_id].score += match.score * self.vector_weight
            except Exception as e:
                print(f"Vector search failed: {e}")
        
        # Convert to list and sort
        results = list(all_matches.values())
        
        # Ensure scores are non-negative (normalize if needed)
        if results:
            min_score = min(result.score for result in results)
            if min_score < 0:
                # Shift all scores to be non-negative
                for result in results:
                    result.score = result.score - min_score
        
        results.sort(key=lambda x: x.score, reverse=True)
        
        # Take top candidates for reranking
        candidates = results[:top_k * 2] if rerank else results[:top_k]
        
        # Rerank if enabled and reranker available
        if rerank and self.reranker and len(candidates) > 1:
            try:
                # Prepare pairs for cross-encoder
                pairs = [(query, match.text) for match in candidates]
                rerank_scores = self.reranker.predict(pairs)
                
                # Update scores
                for match, score in zip(candidates, rerank_scores):
                    match.score = float(score)
                
                # Resort by new scores
                candidates.sort(key=lambda x: x.score, reverse=True)
            except Exception as e:
                print(f"Reranking failed: {e}")
        
        return candidates[:top_k]
    
    def get_stats(self) -> Dict[str, Any]:
        """Get retrieval statistics"""
        stats = {
            "store_type": self.vector_store.store_type,
            "bm25_available": WHOOSH_AVAILABLE,
            "vector_available": SENTENCE_TRANSFORMERS_AVAILABLE,
            "qdrant_available": QDRANT_AVAILABLE,
            "reranker_available": self.reranker is not None,
            "pii_redaction_enabled": self.pii_redactor.enabled,
            "feature_rag_v2_enabled": os.getenv("FEATURE_RAG_V2", "false").lower() == "true"
        }
        
        if self.vector_store.store_type == "faiss":
            stats["document_count"] = len(self.vector_store.content_ids)
        elif self.vector_store.store_type == "mock":
            stats["document_count"] = len(self.vector_store.content_ids)
        else:
            stats["document_count"] = "unknown"
        
        return stats