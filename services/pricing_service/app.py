# CREATE FILE: services/pricing_service/app.py

from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
import os
from .pricing import PricingEngine

app = FastAPI(title="Pricing Service", version="1.0.0")

# Initialize pricing engine
pricing_engine = PricingEngine()

class PriceRequest(BaseModel):
    order_total: float = Field(..., gt=0, description="Order total in dollars")
    distance_km: float = Field(..., ge=0, description="Delivery distance in kilometers")
    delivery_method: Optional[str] = Field("platform_delivered", description="Delivery method: platform_delivered or self_deliver")

class PriceResponse(BaseModel):
    order_total: float
    delivery_breakdown: Dict[str, float]
    commission_breakdown: Dict[str, float]
    payment_fee_breakdown: Dict[str, float]
    driver_breakdown: Dict[str, float]
    totals: Dict[str, float]
    metadata: Dict[str, Any]

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"ok": True}

@app.post("/price", response_model=PriceResponse)
async def calculate_price(request: PriceRequest):
    """
    Calculate complete pricing breakdown for an order.
    
    This endpoint provides deterministic pricing calculations including:
    - Delivery fees (base + distance + rural surcharge)
    - Platform commission
    - Payment processing fees
    - Driver payout
    - Platform revenue breakdown
    """
    try:
        # Validate delivery method
        if request.delivery_method not in ["platform_delivered", "self_deliver"]:
            raise HTTPException(
                status_code=400, 
                detail="delivery_method must be 'platform_delivered' or 'self_deliver'"
            )
        
        # Calculate pricing
        result = pricing_engine.calculate_complete_pricing(
            order_total=request.order_total,
            distance_km=request.distance_km,
            delivery_method=request.delivery_method
        )
        
        return PriceResponse(**result)
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid input: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pricing calculation failed: {str(e)}")

@app.get("/config")
async def get_pricing_config():
    """Get current pricing configuration"""
    return pricing_engine.config

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port)