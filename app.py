import asyncio
import datetime
import os
from pathlib import Path
import traceback
import uuid

import jwt
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from backend import (
    run_travel_agent,
    resume_travel_agent,
    refine_travel_itinerary,
    create_user,
    get_user_by_email,
    get_user_by_id,
    verify_password,
    save_or_update_trip,
    get_user_trips,
    get_trip,
    delete_trip,
)
from mcp_client import extract_destination

BASE_DIR = Path(__file__).resolve().parent
JWT_SECRET = os.getenv(
    "JWT_SECRET",
    "tripmate-ai-super-secret-key-production-grade-2026-secure-32bytes",
)
JWT_ALGORITHM = "HS256"

app = FastAPI(
    title="TripMate AI",
    description=(
        "Professional Multi-Agent Travel Planning SaaS with LangGraph, "
        "MCP, Supervisor, Guardrails, HITL, and Continuous Refinement"
    ),
    version="2.5.0",
)

app.mount(
    "/static",
    StaticFiles(directory=str(BASE_DIR / "static")),
    name="static",
)

@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


# =========================================================
# Authentication Helpers
# =========================================================

def create_access_token(user_id: int, email: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user_optional(request: Request) -> dict | None:
    token = request.cookies.get("auth_token")
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1]
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = int(payload.get("sub"))
        return get_user_by_id(user_id)
    except Exception:
        return None


# =========================================================
# Request Schemas
# =========================================================

class SignUpRequest(BaseModel):
    name: str = Field(min_length=1)
    email: str = Field(min_length=3)
    password: str = Field(min_length=6)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=1)


class TravelRequest(BaseModel):
    message: str
    thread_id: str | None = None


class ApprovalRequest(BaseModel):
    thread_id: str = Field(min_length=1)
    approved: bool
    feedback: str = ""


class RefineRequest(BaseModel):
    thread_id: str = Field(min_length=1)
    feedback: str = Field(min_length=1)
    current_itinerary: str = Field(min_length=1)
    user_query: str = ""


# =========================================================
# Page Routes
# =========================================================

@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={},
    )


# =========================================================
# Auth API Endpoints
# =========================================================

@app.post("/api/auth/signup")
async def signup(request_data: SignUpRequest, response: Response):
    try:
        user = create_user(
            email=request_data.email,
            password=request_data.password,
            name=request_data.name,
        )
        token = create_access_token(user_id=user["id"], email=user["email"])
        response.set_cookie(
            key="auth_token",
            value=token,
            httponly=True,
            max_age=604800,  # 7 days
            samesite="lax",
        )
        return JSONResponse(
            content={
                "success": True,
                "user": user,
                "token": token,
            }
        )
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"success": False, "error": str(exc)})
    except Exception as exc:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"success": False, "error": str(exc)})


@app.post("/api/auth/login")
async def login(request_data: LoginRequest, response: Response):
    try:
        user = get_user_by_email(request_data.email)
        if not user or not verify_password(request_data.password, user["password_hash"]):
            return JSONResponse(
                status_code=401,
                content={"success": False, "error": "Invalid email or password."},
            )

        token = create_access_token(user_id=user["id"], email=user["email"])
        response.set_cookie(
            key="auth_token",
            value=token,
            httponly=True,
            max_age=604800,
            samesite="lax",
        )
        user_safe = {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "created_at": user.get("created_at"),
        }
        return JSONResponse(
            content={
                "success": True,
                "user": user_safe,
                "token": token,
            }
        )
    except Exception as exc:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"success": False, "error": str(exc)})


@app.post("/api/auth/logout")
async def logout(response: Response):
    response.delete_cookie(key="auth_token")
    return JSONResponse(content={"success": True, "message": "Logged out successfully."})


@app.get("/api/auth/me")
async def get_me(request: Request):
    user = get_current_user_optional(request)
    if user:
        return {
            "authenticated": True,
            "user": {
                "id": user["id"],
                "email": user["email"],
                "name": user["name"],
                "created_at": user.get("created_at"),
            },
        }
    return {"authenticated": False, "user": None}


# =========================================================
# Trips & Dashboard API Endpoints
# =========================================================

@app.get("/api/trips")
async def list_trips(request: Request, thread_id: str | None = None):
    try:
        user = get_current_user_optional(request)
        user_id = user["id"] if user else None
        trips = get_user_trips(user_id=user_id, thread_id=thread_id)
        return {"success": True, "trips": trips}
    except Exception as exc:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"success": False, "error": str(exc)})


@app.get("/api/trips/{trip_id}")
async def fetch_trip(trip_id: str):
    try:
        trip = get_trip(trip_id)
        if not trip:
            return JSONResponse(status_code=404, content={"success": False, "error": "Trip not found."})
        return {"success": True, "trip": trip}
    except Exception as exc:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"success": False, "error": str(exc)})


@app.delete("/api/trips/{trip_id}")
async def remove_trip(trip_id: str, request: Request):
    try:
        user = get_current_user_optional(request)
        user_id = user["id"] if user else None
        deleted = delete_trip(trip_id=trip_id, user_id=user_id)
        if not deleted:
            return JSONResponse(status_code=404, content={"success": False, "error": "Trip not found or unauthorized."})
        return {"success": True, "message": "Trip deleted successfully."}
    except Exception as exc:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"success": False, "error": str(exc)})


# =========================================================
# Agent Execution & Continuous Refinement Endpoints
# =========================================================

@app.post("/api/travel")
async def travel_planner(request_data: TravelRequest, request: Request):
    try:
        user_message = request_data.message.strip()

        if not user_message:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "Message cannot be empty.",
                },
            )

        user = get_current_user_optional(request)
        user_id = user["id"] if user else None

        result = await asyncio.to_thread(
            run_travel_agent,
            user_input=user_message,
            thread_id=request_data.thread_id,
        )

        thread_id = result.get("thread_id") or request_data.thread_id or f"user_{uuid.uuid4().hex}"
        extracted_dest = extract_destination(user_message)
        destination = result.get("trip_constraints", {}).get("destination") or extracted_dest or "Custom Destination"
        if destination and destination.lower() != "custom destination":
            title = f"{destination} Trip"
        else:
            title = f"Trip: {user_message[:35]}..."
        itinerary = result.get("itinerary") or result.get("answer") or ""

        # Auto-save trip in database
        save_or_update_trip(
            trip_id=thread_id,
            title=title,
            destination=destination,
            user_query=user_message,
            thread_id=thread_id,
            itinerary=itinerary,
            status="draft" if result.get("requires_approval") else "finalized",
            user_id=user_id,
            summary=result.get("supervisor_reasoning") or "",
        )

        return JSONResponse(
            content={
                "success": True,
                "trip_id": thread_id,
                **result,
            }
        )

    except Exception as exc:
        print("ERROR:", exc)
        traceback.print_exc()

        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(exc),
            },
        )


@app.post("/api/travel/approve")
async def approve_travel_plan(request_data: ApprovalRequest, request: Request):
    try:
        if not request_data.approved and not request_data.feedback.strip():
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "Please provide revision feedback when rejecting the draft.",
                },
            )

        user = get_current_user_optional(request)
        user_id = user["id"] if user else None

        result = await asyncio.to_thread(
            resume_travel_agent,
            thread_id=request_data.thread_id,
            approved=request_data.approved,
            feedback=request_data.feedback,
        )

        itinerary = result.get("itinerary") or result.get("answer") or ""
        save_or_update_trip(
            trip_id=request_data.thread_id,
            title="",
            destination="",
            user_query="",
            thread_id=request_data.thread_id,
            itinerary=itinerary,
            status="finalized" if request_data.approved else "revised",
            user_id=user_id,
            summary=result.get("supervisor_reasoning") or "",
        )

        return JSONResponse(
            content={
                "success": True,
                **result,
            }
        )

    except Exception as exc:
        print("APPROVAL ERROR:", exc)
        traceback.print_exc()

        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(exc),
            },
        )


@app.post("/api/travel/refine")
async def refine_itinerary_endpoint(request_data: RefineRequest, request: Request):
    try:
        feedback = request_data.feedback.strip()
        if not feedback:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "Feedback cannot be empty.",
                },
            )

        user = get_current_user_optional(request)
        user_id = user["id"] if user else None

        result = await asyncio.to_thread(
            refine_travel_itinerary,
            thread_id=request_data.thread_id,
            current_itinerary=request_data.current_itinerary,
            feedback=feedback,
            user_query=request_data.user_query,
            user_id=user_id,
        )

        return JSONResponse(
            content={
                "success": True,
                **result,
            }
        )

    except Exception as exc:
        print("REFINE ERROR:", exc)
        traceback.print_exc()

        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(exc),
            },
        )


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "message": "TripMate AI API is running",
        "features": [
            "supervisor_agent",
            "input_guardrail",
            "human_in_the_loop",
            "continuous_refinement",
            "trip_history_persistence",
            "user_authentication",
        ],
    }


@app.get("/favicon.ico")
async def favicon():
    return JSONResponse(content={})


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
