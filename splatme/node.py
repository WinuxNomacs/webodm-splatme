"""
The splat node's HTTP API (node/splatnode.py in this plugin's repository), as the plugin uses it.
"""
import re

import requests

# The oldest node this plugin works with
MIN_VERSION = (0, 2, 0)
# The first node that keeps a job's ref (to find a job whose upload's answer was lost)
REF_VERSION = (0, 2, 2)
# The node this SplatMe was released with: an older one trains, without what came since
CURRENT_VERSION = (0, 3, 0)
# What each node version added that SplatMe uses, for the notice to an older node's administrator
ADDED = (((0, 2, 3), "Grow Until and datasets over 2 GB"),
         ((0, 3, 0), "continuing another trainer's model"))
CREATE_TIMEOUT = 600  # seconds the node may take to answer a new job, once its zip is sent
KIND = re.compile(r"^[a-z0-9_-]{1,32}$")


def update_note(version):
    """What a node older than this SplatMe's lacks, for the administrator, or None."""
    have = parse_version(version)
    if have >= CURRENT_VERSION:
        return None
    lacks = [what for added, what in ADDED if have < added]
    return (f"Node {version} trains, but lacks {'; '.join(lacks)}: update it to "
            f"{'.'.join(str(n) for n in CURRENT_VERSION)} or later.")


def checked_info(info):
    """A node's /info with what SplatMe reads from it in the form it reads it: an option without a whole-number range
    or with choices that are not text, a trainer kind that is not a short name, and a continue_from that does not
    read are left out, so a broken (or hostile) node cannot fail the pages that ask it."""
    out = dict(info)
    options = {}
    for name, limits in (info.get("options") if isinstance(info.get("options"), dict) else {}).items():
        if not isinstance(name, str) or not isinstance(limits, dict):
            continue
        if "choices" in limits:
            if isinstance(limits["choices"], list) and all(isinstance(c, str) for c in limits["choices"]):
                options[name] = limits
        elif limits.get("type") == "bool" or all(isinstance(limits.get(k), int) and not isinstance(limits.get(k), bool) for k in ("min", "max")):
            options[name] = limits
    out["options"] = options
    if "trainer_kind" in out and not (isinstance(out["trainer_kind"], str) and KIND.match(out["trainer_kind"])):
        del out["trainer_kind"]
    wants = out.get("continue_from")
    if wants is not None:
        properties, degrees = (wants.get("properties"), wants.get("sh_degrees")) if isinstance(wants, dict) else (None, None)
        if not (isinstance(properties, list) and all(isinstance(p, str) for p in properties)
                and (degrees is None or isinstance(degrees, list) and all(isinstance(d, int) for d in degrees))):
            del out["continue_from"]
    return out


class NodeError(Exception):
    """Something the node refused or could not do, worded for the user. status is the HTTP status, if any."""

    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


def parse_version(text):
    try:
        return tuple(int(part) for part in str(text).split(".")[:3])
    except ValueError:
        return (0,)


class Node:
    def __init__(self, url, token, timeout=15):
        self.url = (url or "").strip().rstrip("/")
        self.token = token or ""
        self.timeout = timeout

    def request(self, method, path, **kwargs):
        if not self.url:
            raise NodeError("No splat node is set. An administrator sets its address in SplatMe's settings.")
        headers = {"Authorization": "Bearer " + self.token, **kwargs.pop("headers", {})}
        timeout = kwargs.pop("timeout", self.timeout)
        try:
            res = requests.request(method, self.url + path, headers=headers, timeout=timeout, **kwargs)
        except requests.RequestException as e:
            raise NodeError(
                f"The splat node at {self.url} does not answer. Check that it is running and that its address "
                "in SplatMe's settings is right."
            ) from e
        if res.status_code == 401:
            raise NodeError("The splat node refused the token. Check the token in SplatMe's settings.", 401)
        if res.status_code >= 400:
            try:
                message = res.json()["error"]
            except (ValueError, KeyError, TypeError):
                message = f"The splat node answered {res.status_code}"
            raise NodeError(message, res.status_code)
        return res

    def answer(self, res):
        """The JSON a request answered; NodeError (no status: as a node not answering) for anything else (a proxy's page)."""
        try:
            return res.json()
        except ValueError as e:
            raise NodeError(
                f"The splat node at {self.url} answered something that is not a splat node's answer "
                f"({res.status_code}, {res.headers.get('Content-Type') or 'no content type'})."
            ) from e

    def info(self):
        try:
            return self.request("GET", "/info").json()
        except ValueError as e:
            raise NodeError(f"{self.url} is not a splat node. Check its address in SplatMe's settings.") from e

    def keeps_refs(self):
        return parse_version(self.info().get("version")) >= REF_VERSION

    def check(self):
        """The node's info, once it is known to be able to train for this plugin."""
        info = self.info()
        if not isinstance(info, dict) or "options" not in info:
            raise NodeError(f"{self.url} is not a splat node. Check its address in SplatMe's settings.")
        if parse_version(info.get("version")) < MIN_VERSION:
            raise NodeError(
                "The splat node is version {}, and this SplatMe needs {} or later. Update the node.".format(
                    info.get("version"), ".".join(str(n) for n in MIN_VERSION)
                )
            )
        if not info.get("trainer"):
            raise NodeError("The splat node's trainer does not run. Check the node's logs.")
        if not info.get("gpu"):
            raise NodeError("The splat node has no GPU it can use. Check its NVIDIA driver and Docker's GPU access.")
        return checked_info(info)

    def create_job(self, body, length, options):
        """Sends a training zip (an iterable of bytes of a known length) and answers the node's new job."""
        headers = {"Content-Length": str(length), "Content-Type": "application/zip"}
        # Once the zip is sent the node checks it and unpacks a model to continue (hundreds of MB) before it answers
        timeout = (self.timeout, max(self.timeout, CREATE_TIMEOUT))
        res = self.request("POST", "/jobs", params=options, data=body, headers=headers, timeout=timeout)
        return self.answer(res)

    def jobs(self, ref):
        """The node's jobs with that ref."""
        return self.answer(self.request("GET", "/jobs", params={"ref": ref}))

    def job(self, job_id):
        return self.answer(self.request("GET", f"/jobs/{job_id}"))

    def log(self, job_id, offset=0):
        """The trainer's output from a byte on, and the offset to ask from next."""
        res = self.request("GET", f"/jobs/{job_id}/log", params={"offset": offset})
        try:
            after = int(res.headers.get("X-Log-Offset", ""))
        except ValueError:
            after = offset + len(res.content)
        return res.text, after

    def result(self, job_id, dest):
        try:
            with self.request("GET", f"/jobs/{job_id}/result", stream=True) as res, open(dest, "wb") as f:
                f.writelines(res.iter_content(1024 * 1024))
        except requests.RequestException as e:  # the connection dropped mid-download
            raise NodeError(f"The download of the trained model from {self.url} stopped: {e}") from e

    def cancel(self, job_id):
        return self.answer(self.request("POST", f"/jobs/{job_id}/cancel"))

    def delete(self, job_id):
        self.request("DELETE", f"/jobs/{job_id}")
