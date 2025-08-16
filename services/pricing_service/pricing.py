# CREATE FILE: services/pricing_service/pricing.py

from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, Any
import json
import os

class PricingEngine:
    """Deterministic pricing engine using exact decimal arithmetic"""
    
    def __init__(self, config_path: str = None):
        self.config = self._load_config(config_path)
    
    def _load_config(self, config_path: str = None) -> Dict[str, Any]:
        """Load pricing configuration from JSON file"""
        if config_path is None:
            config_path = os.path.join(os.path.dirname(__file__), '../../config/defaults.json')
        
        try:
            with open(config_path, 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            # Fallback defaults if config file not found
            return {
                "commission_platform_delivered_pct": 15.0,
                "commission_self_deliver_pct": 8.0,
                "delivery_fee_base": 5.99,
                "delivery_fee_per_km": 1.25,
                "min_delivery_fee": 3.99,
                "driver_payout_pct_of_delivery": 80.0,
                "payment_fee_pct": 2.9,
                "payment_fee_fixed": 0.30,
                "rural_distance_threshold_km": 25.0,
                "rural_surcharge_pct": 20.0
            }
    
    def calculate_delivery_fee(self, distance_km: float, is_rural: bool = False) -> Dict[str, Decimal]:
        """Calculate delivery fee based on distance and rural status"""
        distance = Decimal(str(distance_km))
        base_fee = Decimal(str(self.config["delivery_fee_base"]))
        per_km_fee = Decimal(str(self.config["delivery_fee_per_km"]))
        min_fee = Decimal(str(self.config["min_delivery_fee"]))
        
        # Base calculation
        delivery_fee = base_fee + (distance * per_km_fee)
        
        # Apply minimum fee
        delivery_fee = max(delivery_fee, min_fee)
        
        # Apply rural surcharge if applicable
        rural_surcharge = Decimal('0')
        if is_rural:
            rural_surcharge_pct = Decimal(str(self.config["rural_surcharge_pct"])) / Decimal('100')
            rural_surcharge = delivery_fee * rural_surcharge_pct
            delivery_fee += rural_surcharge
        
        return {
            "base_delivery_fee": base_fee.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
            "distance_fee": (distance * per_km_fee).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
            "rural_surcharge": rural_surcharge.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
            "total_delivery_fee": delivery_fee.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        }
    
    def calculate_commission(self, order_total: float, delivery_method: str = "platform_delivered") -> Dict[str, Decimal]:
        """Calculate platform commission based on order total and delivery method"""
        order_amount = Decimal(str(order_total))
        
        if delivery_method == "self_deliver":
            commission_rate = Decimal(str(self.config["commission_self_deliver_pct"])) / Decimal('100')
        else:
            commission_rate = Decimal(str(self.config["commission_platform_delivered_pct"])) / Decimal('100')
        
        commission = order_amount * commission_rate
        
        return {
            "commission_rate_pct": (commission_rate * Decimal('100')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
            "commission_amount": commission.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        }
    
    def calculate_payment_fees(self, total_amount: float) -> Dict[str, Decimal]:
        """Calculate payment processing fees (Stripe-style)"""
        amount = Decimal(str(total_amount))
        fee_pct = Decimal(str(self.config["payment_fee_pct"])) / Decimal('100')
        fee_fixed = Decimal(str(self.config["payment_fee_fixed"]))
        
        fee_variable = amount * fee_pct
        total_fee = fee_variable + fee_fixed
        
        return {
            "fee_percentage": fee_variable.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
            "fee_fixed": fee_fixed,
            "total_payment_fee": total_fee.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        }
    
    def calculate_driver_payout(self, delivery_fee: float) -> Dict[str, Decimal]:
        """Calculate driver payout from delivery fee"""
        delivery_amount = Decimal(str(delivery_fee))
        payout_rate = Decimal(str(self.config["driver_payout_pct_of_delivery"])) / Decimal('100')
        
        driver_payout = delivery_amount * payout_rate
        platform_retention = delivery_amount - driver_payout
        
        return {
            "payout_rate_pct": (payout_rate * Decimal('100')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
            "driver_payout": driver_payout.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
            "platform_retention": platform_retention.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        }
    
    def calculate_complete_pricing(self, order_total: float, distance_km: float, 
                                 delivery_method: str = "platform_delivered") -> Dict[str, Any]:
        """Calculate complete pricing breakdown for an order"""
        
        # Determine if rural based on distance
        is_rural = distance_km > self.config["rural_distance_threshold_km"]
        
        # Calculate all components
        delivery_breakdown = self.calculate_delivery_fee(distance_km, is_rural)
        commission_breakdown = self.calculate_commission(order_total, delivery_method)
        
        # Calculate totals
        total_delivery_fee = delivery_breakdown["total_delivery_fee"]
        customer_total = Decimal(str(order_total)) + total_delivery_fee
        payment_fee_breakdown = self.calculate_payment_fees(float(customer_total))
        
        if delivery_method == "platform_delivered":
            driver_breakdown = self.calculate_driver_payout(float(total_delivery_fee))
        else:
            driver_breakdown = {"driver_payout": Decimal('0'), "platform_retention": total_delivery_fee}
        
        # Platform revenue calculation
        platform_commission = commission_breakdown["commission_amount"]
        platform_delivery_retention = driver_breakdown["platform_retention"]
        gross_platform_revenue = platform_commission + platform_delivery_retention
        net_platform_revenue = gross_platform_revenue - payment_fee_breakdown["total_payment_fee"]
        
        return {
            "order_total": Decimal(str(order_total)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
            "delivery_breakdown": {
                k: float(v) for k, v in delivery_breakdown.items()
            },
            "commission_breakdown": {
                k: float(v) for k, v in commission_breakdown.items()
            },
            "payment_fee_breakdown": {
                k: float(v) for k, v in payment_fee_breakdown.items()
            },
            "driver_breakdown": {
                k: float(v) for k, v in driver_breakdown.items()
            },
            "totals": {
                "customer_pays": float(customer_total.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)),
                "driver_receives": float(driver_breakdown["driver_payout"]),
                "vendor_receives": float((Decimal(str(order_total)) - commission_breakdown["commission_amount"]).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)),
                "gross_platform_revenue": float(gross_platform_revenue.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)),
                "net_platform_revenue": float(net_platform_revenue.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
            },
            "metadata": {
                "distance_km": distance_km,
                "is_rural": is_rural,
                "delivery_method": delivery_method
            }
        }