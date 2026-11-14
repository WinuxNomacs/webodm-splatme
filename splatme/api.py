"""
The plugin's API, under /api/plugins/splatme/.

    POST task/<id>/train     starts training; options steps, image_size, max_gaussians, sh_degree
    GET  task/<id>/status    the task's job, and whether the task has a splat model
    POST task/<id>/cancel    stops the task's job
    GET  task/<id>/log       the trainer's output from ?offset= on (the next offset is in X-Log-Offset)
    GET  node                the splat node's address and state (administrators)
    POST node                sets its address (url) and token, then answers as GET does (administrators)

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
from .node import NodeError

# What a page may know of a job: not its run id, nor the node's job
PUBLIC = ("state", "progress", "status", "error", "options", "user", "started", "finished")


def describe(task, job):
    task.refresh_from_db()
    out = {name: job.get(name) for name in PUBLIC} if job else {"state": None}
    out["active"] = bool(job) and job["state"] in training.ACTIVE
    out["has_splats"] = "splats.rad" in task.available_assets
    return out


class Train(TaskView):
    def post(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        check_project_perms(request, task.project, perms=("change_project",))
        try:
            job = training.start(task, request.user, request.data)
        except (training.TrainingError, NodeError) as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(describe(task, job))


class Status(TaskView):
    def get(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        return Response(describe(task, training.follow(task)))


class Cancel(TaskView):
    def post(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        check_project_perms(request, task.project, perms=("change_project",))
        return Response(describe(task, training.cancel(task)))


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


class NodeSettings(APIView):
    permission_classes = (IsAuthenticated,)

    def check_permissions(self, request):
        super().check_permissions(request)
        if not request.user.is_superuser:
            raise exceptions.PermissionDenied()

    def describe(self):
        node = training.get_node()
        out = {"url": node.url, "token_set": bool(node.token), "node": None, "error": None}
        if node.url:
            try:
                out["node"] = node.check()
            except NodeError as e:
                out["error"] = str(e)
        return out

    def get(self, request):
        return Response(self.describe())

    def post(self, request):
        url = str(request.data.get("url", "")).strip()
        if url and not url.startswith(("http://", "https://")):
            raise exceptions.ValidationError(detail="The address starts with http:// or https://")
        token = request.data.get("token")
        training.set_node(url, None if token is None else str(token))
        return Response(self.describe())
