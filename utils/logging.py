# CREATE FILE: utils/logging.py

import json
import os
import time
import uuid
from datetime import datetime
from typing import Dict, Any, Optional, Union
from contextlib import contextmanager
import traceback


class StructuredLogger:
    """
    Centralized structured logging utility for AI_native_INC services.
    
    Provides consistent JSON logging format across all Python services with:
    - Request ID tracking
    - Performance metrics
    - Error context
    - Security audit trails
    - OpenTelemetry integration ready
    """
    
    def __init__(self, service_name: str, environment: str = None):
        self.service_name = service_name
        self.environment = environment or os.getenv('ENVIRONMENT', 'development')
        self.version = os.getenv('SERVICE_VERSION', '1.0.0')
        self.enable_debug = os.getenv('DEBUG_LOGGING', 'false').lower() == 'true'
        
        # Base fields for all log entries
        self.base_fields = {
            'service': self.service_name,
            'environment': self.environment,
            'version': self.version,
            'hostname': os.getenv('HOSTNAME', 'unknown'),
            'process_id': os.getpid()
        }
    
    def _create_log_entry(self, level: str, message: str, **kwargs) -> Dict[str, Any]:
        """Create a structured log entry with standard fields"""
        entry = {
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'level': level.upper(),
            'message': message,
            **self.base_fields
        }
        
        # Add optional fields
        for key, value in kwargs.items():
            if value is not None:
                entry[key] = value
        
        return entry
    
    def _log(self, level: str, message: str, **kwargs):
        """Output structured log entry to stdout"""
        log_entry = self._create_log_entry(level, message, **kwargs)
        print(json.dumps(log_entry))
    
    def debug(self, message: str, **kwargs):
        """Debug level logging (only if debug enabled)"""
        if self.enable_debug:
            self._log('debug', message, **kwargs)
    
    def info(self, message: str, **kwargs):
        """Info level logging"""
        self._log('info', message, **kwargs)
    
    def warning(self, message: str, **kwargs):
        """Warning level logging"""
        self._log('warning', message, **kwargs)
    
    def error(self, message: str, error: Exception = None, **kwargs):
        """Error level logging with optional exception details"""
        error_details = {}
        if error:
            error_details = {
                'error_type': type(error).__name__,
                'error_message': str(error),
                'stack_trace': traceback.format_exc() if self.enable_debug else None
            }
        
        self._log('error', message, **error_details, **kwargs)
    
    def critical(self, message: str, error: Exception = None, **kwargs):
        """Critical level logging"""
        error_details = {}
        if error:
            error_details = {
                'error_type': type(error).__name__,
                'error_message': str(error),
                'stack_trace': traceback.format_exc()
            }
        
        self._log('critical', message, **error_details, **kwargs)
    
    # Specialized logging methods for common use cases
    
    def request_start(self, request_id: str, endpoint: str, method: str = 'POST', 
                     user_id: str = None, **kwargs):
        """Log the start of a request"""
        self.info(
            f"Request started: {method} {endpoint}",
            action='request_start',
            request_id=request_id,
            endpoint=endpoint,
            method=method,
            user_id=user_id,
            **kwargs
        )
    
    def request_end(self, request_id: str, endpoint: str, duration_ms: float, 
                   status_code: int = 200, **kwargs):
        """Log the end of a request with performance metrics"""
        level = 'info' if status_code < 400 else 'warning' if status_code < 500 else 'error'
        
        self._log(
            level,
            f"Request completed: {endpoint} ({status_code})",
            action='request_end',
            request_id=request_id,
            endpoint=endpoint,
            status_code=status_code,
            duration_ms=round(duration_ms, 2),
            performance_category=self._categorize_performance(duration_ms),
            **kwargs
        )
    
    def security_event(self, event_type: str, request_id: str = None, 
                      user_id: str = None, details: Dict[str, Any] = None, **kwargs):
        """Log security-related events for audit trails"""
        self.info(
            f"Security event: {event_type}",
            action='security_event',
            event_type=event_type,
            request_id=request_id,
            user_id=user_id,
            security_details=details or {},
            **kwargs
        )
    
    def business_event(self, event_type: str, request_id: str = None,
                      user_id: str = None, amount: float = None, 
                      order_id: str = None, **kwargs):
        """Log business events (orders, payments, etc.)"""
        self.info(
            f"Business event: {event_type}",
            action='business_event',
            event_type=event_type,
            request_id=request_id,
            user_id=user_id,
            amount=amount,
            order_id=order_id,
            **kwargs
        )
    
    def performance_metric(self, metric_name: str, value: Union[float, int], 
                          unit: str = 'ms', request_id: str = None, **kwargs):
        """Log performance metrics"""
        self.info(
            f"Performance metric: {metric_name}={value}{unit}",
            action='performance_metric',
            metric_name=metric_name,
            metric_value=value,
            metric_unit=unit,
            request_id=request_id,
            **kwargs
        )
    
    def api_call(self, target_service: str, endpoint: str, method: str = 'POST',
                duration_ms: float = None, status_code: int = None, 
                request_id: str = None, **kwargs):
        """Log outbound API calls to other services"""
        level = 'info'
        if status_code and status_code >= 400:
            level = 'warning' if status_code < 500 else 'error'
        
        self._log(
            level,
            f"API call: {method} {target_service}{endpoint}",
            action='api_call',
            target_service=target_service,
            endpoint=endpoint,
            method=method,
            duration_ms=duration_ms,
            status_code=status_code,
            request_id=request_id,
            **kwargs
        )
    
    def data_operation(self, operation: str, table: str = None, 
                      record_count: int = None, duration_ms: float = None,
                      request_id: str = None, **kwargs):
        """Log database or data operations"""
        self.info(
            f"Data operation: {operation}",
            action='data_operation',
            operation=operation,
            table=table,
            record_count=record_count,
            duration_ms=duration_ms,
            request_id=request_id,
            **kwargs
        )
    
    def _categorize_performance(self, duration_ms: float) -> str:
        """Categorize performance based on duration"""
        if duration_ms < 100:
            return 'fast'
        elif duration_ms < 500:
            return 'normal'
        elif duration_ms < 2000:
            return 'slow'
        else:
            return 'very_slow'
    
    @contextmanager
    def request_context(self, request_id: str = None, endpoint: str = None, 
                       method: str = 'POST', user_id: str = None):
        """Context manager for request logging with automatic timing"""
        request_id = request_id or str(uuid.uuid4())
        start_time = time.time()
        
        try:
            if endpoint:
                self.request_start(request_id, endpoint, method, user_id)
            yield request_id
        except Exception as e:
            self.error(f"Request failed: {endpoint}", error=e, request_id=request_id)
            raise
        finally:
            if endpoint:
                duration_ms = (time.time() - start_time) * 1000
                self.request_end(request_id, endpoint, duration_ms)
    
    @contextmanager
    def operation_context(self, operation_name: str, request_id: str = None):
        """Context manager for timed operations"""
        start_time = time.time()
        
        try:
            self.debug(f"Operation started: {operation_name}", 
                      action='operation_start', 
                      operation=operation_name,
                      request_id=request_id)
            yield
        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            self.error(f"Operation failed: {operation_name}", 
                      error=e,
                      action='operation_error',
                      operation=operation_name,
                      duration_ms=duration_ms,
                      request_id=request_id)
            raise
        else:
            duration_ms = (time.time() - start_time) * 1000
            self.debug(f"Operation completed: {operation_name}",
                      action='operation_end',
                      operation=operation_name,
                      duration_ms=duration_ms,
                      request_id=request_id)


# Convenience functions for common logging patterns

def get_logger(service_name: str) -> StructuredLogger:
    """Get a configured logger for a service"""
    return StructuredLogger(service_name)


def log_api_request(logger: StructuredLogger, request_data: Dict[str, Any]):
    """Log an incoming API request with sanitized data"""
    # Remove sensitive fields
    sanitized_data = {k: v for k, v in request_data.items() 
                     if k not in ['password', 'token', 'secret', 'key']}
    
    logger.debug("API request received", 
                action='api_request_received',
                request_data=sanitized_data)


def log_database_query(logger: StructuredLogger, query_type: str, table: str,
                      duration_ms: float, record_count: int = None,
                      request_id: str = None):
    """Log database query performance"""
    logger.performance_metric(
        f"db_query_{query_type.lower()}",
        duration_ms,
        'ms',
        request_id=request_id,
        table=table,
        record_count=record_count
    )


def log_external_api_call(logger: StructuredLogger, service: str, endpoint: str,
                         response_time_ms: float, status_code: int,
                         request_id: str = None):
    """Log external API call with performance metrics"""
    logger.api_call(
        target_service=service,
        endpoint=endpoint,
        duration_ms=response_time_ms,
        status_code=status_code,
        request_id=request_id
    )


def log_business_transaction(logger: StructuredLogger, transaction_type: str,
                           amount: float, currency: str = 'USD',
                           user_id: str = None, order_id: str = None,
                           request_id: str = None):
    """Log business transaction for audit purposes"""
    logger.business_event(
        event_type=transaction_type,
        request_id=request_id,
        user_id=user_id,
        amount=amount,
        currency=currency,
        order_id=order_id
    )


# PII Sanitization utilities

def sanitize_pii(data: Any, redact_fields: set = None) -> Any:
    """
    Recursively sanitize PII from data structures before logging.
    
    Args:
        data: The data to sanitize
        redact_fields: Set of field names to redact (default: common PII fields)
    
    Returns:
        Sanitized data with PII fields redacted
    """
    if redact_fields is None:
        redact_fields = {
            'email', 'phone', 'ssn', 'social_security_number',
            'credit_card', 'card_number', 'password', 'token',
            'api_key', 'secret', 'private_key', 'address'
        }
    
    if isinstance(data, dict):
        return {
            key: '[REDACTED]' if key.lower() in redact_fields 
            else sanitize_pii(value, redact_fields)
            for key, value in data.items()
        }
    elif isinstance(data, list):
        return [sanitize_pii(item, redact_fields) for item in data]
    elif isinstance(data, str):
        # Basic pattern-based PII detection for string values
        import re
        
        # Email pattern
        if re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', data):
            return '[REDACTED_EMAIL]'
        
        # Phone pattern
        if re.search(r'\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b', data):
            return '[REDACTED_PHONE]'
        
        # Credit card pattern (basic)
        if re.search(r'\b(?:\d{4}[-\s]?){3}\d{4}\b', data):
            return '[REDACTED_CARD]'
        
        return data
    else:
        return data


# Example usage demonstration
if __name__ == "__main__":
    # Example service logger
    logger = get_logger("rag_agent")
    
    # Example request logging
    with logger.request_context(endpoint="/query", method="POST", user_id="user_123") as request_id:
        logger.info("Processing RAG query", request_id=request_id, query_length=50)
        
        # Simulate operation
        with logger.operation_context("embedding_generation", request_id):
            time.sleep(0.1)  # Simulate work
        
        # Log performance metric
        logger.performance_metric("embedding_time", 100.5, "ms", request_id)
        
        # Log business event
        logger.business_event("rag_query_completed", request_id=request_id, 
                            result_count=5, user_id="user_123")
    
    # Example error logging
    try:
        raise ValueError("Example error")
    except Exception as e:
        logger.error("Query processing failed", error=e, request_id="req_456")
    
    # Example security event
    logger.security_event("authentication_success", user_id="user_123", 
                         details={"method": "api_key", "source_ip": "192.168.1.1"})
    
    # Example PII sanitization
    sensitive_data = {
        "user_email": "john@example.com",
        "phone": "555-123-4567",
        "order_details": {"item": "pizza", "quantity": 2}
    }
    sanitized = sanitize_pii(sensitive_data)
    logger.info("User data processed", data=sanitized)