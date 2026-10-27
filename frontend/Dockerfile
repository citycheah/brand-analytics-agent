FROM python:3.11-slim

# Install uv for fast package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /workspace

# Copy dependency configuration files
COPY pyproject.toml uv.lock ./

# Install project dependencies without requiring root packages at sync time
RUN uv sync --frozen --no-dev --no-install-project --link-mode=copy

# Copy frontend source files and assets
COPY frontend/ ./frontend/
COPY public/ ./public/
COPY .chainlit/ ./.chainlit/
COPY frontend/chainlit.md ./chainlit.md

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uv run chainlit run frontend/app.py --headless --host 0.0.0.0 --port ${PORT:-8080}"]
