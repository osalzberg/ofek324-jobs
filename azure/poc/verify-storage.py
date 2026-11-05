"""Verify a private Azure Blob CV container with a short-lived, read-only user SAS.

Uploads and deletes only a uniquely named synthetic PDF created by this invocation.
No real CV, key, access token, or signed URL is printed or stored in the repository.
"""

import datetime as dt
import json
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

SUBSCRIPTION = "5edb3519-a630-43b6-82ac-cf92b84ec378"
ACCOUNT = "stofek324osalzbergdev"
CONTAINER = "cvs"
BASE_URL = f"https://{ACCOUNT}.blob.core.windows.net"


def az(*args):
    result = subprocess.run(
        ["az", *args, "--subscription", SUBSCRIPTION, "--only-show-errors"],
        text=True, capture_output=True, check=True,
    )
    return result.stdout.strip()


def request(url, method="GET", data=None, headers=None):
    req = urllib.request.Request(url, method=method, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def synthetic_pdf():
    stream = b"BT /F1 14 Tf 40 100 Td (Synthetic access test - no personal data) Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 180] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    data = b"%PDF-1.4\n"
    offsets = []
    for n, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += f"{n} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(data)
    data += b"xref\n0 6\n0000000000 65535 f \n"
    for offset in offsets:
        data += f"{offset:010d} 00000 n \n".encode()
    data += f"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return data


def main():
    account = json.loads(az(
        "storage", "account", "show", "--name", ACCOUNT,
        "--resource-group", "rg-ofek-jobs-dev", "-o", "json",
    ))
    assert account["sku"]["name"] == "Standard_LRS"
    assert account["allowBlobPublicAccess"] is False
    assert account["allowSharedKeyAccess"] is False
    assert account["enableHttpsTrafficOnly"] is True
    container = json.loads(az(
        "storage", "container", "show", "--account-name", ACCOUNT,
        "--name", CONTAINER, "--auth-mode", "login", "-o", "json",
    ))
    assert container["properties"]["publicAccess"] is None

    name = f"poc/synthetic-cv-{uuid.uuid4()}.pdf"
    url = f"{BASE_URL}/{CONTAINER}/{name}"
    content = synthetic_pdf()
    uploaded = False
    try:
        with tempfile.TemporaryDirectory(prefix="ofek-storage-poc-") as directory:
            file = Path(directory) / "synthetic.pdf"
            file.write_bytes(content)
            az(
                "storage", "blob", "upload", "--account-name", ACCOUNT,
                "--container-name", CONTAINER, "--name", name,
                "--file", str(file), "--content-type", "application/pdf",
                "--auth-mode", "login", "--overwrite", "false", "-o", "none",
            )
            uploaded = True
        anonymous_status, anonymous_body = request(url)
        anonymous_code = None
        anonymous_xml = anonymous_body.decode("utf-8-sig").strip()
        if anonymous_xml.startswith("<?xml") or anonymous_xml.startswith("<Error"):
            anonymous_code = ET.fromstring(anonymous_xml).findtext("Code")
        denied = anonymous_status in (401, 403, 404) or (
            anonymous_status == 409 and anonymous_code == "PublicAccessNotPermitted"
        )
        assert denied and anonymous_body != content, (
            f"Anonymous access returned {anonymous_status}, {anonymous_code}"
        )

        issued_at = dt.datetime.now(dt.timezone.utc)
        expiry = issued_at + dt.timedelta(seconds=60)
        sas = az(
            "storage", "blob", "generate-sas", "--account-name", ACCOUNT,
            "--container-name", CONTAINER, "--name", name,
            "--permissions", "r", "--expiry", expiry.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "--https-only", "--auth-mode", "login", "--as-user", "-o", "tsv",
        )
        fields = urllib.parse.parse_qs(sas)
        assert fields["sp"] == ["r"]
        assert fields["spr"] == ["https"]
        signed_expiry = dt.datetime.fromisoformat(fields["se"][0].replace("Z", "+00:00"))
        assert 0 < (signed_expiry - issued_at).total_seconds() <= 60
        signed_url = f"{url}?{sas}"
        valid_status, payload = request(signed_url)
        assert valid_status == 200 and payload == content
        write_status, _ = request(
            signed_url, method="PUT", data=b"must not replace the PDF",
            headers={"x-ms-blob-type": "BlockBlob", "x-ms-version": "2023-11-03"},
        )
        assert write_status == 403, f"Read-only SAS permitted a write: {write_status}"
        remaining = (signed_expiry - dt.datetime.now(dt.timezone.utc)).total_seconds()
        time.sleep(max(0, remaining) + 3)
        expired_status, _ = request(signed_url)
        assert expired_status == 403, f"Expired SAS returned {expired_status}"
        print(json.dumps({
            "account": ACCOUNT, "container": CONTAINER, "private": True,
            "shared_key_disabled": True, "anonymous_status": anonymous_status,
            "anonymous_error_code": anonymous_code,
            "valid_signed_read_status": valid_status, "write_status": write_status,
            "maximum_token_lifetime_seconds": 60, "expired_status": expired_status,
            "scope": "Synthetic private-file access test, not the application's upload endpoint",
        }))
    finally:
        if uploaded:
            az(
                "storage", "blob", "delete", "--account-name", ACCOUNT,
                "--container-name", CONTAINER, "--name", name,
                "--auth-mode", "login", "-o", "none",
            )
            print("Removed this test's synthetic PDF.")


if __name__ == "__main__":
    main()
