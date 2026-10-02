import os
from fastapi import FastAPI, Request, Response
import httpx

app = FastAPI(title="Umami MCP Proxy")

UPSTREAM = os.environ.get("UMAMI_MCP_URL", "").rstrip("/")
API_KEY = os.environ.get("UMAMI_API_KEY", "")
SECRET = os.environ.get("MCP_PATH_SECRET", "").strip("/")

if not UPSTREAM or not API_KEY or len(SECRET) < 24:
    raise RuntimeError("UMAMI_MCP_URL, UMAMI_API_KEY, and a 24+ char MCP_PATH_SECRET are required")

FORWARD_REQUEST_HEADERS = {
    "accept",
    "content-type",
    "mcp-protocol-version",
    "mcp-session-id",
    "last-event-id",
    "user-agent",
}
FORWARD_RESPONSE_HEADERS = {
    "content-type",
    "cache-control",
    "mcp-session-id",
}

@app.get("/health")
async def health():
    return {"status": "ok", "auth_configured": bool(API_KEY)}

async def proxy(request: Request):
    if request.url.path.rstrip("/") != f"/{SECRET}/mcp":
        return Response(status_code=404)

    headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() in FORWARD_REQUEST_HEADERS
    }
    headers["authorization"] = f"Bearer {API_KEY}"

    body = await request.body()
    timeout = httpx.Timeout(connect=20.0, read=120.0, write=120.0, pool=20.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        upstream = await client.request(
            method=request.method,
            url=UPSTREAM,
            headers=headers,
            content=body if body else None,
        )

    response_headers = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower() in FORWARD_RESPONSE_HEADERS
    }
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=response_headers,
    )

app.add_api_route(f"/{SECRET}/mcp", proxy, methods=["GET", "POST", "DELETE"])
app.add_api_route(f"/{SECRET}/mcp/", proxy, methods=["GET", "POST", "DELETE"])
