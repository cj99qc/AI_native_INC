# CREATE FILE: services/escrow_service/app.py

from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional, List
from enum import Enum
from datetime import datetime, timezone
import uuid
import json
import os

app = FastAPI(title="Escrow Service", version="1.0.0")

class EscrowStatus(str, Enum):
    PENDING = "pending"
    HELD = "held"
    RELEASED = "released"
    DISPUTED = "disputed"
    REFUNDED = "refunded"

class PaymentBreakdown(BaseModel):
    total_cents: int = Field(..., ge=0)
    platform_fee_cents: int = Field(..., ge=0)
    delivery_fee_cents: int = Field(..., ge=0)
    driver_payout_cents: int = Field(..., ge=0)
    vendor_payout_cents: int = Field(..., ge=0)

class EscrowRequest(BaseModel):
    order_id: str
    customer_id: str
    vendor_id: str
    driver_id: Optional[str] = None
    batch_id: Optional[str] = None
    payment_breakdown: PaymentBreakdown
    payment_intent_id: Optional[str] = None

class EscrowRecord(BaseModel):
    id: str
    order_id: str
    customer_id: str
    vendor_id: str
    driver_id: Optional[str]
    batch_id: Optional[str]
    status: EscrowStatus
    payment_breakdown: PaymentBreakdown
    payment_intent_id: Optional[str]
    created_at: datetime
    held_at: Optional[datetime]
    released_at: Optional[datetime]
    disputed_at: Optional[datetime]
    refunded_at: Optional[datetime]
    metadata: Dict[str, Any]

class ReleaseRequest(BaseModel):
    escrow_id: str
    completion_confirmed: bool
    completion_notes: Optional[str] = None

class DisputeRequest(BaseModel):
    escrow_id: str
    dispute_reason: str
    disputed_by: str  # customer_id, vendor_id, or driver_id
    dispute_notes: Optional[str] = None

class RefundRequest(BaseModel):
    escrow_id: str
    refund_reason: str
    partial_refund_cents: Optional[int] = None  # If None, full refund

class MockStripeConnector:
    """Mock Stripe connector for local development"""
    
    def __init__(self, use_real_stripe: bool = False):
        self.use_real_stripe = use_real_stripe
        if use_real_stripe:
            try:
                import stripe
                self.stripe = stripe
                self.stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
            except ImportError:
                print("Warning: Stripe not available, using mock connector")
                self.use_real_stripe = False
    
    def hold_funds(self, payment_intent_id: str, amount_cents: int) -> Dict[str, Any]:
        """Hold funds from a payment intent"""
        if self.use_real_stripe and payment_intent_id:
            try:
                # In real implementation, you would capture the payment intent
                # and hold funds in your platform account
                pi = self.stripe.PaymentIntent.retrieve(payment_intent_id)
                if pi.status == 'requires_capture':
                    pi.capture()
                return {"success": True, "stripe_payment_intent": pi.id}
            except Exception as e:
                return {"success": False, "error": str(e)}
        else:
            # Mock successful hold
            return {
                "success": True,
                "mock_transaction_id": f"mock_hold_{uuid.uuid4().hex[:12]}",
                "amount_cents": amount_cents
            }
    
    def release_funds(self, transaction_id: str, breakdown: PaymentBreakdown) -> Dict[str, Any]:
        """Release held funds to vendor and driver"""
        if self.use_real_stripe:
            try:
                # In real implementation, you would create transfers to connected accounts
                transfers = []
                if breakdown.vendor_payout_cents > 0:
                    vendor_transfer = self.stripe.Transfer.create(
                        amount=breakdown.vendor_payout_cents,
                        currency='usd',
                        destination=f'acct_vendor_{transaction_id}',  # Would be real account ID
                    )
                    transfers.append(vendor_transfer.id)
                
                if breakdown.driver_payout_cents > 0:
                    driver_transfer = self.stripe.Transfer.create(
                        amount=breakdown.driver_payout_cents,
                        currency='usd',
                        destination=f'acct_driver_{transaction_id}',  # Would be real account ID
                    )
                    transfers.append(driver_transfer.id)
                
                return {"success": True, "transfers": transfers}
            except Exception as e:
                return {"success": False, "error": str(e)}
        else:
            # Mock successful release
            return {
                "success": True,
                "mock_vendor_transfer": f"mock_vendor_{uuid.uuid4().hex[:8]}",
                "mock_driver_transfer": f"mock_driver_{uuid.uuid4().hex[:8]}",
                "vendor_amount_cents": breakdown.vendor_payout_cents,
                "driver_amount_cents": breakdown.driver_payout_cents
            }
    
    def refund_funds(self, payment_intent_id: str, amount_cents: int) -> Dict[str, Any]:
        """Refund funds to customer"""
        if self.use_real_stripe and payment_intent_id:
            try:
                refund = self.stripe.Refund.create(
                    payment_intent=payment_intent_id,
                    amount=amount_cents
                )
                return {"success": True, "refund_id": refund.id}
            except Exception as e:
                return {"success": False, "error": str(e)}
        else:
            # Mock successful refund
            return {
                "success": True,
                "mock_refund_id": f"mock_refund_{uuid.uuid4().hex[:8]}",
                "amount_cents": amount_cents
            }

class EscrowStateMachine:
    """Escrow state machine for managing payment states"""
    
    def __init__(self, stripe_connector: MockStripeConnector):
        self.stripe = stripe_connector
        self.escrows: Dict[str, EscrowRecord] = {}
    
    def create_escrow(self, request: EscrowRequest) -> EscrowRecord:
        """Create a new escrow record"""
        escrow_id = str(uuid.uuid4())
        
        escrow = EscrowRecord(
            id=escrow_id,
            order_id=request.order_id,
            customer_id=request.customer_id,
            vendor_id=request.vendor_id,
            driver_id=request.driver_id,
            batch_id=request.batch_id,
            status=EscrowStatus.PENDING,
            payment_breakdown=request.payment_breakdown,
            payment_intent_id=request.payment_intent_id,
            created_at=datetime.now(timezone.utc),
            held_at=None,
            released_at=None,
            disputed_at=None,
            refunded_at=None,
            metadata={}
        )
        
        self.escrows[escrow_id] = escrow
        return escrow
    
    def hold_funds(self, escrow_id: str) -> Dict[str, Any]:
        """Transition from PENDING to HELD"""
        if escrow_id not in self.escrows:
            raise ValueError(f"Escrow {escrow_id} not found")
        
        escrow = self.escrows[escrow_id]
        
        if escrow.status != EscrowStatus.PENDING:
            raise ValueError(f"Cannot hold funds for escrow in status {escrow.status}")
        
        # Hold funds via payment processor
        hold_result = self.stripe.hold_funds(
            escrow.payment_intent_id,
            escrow.payment_breakdown.total_cents
        )
        
        if hold_result["success"]:
            escrow.status = EscrowStatus.HELD
            escrow.held_at = datetime.now(timezone.utc)
            escrow.metadata.update(hold_result)
            return {"success": True, "escrow": escrow}
        else:
            return {"success": False, "error": hold_result.get("error", "Unknown error")}
    
    def release_funds(self, escrow_id: str, completion_notes: Optional[str] = None) -> Dict[str, Any]:
        """Transition from HELD to RELEASED"""
        if escrow_id not in self.escrows:
            raise ValueError(f"Escrow {escrow_id} not found")
        
        escrow = self.escrows[escrow_id]
        
        if escrow.status != EscrowStatus.HELD:
            raise ValueError(f"Cannot release funds for escrow in status {escrow.status}")
        
        # Release funds to vendor and driver
        release_result = self.stripe.release_funds(
            escrow_id,
            escrow.payment_breakdown
        )
        
        if release_result["success"]:
            escrow.status = EscrowStatus.RELEASED
            escrow.released_at = datetime.now(timezone.utc)
            if completion_notes:
                escrow.metadata["completion_notes"] = completion_notes
            escrow.metadata.update(release_result)
            return {"success": True, "escrow": escrow}
        else:
            return {"success": False, "error": release_result.get("error", "Unknown error")}
    
    def dispute_funds(self, escrow_id: str, dispute_reason: str, 
                     disputed_by: str, dispute_notes: Optional[str] = None) -> Dict[str, Any]:
        """Transition from HELD to DISPUTED"""
        if escrow_id not in self.escrows:
            raise ValueError(f"Escrow {escrow_id} not found")
        
        escrow = self.escrows[escrow_id]
        
        if escrow.status != EscrowStatus.HELD:
            raise ValueError(f"Cannot dispute escrow in status {escrow.status}")
        
        escrow.status = EscrowStatus.DISPUTED
        escrow.disputed_at = datetime.now(timezone.utc)
        escrow.metadata.update({
            "dispute_reason": dispute_reason,
            "disputed_by": disputed_by,
            "dispute_notes": dispute_notes
        })
        
        return {"success": True, "escrow": escrow}
    
    def refund_funds(self, escrow_id: str, refund_reason: str, 
                    partial_amount_cents: Optional[int] = None) -> Dict[str, Any]:
        """Refund funds to customer"""
        if escrow_id not in self.escrows:
            raise ValueError(f"Escrow {escrow_id} not found")
        
        escrow = self.escrows[escrow_id]
        
        if escrow.status not in [EscrowStatus.HELD, EscrowStatus.DISPUTED]:
            raise ValueError(f"Cannot refund escrow in status {escrow.status}")
        
        refund_amount = partial_amount_cents or escrow.payment_breakdown.total_cents
        
        # Process refund
        refund_result = self.stripe.refund_funds(
            escrow.payment_intent_id,
            refund_amount
        )
        
        if refund_result["success"]:
            escrow.status = EscrowStatus.REFUNDED
            escrow.refunded_at = datetime.now(timezone.utc)
            escrow.metadata.update({
                "refund_reason": refund_reason,
                "refund_amount_cents": refund_amount,
                **refund_result
            })
            return {"success": True, "escrow": escrow}
        else:
            return {"success": False, "error": refund_result.get("error", "Unknown error")}
    
    def get_escrow(self, escrow_id: str) -> Optional[EscrowRecord]:
        """Get escrow by ID"""
        return self.escrows.get(escrow_id)
    
    def list_escrows_by_order(self, order_id: str) -> List[EscrowRecord]:
        """List all escrows for an order"""
        return [e for e in self.escrows.values() if e.order_id == order_id]

# Initialize services
use_real_stripe = os.getenv("USE_REAL_STRIPE", "false").lower() == "true"
stripe_connector = MockStripeConnector(use_real_stripe)
escrow_machine = EscrowStateMachine(stripe_connector)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"ok": True}

@app.post("/hold_funds")
async def hold_funds_endpoint(request: EscrowRequest):
    """
    Create escrow and hold funds for an order.
    
    This creates an escrow record and attempts to hold the customer's payment
    until the order is completed or disputed.
    """
    try:
        # Create escrow record
        escrow = escrow_machine.create_escrow(request)
        
        # Attempt to hold funds
        result = escrow_machine.hold_funds(escrow.id)
        
        if result["success"]:
            return {
                "success": True,
                "escrow_id": escrow.id,
                "status": escrow.status,
                "held_at": escrow.held_at.isoformat() if escrow.held_at else None
            }
        else:
            return {
                "success": False,
                "error": result["error"],
                "escrow_id": escrow.id
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Hold funds failed: {str(e)}")

@app.post("/release_funds")
async def release_funds_endpoint(request: ReleaseRequest):
    """
    Release held funds to vendor and driver after successful completion.
    """
    try:
        result = escrow_machine.release_funds(
            request.escrow_id,
            request.completion_notes
        )
        
        if result["success"]:
            escrow = result["escrow"]
            return {
                "success": True,
                "escrow_id": escrow.id,
                "status": escrow.status,
                "released_at": escrow.released_at.isoformat() if escrow.released_at else None,
                "vendor_payout_cents": escrow.payment_breakdown.vendor_payout_cents,
                "driver_payout_cents": escrow.payment_breakdown.driver_payout_cents
            }
        else:
            return {"success": False, "error": result["error"]}
            
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Release funds failed: {str(e)}")

@app.post("/dispute")
async def dispute_funds_endpoint(request: DisputeRequest):
    """
    Mark escrow as disputed and halt automatic fund release.
    """
    try:
        result = escrow_machine.dispute_funds(
            request.escrow_id,
            request.dispute_reason,
            request.disputed_by,
            request.dispute_notes
        )
        
        escrow = result["escrow"]
        return {
            "success": True,
            "escrow_id": escrow.id,
            "status": escrow.status,
            "disputed_at": escrow.disputed_at.isoformat() if escrow.disputed_at else None,
            "dispute_reason": request.dispute_reason
        }
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Dispute failed: {str(e)}")

@app.post("/refund")
async def refund_funds_endpoint(request: RefundRequest):
    """
    Refund funds to customer (full or partial).
    """
    try:
        result = escrow_machine.refund_funds(
            request.escrow_id,
            request.refund_reason,
            request.partial_refund_cents
        )
        
        if result["success"]:
            escrow = result["escrow"]
            return {
                "success": True,
                "escrow_id": escrow.id,
                "status": escrow.status,
                "refunded_at": escrow.refunded_at.isoformat() if escrow.refunded_at else None,
                "refund_amount_cents": escrow.metadata.get("refund_amount_cents", 0)
            }
        else:
            return {"success": False, "error": result["error"]}
            
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Refund failed: {str(e)}")

@app.get("/escrow/{escrow_id}")
async def get_escrow_status(escrow_id: str):
    """Get current status of an escrow"""
    try:
        escrow = escrow_machine.get_escrow(escrow_id)
        if not escrow:
            raise HTTPException(status_code=404, detail="Escrow not found")
        
        return {
            "escrow_id": escrow.id,
            "order_id": escrow.order_id,
            "status": escrow.status,
            "payment_breakdown": escrow.payment_breakdown.dict(),
            "created_at": escrow.created_at.isoformat(),
            "held_at": escrow.held_at.isoformat() if escrow.held_at else None,
            "released_at": escrow.released_at.isoformat() if escrow.released_at else None,
            "disputed_at": escrow.disputed_at.isoformat() if escrow.disputed_at else None,
            "refunded_at": escrow.refunded_at.isoformat() if escrow.refunded_at else None,
            "metadata": escrow.metadata
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Get escrow failed: {str(e)}")

@app.get("/order/{order_id}/escrows")
async def get_order_escrows(order_id: str):
    """Get all escrows for an order"""
    try:
        escrows = escrow_machine.list_escrows_by_order(order_id)
        
        return {
            "order_id": order_id,
            "escrow_count": len(escrows),
            "escrows": [
                {
                    "escrow_id": e.id,
                    "status": e.status,
                    "created_at": e.created_at.isoformat(),
                    "total_cents": e.payment_breakdown.total_cents
                }
                for e in escrows
            ]
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Get order escrows failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8004"))
    uvicorn.run(app, host="0.0.0.0", port=port)