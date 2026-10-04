"""QR code generation using segno."""

import io
import segno


def generate_qr_png_bytes(url: str, scale: int = 8) -> bytes:
    """Generate PNG bytes of the QR code."""
    qr = segno.make(url, error="m")
    out = io.BytesIO()
    qr.save(out, kind="png", scale=scale)
    return out.getvalue()


def generate_qr_svg(url: str, scale: int = 5) -> str:
    """Generate SVG string of the QR code."""
    qr = segno.make(url, error="m")
    out = io.StringIO()
    qr.save(out, kind="svg", scale=scale)
    return out.getvalue()
