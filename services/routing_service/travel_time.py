# CREATE FILE: services/routing_service/travel_time.py

import os
import sys
import math
import time
import json
import hashlib
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime, timedelta
import threading

# Add utils to path for logging
sys.path.append(os.path.join(os.path.dirname(__file__), '../../'))
from utils.logging import get_logger

# Optional imports
try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False


@dataclass
class TravelTimeRequest:
    """Request for travel time calculation"""
    from_lat: float
    from_lng: float
    to_lat: float
    to_lng: float
    mode: str = 'driving'  # driving, walking, cycling
    departure_time: Optional[datetime] = None


@dataclass
class TravelTimeResult:
    """Result of travel time calculation"""
    duration_seconds: int
    distance_meters: float
    mode: str
    provider: str
    cached: bool = False
    calculated_at: datetime = None


class TravelTimeCache:
    """Cache for travel time results with TTL"""
    
    def __init__(self, use_redis: bool = True, default_ttl: int = 86400):  # 24 hours
        self.default_ttl = default_ttl
        self.logger = get_logger("travel_time_cache")
        self.local_cache = {}
        self.cache_stats = {"hits": 0, "misses": 0, "errors": 0}
        self._lock = threading.RLock()
        
        # Try to connect to Redis if available
        self.redis_client = None
        if use_redis and REDIS_AVAILABLE:
            try:
                redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
                self.redis_client = redis.from_url(redis_url, decode_responses=True)
                # Test connection
                self.redis_client.ping()
                self.logger.info("Connected to Redis cache", redis_url=redis_url)
            except Exception as e:
                self.logger.warning("Redis connection failed, using local cache", error=e)
                self.redis_client = None
    
    def _generate_cache_key(self, request: TravelTimeRequest) -> str:
        """Generate a cache key from request parameters"""
        # Round coordinates to reduce cache misses for nearby points
        lat1 = round(request.from_lat, 4)
        lng1 = round(request.from_lng, 4)
        lat2 = round(request.to_lat, 4)
        lng2 = round(request.to_lng, 4)
        
        key_parts = [str(lat1), str(lng1), str(lat2), str(lng2), request.mode]
        
        # Add departure time if specified (rounded to hour)
        if request.departure_time:
            hour_key = request.departure_time.strftime("%Y%m%d%H")
            key_parts.append(hour_key)
        
        # Create hash to keep key length manageable
        key_string = "|".join(key_parts)
        return f"travel_time:{hashlib.md5(key_string.encode()).hexdigest()}"
    
    def get(self, request: TravelTimeRequest) -> Optional[TravelTimeResult]:
        """Get cached travel time result"""
        cache_key = self._generate_cache_key(request)
        
        with self._lock:
            try:
                # Try Redis first
                if self.redis_client:
                    cached_data = self.redis_client.get(cache_key)
                    if cached_data:
                        result_dict = json.loads(cached_data)
                        result = TravelTimeResult(**result_dict)
                        result.cached = True
                        self.cache_stats["hits"] += 1
                        return result
                
                # Fall back to local cache
                if cache_key in self.local_cache:
                    result, expiry = self.local_cache[cache_key]
                    if datetime.now() < expiry:
                        result.cached = True
                        self.cache_stats["hits"] += 1
                        return result
                    else:
                        # Expired, remove from local cache
                        del self.local_cache[cache_key]
                
                self.cache_stats["misses"] += 1
                return None
                
            except Exception as e:
                self.logger.error("Cache get error", error=e, cache_key=cache_key)
                self.cache_stats["errors"] += 1
                return None
    
    def set(self, request: TravelTimeRequest, result: TravelTimeResult, ttl: int = None):
        """Cache travel time result"""
        cache_key = self._generate_cache_key(request)
        ttl = ttl or self.default_ttl
        
        with self._lock:
            try:
                # Prepare data for caching
                result_dict = {
                    "duration_seconds": result.duration_seconds,
                    "distance_meters": result.distance_meters,
                    "mode": result.mode,
                    "provider": result.provider,
                    "calculated_at": result.calculated_at.isoformat() if result.calculated_at else None
                }
                
                # Try Redis first
                if self.redis_client:
                    self.redis_client.setex(cache_key, ttl, json.dumps(result_dict))
                else:
                    # Fall back to local cache
                    expiry = datetime.now() + timedelta(seconds=ttl)
                    self.local_cache[cache_key] = (result, expiry)
                    
                    # Cleanup old entries periodically
                    if len(self.local_cache) > 1000:
                        self._cleanup_local_cache()
                
            except Exception as e:
                self.logger.error("Cache set error", error=e, cache_key=cache_key)
                self.cache_stats["errors"] += 1
    
    def _cleanup_local_cache(self):
        """Remove expired entries from local cache"""
        now = datetime.now()
        expired_keys = [
            key for key, (_, expiry) in self.local_cache.items()
            if now >= expiry
        ]
        for key in expired_keys:
            del self.local_cache[key]
        
        self.logger.debug("Local cache cleanup", removed_entries=len(expired_keys))
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        with self._lock:
            total_requests = self.cache_stats["hits"] + self.cache_stats["misses"]
            hit_rate = (self.cache_stats["hits"] / total_requests) if total_requests > 0 else 0
            
            return {
                "hits": self.cache_stats["hits"],
                "misses": self.cache_stats["misses"],
                "errors": self.cache_stats["errors"],
                "hit_rate": round(hit_rate, 3),
                "local_cache_size": len(self.local_cache),
                "redis_connected": self.redis_client is not None
            }


class BaseTravelTimeProvider:
    """Base class for travel time providers"""
    
    def __init__(self, provider_name: str, cache: TravelTimeCache = None):
        self.provider_name = provider_name
        self.cache = cache or TravelTimeCache()
        self.logger = get_logger(f"travel_provider_{provider_name}")
        self.request_count = 0
        self.error_count = 0
    
    def get_travel_time(self, request: TravelTimeRequest) -> TravelTimeResult:
        """Get travel time with caching"""
        self.request_count += 1
        
        # Check cache first
        cached_result = self.cache.get(request)
        if cached_result:
            return cached_result
        
        try:
            # Calculate travel time
            result = self._calculate_travel_time(request)
            result.calculated_at = datetime.now()
            
            # Cache the result
            self.cache.set(request, result)
            
            return result
            
        except Exception as e:
            self.error_count += 1
            self.logger.error("Travel time calculation failed", error=e, 
                            from_lat=request.from_lat, from_lng=request.from_lng,
                            to_lat=request.to_lat, to_lng=request.to_lng)
            # Return fallback result
            return self._fallback_calculation(request)
    
    def _calculate_travel_time(self, request: TravelTimeRequest) -> TravelTimeResult:
        """Override in subclasses to implement actual calculation"""
        raise NotImplementedError
    
    def _fallback_calculation(self, request: TravelTimeRequest) -> TravelTimeResult:
        """Fallback calculation using haversine distance"""
        distance_km = self._haversine_distance(
            request.from_lat, request.from_lng,
            request.to_lat, request.to_lng
        )
        
        # Speed estimates by mode
        speed_kmh = {
            'driving': 40,
            'walking': 5,
            'cycling': 15
        }.get(request.mode, 40)
        
        duration_hours = distance_km / speed_kmh
        duration_seconds = int(duration_hours * 3600)
        
        return TravelTimeResult(
            duration_seconds=duration_seconds,
            distance_meters=distance_km * 1000,
            mode=request.mode,
            provider=f"{self.provider_name}_fallback"
        )
    
    def _haversine_distance(self, lat1: float, lng1: float, lat2: float, lng2: float) -> float:
        """Calculate haversine distance in kilometers"""
        R = 6371  # Earth's radius in km
        
        lat1_rad = math.radians(lat1)
        lat2_rad = math.radians(lat2)
        delta_lat = math.radians(lat2 - lat1)
        delta_lng = math.radians(lng2 - lng1)
        
        a = (math.sin(delta_lat / 2) ** 2 + 
             math.cos(lat1_rad) * math.cos(lat2_rad) * 
             math.sin(delta_lng / 2) ** 2)
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        
        return R * c
    
    def get_stats(self) -> Dict[str, Any]:
        """Get provider statistics"""
        return {
            "provider": self.provider_name,
            "total_requests": self.request_count,
            "error_count": self.error_count,
            "error_rate": round(self.error_count / max(1, self.request_count), 3),
            "cache_stats": self.cache.get_stats()
        }


class MockTravelTimeProvider(BaseTravelTimeProvider):
    """Mock travel time provider for development and testing"""
    
    def __init__(self, cache: TravelTimeCache = None, avg_speed_kmh: float = 40):
        super().__init__("mock", cache)
        self.avg_speed_kmh = avg_speed_kmh
        
        # Add some realistic urban factors
        self.urban_delay_factor = 1.3  # 30% delay for urban areas
        self.intersection_delay = 30  # 30 seconds per km for intersections
    
    def _calculate_travel_time(self, request: TravelTimeRequest) -> TravelTimeResult:
        """Calculate mock travel time with realistic factors"""
        distance_km = self._haversine_distance(
            request.from_lat, request.from_lng,
            request.to_lat, request.to_lng
        )
        
        # Adjust speed based on mode
        if request.mode == 'walking':
            speed_kmh = 5
            delay_factor = 1.0  # No traffic delays for walking
        elif request.mode == 'cycling':
            speed_kmh = 15
            delay_factor = 1.1  # Minimal traffic delays
        else:  # driving
            speed_kmh = self.avg_speed_kmh
            delay_factor = self.urban_delay_factor
        
        # Base travel time
        duration_hours = distance_km / speed_kmh
        duration_seconds = duration_hours * 3600
        
        # Add urban delays for driving
        if request.mode == 'driving':
            duration_seconds *= delay_factor
            duration_seconds += distance_km * self.intersection_delay
        
        # Add some randomness for realism (±10%)
        import random
        variance = 0.1
        multiplier = 1 + random.uniform(-variance, variance)
        duration_seconds *= multiplier
        
        return TravelTimeResult(
            duration_seconds=int(duration_seconds),
            distance_meters=distance_km * 1000,
            mode=request.mode,
            provider="mock"
        )


class GraphHopperProvider(BaseTravelTimeProvider):
    """GraphHopper API travel time provider"""
    
    def __init__(self, api_key: str = None, cache: TravelTimeCache = None, 
                 base_url: str = "https://graphhopper.com/api/1"):
        super().__init__("graphhopper", cache)
        self.api_key = api_key
        self.base_url = base_url
        self.timeout = 10  # seconds
        
        if not REQUESTS_AVAILABLE:
            raise ImportError("requests library required for GraphHopper provider")
        
        if not api_key:
            self.logger.warning("No GraphHopper API key provided, will use fallback")
    
    def _calculate_travel_time(self, request: TravelTimeRequest) -> TravelTimeResult:
        """Calculate travel time using GraphHopper API"""
        if not self.api_key:
            return self._fallback_calculation(request)
        
        try:
            # Prepare API request
            params = {
                'point': [f"{request.from_lat},{request.from_lng}", 
                         f"{request.to_lat},{request.to_lng}"],
                'vehicle': request.mode if request.mode in ['car', 'foot', 'bike'] else 'car',
                'calc_points': 'false',  # We only need time/distance
                'key': self.api_key
            }
            
            start_time = time.time()
            response = requests.get(
                f"{self.base_url}/route",
                params=params,
                timeout=self.timeout
            )
            api_duration = (time.time() - start_time) * 1000
            
            if response.status_code != 200:
                raise Exception(f"GraphHopper API error: {response.status_code}")
            
            data = response.json()
            
            if 'paths' not in data or not data['paths']:
                raise Exception("No route found")
            
            path = data['paths'][0]
            
            self.logger.debug("GraphHopper API call successful",
                            api_duration_ms=api_duration,
                            distance_m=path['distance'],
                            time_ms=path['time'])
            
            return TravelTimeResult(
                duration_seconds=int(path['time'] / 1000),  # Convert ms to seconds
                distance_meters=path['distance'],
                mode=request.mode,
                provider="graphhopper"
            )
            
        except Exception as e:
            self.logger.warning("GraphHopper API failed, using fallback", error=e)
            return self._fallback_calculation(request)


class OSRMProvider(BaseTravelTimeProvider):
    """OSRM (Open Source Routing Machine) travel time provider"""
    
    def __init__(self, cache: TravelTimeCache = None, 
                 base_url: str = "http://router.project-osrm.org"):
        super().__init__("osrm", cache)
        self.base_url = base_url
        self.timeout = 10  # seconds
        
        if not REQUESTS_AVAILABLE:
            raise ImportError("requests library required for OSRM provider")
    
    def _calculate_travel_time(self, request: TravelTimeRequest) -> TravelTimeResult:
        """Calculate travel time using OSRM API"""
        try:
            # OSRM only supports driving, walking, cycling
            profile = {
                'driving': 'driving',
                'walking': 'foot',
                'cycling': 'bike'
            }.get(request.mode, 'driving')
            
            # Prepare coordinates
            coordinates = f"{request.from_lng},{request.from_lat};{request.to_lng},{request.to_lat}"
            
            start_time = time.time()
            response = requests.get(
                f"{self.base_url}/route/v1/{profile}/{coordinates}",
                params={'overview': 'false', 'geometries': 'geojson'},
                timeout=self.timeout
            )
            api_duration = (time.time() - start_time) * 1000
            
            if response.status_code != 200:
                raise Exception(f"OSRM API error: {response.status_code}")
            
            data = response.json()
            
            if data.get('code') != 'Ok':
                raise Exception(f"OSRM error: {data.get('message', 'Unknown error')}")
            
            if not data.get('routes'):
                raise Exception("No route found")
            
            route = data['routes'][0]
            
            self.logger.debug("OSRM API call successful",
                            api_duration_ms=api_duration,
                            distance_m=route['distance'],
                            duration_s=route['duration'])
            
            return TravelTimeResult(
                duration_seconds=int(route['duration']),
                distance_meters=route['distance'],
                mode=request.mode,
                provider="osrm"
            )
            
        except Exception as e:
            self.logger.warning("OSRM API failed, using fallback", error=e)
            return self._fallback_calculation(request)


class GoogleMapsProvider(BaseTravelTimeProvider):
    """Google Maps API travel time provider"""
    
    def __init__(self, api_key: str = None, cache: TravelTimeCache = None):
        super().__init__("google_maps", cache)
        self.api_key = api_key
        self.base_url = "https://maps.googleapis.com/maps/api"
        self.timeout = 10  # seconds
        
        if not REQUESTS_AVAILABLE:
            raise ImportError("requests library required for Google Maps provider")
        
        if not api_key:
            self.logger.warning("No Google Maps API key provided, will use fallback")
    
    def _calculate_travel_time(self, request: TravelTimeRequest) -> TravelTimeResult:
        """Calculate travel time using Google Maps Distance Matrix API"""
        if not self.api_key:
            return self._fallback_calculation(request)
        
        try:
            # Prepare API request
            origins = f"{request.from_lat},{request.from_lng}"
            destinations = f"{request.to_lat},{request.to_lng}"
            
            params = {
                'origins': origins,
                'destinations': destinations,
                'mode': request.mode,
                'units': 'metric',
                'key': self.api_key
            }
            
            # Add departure time for traffic-aware routing
            if request.departure_time:
                params['departure_time'] = int(request.departure_time.timestamp())
            
            start_time = time.time()
            response = requests.get(
                f"{self.base_url}/distancematrix/json",
                params=params,
                timeout=self.timeout
            )
            api_duration = (time.time() - start_time) * 1000
            
            if response.status_code != 200:
                raise Exception(f"Google Maps API error: {response.status_code}")
            
            data = response.json()
            
            if data['status'] != 'OK':
                raise Exception(f"Google Maps error: {data['status']}")
            
            if not data['rows'] or not data['rows'][0]['elements']:
                raise Exception("No route found")
            
            element = data['rows'][0]['elements'][0]
            
            if element['status'] != 'OK':
                raise Exception(f"Route calculation failed: {element['status']}")
            
            self.logger.debug("Google Maps API call successful",
                            api_duration_ms=api_duration,
                            distance_text=element['distance']['text'],
                            duration_text=element['duration']['text'])
            
            return TravelTimeResult(
                duration_seconds=element['duration']['value'],
                distance_meters=element['distance']['value'],
                mode=request.mode,
                provider="google_maps"
            )
            
        except Exception as e:
            self.logger.warning("Google Maps API failed, using fallback", error=e)
            return self._fallback_calculation(request)


class TravelTimeManager:
    """Manages multiple travel time providers with fallback chain"""
    
    def __init__(self, providers: List[BaseTravelTimeProvider] = None):
        self.providers = providers or [MockTravelTimeProvider()]
        self.logger = get_logger("travel_time_manager")
        self.request_stats = {}
    
    def get_travel_time(self, request: TravelTimeRequest) -> TravelTimeResult:
        """Get travel time using provider chain with fallback"""
        for i, provider in enumerate(self.providers):
            try:
                result = provider.get_travel_time(request)
                
                # Track usage stats
                provider_name = provider.provider_name
                if provider_name not in self.request_stats:
                    self.request_stats[provider_name] = {"success": 0, "failure": 0}
                
                if "fallback" not in result.provider:
                    self.request_stats[provider_name]["success"] += 1
                    return result
                else:
                    # Provider used fallback, try next provider
                    self.request_stats[provider_name]["failure"] += 1
                    if i < len(self.providers) - 1:
                        continue
                    else:
                        return result  # Last provider, return fallback result
                        
            except Exception as e:
                self.logger.error(f"Provider {provider.provider_name} failed", error=e)
                provider_name = provider.provider_name
                if provider_name not in self.request_stats:
                    self.request_stats[provider_name] = {"success": 0, "failure": 0}
                self.request_stats[provider_name]["failure"] += 1
                
                # Try next provider or return mock result if last
                if i == len(self.providers) - 1:
                    mock_provider = MockTravelTimeProvider()
                    return mock_provider.get_travel_time(request)
        
        # Should never reach here, but return mock as ultimate fallback
        mock_provider = MockTravelTimeProvider()
        return mock_provider.get_travel_time(request)
    
    def get_stats(self) -> Dict[str, Any]:
        """Get statistics for all providers"""
        stats = {
            "total_providers": len(self.providers),
            "request_stats": self.request_stats,
            "providers": []
        }
        
        for provider in self.providers:
            stats["providers"].append(provider.get_stats())
        
        return stats


# Factory functions

def create_travel_time_manager(config: Dict[str, Any] = None) -> TravelTimeManager:
    """Create a travel time manager with configured providers"""
    config = config or {}
    providers = []
    
    # Create cache
    cache = TravelTimeCache(
        use_redis=config.get("use_redis_cache", True),
        default_ttl=config.get("cache_ttl_seconds", 86400)
    )
    
    # Add providers based on configuration
    provider_configs = config.get("providers", [{"type": "mock"}])
    
    for provider_config in provider_configs:
        provider_type = provider_config.get("type", "mock")
        
        try:
            if provider_type == "graphhopper":
                api_key = provider_config.get("api_key") or os.getenv("GRAPHHOPPER_API_KEY")
                providers.append(GraphHopperProvider(api_key=api_key, cache=cache))
            
            elif provider_type == "osrm":
                base_url = provider_config.get("base_url", "http://router.project-osrm.org")
                providers.append(OSRMProvider(cache=cache, base_url=base_url))
            
            elif provider_type == "google_maps":
                api_key = provider_config.get("api_key") or os.getenv("GOOGLE_MAPS_API_KEY")
                providers.append(GoogleMapsProvider(api_key=api_key, cache=cache))
            
            else:  # mock
                avg_speed = provider_config.get("avg_speed_kmh", 40)
                providers.append(MockTravelTimeProvider(cache=cache, avg_speed_kmh=avg_speed))
                
        except Exception as e:
            logger = get_logger("travel_time_factory")
            logger.error(f"Failed to create {provider_type} provider", error=e)
    
    # Ensure we always have at least a mock provider
    if not providers:
        providers.append(MockTravelTimeProvider(cache=cache))
    
    return TravelTimeManager(providers)


# Example usage
if __name__ == "__main__":
    # Create manager with multiple providers
    config = {
        "providers": [
            {"type": "osrm"},
            {"type": "mock", "avg_speed_kmh": 45}
        ],
        "cache_ttl_seconds": 3600
    }
    
    manager = create_travel_time_manager(config)
    
    # Test request
    request = TravelTimeRequest(
        from_lat=45.4215,
        from_lng=-75.6972,
        to_lat=45.4105,
        to_lng=-75.6812,
        mode='driving'
    )
    
    result = manager.get_travel_time(request)
    
    logger = get_logger("travel_time_example")
    logger.info("Travel time calculated",
                duration_seconds=result.duration_seconds,
                distance_meters=result.distance_meters,
                provider=result.provider,
                cached=result.cached)
    
    # Print statistics
    stats = manager.get_stats()
    print(json.dumps(stats, indent=2))