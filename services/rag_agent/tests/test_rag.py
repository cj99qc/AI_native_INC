# CREATE FILE: services/rag_agent/tests/test_rag.py

import pytest
import os
import sys
import json
from unittest.mock import patch, MagicMock

# Add the parent directory to sys.path to import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from retrieval import HybridRetriever, DocumentMatch, PIIRedactor, VectorStore
import numpy as np


class TestPIIRedactor:
    """Test PII redaction functionality"""
    
    def test_email_redaction(self):
        redactor = PIIRedactor(enabled=True)
        text = "Contact john.doe@example.com for support"
        result = redactor.redact(text)
        assert "[REDACTED_EMAIL]" in result
        assert "john.doe@example.com" not in result
    
    def test_phone_redaction(self):
        redactor = PIIRedactor(enabled=True)
        text = "Call us at 555-123-4567 or (555) 987-6543"
        result = redactor.redact(text)
        assert "[REDACTED_PHONE]" in result
        assert "555-123-4567" not in result
    
    def test_disabled_redaction(self):
        redactor = PIIRedactor(enabled=False)
        text = "Contact john.doe@example.com at 555-123-4567"
        result = redactor.redact(text)
        assert result == text  # No redaction when disabled


class TestVectorStore:
    """Test vector store functionality"""
    
    @pytest.fixture
    def config(self):
        return {
            "embedding_dim": 384,
            "vector_db": "mock"  # Force mock for testing
        }
    
    def test_mock_vector_store_init(self, config):
        store = VectorStore(config)
        assert store.store_type == "mock"
        assert store.embedding_dim == 384
    
    def test_add_and_search_document(self, config):
        store = VectorStore(config)
        
        # Add a document
        embedding = np.random.normal(0, 1, 384)
        embedding = embedding / np.linalg.norm(embedding)
        
        store.add_document(
            content_id="doc1",
            embedding=embedding,
            content_type="test",
            text="This is a test document",
            metadata={"source": "test"}
        )
        
        # Search for the exact same document (should have high similarity)
        results = store.search(embedding, top_k=5)
        
        assert len(results) == 1
        assert results[0].content_id == "doc1"
        assert results[0].score > 0.99  # Should be very high similarity for exact match


class TestHybridRetriever:
    """Test hybrid retrieval functionality"""
    
    @pytest.fixture
    def config(self):
        return {
            "embedding_dim": 384,
            "top_k_results": 5,
            "use_hybrid": True,
            "bm25_weight": 0.3,
            "vector_weight": 0.7,
            "vector_db": "mock",
            "embedding_model": "mock"
        }
    
    @pytest.fixture
    def retriever(self, config):
        # Mock environment variables
        with patch.dict(os.environ, {"PII_REDACTION": "false", "FEATURE_RAG_V2": "true"}):
            return HybridRetriever(config)
    
    def test_add_document(self, retriever):
        """Test adding a document to the retriever"""
        retriever.add_document(
            content_id="test_doc_1",
            content_type="order",
            text="This is a test order document about pizza delivery",
            metadata={"vendor": "Pizza Palace", "location": "downtown"}
        )
        
        # Verify document was added to BM25
        assert "test_doc_1" in retriever.bm25.documents
        
        # Verify document was added to vector store
        assert "test_doc_1" in retriever.vector_store.documents
    
    def test_search_with_feature_flag_off(self, config):
        """Test that search falls back to vector-only when RAG v2 is disabled"""
        with patch.dict(os.environ, {"FEATURE_RAG_V2": "false"}):
            retriever = HybridRetriever(config)
            
            # Add test documents
            test_docs = [
                ("doc1", "order", "Pizza delivery to downtown"),
                ("doc2", "driver", "Driver available in downtown area"),
                ("doc3", "location", "Downtown restaurant location")
            ]
            
            for doc_id, content_type, text in test_docs:
                retriever.add_document(doc_id, content_type, text)
            
            # Search should work but only use vector search
            results = retriever.search("pizza downtown", top_k=3)
            
            assert len(results) <= 3
            assert all(isinstance(result, DocumentMatch) for result in results)
    
    def test_search_with_rag_v2_enabled(self, retriever):
        """Test hybrid search when RAG v2 is enabled"""
        # Add test documents
        test_docs = [
            ("doc1", "order", "Pizza delivery to downtown location"),
            ("doc2", "driver", "Driver available for pizza deliveries"),
            ("doc3", "location", "Downtown pizza restaurant")
        ]
        
        for doc_id, content_type, text in test_docs:
            retriever.add_document(doc_id, content_type, text)
        
        # Test basic search
        results = retriever.search("pizza delivery", top_k=2)
        
        assert len(results) <= 2
        assert all(isinstance(result, DocumentMatch) for result in results)
        assert all(result.score >= 0 for result in results)
    
    def test_search_with_bm25_only(self, retriever):
        """Test search using only BM25"""
        # Add test documents
        retriever.add_document("doc1", "order", "pizza delivery order")
        retriever.add_document("doc2", "driver", "driver pickup pizza")
        
        results = retriever.search("pizza", use_bm25=True, use_vector=False)
        
        assert len(results) <= 2
        # Both documents should match "pizza"
        assert any("pizza" in result.text.lower() for result in results)
    
    def test_search_with_vector_only(self, retriever):
        """Test search using only vector similarity"""
        # Add test documents
        retriever.add_document("doc1", "order", "food delivery service")
        retriever.add_document("doc2", "driver", "delivery driver available")
        
        results = retriever.search("food delivery", use_bm25=False, use_vector=True)
        
        assert len(results) <= 2
        assert all(isinstance(result, DocumentMatch) for result in results)
    
    def test_get_stats(self, retriever):
        """Test getting retrieval statistics"""
        # Add a test document
        retriever.add_document("doc1", "test", "test document")
        
        stats = retriever.get_stats()
        
        assert "store_type" in stats
        assert "bm25_available" in stats
        assert "vector_available" in stats
        assert "document_count" in stats
        assert "feature_rag_v2_enabled" in stats
        
        # With our mock setup, document count should be 1
        assert stats["document_count"] == 1


class TestIntegration:
    """Integration tests for the complete RAG system"""
    
    @pytest.fixture
    def config(self):
        return {
            "embedding_dim": 384,
            "top_k_results": 5,
            "similarity_threshold": 0.1,  # Lower threshold for testing
            "use_hybrid": True,
            "bm25_weight": 0.3,
            "vector_weight": 0.7,
            "vector_db": "mock"
        }
    
    def test_full_rag_workflow(self, config):
        """Test the complete RAG workflow: ingest + search"""
        with patch.dict(os.environ, {"FEATURE_RAG_V2": "true", "PII_REDACTION": "false"}):
            retriever = HybridRetriever(config)
            
            # Ingest sample documents
            sample_docs = [
                {
                    "id": "order_1",
                    "type": "order",
                    "text": "Pizza delivery order from downtown restaurant to university area",
                    "metadata": {"vendor": "Tony's Pizza", "price": 25.99}
                },
                {
                    "id": "driver_1", 
                    "type": "driver",
                    "text": "Experienced delivery driver available for food deliveries in downtown",
                    "metadata": {"rating": 4.8, "vehicle": "bike"}
                },
                {
                    "id": "location_1",
                    "type": "location", 
                    "text": "Popular restaurant located in downtown business district",
                    "metadata": {"cuisine": "italian", "hours": "11am-10pm"}
                }
            ]
            
            # Ingest documents
            for doc in sample_docs:
                retriever.add_document(
                    content_id=doc["id"],
                    content_type=doc["type"],
                    text=doc["text"],
                    metadata=doc["metadata"]
                )
            
            # Test different queries
            test_queries = [
                ("pizza delivery", ["order_1", "driver_1"]),  # Should match order and driver
                ("downtown restaurant", ["location_1", "order_1"]),  # Should match location and order
                ("experienced driver", ["driver_1"]),  # Should primarily match driver
            ]
            
            for query, expected_docs in test_queries:
                results = retriever.search(query, top_k=3)
                
                # Check that we get results
                assert len(results) > 0
                
                # Check that at least some expected documents are in results
                result_ids = [r.content_id for r in results]
                assert any(doc_id in result_ids for doc_id in expected_docs)
                
                # Check result structure
                for result in results:
                    assert hasattr(result, 'content_id')
                    assert hasattr(result, 'content_type')
                    assert hasattr(result, 'text')
                    assert hasattr(result, 'score')
                    assert hasattr(result, 'metadata')
                    assert result.score >= 0
    
    def test_pii_redaction_integration(self, config):
        """Test PII redaction in the full workflow"""
        with patch.dict(os.environ, {"PII_REDACTION": "true", "FEATURE_RAG_V2": "true"}):
            retriever = HybridRetriever(config)
            
            # Add document with PII
            retriever.add_document(
                content_id="pii_doc",
                content_type="order",
                text="Order from john.doe@example.com with phone 555-123-4567",
                metadata={}
            )
            
            # Search for the document
            results = retriever.search("order", top_k=1)
            
            assert len(results) == 1
            result_text = results[0].text
            
            # Verify PII was redacted (case-insensitive check)
            assert "[REDACTED_EMAIL]" in result_text.upper()
            assert "[REDACTED_PHONE]" in result_text.upper()
            assert "john.doe@example.com" not in result_text
            assert "555-123-4567" not in result_text


if __name__ == "__main__":
    # Run tests with basic configuration
    pytest.main([__file__, "-v"])