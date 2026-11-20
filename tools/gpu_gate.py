"""Politeness gate: another local job (ComfyUI on :8189) shares this GPU. Wait until it is idle before generating."""
import json, sys, time, urllib.request

def _get(url, t=5):
    with urllib.request.urlopen(url, timeout=t) as r: return json.loads(r.read())

def comfy_busy():
    try:
        q = _get("http://127.0.0.1:8189/queue")
        return len(q["queue_running"]) + len(q["queue_pending"]) > 0
    except Exception:
        return False  # not running -> not busy

def forge_unload():
    try:
        req = urllib.request.Request("http://127.0.0.1:7871/sdapi/v1/unload-checkpoint", data=b"{}", headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=120).read()
    except Exception as e:
        print("unload failed", e)

def wait_idle(max_wait=3600, settle=6):
    t0 = time.time(); waited = False
    while comfy_busy() and time.time() - t0 < max_wait:
        if not waited:
            forge_unload(); waited = True; print("gpu busy (other job) - waiting", flush=True)
        time.sleep(5)
    if waited:
        time.sleep(settle); print(f"gpu free after {time.time()-t0:.0f}s", flush=True)
    return time.time() - t0

if __name__ == "__main__":
    # wait for forge to finish its current job, then gate
    while True:
        try:
            if _get("http://127.0.0.1:7871/sdapi/v1/progress")["state"]["job_count"] == 0: break
        except Exception: break
        time.sleep(3)
    forge_unload()
    print("waited", wait_idle())
