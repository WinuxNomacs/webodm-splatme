"""
The plugin's API, under /api/plugins/splatme/.

    POST task/<id>/train     starts training; options steps, image_size, max_gaussians, sh_degree
    GET  task/<id>/status    the task's job, and whether the task has a splat model
    GET  task/<id>/check     before training: why the task or the node cannot train, warnings, the options' ranges
    POST task/<id>/cancel    stops the task's job
    GET  task/<id>/log       the trainer's output from ?offset= on (the next offset is in X-Log-Offset)
    GET  node                the splat node's state; for administrators also its address
    POST node                sets its address (url) and token, then answers as GET does (administrators);
                             with save false, only tries them
    GET  task/<id>/auto      whether the task is trained when it completes, and with which options
    POST task/<id>/auto      sets that for the task (enabled and the options), or with reset true goes back to
                             the administrators' default
    GET  automation          the default for tasks without a setting of their own; with ?ranges=1 also the
                             node's range of each option (a new task's setting is chosen before the task exists)
    POST automation          sets it (administrators)

Starting and canceling need the right to change the task's project; the node's token never leaves the server.
"""
from app.api.common import check_project_perms
from app.plugins.views import TaskView
from django.http import HttpResponse
from rest_framework import exceptions, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import training
from .node import Node, NodeError

# What a page may know of a job: not its run id, nor the node's job
PUBLIC = ("state", "progress", "status", "error", "options", "user", "auto", "started", "finished", "sky_masks")
UNAVAILABLE = "The splat node is not available. Ask an administrator to check SplatMe's settings."


def can_train(request, task):
    return request.user.has_perm("change_project", task.project)


def node_state(info):
    """What any user may know of the node: not the id of the job it runs."""
    return {
        "version": info.get("version"), "trainer": info.get("trainer"), "gpu": info.get("gpu"),
        "busy": bool(info.get("running")), "queued": info.get("queued", 0),
    }  # fmt: skip


def is_true(value):
    return value is True or str(value).lower() in ("true", "1", "on")


def describe_auto(setting):
    return {name: setting.get(name) for name in ("enabled", "options", "own") if name in setting}


def describe(request, task, job):
    try:
        task.refresh_from_db()
    except task.DoesNotExist:
        raise exceptions.NotFound() from None
    out = {name: job.get(name) for name in PUBLIC} if job else {"state": None}
    out["active"] = bool(job) and job["state"] in training.ACTIVE
    out["has_splats"] = "splats.rad" in task.available_assets
    out["can_train"] = can_train(request, task)
    out["task_status"] = task.status
    out["auto"] = describe_auto(training.get_auto(task.id))
    return out


class Train(TaskView):
    def post(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        check_project_perms(request, task.project, perms=("change_project",))
        try:
            job = training.start(task, request.user.username, request.data)
        except (training.TrainingError, NodeError) as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(describe(request, task, job))


class Status(TaskView):
    def get(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        return Response(describe(request, task, training.follow(task)))


class Check(TaskView):
    def get(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        out = {
            "problem": training.problem(task), "warnings": [], "node_error": None, "ranges": None,
            "defaults": training.DEFAULTS, "has_splats": "splats.rad" in task.available_assets,
            "trained_steps": training.trained_steps(task),
        }  # fmt: skip
        if out["problem"] is None:
            out["warnings"] = training.warnings(task)
        try:
            info = training.get_node().check()
            out["ranges"] = {name: info["options"][name] for name in training.NODE_OPTIONS if name in info["options"]}
        except NodeError as e:
            # Only an administrator can fix the node, and its address is theirs to know
            out["node_error"] = str(e) if request.user.is_superuser else UNAVAILABLE
        return Response(out)


class Cancel(TaskView):
    def post(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        check_project_perms(request, task.project, perms=("change_project",))
        return Response(describe(request, task, training.cancel(task)))


class Log(TaskView):
    def get(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        job = training.get_job(task.id)
        try:
            offset = max(0, int(request.query_params.get("offset", 0)))
        except ValueError:
            raise exceptions.ValidationError(detail="Invalid offset") from None
        text = ""
        if job and job.get("node_job"):
            try:
                text, offset = training.get_node().log(job["node_job"], offset)
            except NodeError as e:
                if e.status != 404:  # the node deletes a finished job, and its log, after a while
                    return Response({"error": str(e)}, status=status.HTTP_502_BAD_GATEWAY)
        res = HttpResponse(text, content_type="text/plain; charset=utf-8")
        res["X-Log-Offset"] = str(offset)
        return res


class Auto(TaskView):
    def get(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        return Response(describe_auto(training.get_auto(task.id)))

    def post(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        check_project_perms(request, task.project, perms=("change_project",))
        if is_true(request.data.get("reset")):
            training.reset_auto(task.id)
        else:
            try:
                training.set_auto(task.id, request.user.username, is_true(request.data.get("enabled")), request.data)
            except training.TrainingError as e:
                return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(describe_auto(training.get_auto(task.id)))


class Automation(APIView):
    permission_classes = (IsAuthenticated,)

    def describe(self, request):
        out = describe_auto(training.get_default())
        out["admin"] = request.user.is_superuser
        # Only an administrator can restart WebODM, so only they are told the worker does not listen yet
        out["listening"] = training.worker_listens() if request.user.is_superuser else None
        return out

    def get(self, request):
        if is_true(request.query_params.get("ranges")):
            return Response(dict(describe_auto(training.get_default()), ranges=training.node_ranges()))
        return Response(self.describe(request))

    def post(self, request):
        if not request.user.is_superuser:
            raise exceptions.PermissionDenied()
        try:
            training.set_default(is_true(request.data.get("enabled")), request.data)
        except training.TrainingError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.describe(request))


class NodeSettings(APIView):
    permission_classes = (IsAuthenticated,)

    def describe(self, request, node):
        out = {"admin": request.user.is_superuser, "node": None, "error": None}
        try:
            out["node"] = node_state(node.check())
        except NodeError as e:
            out["error"] = str(e) if request.user.is_superuser else UNAVAILABLE
        if request.user.is_superuser:
            out.update(url=node.url, token_set=bool(node.token))
        return out

    def get(self, request):
        return Response(self.describe(request, training.get_node()))

    def post(self, request):
        if not request.user.is_superuser:
            raise exceptions.PermissionDenied()
        url = str(request.data.get("url", "")).strip().rstrip("/")
        if url and not url.startswith(("http://", "https://")):
            raise exceptions.ValidationError(detail="The address starts with http:// or https://")
        token = request.data.get("token")
        token = None if token in (None, "") else str(token)  # an empty token keeps the one that is set
        if request.data.get("save") in (False, "false", "0"):
            saved = training.get_node()
            return Response(self.describe(request, Node(url, saved.token if token is None else token)))
        training.set_node(url, token)
        return Response(self.describe(request, training.get_node()))
