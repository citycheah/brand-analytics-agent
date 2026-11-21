"""DEPRECATED: Standalone Chainlit UI retired in favour of the Unified Next.js Portal.

Launch the modern 5-page Executive Portal in:
  `brand-analytics-agent/frontend-portal/` (port 3000)
which streams SSE via `POST /query/stream` and queries FastAPI Portal endpoints (`/api/v1/*`).
"""

from __future__ import annotations

import warnings

DEPRECATION_MESSAGE = (
    "brand-analytics-agent/frontend/app.py (Chainlit) is retired. "
    "Use brand-analytics-agent/frontend-portal/ instead."
)


def main() -> None:
    warnings.warn(DEPRECATION_MESSAGE, DeprecationWarning, stacklevel=2)
    raise RuntimeError(DEPRECATION_MESSAGE)


if __name__ == "__main__":
    main()
