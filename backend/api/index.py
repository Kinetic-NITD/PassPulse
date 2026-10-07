"""
Vercel Python entrypoint.

Vercel's Python runtime loads this file and looks for an ASGI/WSGI callable
named `app`. We import the real FastAPI app from app.main so the project
structure stays unchanged.
"""

import sys
from pathlib import Path

# Make `app/` importable when Vercel runs from api/
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.main import app  # noqa: E402, F401