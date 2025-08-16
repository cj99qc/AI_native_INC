# CREATE FILE: services/pricing_service/tests/test_pricing.py

import pytest
from decimal import Decimal
from services.pricing_service.pricing import PricingEngine
import os
import json
import tempfile

class TestPricingEngine:
    
    @pytest.fixture
    def pricing_engine(self):
        """Create pricing engine with test configuration"""
        return PricingEngine()
    
    @pytest.fixture
    def test_config(self):
        """Create a test configuration file"""
        config = {
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
        
        # Create temporary config file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(config, f)
            temp_path = f.name
        
        yield temp_path
        
        # Cleanup
        os.unlink(temp_path)
    
    def test_delivery_fee_calculation(self, pricing_engine):
        """Test delivery fee calculation with exact values"""
        # Test case: 5km delivery, non-rural
        result = pricing_engine.calculate_delivery_fee(5.0, False)
        
        expected_base = Decimal('5.99')
        expected_distance = Decimal('5.0') * Decimal('1.25')  # 6.25
        expected_total = expected_base + expected_distance  # 12.24
        
        assert result["base_delivery_fee"] == expected_base
        assert result["distance_fee"] == expected_distance
        assert result["rural_surcharge"] == Decimal('0.00')
        assert result["total_delivery_fee"] == expected_total
    
    def test_delivery_fee_minimum(self, pricing_engine):
        """Test minimum delivery fee enforcement"""
        # Test case: very short distance should hit minimum fee
        result = pricing_engine.calculate_delivery_fee(0.5, False)
        
        # Base (5.99) + Distance (0.625) = 6.615, above minimum 3.99
        assert result["total_delivery_fee"] >= Decimal('3.99')
        
        # Test with extremely short distance
        result_min = pricing_engine.calculate_delivery_fee(0.0, False)
        assert result_min["total_delivery_fee"] >= Decimal('3.99')
    
    def test_rural_surcharge(self, pricing_engine):
        """Test rural surcharge calculation"""
        # Test case: 30km delivery (rural)
        result = pricing_engine.calculate_delivery_fee(30.0, True)
        
        base_fee = Decimal('5.99') + (Decimal('30.0') * Decimal('1.25'))  # 43.49
        rural_surcharge = base_fee * Decimal('0.20')  # 8.698 -> 8.70
        expected_total = base_fee + rural_surcharge  # 52.19
        
        assert result["rural_surcharge"] == rural_surcharge.quantize(Decimal('0.01'))
        assert result["total_delivery_fee"] == expected_total.quantize(Decimal('0.01'))
    
    def test_commission_calculation(self, pricing_engine):
        """Test commission calculation for different delivery methods"""
        order_total = 40.0
        
        # Platform delivered (15% commission)
        result_platform = pricing_engine.calculate_commission(order_total, "platform_delivered")
        expected_commission = Decimal('40.0') * Decimal('0.15')  # 6.00
        
        assert result_platform["commission_rate_pct"] == Decimal('15.00')
        assert result_platform["commission_amount"] == expected_commission
        
        # Self deliver (8% commission)
        result_self = pricing_engine.calculate_commission(order_total, "self_deliver")
        expected_commission_self = Decimal('40.0') * Decimal('0.08')  # 3.20
        
        assert result_self["commission_rate_pct"] == Decimal('8.00')
        assert result_self["commission_amount"] == expected_commission_self
    
    def test_payment_fees(self, pricing_engine):
        """Test payment processing fee calculation"""
        # Test case: $52.24 total (order + delivery)
        total_amount = 52.24
        result = pricing_engine.calculate_payment_fees(total_amount)
        
        expected_variable = Decimal('52.24') * Decimal('0.029')  # 1.5150
        expected_fixed = Decimal('0.30')
        expected_total = expected_variable + expected_fixed  # 1.8150 -> 1.82
        
        assert result["fee_percentage"] == expected_variable.quantize(Decimal('0.01'))
        assert result["fee_fixed"] == expected_fixed
        assert result["total_payment_fee"] == expected_total.quantize(Decimal('0.01'))
    
    def test_driver_payout(self, pricing_engine):
        """Test driver payout calculation"""
        delivery_fee = 12.24
        result = pricing_engine.calculate_driver_payout(delivery_fee)
        
        expected_payout = Decimal('12.24') * Decimal('0.80')  # 9.792 -> 9.79
        expected_retention = Decimal('12.24') - expected_payout  # 2.45
        
        assert result["payout_rate_pct"] == Decimal('80.00')
        assert result["driver_payout"] == expected_payout.quantize(Decimal('0.01'))
        assert result["platform_retention"] == expected_retention.quantize(Decimal('0.01'))
    
    def test_complete_pricing_integration(self, pricing_engine):
        """Test complete pricing calculation with known values"""
        # Known test case: $40 order, 5km delivery, platform delivered
        result = pricing_engine.calculate_complete_pricing(
            order_total=40.0,
            distance_km=5.0,
            delivery_method="platform_delivered"
        )
        
        # Expected calculations:
        # Delivery fee: 5.99 + (5 * 1.25) = 12.24
        # Customer total: 40.00 + 12.24 = 52.24
        # Commission: 40.00 * 0.15 = 6.00
        # Payment fee: (52.24 * 0.029) + 0.30 = 1.82
        # Driver payout: 12.24 * 0.80 = 9.79
        # Platform delivery retention: 12.24 - 9.79 = 2.45
        # Gross platform revenue: 6.00 + 2.45 = 8.45
        # Net platform revenue: 8.45 - 1.82 = 6.63
        
        assert result["order_total"] == 40.0
        assert result["delivery_breakdown"]["total_delivery_fee"] == 12.24
        assert result["commission_breakdown"]["commission_amount"] == 6.0
        assert result["payment_fee_breakdown"]["total_payment_fee"] == 1.82
        assert result["driver_breakdown"]["driver_payout"] == 9.79
        assert result["totals"]["customer_pays"] == 52.24
        assert result["totals"]["driver_receives"] == 9.79
        assert result["totals"]["vendor_receives"] == 34.0  # 40 - 6 commission
        assert result["totals"]["gross_platform_revenue"] == 8.45
        assert result["totals"]["net_platform_revenue"] == 6.63
        assert result["metadata"]["is_rural"] == False
    
    def test_rural_order_pricing(self, pricing_engine):
        """Test complete pricing for rural order"""
        # Test case: $40 order, 30km delivery (rural)
        result = pricing_engine.calculate_complete_pricing(
            order_total=40.0,
            distance_km=30.0,
            delivery_method="platform_delivered"
        )
        
        # Rural order should have surcharge
        assert result["metadata"]["is_rural"] == True
        assert result["delivery_breakdown"]["rural_surcharge"] > 0
        assert result["delivery_breakdown"]["total_delivery_fee"] > 43.49  # Base fee without surcharge
    
    def test_self_delivery_pricing(self, pricing_engine):
        """Test pricing for self-delivery orders"""
        result = pricing_engine.calculate_complete_pricing(
            order_total=40.0,
            distance_km=5.0,
            delivery_method="self_deliver"
        )
        
        # Self deliver should have lower commission and no driver payout
        assert result["commission_breakdown"]["commission_rate_pct"] == 8.0
        assert result["commission_breakdown"]["commission_amount"] == 3.2
        assert result["driver_breakdown"]["driver_payout"] == 0.0
    
    def test_deterministic_results(self, pricing_engine):
        """Test that calculations are deterministic"""
        # Same inputs should always produce same outputs
        inputs = (40.0, 5.0, "platform_delivered")
        
        result1 = pricing_engine.calculate_complete_pricing(*inputs)
        result2 = pricing_engine.calculate_complete_pricing(*inputs)
        
        assert result1 == result2
    
    def test_config_loading_fallback(self):
        """Test that engine works with fallback config when file not found"""
        engine = PricingEngine("/nonexistent/path.json")
        
        # Should still work with built-in defaults
        result = engine.calculate_complete_pricing(40.0, 5.0)
        assert "order_total" in result
        assert result["order_total"] == 40.0