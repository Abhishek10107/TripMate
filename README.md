# TripMate AI

This repository contains a small travel-planning demo application built around LangGraph, FastAPI, and MCP-style tool integrations. It is designed to illustrate how a supervisor-driven multi-agent workflow can coordinate several specialized agents, apply a simple guardrail to incoming requests, and pause for human approval before finalizing a draft itinerary.

This project is useful for learning, prototyping, and experimentation. It is not presented as a production travel booking system, and external service availability and model responses can vary.

## Overview

TripMate AI lets a user describe a trip request in natural language and then generates a draft itinerary that may include:

- likely flight and airport guidance
- hotel suggestions and destination context
- weather and forecast information
- budget considerations
- a final human-reviewable itinerary

The app keeps the workflow stateful using a LangGraph graph and a PostgreSQL-backed checkpointer, and it exposes a simple web UI plus API endpoints for the planning flow.

## What this project demonstrates

The project is a practical example of:

- a multi-agent planning pattern using LangGraph
- routing work through a supervisor agent
- validating user intent with an input guardrail
- calling external tools through MCP-style clients
- pausing execution for human approval (HITL)
- refining itineraries using follow-up user feedback
- storing trip/auth records in PostgreSQL

## System architecture

At a high level, the app is split into three main parts:

1. Web/API layer
   - `app.py` exposes the FastAPI application, auth endpoints, trip management endpoints, and the web UI.
   - The UI is served from `templates/` and `static/`.

2. Agent orchestration layer
   - `backend.py` defines the LangGraph workflow and the agent logic.
   - A supervisor selects which specialist agents to invoke based on the user request.
   - A guardrail checks whether the request is still within the travel-planning domain.
   - A human approval step pauses the graph and waits for explicit approval or revision feedback.

3. External service/tool layer
   - `mcp_client.py` connects to external MCP servers and tools.
   - `custom_weather_mcp_server.py` is a small local weather service implemented with FastMCP.
   - Tools are used for things like search, weather forecast retrieval, and route/airport data.

The app also uses PostgreSQL via `psycopg` to persist:

- user accounts
- trip drafts and final plans
- trip metadata and revision history
- agent graph state/checkpoints via the LangGraph Postgres checkpointer

### System architecture diagram

```mermaid
flowchart LR
    User["User / Browser"] --> UI["FastAPI Web UI<br/>app.py"]
    UI --> API["REST API<br/>auth, trips, travel"]
    API --> Backend["LangGraph backend<br/>backend.py"]
    Backend --> Supervisor["Supervisor agent<br/>routes specialist work"]
    Supervisor --> Guardrail["Input guardrail<br/>travel intent check"]
    Supervisor --> Flight["Flight agent"]
    Supervisor --> Hotel["Hotel agent"]
    Supervisor --> Weather["Weather agent"]
    Supervisor --> Budget["Budget agent"]
    Supervisor --> Itinerary["Itinerary agent"]
    Itinerary --> HITL["Human approval<br/>approval pause"]
    HITL --> Final["Final agent"]

    Flight --> MCP1["MCP client<br/>AviationStack"]
    Hotel --> MCP2["MCP client<br/>Tavily search"]
    Weather --> MCP3["Local weather MCP<br/>weather server"]
    Final --> DB[("PostgreSQL<br/>users, trips, state")]

    MCP1 --> Ext1["Flight and airport APIs"]
    MCP2 --> Ext2["Web search and travel data"]
    MCP3 --> Ext3["OpenWeather API"]
```

### Detailed architecture view

The application is organized in layers, each with a distinct responsibility:

1. Presentation layer
   - The browser loads the HTML page served by the FastAPI app.
   - The frontend logic in `static/` sends requests to the API endpoints for auth, trip browsing, and itinerary generation.

2. API layer
   - `app.py` handles user authentication, session cookies, trip persistence, and the main travel-planning endpoints.
   - It exposes routes for signup, login, trip listing, itinerary creation, human approval, and refinement.

3. Orchestration layer
   - `backend.py` defines the LangGraph workflow and state object (`TravelState`).
   - The `supervisor_agent` decides which specialized agents are needed for a given travel request.
   - Specialist agents add structured results to shared state, such as flights, hotels, weather, budget, and itinerary data.

4. Human-in-the-loop layer
   - The graph pauses at `human_approval` using `interrupt()`.
   - The user can approve the draft itinerary or reject it with revision feedback.
   - This pause prevents the system from finalizing an itinerary without explicit review.

5. Tool integration layer
   - `mcp_client.py` bridges the app to external tool servers.
   - It connects to Tavily search, AviationStack, and a local weather MCP server.
   - The weather server is implemented in `custom_weather_mcp_server.py` and calls the OpenWeather API.

6. Persistence layer
   - PostgreSQL stores user accounts, trip records, and revision history.
   - LangGraph checkpoints are also persisted through the Postgres checkpointer, allowing the workflow to resume from a saved `thread_id`.

This diagram shows the project as a learning-oriented multi-agent travel assistant: user requests flow through the web/API boundary into a LangGraph orchestrator, are supported by specialized agents and external tools, and are optionally reviewed by a human before a final response is generated.

## Project structure

- `app.py` — FastAPI app, auth, trip APIs, web routes
- `backend.py` — LangGraph graph, agents, guardrail logic, DB helpers
- `mcp_client.py` — MCP client setup and tool wrappers
- `custom_weather_mcp_server.py` — local weather MCP server
- `templates/` — HTML templates for the frontend
- `static/` — CSS and JavaScript used by the web UI
- `requirements.txt` — Python dependencies
- `Dockerfile` — containerization entry point

## Features

### User-facing features

- travel prompt submission through the web UI or API
- authenticated user signup/login flow
- trip history and per-user trip storage
- draft itinerary generation
- approval/revision flow for itinerary review
- iterative itinerary refinement based on feedback
- basic trip summaries and final polished responses

### Agent features

- `supervisor_agent`: filters requests and decides which specialist agents are relevant
- `flight_agent`: reasons about likely airports, airlines, flights, and booking concerns
- `hotel_agent`: gathers accommodation and neighborhood guidance via search tooling
- `weather_agent`: pulls weather and forecast information for the destination
- `budget_agent`: assesses affordability and cost risks
- `itinerary_agent`: assembles the draft plan
- `final_agent`: produces a polished final answer after approval or revision

### Guardrails and control flow

- The input guardrail checks whether the user request falls within travel planning.
- If blocked, the request is rejected with a clear explanation.
- If allowed, the supervisor selects agents and routes the workflow dynamically.
- Human review is inserted before final output, which allows a user to approve or reject the draft.

## Prerequisites

Before running the project, make sure you have:

- Python 3.10 or newer
- Git
- A PostgreSQL database reachable by the app
- API keys or access for the downstream services used by this demo
- `uvx` on your PATH for the AviationStack MCP setup
- a Python virtual environment tool such as `venv`

## Required environment variables

This project expects a `.env` file in the repository root. The code uses `python-dotenv` to load it.

A typical setup looks like this:

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname
GROQ_API_KEY=your_groq_key
GROQ_MODEL=openai/gpt-oss-120b
TAVILY_API_KEY=your_tavily_key
OPENWEATHER_API_KEY=your_openweather_key
AVIATION_STACK_API_KEY=your_aviationstack_key
# AVIATIONSTACK_API_KEY is also accepted by the client code.
```

Notes:

- `DATABASE_URL` is required because the app stores state and trip records in PostgreSQL.
- `GROQ_API_KEY` is required for the model calls in `backend.py` and `mcp_client.py`.
- `OPENWEATHER_API_KEY` is required when the weather MCP server is used.
- `TAVILY_API_KEY` is used for live search-style hotel or travel research.
- `AVIATION_STACK_API_KEY` is used by the AviationStack MCP tool.

## Setup

On Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Then create a `.env` file with the required values and start the app:

```powershell
python app.py
```

Or with uvicorn:

```powershell
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Open the app in a browser:

```text
http://127.0.0.1:8000
```

## Running the MCP components

The app includes a custom weather MCP server at `custom_weather_mcp_server.py`.

It is normally launched by the Python client process via the `weather` MCP configuration, so you generally do not need to start it separately. For direct experimentation, you can also run it manually:

```powershell
python custom_weather_mcp_server.py
```

The `mcp_client.py` module sets up the following MCP-style integrations:

- Tavily search
- AviationStack tool access through `uvx aviationstack-mcp`
- local weather service via the custom FastMCP server

## Agent workflow and execution flow

The core orchestration is a LangGraph state machine defined in `backend.py`.

1. A user request is received from the FastAPI route or UI.
2. The graph starts at the `supervisor` node.
3. The `supervisor_agent` checks whether the request is a valid travel request.
4. If allowed, it selects the relevant specialist agents.
5. The selected agents run in sequence; each adds partial results to the shared graph state.
6. The `itinerary_agent` creates a first draft itinerary.
7. The graph pauses at `human_approval` via `interrupt()` and waits for review.
8. The user approves the itinerary or gives feedback.
9. `final_agent` produces the final answer.
10. The workflow can be resumed with `resume_travel_agent()` or refined with `refine_travel_itinerary()`.

The graph uses a Postgres checkpointer so it can persist state across interactions for the same `thread_id`.

## Important runtime behavior

This code is intentionally structured as a demo and learning scaffold rather than a polished SaaS product.

A few practical points:

- The model output is not guaranteed to be fully accurate or consistent.
- External API calls may fail or return partial data depending on quotas, network issues, or service availability.
- The app includes basic auth and trip persistence, but it does not aim to cover every production security concern.
- The travel workflow is designed to illustrate coordination patterns, not to replace a full booking or travel engine.

## API overview

The project exposes a few main API routes in `app.py`:

- `GET /` — serves the web UI
- `POST /api/auth/signup` — create a user account
- `POST /api/auth/login` — log in and create an auth token
- `POST /api/auth/logout` — clear the auth token
- `GET /api/auth/me` — get the current authenticated user
- `GET /api/trips` — list trips for a user or thread
- `GET /api/trips/{trip_id}` — fetch one trip
- `DELETE /api/trips/{trip_id}` — delete a trip
- `POST /api/travel` — create a travel-planning run from a prompt
- `POST /api/travel/approve` — approve or reject a draft itinerary
- `POST /api/travel/refine` — refine an itinerary using user feedback
- `GET /health` — health check endpoint

## Development notes

- The app combines synchronous helpers in `backend.py` with an async FastAPI server.
- `asyncio.to_thread` is used in `app.py` to run the synchronous LangGraph workflow without blocking the main event loop.
- The code intentionally keeps a small, explicit set of tools and endpoints rather than abstracting everything into a larger framework.
- It is useful as a reference implementation for multi-agent, tool-using, human-review workflows.

## Summary

TripMate AI is a demo travel-planning app that combines a FastAPI frontend, LangGraph orchestration, MCP tool access, and human-in-the-loop review. It is meant to make the design of a multi-agent travel assistant easy to understand and experiment with, while staying honest about the fact that it is a prototype rather than a production travel platform.
