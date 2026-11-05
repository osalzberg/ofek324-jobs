"""Deploy with an explicitly personal-tenant token, not the CLI default tenant."""
import base64
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

subscription = "5edb3519-a630-43b6-82ac-cf92b84ec378"
tenant = "ea40c3b0-b791-4369-b99a-3c4e9f570512"
origin = "https://ofek324-osalzberg-dev.scm.azurewebsites.net"
token = json.loads(subprocess.check_output([
    "az", "account", "get-access-token", "--subscription", subscription,
    "--resource", "https://management.azure.com/", "-o", "json",
], text=True))["accessToken"]
part = token.split(".")[1]
assert json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))["tid"] == tenant
if sys.argv[1] == "--status":
    status_url = origin + "/api/deployments/latest"
else:
    archive = Path(sys.argv[1]).resolve()
    request = urllib.request.Request(
        origin + "/api/zipdeploy?isAsync=true", data=archive.read_bytes(), method="POST",
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/zip"},
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        status_url = urllib.parse.urljoin(origin, response.headers["Location"])
    target = urllib.parse.urlparse(status_url)
    if target.scheme != "https" or target.hostname != urllib.parse.urlparse(origin).hostname or target.port not in (None, 443):
        status_url = origin + "/api/deployments/latest"
    print("Deployment accepted with the personal tenant identity.", flush=True)
previous = None
for _ in range(120):
    with urllib.request.urlopen(urllib.request.Request(status_url, headers={"Authorization": "Bearer " + token}), timeout=60) as response:
        status = json.load(response)
    if status["status"] != previous:
        print(json.dumps({key: status.get(key) for key in ["id", "status", "complete", "active"]}), flush=True)
        previous = status["status"]
    if status["status"] == 4:
        print("Standalone deployment completed.", flush=True)
        break
    if status["status"] == 3:
        raise SystemExit("Deployment failed; inspect the deployment's Kudu logs.")
    time.sleep(5)
else:
    raise SystemExit("Deployment did not finish in ten minutes; inspect before retrying.")
