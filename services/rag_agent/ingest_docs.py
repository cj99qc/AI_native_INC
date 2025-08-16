# CREATE FILE: services/rag_agent/ingest_docs.py

#!/usr/bin/env python3
"""
Script to ingest example data into the RAG system for testing.
"""

import requests
import json
import os
import sys
from pathlib import Path

def load_example_data():
    """Load example data for ingestion"""
    
    # Sample logistics and policy documents
    documents = [
        {
            "content_id": "policy_delivery_standards",
            "content_type": "policy",
            "text": "INC Delivery Standards: All deliveries must be completed within the estimated time window. Drivers should confirm pickup with vendors and delivery with customers. Temperature-sensitive items require insulated bags. Maximum delivery distance is 50km from vendor location.",
            "metadata": {"category": "delivery_policy", "version": "1.0"}
        },
        {
            "content_id": "policy_payment_disputes",
            "content_type": "policy", 
            "text": "Payment Dispute Resolution: Customers can dispute orders within 24 hours of delivery. Valid disputes include: incorrect items, missing items, damaged goods, or late delivery (>30 minutes past ETA). Refunds processed within 3-5 business days.",
            "metadata": {"category": "payment_policy", "version": "1.0"}
        },
        {
            "content_id": "location_ottawa_downtown",
            "content_type": "location",
            "text": "Ottawa Downtown Area: High density commercial and residential area. Peak delivery times 11:30AM-1:30PM and 5:30PM-8:30PM. Parking challenges downtown, use loading zones when available. Average delivery time 8-12 minutes per stop.",
            "metadata": {"city": "Ottawa", "region": "downtown", "zone": "high_density"}
        },
        {
            "content_id": "location_kanata_suburb",
            "content_type": "location",
            "text": "Kanata Suburban Area: Lower density residential area with tech companies. Longer distances between stops. Best delivery times 5:00PM-8:00PM for residential. Office deliveries best 11:00AM-2:00PM. Average delivery time 5-8 minutes per stop.",
            "metadata": {"city": "Ottawa", "region": "kanata", "zone": "suburban"}
        },
        {
            "content_id": "driver_best_practices",
            "content_type": "driver",
            "text": "Driver Best Practices: Always call customer if running late. Verify order contents with vendor before pickup. Use GPS for optimal routing. Keep insulated bags for temperature-sensitive orders. Maintain 4.5+ star rating for priority batch assignments.",
            "metadata": {"category": "best_practices", "audience": "drivers"}
        },
        {
            "content_id": "order_handling_procedures",
            "content_type": "order",
            "text": "Order Handling Procedures: Verify customer phone number at pickup. Check special instructions for dietary restrictions or delivery preferences. Photo confirmation required for contactless deliveries. Report any vendor delays immediately to support.",
            "metadata": {"category": "procedures", "audience": "drivers"}
        },
        {
            "content_id": "peak_hours_guidance",
            "content_type": "policy",
            "text": "Peak Hours Management: Lunch rush (11:30AM-1:30PM) and dinner rush (5:30PM-8:30PM) have 15% surge pricing. Drivers encouraged to be online during these times. Batch sizes may increase during peak to improve efficiency.",
            "metadata": {"category": "operations", "version": "1.1"}
        },
        {
            "content_id": "rural_delivery_policy",
            "content_type": "policy",
            "text": "Rural Delivery Policy: Deliveries beyond 25km from vendor incur rural surcharge of 20%. Extended delivery windows of +/- 30 minutes. Drivers should call ahead to confirm customer availability. Minimum batch size of 2 orders for rural routes.",
            "metadata": {"category": "rural_policy", "version": "1.0"}
        }
    ]
    
    return documents

def ingest_document(base_url, doc):
    """Ingest a single document"""
    try:
        response = requests.post(f"{base_url}/ingest", json=doc, timeout=30)
        response.raise_for_status()
        return True, response.json()
    except requests.exceptions.RequestException as e:
        return False, str(e)

def main():
    # Default RAG service URL
    base_url = os.getenv("RAG_SERVICE_URL", "http://localhost:8005")
    
    # Allow override from command line
    if len(sys.argv) > 1:
        base_url = sys.argv[1]
    
    print(f"Ingesting documents into RAG service at: {base_url}")
    
    # Check if service is available
    try:
        health_response = requests.get(f"{base_url}/health", timeout=10)
        health_response.raise_for_status()
        print("✓ RAG service is healthy")
    except requests.exceptions.RequestException as e:
        print(f"✗ Cannot reach RAG service: {e}")
        print("Make sure the RAG service is running on the specified URL")
        return 1
    
    # Load and ingest documents
    documents = load_example_data()
    successful = 0
    failed = 0
    
    print(f"\nIngesting {len(documents)} documents...")
    
    for doc in documents:
        success, result = ingest_document(base_url, doc)
        if success:
            print(f"✓ {doc['content_id']} ({doc['content_type']})")
            successful += 1
        else:
            print(f"✗ {doc['content_id']}: {result}")
            failed += 1
    
    print(f"\nIngestion complete: {successful} successful, {failed} failed")
    
    # Test a query
    print("\nTesting query...")
    try:
        test_query = {
            "query": "What are the delivery standards for temperature-sensitive items?",
            "top_k": 3
        }
        response = requests.post(f"{base_url}/query", json=test_query, timeout=30)
        response.raise_for_status()
        result = response.json()
        
        print(f"Query: {test_query['query']}")
        print(f"Found {len(result['matches'])} matches")
        for match in result['matches']:
            print(f"  - {match['content_id']} (similarity: {match['similarity_score']:.2f})")
        
    except requests.exceptions.RequestException as e:
        print(f"✗ Query test failed: {e}")
    
    return 0 if failed == 0 else 1

if __name__ == "__main__":
    exit(main())