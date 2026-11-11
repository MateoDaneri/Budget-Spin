#!/usr/bin/env python3
"""Activate an optional scheduler after privately installing its credential.

Run on the Docker host with existing Docker access. No provider call is made by
preflight; starting the schedulers immediately performs their first sync.
"""
import json
import ipaddress
import os
from pathlib import Path
import secrets
import subprocess
import sys

APP = "budget-spin-app-1"
NETWORK = "budgetspin-ingest-internal"
IMAGE = "curlimages/curl:8.11.1@sha256:c1fe1679c34d9784c1b0d1e5f62ac0a79fca01fb6377cdd33e90473c6f9f9a69"
TOKEN = Path.home() / ".local/share/budgetspin/ingest-token"
# The Itaú scheduler keeps its historical container name so an installation that
# already runs it is still recognized (existence check and network isolation).
NAMES = ("budgetspin-gmail-scheduler", "budgetspin-splitwise-scheduler")
# Itaú: the IMAP credential is the private JSON file or, failing that, the
# ITAU_IMAP_USER / ITAU_IMAP_PASSWORD settings of the app container.
CHECK = r'''const fs=require('fs');
const kind=process.argv[1];
if(kind==='itau'){
 const f='/app/data/imap-credentials.json';
 if(fs.existsSync(f)){
  const s=fs.statSync(f); if (!s.isFile() || (s.mode&0o077)) throw Error('Invalid private credential file');
  const c=JSON.parse(fs.readFileSync(f,'utf8'));
  if (![c.user,c.password].every(x=>typeof x==='string'&&x.trim())) throw Error('Invalid IMAP credential');
 } else if (![process.env.ITAU_IMAP_USER,process.env.ITAU_IMAP_PASSWORD].every(x=>typeof x==='string'&&x.trim())) throw Error('IMAP credential missing');
} else {
 const f='/app/data/splitwise-api-key';
 const s=fs.statSync(f); if (!s.isFile() || (s.mode&0o077)) throw Error('Invalid private credential file');
 if (!/^\S+$/.test(fs.readFileSync(f,'utf8').trim())) throw Error('Invalid Splitwise credential');
}'''
INSTALL = r'''const fs=require('fs'), p='/app/data/ingest-token', b=fs.readFileSync(0);
const dir='/app/data/ingest-state';
try {fs.mkdirSync(dir,{mode:0o700}); fs.chownSync(dir,1000,1000);} catch(e){if(e.code!=='EEXIST')throw e;}
const d=fs.lstatSync(dir); if(!d.isDirectory()||d.uid!==1000||(d.mode&0o077)) throw Error('Invalid private state directory');
try {fs.writeFileSync(p,b,{mode:0o600,flag:'wx'});fs.chownSync(p,1000,1000);} catch(e) {
 if(e.code!=='EEXIST')throw e;
 const s=fs.statSync(p); if(!s.isFile()||(s.mode&0o077)||!fs.readFileSync(p).equals(b))throw Error('Trigger credential mismatch');
}'''

def docker(*args, data=None, check=True):
    result = subprocess.run(["docker", *args], input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
    if check and result.returncode:
        raise RuntimeError("Docker operation failed: " + " ".join(args[:2]))
    return result

def preflight(kind):
    app = json.loads(docker("inspect", APP).stdout)[0]
    if not app["State"]["Running"] or app["State"].get("Health", {}).get("Status") != "healthy":
        raise RuntimeError("Application is not healthy")
    overrides = ("INGEST_TOKEN=", "INGEST_TOKEN_FILE=", "SPLITWISE_API_KEY=", "SPLITWISE_API_KEY_FILE=")
    if any(entry.startswith(overrides) for entry in app.get("Config", {}).get("Env", [])):
        raise RuntimeError("Provider settings override the activation defaults; inspect configuration")
    docker("exec", APP, "node", "-e", CHECK, kind)
    name = NAMES[0] if kind == "itau" else NAMES[1]
    if docker("inspect", name, check=False).returncode == 0:
        raise RuntimeError("The scheduler already exists; inspect it before retrying")
    net = docker("network", "inspect", NETWORK, check=False)
    if net.returncode == 0:
        info = json.loads(net.stdout)[0]
        if not info.get("Internal") or any(v.get("Name") not in (APP, *NAMES) for v in (info.get("Containers") or {}).values()):
            raise RuntimeError("Existing scheduler network is not isolated")
    return app

def free_subnet():
    """Choose a small RFC1918 subnet outside Docker networks and host routes."""
    routes = subprocess.run(["ip", "-j", "-4", "route", "show", "table", "all"], capture_output=True, check=True, timeout=10)
    used = []
    for route in json.loads(routes.stdout):
        destination = route.get("dst", "default")
        if destination != "default":
            used.append(ipaddress.ip_network(destination, strict=False))
    ids = docker("network", "ls", "-q").stdout.decode().split()
    if ids:
        for network in json.loads(docker("network", "inspect", *ids).stdout):
            for config in network.get("IPAM", {}).get("Config") or []:
                if config.get("Subnet"):
                    net = ipaddress.ip_network(config["Subnet"], strict=False)
                    if net.version == 4: used.append(net)
    for candidate in ipaddress.ip_network("10.231.0.0/16").subnets(new_prefix=28):
        if not any(candidate.overlaps(net) for net in used): return str(candidate)
    raise RuntimeError("No isolated scheduler subnet is available")

def main():
    args = sys.argv[1:]
    if not args or args[0] not in ("itau", "splitwise") or args[1:] not in ([], ["--check"]):
        raise RuntimeError("Usage: activate-sync.py itau|splitwise [--check]")
    kind = args[0]
    preflight(kind)
    if args[1:] == ["--check"]:
        print("Credentials and scheduler preflight passed; nothing started.")
        return
    TOKEN.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if TOKEN.parent.stat().st_mode & 0o077: raise RuntimeError("Private token directory permissions are too broad")
    try:
        fd = os.open(TOKEN, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f: f.write(secrets.token_urlsafe(48).encode())
    except FileExistsError: pass
    st = TOKEN.stat()
    if st.st_mode & 0o077 or not TOKEN.is_file(): raise RuntimeError("Trigger credential is not private")
    token = TOKEN.read_bytes()
    if not 32 <= len(token) <= 256: raise RuntimeError("Trigger credential invalid")
    docker("exec", "-i", "--user", "0", APP, "node", "-e", INSTALL, data=token)
    docker("image", "inspect", IMAGE, check=True)
    if docker("network", "inspect", NETWORK, check=False).returncode:
        docker("network", "create", "--internal", "--subnet", free_subnet(), NETWORK)
    app = json.loads(docker("inspect", APP).stdout)[0]
    if NETWORK not in app["NetworkSettings"]["Networks"]:
        docker("network", "connect", "--alias", "app", NETWORK, APP)
    created = []
    try:
        schedules = {"itau": (NAMES[0], "itau", "900"), "splitwise": (NAMES[1], "splitwise", "3600")}
        for name, endpoint, interval in (schedules[kind],):
            # The header reaches curl as config on stdin from the printf builtin, so
            # the token is never in any process argument list inside the container.
            shell = ('while true; do token=$(cat /run/ingest-token); '
                     'printf \'header = "Authorization: Bearer %s"\\n\' "$token" | '
                     'curl -K - -fsS -o /dev/null -X POST --connect-timeout 10 --max-time 600 http://app:3000/api/ingest/' + endpoint +
                     ' || echo "sync trigger failed" >&2; sleep ' + interval + '; done')
            docker("run", "-d", "--name", name, "--restart", "unless-stopped", "--network", NETWORK,
                   "--user", "1000:1000", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
                   "--pids-limit", "64", "--mount", f"type=bind,src={TOKEN},dst=/run/ingest-token,readonly",
                   "--entrypoint", "sh", IMAGE, "-c", shell)
            created.append(name)
    except Exception:
        for name in created: docker("rm", "-f", name, check=False)
        raise
    print(f"{kind.capitalize()} scheduler started.")

if __name__ == "__main__":
    try: main()
    except Exception as exc:
        print("Activation stopped:", str(exc), file=sys.stderr)
        sys.exit(1)
