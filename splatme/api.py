"""
The plugin's API, under /api/plugins/splatme/.

    POST task/<id>/train     starts training; options steps, image_size, max_gaussians, sh_degree
    GET  task/<id>/status    the task's job, and whether the task has a splat model
    GET  task/<id>/check     before training: why the task or the node cannot train, warnings, the options' ranges
    POST task/<id>/cancel    stops the task's job
    GET  task/<id>/log       the trainer's output from ?offset= on (the next offset is in X-Log-Offset)
    GET  node                the splat node's state and its address (for administrators also whether a token is set)
    POST node                sets its address (url) and token, then answers as GET does (administrators);
                             with save false, only tries them
    GET  task/<id>/auto      whether the task is trained when it completes, and with which options
    POST task/<id>/auto      sets that for the task (enabled and the options)
    GET  automation          the options SplatMe's panel starts with for the user's new task: their own (own true)
                             or the administrators'; with ?ranges=1 also the node's range of each option (the
                             panel is filled before the task exists)
    POST automation          saves the user's own options; with reset true, drops them
    GET  automation/shared   the administrators' options, for users who saved none of their own
    POST automation/shared   sets them (administrators)
    GET  tasks               the tasks SplatMe can train that the user may see (training.compatible), by project, each
                             with its processing (status, progress, error) and its splats as task/<id>/status gives
                             them (SplatMe's Tasks page, in one request); a project with none is left out. Also the
                             projects the user may add a task to (New Task With Splats). ?project=<id> for one project

Starting and canceling need the right to change the task's project; the node's token never leaves the server.
"""
from app.api.common import check_project_perms
from app.models import Project
from app.plugins.views import TaskView
from django.http import HttpResponse
from guardian.shortcuts import get_objects_for_user
from rest_framework import exceptions, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import crop, thermal, training
from .node import Node, NodeError

# What a page may know of a job: not its run id, nor the node's job
PUBLIC = (
    "state", "progress", "status", "error", "options", "user", "auto", "started", "finished", "sky_masks", "cropped",
    "time_left", "thermal",
)  # fmt: skip
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
    return {name: setting.get(name) for name in ("enabled", "options") if name in setting}


def describe(request, task, job):
    try:
        task.refresh_from_db()
    except task.DoesNotExist:
        raise exceptions.NotFound() from None
    return summary(request, task, job, can_train(request, task))


def summary(request, task, job, may_train):
    """A task's splats as a page shows them: its job, its model, whether the user may train it, its automation."""
    out = {name: job.get(name) for name in PUBLIC} if job else {"state": None}
    out["active"] = bool(job) and job["state"] in training.ACTIVE
    out["has_splats"] = "splats.rad" in task.available_assets
    out["can_train"] = may_train
    out["task_status"] = task.status
    out["auto"] = describe_auto(training.get_auto(task.id, request.user))
    # Whether WebODM's worker tells the plugin of completed tasks, for a task set to train (None: not known)
    out["listening"] = training.listens() if out["auto"]["enabled"] else None
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
        out = describe(request, task, training.follow(task))
        if is_true(request.query_params.get("listed")):
            out["listed"] = training.compatible(task)  # whether SplatMe → Tasks lists it (its folder is read)
        return Response(out)


class Check(TaskView):
    def get(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        out = {
            "problem": training.problem(task), "warnings": [], "node_error": None, "ranges": None,
            "defaults": training.DEFAULTS, "has_splats": "splats.rad" in task.available_assets,
            "trained_steps": training.trained_steps(task), "boundary": bool(crop.boundary(task)),
            "thermal": thermal.is_thermal(task), "photo_sizes": training.photo_sizes(task),
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
        return Response(describe_auto(training.get_auto(task.id, request.user)))

    def post(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        check_project_perms(request, task.project, perms=("change_project",))
        try:
            training.set_auto(task.id, request.user.username, is_true(request.data.get("enabled")), request.data)
        except training.TrainingError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(describe_auto(training.get_auto(task.id, request.user)))


class Automation(APIView):
    permission_classes = (IsAuthenticated,)

    def describe(self, request):
        own = training.own_options(request.user)
        out = {"options": own or training.shared_options(), "own": own is not None, "admin": request.user.is_superuser}
        # Administrators, who can restart WebODM, are told what the worker says now; others what it said lately
        out["listening"] = training.listens(fresh=request.user.is_superuser)
        return out

    def get(self, request):
        out = self.describe(request)
        if is_true(request.query_params.get("ranges")):
            out["ranges"] = training.node_ranges()
        return Response(out)

    def post(self, request):
        if is_true(request.data.get("reset")):
            training.reset_own_options(request.user)
            return Response(self.describe(request))
        try:
            training.set_own_options(request.user, request.data)
        except training.TrainingError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.describe(request))


class SharedAutomation(APIView):
    permission_classes = (IsAuthenticated,)

    def describe(self, request):
        out = {"options": training.shared_options(), "admin": request.user.is_superuser}
        out["listening"] = training.listens(fresh=request.user.is_superuser)
        return out

    def get(self, request):
        return Response(self.describe(request))

    def post(self, request):
        if not request.user.is_superuser:
            raise exceptions.PermissionDenied()
        try:
            training.set_shared_options(request.data)
        except training.TrainingError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.describe(request))


class Tasks(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        # As WebODM's own project list: a project's own permission, not the global one every user has
        projects = get_objects_for_user(request.user, "app.view_project", Project, accept_global_perms=False)
        projects = projects.filter(deleting=False).order_by("-created_at")
        wanted = request.query_params.get("project")
        if wanted:
            if not wanted.isdigit():
                raise exceptions.ValidationError(detail="Invalid project")
            projects = projects.filter(id=int(wanted))
        out, addable = [], []
        for project in projects:
            may_train = request.user.has_perm("change_project", project)
            all_tasks = project.task_set.filter(partial=False)
            if may_train:
                addable.append({"id": project.id, "name": project.name, "has_tasks": all_tasks.exists()})
            tasks = []
            # A task still receiving its photos (partial) is not one yet, as on the Dashboard
            for task in all_tasks.order_by("-created_at"):
                if not training.compatible(task):
                    continue
                tasks.append({
                    "id": str(task.id), "name": task.name, "status": task.status, "created_at": task.created_at,
                    "images_count": task.images_count, "running_progress": task.running_progress,
                    "last_error": task.last_error,
                    "splats": summary(request, task, training.follow(task), may_train),
                })  # fmt: skip
            if tasks:
                out.append({"id": project.id, "name": project.name, "can_train": may_train, "tasks": tasks})
        return Response({"projects": out, "addable": addable})


class NodeSettings(APIView):
    permission_classes = (IsAuthenticated,)

    def describe(self, request, node):
        out = {"admin": request.user.is_superuser, "node": None, "error": None, "url": node.url}
        try:
            out["node"] = node_state(node.check())
        except NodeError as e:
            out["error"] = str(e) if request.user.is_superuser else UNAVAILABLE
        if request.user.is_superuser:
            out["token_set"] = bool(node.token)
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
