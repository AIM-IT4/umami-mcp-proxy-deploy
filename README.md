# Umami MCP Proxy Deploy

Generic Streamable HTTP reverse proxy for self-hosted Umami MCP. No credentials are stored in this repository.

Required environment variables:
- `UMAMI_MCP_URL`
- `UMAMI_API_KEY`
- `MCP_PATH_SECRET` (24+ random characters)
- `PORT` (Render provides this)

Health check: `/health`.
