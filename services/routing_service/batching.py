# CREATE FILE: services/routing_service/batching.py

import math
import json
import random
from typing import List, Dict, Any, Tuple, Optional
from dataclasses import dataclass
from datetime import datetime, timedelta

try:
    from sklearn.cluster import KMeans
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False

@dataclass
class Order:
    id: str
    pickup_lat: float
    pickup_lng: float
    delivery_lat: float
    delivery_lng: float
    created_at: datetime
    priority: int = 1
    estimated_prep_time_minutes: int = 15

@dataclass 
class Batch:
    id: str
    orders: List[Order]
    center_lat: float
    center_lng: float
    created_at: datetime
    estimated_duration_minutes: int = 0

class BatchingEngine:
    """Batching engine for grouping orders efficiently"""
    
    def __init__(self, config: Dict[str, Any]):
        self.max_batch_size = config.get("max_batch_size_orders", 8)
        self.batch_window_minutes = config.get("batch_window_minutes", 15)
        self.seed = config.get("seed", 42)
        random.seed(self.seed)
    
    def haversine_distance(self, lat1: float, lng1: float, lat2: float, lng2: float) -> float:
        """Calculate haversine distance between two points in kilometers"""
        R = 6371  # Earth's radius in kilometers
        
        lat1_rad = math.radians(lat1)
        lng1_rad = math.radians(lng1)
        lat2_rad = math.radians(lat2)
        lng2_rad = math.radians(lng2)
        
        dlat = lat2_rad - lat1_rad
        dlng = lng2_rad - lng1_rad
        
        a = math.sin(dlat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlng/2)**2
        c = 2 * math.asin(math.sqrt(a))
        
        return R * c
    
    def calculate_cluster_center(self, orders: List[Order]) -> Tuple[float, float]:
        """Calculate the centroid of a group of orders"""
        if not orders:
            return 0.0, 0.0
        
        # Calculate center based on both pickup and delivery points
        lats = []
        lngs = []
        
        for order in orders:
            lats.extend([order.pickup_lat, order.delivery_lat])
            lngs.extend([order.pickup_lng, order.delivery_lng])
        
        center_lat = sum(lats) / len(lats)
        center_lng = sum(lngs) / len(lngs)
        
        return center_lat, center_lng
    
    def kmeans_clustering(self, orders: List[Order], n_clusters: int) -> List[List[Order]]:
        """Cluster orders using K-means on pickup locations"""
        if not SKLEARN_AVAILABLE:
            return self.grid_clustering(orders, n_clusters)
        
        if len(orders) <= n_clusters:
            return [[order] for order in orders]
        
        # Extract pickup coordinates
        coordinates = [[order.pickup_lat, order.pickup_lng] for order in orders]
        
        try:
            kmeans = KMeans(n_clusters=n_clusters, random_state=self.seed, n_init=10)
            cluster_labels = kmeans.fit_predict(coordinates)
            
            # Group orders by cluster
            clusters = [[] for _ in range(n_clusters)]
            for i, label in enumerate(cluster_labels):
                clusters[label].append(orders[i])
            
            # Remove empty clusters
            return [cluster for cluster in clusters if cluster]
        
        except Exception:
            # Fallback to grid clustering if K-means fails
            return self.grid_clustering(orders, n_clusters)
    
    def grid_clustering(self, orders: List[Order], n_clusters: int) -> List[List[Order]]:
        """Fallback clustering using grid-based approach"""
        if len(orders) <= n_clusters:
            return [[order] for order in orders]
        
        # Find bounding box
        min_lat = min(order.pickup_lat for order in orders)
        max_lat = max(order.pickup_lat for order in orders)
        min_lng = min(order.pickup_lng for order in orders)
        max_lng = max(order.pickup_lng for order in orders)
        
        # Create grid
        grid_size = math.ceil(math.sqrt(n_clusters))
        lat_step = (max_lat - min_lat) / grid_size
        lng_step = (max_lng - min_lng) / grid_size
        
        # Assign orders to grid cells
        grid_clusters = {}
        for order in orders:
            grid_lat = int((order.pickup_lat - min_lat) / lat_step) if lat_step > 0 else 0
            grid_lng = int((order.pickup_lng - min_lng) / lng_step) if lng_step > 0 else 0
            
            # Ensure we don't exceed grid bounds
            grid_lat = min(grid_lat, grid_size - 1)
            grid_lng = min(grid_lng, grid_size - 1)
            
            cell_key = (grid_lat, grid_lng)
            if cell_key not in grid_clusters:
                grid_clusters[cell_key] = []
            grid_clusters[cell_key].append(order)
        
        return list(grid_clusters.values())
    
    def get_highway_reference_point(self) -> Optional[Tuple[float, float]]:
        """Get a reference point on Highway 7 for distance calculations"""
        # Return a central point on Highway 7 (Ottawa area)
        # This is a simplified approximation - latitude ~45.38, longitude ~-75.70
        return (45.38, -75.70)
    
    def filter_orders_by_highway_deviation(self, orders: List[Order], 
                                          max_deviation_km: float = 5.0) -> List[Order]:
        """
        Filter orders that are too far from Highway 7 artery
        Limits 'off-highway' deviation to specified km (default 5km)
        """
        highway_point = self.get_highway_reference_point()
        if not highway_point:
            return orders  # No filtering if highway reference unavailable
        
        filtered_orders = []
        highway_lat, highway_lng = highway_point
        
        for order in orders:
            # Check both pickup and delivery distances from highway
            pickup_distance = self.haversine_distance(
                order.pickup_lat, order.pickup_lng, highway_lat, highway_lng
            )
            delivery_distance = self.haversine_distance(
                order.delivery_lat, order.delivery_lng, highway_lat, highway_lng
            )
            
            # Include order if either pickup or delivery is within deviation limit
            # This ensures we capture orders serviced via the highway
            if pickup_distance <= max_deviation_km or delivery_distance <= max_deviation_km:
                filtered_orders.append(order)
        
        return filtered_orders
    
    def validate_cluster_highway_deviation(self, cluster: List[Order], 
                                          max_deviation_km: float = 5.0) -> bool:
        """
        Validate that a cluster's centroid doesn't deviate too far from Highway 7
        Returns True if cluster is acceptable, False otherwise
        """
        if not cluster:
            return True
        
        center_lat, center_lng = self.calculate_cluster_center(cluster)
        highway_point = self.get_highway_reference_point()
        
        if not highway_point:
            return True  # Accept if no highway reference available
        
        highway_lat, highway_lng = highway_point
        distance = self.haversine_distance(center_lat, center_lng, highway_lat, highway_lng)
        
        return distance <= max_deviation_km
    
    def balance_batches(self, clusters: List[List[Order]]) -> List[List[Order]]:
        """Balance cluster sizes to respect max batch size"""
        balanced_batches = []
        
        for cluster in clusters:
            if len(cluster) <= self.max_batch_size:
                balanced_batches.append(cluster)
            else:
                # Split large clusters
                for i in range(0, len(cluster), self.max_batch_size):
                    batch = cluster[i:i + self.max_batch_size]
                    balanced_batches.append(batch)
        
        return balanced_batches
    
    def merge_small_batches(self, batches: List[List[Order]]) -> List[List[Order]]:
        """Merge very small batches if possible"""
        if len(batches) <= 1:
            return batches
        
        merged_batches = []
        i = 0
        
        while i < len(batches):
            current_batch = batches[i]
            
            # If current batch is small, try to merge with next small batch
            if len(current_batch) <= 2 and i + 1 < len(batches):
                next_batch = batches[i + 1]
                
                if len(current_batch) + len(next_batch) <= self.max_batch_size:
                    # Merge if geographic distance is reasonable
                    center1 = self.calculate_cluster_center(current_batch)
                    center2 = self.calculate_cluster_center(next_batch)
                    distance = self.haversine_distance(center1[0], center1[1], center2[0], center2[1])
                    
                    if distance <= 10:  # 10km threshold for merging
                        merged_batch = current_batch + next_batch
                        merged_batches.append(merged_batch)
                        i += 2
                        continue
            
            merged_batches.append(current_batch)
            i += 1
        
        return merged_batches
    
    def filter_orders_by_time_window(self, orders: List[Order], 
                                   current_time: Optional[datetime] = None) -> List[Order]:
        """Filter orders that fall within the batching time window"""
        if current_time is None:
            current_time = datetime.now()
        
        window_start = current_time - timedelta(minutes=self.batch_window_minutes)
        
        return [
            order for order in orders 
            if order.created_at >= window_start
        ]
    
    def create_batches(self, orders: List[Order], 
                      current_time: Optional[datetime] = None,
                      max_highway_deviation_km: float = 5.0) -> List[Batch]:
        """
        Main method to create batches from a list of orders
        Now includes highway deviation filtering to limit off-highway orders
        """
        if not orders:
            return []
        
        # Filter orders by time window
        eligible_orders = self.filter_orders_by_time_window(orders, current_time)
        
        if not eligible_orders:
            return []
        
        # NEW: Filter orders by highway deviation (Pulse constraint)
        # Only include orders within 5km of Highway 7
        highway_filtered_orders = self.filter_orders_by_highway_deviation(
            eligible_orders, max_highway_deviation_km
        )
        
        if not highway_filtered_orders:
            # If no orders near highway, fall back to original orders
            # This prevents complete failure in areas far from Highway 7
            import logging
            logging.warning(
                f"No orders within {max_highway_deviation_km}km of Highway 7. "
                f"Falling back to unfiltered orders ({len(eligible_orders)} orders)."
            )
            highway_filtered_orders = eligible_orders
        
        # Sort by priority and creation time
        highway_filtered_orders.sort(key=lambda x: (-x.priority, x.created_at))
        
        # Determine number of clusters
        if len(highway_filtered_orders) <= self.max_batch_size:
            n_clusters = 1
        else:
            # Aim for batches of roughly max_batch_size/2 to max_batch_size
            n_clusters = max(1, len(highway_filtered_orders) // (self.max_batch_size // 2))
        
        # Cluster orders
        clusters = self.kmeans_clustering(highway_filtered_orders, n_clusters)
        
        # NEW: Filter out clusters that deviate too far from highway
        valid_clusters = [
            cluster for cluster in clusters
            if self.validate_cluster_highway_deviation(cluster, max_highway_deviation_km)
        ]
        
        # If all clusters were filtered out, use original clusters
        if not valid_clusters:
            import logging
            logging.warning(
                f"All {len(clusters)} clusters exceed {max_highway_deviation_km}km highway deviation. "
                f"Using unfiltered clusters to prevent empty batch result."
            )
            valid_clusters = clusters
        
        # Balance batch sizes
        balanced_batches = self.balance_batches(valid_clusters)
        
        # Merge small batches if beneficial
        final_batches = self.merge_small_batches(balanced_batches)
        
        # Create Batch objects
        batches = []
        for i, batch_orders in enumerate(final_batches):
            if batch_orders:  # Only create non-empty batches
                center_lat, center_lng = self.calculate_cluster_center(batch_orders)
                
                batch = Batch(
                    id=f"batch_{int(datetime.now().timestamp())}_{i}",
                    orders=batch_orders,
                    center_lat=center_lat,
                    center_lng=center_lng,
                    created_at=current_time or datetime.now()
                )
                batches.append(batch)
        
        return batches
    
    def estimate_batch_duration(self, batch: Batch) -> int:
        """Estimate completion time for a batch in minutes"""
        if not batch.orders:
            return 0
        
        # Base time estimates
        base_prep_time = max(order.estimated_prep_time_minutes for order in batch.orders)
        pickup_time_per_order = 5  # minutes per pickup
        delivery_time_per_order = 8  # minutes per delivery
        travel_time_estimate = len(batch.orders) * 12  # rough estimate for travel between points
        
        total_time = (
            base_prep_time + 
            (len(batch.orders) * pickup_time_per_order) +
            (len(batch.orders) * delivery_time_per_order) +
            travel_time_estimate
        )
        
        batch.estimated_duration_minutes = total_time
        return total_time