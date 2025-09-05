// CREATE FILE: api/agents/tools/rag.js

const axios = require('axios');

class RAGTool {
    constructor() {
        this.name = 'rag';
        this.description = 'Search and retrieve information from knowledge base';
        this.serviceUrl = process.env.DOCKER_ENV === 'true' 
            ? 'http://rag_agent:8005'
            : process.env.RAG_SERVICE_URL || 'http://localhost:8005';
        this.timeout = 10000; // 10 second timeout
        this.useRagV2 = process.env.FEATURE_RAG_V2 === 'true';
    }

    getAvailableActions() {
        return ['query', 'search', 'ingest', 'get_stats'];
    }

    async execute(action, params, context = {}) {
        const { requestId, dryRun = false } = context;

        switch (action) {
            case 'query':
                return this.queryKnowledge(params, requestId, dryRun);
            
            case 'search':
                return this.searchDocuments(params, requestId, dryRun);
            
            case 'ingest':
                return this.ingestDocument(params, requestId, dryRun);
            
            case 'get_stats':
                return this.getStats(params, requestId, dryRun);
            
            default:
                throw new Error(`Unknown RAG action: ${action}`);
        }
    }

    async queryKnowledge(params, requestId, dryRun = false) {
        try {
            const {
                query,
                top_k = 5,
                content_types = null,
                use_bm25 = true,
                rerank = false,
                filters = null
            } = params;

            if (!query || query.trim().length === 0) {
                throw new Error('Query text is required');
            }

            let requestData;
            let endpoint;

            if (this.useRagV2) {
                // Use new RAG v2 API
                endpoint = '/query';
                requestData = {
                    q: query.trim(),
                    top_k: Math.min(top_k, 20), // Limit to reasonable number
                    use_bm25: use_bm25,
                    rerank: rerank,
                    filters: filters || {}
                };
            } else {
                // Use legacy API for backward compatibility
                endpoint = '/query_legacy';
                requestData = {
                    query: query.trim(),
                    top_k: Math.min(top_k, 20),
                    content_types: content_types,
                    similarity_threshold: 0.7
                };
            }

            if (requestId) {
                requestData.request_id = requestId;
            }

            console.log(`[RAGTool] Query request:`, {
                requestId,
                query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
                top_k,
                use_rag_v2: this.useRagV2,
                dryRun
            });

            // Make request to RAG service
            const response = await axios.post(`${this.serviceUrl}${endpoint}`, requestData, {
                timeout: this.timeout,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-ID': requestId || 'agent-rag'
                }
            });

            // Normalize response format between v1 and v2
            let normalizedResults;
            if (this.useRagV2 && response.data.results) {
                normalizedResults = response.data.results.map(result => ({
                    content_id: result.id,
                    content_type: result.source,
                    text: result.text_snippet,
                    similarity_score: result.score,
                    metadata: result.metadata
                }));
            } else if (response.data.matches) {
                normalizedResults = response.data.matches;
            } else {
                normalizedResults = [];
            }

            return {
                success: true,
                query: query,
                results: normalizedResults,
                sources: response.data.sources || [],
                total_results: normalizedResults.length,
                processing_time_ms: response.data.processing_time_ms,
                rag_version: this.useRagV2 ? 'v2' : 'v1',
                dry_run: dryRun
            };

        } catch (error) {
            if (error.response) {
                throw new Error(`RAG service error: ${error.response.data.error || error.response.statusText}`);
            } else if (error.code === 'ECONNREFUSED') {
                // Service unavailable - provide fallback
                console.warn('[RAGTool] Service unavailable, using fallback search');
                return this.fallbackSearch(params, dryRun);
            } else {
                throw new Error(`Knowledge query failed: ${error.message}`);
            }
        }
    }

    async searchDocuments(params, requestId, dryRun = false) {
        // Alias for queryKnowledge with search-specific defaults
        const searchParams = {
            ...params,
            use_bm25: params.use_bm25 !== false, // Default to true for search
            rerank: params.rerank || false,
            top_k: params.top_k || 3
        };

        return this.queryKnowledge(searchParams, requestId, dryRun);
    }

    async ingestDocument(params, requestId, dryRun = false) {
        try {
            const {
                content_id,
                content_type = 'document',
                text,
                metadata = {},
                chunk_size = 512,
                chunk_overlap = 64
            } = params;

            if (!content_id || !text) {
                throw new Error('Both content_id and text are required for ingestion');
            }

            if (text.length > 50000) {
                throw new Error('Document text is too long (max 50,000 characters)');
            }

            let requestData;
            let endpoint;

            if (this.useRagV2) {
                // Use new RAG v2 batch ingest API
                endpoint = '/ingest';
                requestData = {
                    docs: [{
                        id: content_id,
                        text: text,
                        metadata: {
                            ...metadata,
                            content_type: content_type,
                            ingested_by: 'agent',
                            ingested_at: new Date().toISOString()
                        }
                    }],
                    chunk_size: chunk_size,
                    chunk_overlap: chunk_overlap
                };
            } else {
                // Use legacy single document API
                endpoint = '/ingest';
                requestData = {
                    content_id: content_id,
                    content_type: content_type,
                    text: text,
                    metadata: {
                        ...metadata,
                        ingested_by: 'agent',
                        ingested_at: new Date().toISOString()
                    }
                };
            }

            if (requestId) {
                requestData.request_id = requestId;
            }

            console.log(`[RAGTool] Ingest request:`, {
                requestId,
                content_id,
                content_type,
                text_length: text.length,
                use_rag_v2: this.useRagV2,
                dryRun
            });

            if (dryRun) {
                return {
                    success: true,
                    message: 'Dry run: Document would be ingested',
                    content_id: content_id,
                    text_length: text.length,
                    chunks_estimated: Math.ceil(text.length / chunk_size),
                    dry_run: true
                };
            }

            // Make request to RAG service
            const response = await axios.post(`${this.serviceUrl}${endpoint}`, requestData, {
                timeout: this.timeout * 2, // Longer timeout for ingestion
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-ID': requestId || 'agent-rag-ingest'
                }
            });

            return {
                success: true,
                content_id: content_id,
                ingested: response.data.ingested || 1,
                task_id: response.data.task_id,
                message: response.data.message || 'Document ingested successfully',
                rag_version: this.useRagV2 ? 'v2' : 'v1',
                dry_run: false
            };

        } catch (error) {
            if (error.response) {
                throw new Error(`RAG ingestion error: ${error.response.data.error || error.response.statusText}`);
            } else if (error.code === 'ECONNREFUSED') {
                throw new Error('RAG service unavailable - cannot ingest documents');
            } else {
                throw new Error(`Document ingestion failed: ${error.message}`);
            }
        }
    }

    async getStats(params, requestId, dryRun = false) {
        try {
            const endpoint = this.useRagV2 ? '/index_status' : '/stats';

            console.log(`[RAGTool] Stats request:`, {
                requestId,
                use_rag_v2: this.useRagV2,
                dryRun
            });

            // Make request to RAG service
            const response = await axios.get(`${this.serviceUrl}${endpoint}`, {
                timeout: 5000,
                headers: {
                    'X-Request-ID': requestId || 'agent-rag-stats'
                }
            });

            // Normalize response format
            let normalizedStats;
            if (this.useRagV2 && response.data.document_count !== undefined) {
                normalizedStats = {
                    total_documents: response.data.document_count,
                    index_type: response.data.index_type,
                    features_enabled: response.data.features_enabled,
                    last_updated: response.data.last_updated
                };
            } else {
                normalizedStats = response.data;
            }

            return {
                success: true,
                stats: normalizedStats,
                rag_version: this.useRagV2 ? 'v2' : 'v1',
                dry_run: dryRun
            };

        } catch (error) {
            if (error.response) {
                throw new Error(`RAG stats error: ${error.response.data.error || error.response.statusText}`);
            } else if (error.code === 'ECONNREFUSED') {
                return {
                    success: false,
                    stats: { message: 'RAG service unavailable' },
                    rag_version: this.useRagV2 ? 'v2' : 'v1',
                    dry_run: dryRun
                };
            } else {
                throw new Error(`Stats retrieval failed: ${error.message}`);
            }
        }
    }

    // Fallback search when RAG service is unavailable
    fallbackSearch(params, dryRun = false) {
        const { query, top_k = 5 } = params;

        // Simple keyword-based fallback responses
        const knowledgeBase = {
            'delivery': {
                content_id: 'delivery_info',
                content_type: 'policy',
                text: 'Delivery service is available 7 days a week. Standard delivery takes 30-45 minutes.',
                similarity_score: 0.9,
                metadata: { source: 'fallback', topic: 'delivery' }
            },
            'pricing': {
                content_id: 'pricing_info',
                content_type: 'policy',
                text: 'Delivery fees start at $5.99 plus $1.25 per kilometer. Platform commission is 15%.',
                similarity_score: 0.9,
                metadata: { source: 'fallback', topic: 'pricing' }
            },
            'driver': {
                content_id: 'driver_info',
                content_type: 'policy',
                text: 'Drivers must complete background checks and vehicle inspections. Rating system available.',
                similarity_score: 0.8,
                metadata: { source: 'fallback', topic: 'drivers' }
            }
        };

        const queryLower = query.toLowerCase();
        const results = [];

        for (const [keyword, info] of Object.entries(knowledgeBase)) {
            if (queryLower.includes(keyword)) {
                results.push(info);
            }
        }

        // If no specific matches, return general info
        if (results.length === 0) {
            results.push({
                content_id: 'general_info',
                content_type: 'policy',
                text: 'INC Logistics provides on-demand delivery services with real-time tracking and reliable drivers.',
                similarity_score: 0.5,
                metadata: { source: 'fallback', topic: 'general' }
            });
        }

        return {
            success: true,
            query: query,
            results: results.slice(0, top_k),
            sources: ['fallback'],
            total_results: results.length,
            processing_time_ms: 50,
            rag_version: 'fallback',
            fallback_used: true,
            dry_run: dryRun
        };
    }

    async healthCheck() {
        try {
            const response = await axios.get(`${this.serviceUrl}/health`, {
                timeout: 2000
            });
            return {
                healthy: true,
                service: 'rag',
                rag_version: this.useRagV2 ? 'v2' : 'v1',
                features: response.data.features || {},
                response_time: response.headers['response-time'] || 'unknown'
            };
        } catch (error) {
            return {
                healthy: false,
                service: 'rag',
                error: error.message
            };
        }
    }
}

module.exports = new RAGTool();