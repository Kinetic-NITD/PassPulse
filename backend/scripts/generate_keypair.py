"""Script to generate an Ed25519 keypair and optionally insert into signing_keys table."""

import os
import sys
import base64
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

# Ensure backend root is in sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv(backend_dir.parent / ".env")


def generate():
    # 32 random bytes seed
    private_key = ed25519.Ed25519PrivateKey.generate()
    seed = private_key.private_bytes_raw()
    seed_b64 = base64.b64encode(seed).decode("ascii")

    public_key = private_key.public_key()
    pub_bytes = public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)
    pub_b64 = base64.b64encode(pub_bytes).decode("ascii")

    print("=== Generated Ed25519 Keypair ===")
    print(f"SIGNING_PRIVATE_KEY={seed_b64}")
    print(f"Public Key (base64)={pub_b64}")
    print(f"Public Key (hex)={pub_bytes.hex()}")

    key_id = int(os.environ.get("SIGNING_KEY_ID", "1"))
    db_url = os.environ.get("DATABASE_URL")

    if db_url and not db_url.startswith("postgresql://user:password"):
        choice = input(f"Register key_id={key_id} into database signing_keys? [y/N]: ").strip().lower()
        if choice == "y":
            import psycopg
            with psycopg.connect(db_url) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO signing_keys (key_id, public_key, active)
                        VALUES (%s, %s, true)
                        ON CONFLICT (key_id) DO UPDATE SET public_key = EXCLUDED.public_key, active = true
                        """,
                        (key_id, pub_bytes),
                    )
                conn.commit()
            print(f"Successfully registered key_id={key_id} in signing_keys table.")


if __name__ == "__main__":
    generate()
