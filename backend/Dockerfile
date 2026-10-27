FROM python:3.11-slim

# Install system dependencies if required
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /workspace

# Copy dependency configuration files
COPY pyproject.toml uv.lock ./

# Install project dependencies without requiring root packages at sync time
RUN uv sync --frozen --no-dev --no-install-project --link-mode=copy

# Copy agent package, SQL templates, and wrapper files
COPY brand_analytics_app/ ./brand_analytics_app/
COPY backend/ ./backend/

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uv run uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
