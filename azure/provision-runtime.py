"""Provision only this project's runtime access and metered email service.

Uses the existing Basic/F1 resources. Secrets stay in memory and App Service
settings; no credentials are printed, passed in command arguments, or written.
"""
import json
import ipaddress
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

SUB = "5edb3519-a630-43b6-82ac-cf92b84ec378"
TENANT = "ea40c3b0-b791-4369-b99a-3c4e9f570512"
RG = f"/subscriptions/{SUB}/resourceGroups/rg-ofek-jobs-dev"
IDENTITY = "ce7500a1-f4cc-4398-b8b2-a6bbf4da4512"
WEB = f"{RG}/providers/Microsoft.Web/sites/ofek324-osalzberg-dev"
STORAGE = f"{RG}/providers/Microsoft.Storage/storageAccounts/stofek324osalzbergdev"
SQL = f"{RG}/providers/Microsoft.Sql/servers/sql-ofek324-osalzberg-fc"
EMAIL = f"{RG}/providers/Microsoft.Communication/emailServices/email-ofek324-osalzberg-dev"
DOMAIN = f"{EMAIL}/domains/AzureManagedDomain"
COMM = f"{RG}/providers/Microsoft.Communication/communicationServices/acs-ofek324-osalzberg-dev"
token = json.loads(subprocess.check_output([
    "az", "account", "get-access-token", "--subscription", SUB,
    "--resource", "https://management.azure.com/", "-o", "json",
], text=True))["accessToken"]


def arm(path, version, method="GET", body=None, allow_missing=False):
    encoded = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        f"https://management.azure.com{path}?api-version={version}",
        data=encoded, method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
            return json.loads(data) if data else {}
    except urllib.error.HTTPError as error:
        if error.code == 404 and allow_missing:
            return None
        # ARM errors can echo supplied settings; expose codes, not secret-bearing bodies.
        payload = json.loads(error.read())
        raise RuntimeError(f"ARM {method} {path}: {error.code}, {payload.get('error', {}).get('code')}") from None


def ready(path, version):
    for _ in range(60):
        resource = arm(path, version)
        state = resource.get("properties", {}).get("provisioningState")
        if state in ("Succeeded", None):
            return resource
        if state in ("Failed", "Canceled"):
            raise RuntimeError(f"Resource provisioning failed: {path}")
        time.sleep(5)
    raise TimeoutError(f"Resource was not ready: {path}")


def role(scope, role_id):
    assignment = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{scope}/{IDENTITY}/{role_id}"))
    path = f"{scope}/providers/Microsoft.Authorization/roleAssignments/{assignment}"
    if arm(path, "2022-04-01", allow_missing=True) is None:
        arm(path, "2022-04-01", "PUT", {"properties": {
            "roleDefinitionId": f"/subscriptions/{SUB}/providers/Microsoft.Authorization/roleDefinitions/{role_id}",
            "principalId": IDENTITY, "principalType": "ServicePrincipal",
        }})


web = arm(WEB, "2023-12-01")
assert web["identity"]["tenantId"] == TENANT and web["identity"]["principalId"] == IDENTITY
plan = arm(web["properties"]["serverFarmId"], "2023-12-01")
assert plan["sku"]["name"] == "F1", "Do not upgrade hosting"
db = arm(f"{SQL}/databases/ofek-jobs-poc", "2023-08-01")
assert db["sku"]["name"] == "Basic", "Do not upgrade database"

if "--firewall-only" not in sys.argv:
    role(f"{STORAGE}/blobServices/default/containers/cvs", "ba92f5b4-2d11-453d-a403-e96b0029c9fe")
    role(STORAGE, "db58b8e5-c6ad-4a2a-8342-4190687cbf4a")
# Free/shared workers can actually use the wider advertised pool after recycling.
addresses = sorted(set(web["properties"]["possibleOutboundIpAddresses"].split(",")))
if not addresses or any(not ip for ip in addresses):
    raise RuntimeError("The host did not advertise its possible outbound addresses")
for index, ip in enumerate(addresses, 1):
    ipaddress.IPv4Address(ip)
    arm(f"{SQL}/firewallRules/ofek-app-outbound-{index}", "2023-08-01", "PUT",
        {"properties": {"startIpAddress": ip, "endIpAddress": ip}})
print(f"Configured {len(addresses)} exact advertised app egress addresses; no all-Azure firewall rule.", flush=True)
if "--firewall-only" in sys.argv:
    raise SystemExit(0)

for path, properties in [
    (EMAIL, {"dataLocation": "Europe"}),
    (DOMAIN, {"domainManagement": "AzureManaged"}),
    (COMM, {"dataLocation": "Europe", "linkedDomains": [DOMAIN]}),
]:
    existing = arm(path, "2023-03-31", allow_missing=True)
    if existing is None:
        body = {"location": "global", "properties": properties}
        if path != DOMAIN:
            body["tags"] = {"project": "ofek-jobs", "environment": "development"}
        arm(path, "2023-03-31", "PUT", body)
    ready(path, "2023-03-31")
    print(f"Ready: {path.rsplit('/', 1)[-1]}", flush=True)

domain = arm(DOMAIN, "2023-03-31")
comm = arm(COMM, "2023-03-31")
senders = arm(f"{DOMAIN}/senderUsernames", "2023-03-31")["value"]
if not senders:
    raise RuntimeError("Azure-managed email domain has no verified sender")
sender = f"{senders[0]['properties']['username']}@{domain['properties']['fromSenderDomain']}"
keys = arm(f"{COMM}/listKeys", "2023-03-31", "POST", {})
settings = arm(f"{WEB}/config/appsettings/list", "2023-12-01", "POST", {})["properties"]
settings.update({
    "APP_URL": "https://ofek324-osalzberg-dev.azurewebsites.net",
    "SQL_SERVER": "sql-ofek324-osalzberg-fc.database.windows.net",
    "SQL_DATABASE": "ofek-jobs-poc",
    "AZURE_STORAGE_ACCOUNT": "stofek324osalzbergdev",
    "AZURE_TENANT_ID": TENANT,
    "EMAIL_CONNECTION_STRING": keys["primaryConnectionString"],
    "EMAIL_SENDER": sender,
    "CRON_SECRET": settings.get("CRON_SECRET") or secrets.token_urlsafe(32),
    "SCM_DO_BUILD_DURING_DEPLOYMENT": "false",
    "WEBSITE_RUN_FROM_PACKAGE": "1",
})
arm(f"{WEB}/config/appsettings", "2023-12-01", "PUT", {"properties": settings})
print(json.dumps({"emailSender": sender, "emailEndpoint": comm["properties"]["hostName"],
                  "secretsStoredIn": "App Service settings only", "emailsSent": 0}))
