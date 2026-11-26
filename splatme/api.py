"""
The plugin's API, under /api/plugins/splatme/.

    POST task/<id>/train     starts training; options steps, image_size, max_gaussians, sh_degree, densify_until, strategy,
                             exposure_correction (those the node's trainer has)
    GET  task/<id>/status    the task's job, and whether the task has a splat model
    GET  task/<id>/check     before training: why the task or the node cannot train, warnings, the options' ranges,
                             the node's trainer (node: trainer_kind, supports, ranges) and the trainer of the task's
                             model (trained_kind)
    POST task/<id>/cancel    stops the task's job
    GET  task/<id>/log       the trainer's output from ?offset= on (the next offset is in X-Log-Offset)
    GET  node                the splat node's state and its address (for administrators also whether a token is set)
    POST node                sets its address (url) and token, then answers as GET does (administrators);
                             with save false, only tries them
    GET  task/<id>/auto      whether the task is trained when it completes, and with which options
    POST task/<id>/auto      sets that for the task (enabled and the options)
    GET  automation          the options SplatMe's panel starts with for the user's new task: their own (own true)
                             or the administrators'; with ?ranges=1 also the node's range of each option and its
                             trainer (node, as check has it; the panel is filled before the task exists)
    POST automation          saves the user's own options; with reset true, drops them
    GET  automation/shared   the administrators' options, for users who saved none of their own (?ranges=1 as above)
    POST automation/shared   sets them (administrators)
    GET  task/<id>/edits     the task's splat edits (edits.py) in its trained model's frame, why it cannot be edited
                             (editable), its last Apply Edits, whether its model was made with them (applied) and, for
                             those who may edit, the trained model's URL, size and splat count
    PUT  task/<id>/edits     replaces its edits (edits), then answers as GET does
    GET  task/<id>/model     the trained model, uncut (those who may edit)
    GET  task/<id>/floaters  which splats of its trained model are floaters at ?strength= (light, medium or strong):
                             their numbers in the .ply (removed), for the page to hide them (those who may edit)
    POST task/<id>/apply     makes the task's shown model again from its trained model and its edits; with cancel,
                             stops the one that runs
    GET  task/<id>/download  the task's model with its saved edits, as Apply makes it, as a .ply (training.edited_model)
    GET  task/<id>/thumbnail a JPEG of the task's model, taken by Edit Splats (404 without one)
    PUT  task/<id>/thumbnail keeps the JPEG in the request's body as its thumbnail (those who may edit)
    GET  task/<id>/model-edits   the task's textured model's edits (meshes.py) in the model's frame, why it cannot be
                                 edited (editable), its last update, whether the model has the edits (applied) and,
                                 for those who may edit, the original model's URL and size
    PUT  task/<id>/model-edits   replaces them (edits), then answers as GET does
    GET  task/<id>/model-original the textured model's original GLB, before any update (those who may edit)
    POST task/<id>/model-apply   makes the task's textured model again from its original files and the edits; with
                                 cancel, stops the one that runs
    GET  tasks               the tasks SplatMe can train that the user may see (training.compatible), by project, each
                             with its processing (status, progress, error) and its splats as task/<id>/status gives
                             them (SplatMe's Tasks page, in one request); a project with none is left out. Also the
                             projects the user may add a task to (New Task With Splats). ?project=<id> for one project

Starting, canceling, editing and applying need the right to change the task's project; the node's token never leaves the server.
"""
import logging

from app.api.common import check_project_perms
from app.models import Project
from app.plugins.views import TaskView
from django.http import FileResponse, HttpResponse
from django.utils.text import slugify
from guardian.shortcuts import get_objects_for_user
from rest_framework import exceptions, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import crop, edits, meshes, thermal, training
from .node import Node, NodeError, update_note

logger = logging.getLogger("app.logger")

# What a page may know of a job: not its run id, nor the node's job
PUBLIC = (
    "state", "progress", "status", "error", "options", "user", "auto", "started", "finished", "sky_masks", "cropped",
    "time_left", "thermal", "edited", "edits_error", "times", "earlier_training", "resume", "skipped",
)  # fmt: skip
# What a page may know of an Apply Edits
APPLY_PUBLIC = ("state", "status", "error", "user", "started", "finished", "cropped", "edited")
UNAVAILABLE = "The splat node is not available. Ask an administrator to check SplatMe's settings."


def can_train(request, task):
    return request.user.has_perm("change_project", task.project)


def node_state(info):
    """What any user may know of the node: not the id of the job it runs."""
    return {
        "version": info.get("version"), "trainer": info.get("trainer"), "gpu": info.get("gpu"),
        "busy": bool(info.get("running")), "queued": info.get("queued", 0), "update": update_note(info.get("version")),
    }  # fmt: skip


def is_true(value):
    return value is True or str(value).lower() in ("true", "1", "on")


def describe_auto(setting):
    return {name: setting.get(name) for name in ("enabled", "options", "node") if name in setting}


def describe(request, task, job):
    try:
        task.refresh_from_db()
    except task.DoesNotExist:
        raise exceptions.NotFound() from None
    return summary(request, task, job, can_train(request, task))


MODEL_APPLY_PUBLIC = ("state", "status", "error", "user", "started", "finished", "removed", "flattened", "moved", "filled", "added", "cloned", "triangles")


def describe_model_apply(record):
    return {name: record.get(name) for name in MODEL_APPLY_PUBLIC} if record else None


def describe_apply(record):
    return {name: record.get(name) for name in APPLY_PUBLIC} if record else None


def summary(request, task, job, may_train):
    """A task's splats as a page shows them: its job, its model, whether the user may train it, its automation."""
    out = {name: job.get(name) for name in PUBLIC} if job else {"state": None}
    out["active"] = bool(job) and job["state"] in training.ACTIVE
    out["has_splats"] = "splats.rad" in task.available_assets
    out["can_train"] = may_train
    out["task_status"] = task.status
    out["editable"] = out["has_splats"] and training.editable(task) is None
    out["thumbnail"] = training.thumbnail_version(task) if out["has_splats"] else None
    out["model_editable"] = meshes.editable(task) is None
    out["model_apply"] = describe_model_apply(training.get_apply(task.id, meshes.KIND))
    out["apply"] = describe_apply(training.get_apply(task.id))
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
            # Whether SplatMe → Tasks lists it, and why not (its folder is read)
            out["unlisted"] = training.unlisted(task)
            out["listed"] = out["unlisted"] is None
        return Response(out)


class Check(TaskView):
    def get(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        out = {
            "problem": training.problem(task), "warnings": [], "node_error": None, "ranges": None, "node": None,
            "defaults": training.DEFAULTS, "has_splats": "splats.rad" in task.available_assets,
            "trained_steps": training.trained_steps(task), "trained_kind": training.trained_kind(task),
            "boundary": bool(crop.boundary(task)),
            "trained_grow_until": (training.trained_options(task) or {}).get("densify_until"),
            "thermal": thermal.is_thermal(task), "photo_sizes": training.photo_sizes(task),
        }  # fmt: skip
        if out["problem"] is None:
            out["warnings"] = training.warnings(task)
        # Every node set up, and whether each can continue the task's model; the chosen one's trainer (?node=, or
        # the default) is what the form shows. Only an administrator can fix a node, and its address is theirs to know
        chosen = request.query_params.get("node") or None
        out["nodes"], picked = [], None
        for entry, info, error in training.check_nodes():
            item = {"id": entry["id"], "name": entry["name"], "trainer_kind": None, "continue_problem": None,
                    "error": None if error is None else (error if request.user.is_superuser else UNAVAILABLE)}
            if info is not None:
                item["trainer_kind"] = training.node_kind(info)
                if out["trained_steps"] is not None:
                    item["continue_problem"] = training.continue_problem(task, info)
            out["nodes"].append(item)
            if picked is None and (entry["id"] == chosen or chosen is None):
                picked = (entry, info, item["error"])
        if picked is None:
            if chosen is not None:
                out["node_error"] = "That splat node is not set up in SplatMe."
            else:
                try:
                    training.get_node().check()  # none set up: its answer says so
                except NodeError as e:
                    out["node_error"] = str(e) if request.user.is_superuser else UNAVAILABLE
        else:
            out["node_id"] = picked[0]["id"]
            if picked[1] is None:
                out["node_error"] = picked[2]
            else:
                out["node"] = training.node_view(picked[1])
                out["ranges"] = out["node"]["ranges"]
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
                text, offset = training.job_node(job).log(job["node_job"], offset)
            except NodeError as e:
                if e.status != 404:  # the node deletes a finished job, and its log, after a while
                    error = str(e) if request.user.is_superuser else UNAVAILABLE  # as Check
                    return Response({"error": error}, status=status.HTTP_502_BAD_GATEWAY)
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


class Edits(TaskView):
    def describe(self, request, task):
        reason, job = training.editable(task), training.get_job(task.id)
        try:
            saved, unreadable = edits.get(task), None
        except edits.EditsError as e:
            saved, unreadable = [], str(e)
        out = {
            "edits": saved, "unreadable": unreadable, "editable": reason, "can_edit": can_train(request, task), "name": task.name,
            "project": task.project.id, "apply": describe_apply(training.get_apply(task.id)), "model": None,
            "boundary": [],
            "training": bool(job) and job["state"] in training.ACTIVE,
        }  # fmt: skip
        if reason is None:
            # Whether the task's model was made with the edits saved now (None: not known)
            out["applied"] = training.shown_current(task.id)
        if reason is None and out["can_edit"]:
            # Uncut, it has what the boundary and the edits remove: only for those who may edit
            try:
                out["model"] = training.model_info(task)
            except (OSError, ValueError) as e:
                logger.warning(f"SplatMe: task {task.id}'s trained model does not read: {e}")
                out["editable"] = "This task's trained splat model could not be read. Train its splats again to edit them."
                return out
            # What the shown model leaves out of it, which the page hides too
            out["boundary"] = crop.boundary(task) if training.trained_with_crop(task) else []
        return out

    def get(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        return Response(self.describe(request, task))

    def put(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        check_project_perms(request, task.project, perms=("change_project",))
        reason = training.editable(task)
        if reason:
            return Response({"error": reason}, status=status.HTTP_400_BAD_REQUEST)
        try:
            edits.save(task, request.data.get("edits") if isinstance(request.data, dict) else None)
        except edits.EditsError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.describe(request, task))


class Model(TaskView):
    """The trained model, uncut, for Edit Splats: only for those who may change the task's project."""

    def get(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        check_project_perms(request, task.project, perms=("change_project",))
        reason = training.editable(task)
        if reason:
            return Response({"error": reason}, status=status.HTTP_400_BAD_REQUEST)
        try:
            model = open(training.trained_model(task), "rb")  # noqa: SIM115 (FileResponse closes it)
        except OSError as e:
            logger.warning(f"SplatMe: task {task.id}'s trained model could not be opened: {e}")
            return Response({"error": "The trained model could not be read."}, status=status.HTTP_400_BAD_REQUEST)
        return FileResponse(model, content_type="application/octet-stream")


class Floaters(TaskView):
    def get(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        check_project_perms(request, task.project, perms=("change_project",))
        strength = request.query_params.get("strength")
        if strength not in edits.STRENGTHS:
            return Response({"error": "The strength must be light, medium or strong."}, status=status.HTTP_400_BAD_REQUEST)
        reason = training.editable(task)
        if reason:
            return Response({"error": reason}, status=status.HTTP_400_BAD_REQUEST)
        try:
            found = edits.floaters(training.trained_model(task), strength)
        except OSError as e:
            logger.warning(f"SplatMe: task {task.id}'s floaters could not be found: {e}")
            return Response({"error": "The trained model could not be read."}, status=status.HTTP_400_BAD_REQUEST)
        except (ValueError, KeyError, MemoryError) as e:
            return Response({"error": f"The trained model's floaters could not be found: {str(e) or type(e).__name__}"}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"strength": strength, "removed": found.nonzero()[0].tolist()})


class Apply(TaskView):
    def post(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        check_project_perms(request, task.project, perms=("change_project",))
        if isinstance(request.data, dict) and is_true(request.data.get("cancel")):
            training.cancel_apply(task.id)
            return Response(describe(request, task, training.get_job(task.id)))
        try:
            training.start_apply(task, request.user.username)
        except training.TrainingError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(describe(request, task, training.get_job(task.id)))


class Download(TaskView):
    def get(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        try:
            model = training.edited_model(task)
        except OSError as e:  # its text has the server's paths: the log has it
            logger.warning(f"SplatMe: task {task.id}'s edited model could not be made: {e}")
            text = "The edited model could not be made: the server could not write or read it."
            return HttpResponse(text, status=status.HTTP_400_BAD_REQUEST, content_type="text/plain; charset=utf-8")
        except (training.TrainingError, edits.EditsError) as e:
            # A link the browser follows: the reason as a page of text
            text = f"The edited model could not be made: {str(e) or type(e).__name__}"
            return HttpResponse(text, status=status.HTTP_400_BAD_REQUEST, content_type="text/plain; charset=utf-8")
        name = f"{slugify(task.name or '') or task.id}-splats.ply"
        return FileResponse(model, as_attachment=True, filename=name, content_type="application/octet-stream")


class Thumbnail(TaskView):
    def get(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        try:
            image = open(training.thumbnail_file(task), "rb")  # noqa: SIM115 (FileResponse closes it)
        except OSError:
            return Response({"error": "This task has no thumbnail."}, status=status.HTTP_404_NOT_FOUND)
        return FileResponse(image, content_type="image/jpeg")

    def put(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        check_project_perms(request, task.project, perms=("change_project",))
        reason = training.editable(task)
        if reason:
            return Response({"error": reason}, status=status.HTTP_400_BAD_REQUEST)
        try:
            training.save_thumbnail(task, request.body)
        except training.TrainingError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"thumbnail": training.thumbnail_version(task)})


class ModelEdits(TaskView):
    def describe(self, request, task):
        reason = meshes.editable(task)
        try:
            saved, unreadable = meshes.get(task), None
        except edits.EditsError as e:
            saved, unreadable = [], str(e)
        out = {
            "edits": saved, "unreadable": unreadable, "editable": reason, "can_edit": can_train(request, task),
            "name": task.name, "project": task.project.id, "model": None,
            "apply": describe_model_apply(training.get_apply(task.id, meshes.KIND)),
        }  # fmt: skip
        if reason is None:
            out["applied"] = meshes.shown_current(task.id)
            if out["can_edit"]:
                try:
                    out["model"] = meshes.info(task)
                except OSError as e:
                    logger.warning(f"SplatMe: task {task.id}'s textured model could not be read: {e}")
                    out["editable"] = "This task's textured model could not be read."
        return out

    def get(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        return Response(self.describe(request, task))

    def put(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        check_project_perms(request, task.project, perms=("change_project",))
        reason = meshes.editable(task)
        if reason:
            return Response({"error": reason}, status=status.HTTP_400_BAD_REQUEST)
        try:
            meshes.save(task, request.data.get("edits") if isinstance(request.data, dict) else None)
        except edits.EditsError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.describe(request, task))


class ModelOriginal(TaskView):
    """The textured model's original GLB, for the editor: only for those who may change the task's project."""

    def get(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        check_project_perms(request, task.project, perms=("change_project",))
        reason = meshes.editable(task)
        if reason:
            return Response({"error": reason}, status=status.HTTP_400_BAD_REQUEST)
        try:
            model = open(meshes.original(task, meshes.GLB), "rb")  # noqa: SIM115 (FileResponse closes it)
        except OSError as e:
            logger.warning(f"SplatMe: task {task.id}'s textured model could not be opened: {e}")
            return Response({"error": "The textured model could not be read."}, status=status.HTTP_400_BAD_REQUEST)
        return FileResponse(model, content_type="model/gltf-binary")


class ModelApply(TaskView):
    def post(self, request, pk=None):
        task = self.get_and_check_task(request, pk)
        check_project_perms(request, task.project, perms=("change_project",))
        if isinstance(request.data, dict) and is_true(request.data.get("cancel")):
            training.cancel_apply(task.id, meshes.KIND)
        else:
            try:
                meshes.start_apply(task, request.user.username)
            except meshes.ModelError as e:
                return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"apply": describe_model_apply(training.get_apply(task.id, meshes.KIND)),
                         "applied": meshes.shown_current(task.id)})


def with_node(request, out):
    """With ?ranges=1, the node's trainer and range of each option added to an answer (None when it does not answer)."""
    if is_true(request.query_params.get("ranges")):
        out["node"] = training.node_trainer()
        out["ranges"] = out["node"]["ranges"] if out["node"] else None
    return out


class Automation(APIView):
    permission_classes = (IsAuthenticated,)

    def describe(self, request):
        own = training.own_options(request.user)
        out = {"options": own or training.shared_options(), "own": own is not None, "admin": request.user.is_superuser}
        # Administrators, who can restart WebODM, are told what the worker says now; others what it said lately
        out["listening"] = training.listens(fresh=request.user.is_superuser)
        return out

    def get(self, request):
        return Response(with_node(request, self.describe(request)))

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
        return Response(with_node(request, self.describe(request)))

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


class Revive(APIView):
    """GET from any WebODM page (main.js): trainings that lost their worker are taken over (training.revive)."""

    permission_classes = (IsAuthenticated,)

    def get(self, request):
        training.revive()
        return Response(status=status.HTTP_204_NO_CONTENT)


class Nodes(APIView):
    """GET: every splat node set up, the default first: its id, name and state (an administrator also gets its
    address and whether a token is set; nobody gets the token)."""

    permission_classes = (IsAuthenticated,)

    def get(self, request):
        admin = request.user.is_superuser
        out = []
        for entry, info, error in training.check_nodes():
            item = {"id": entry["id"], "name": entry["name"], "node": None if info is None else node_state(info),
                    "trainer_kind": None if info is None else training.node_kind(info),
                    "error": None if error is None else (error if admin else UNAVAILABLE)}
            if admin:
                item.update(url=entry["url"], token_set=bool(entry["token"]))
            out.append(item)
        return Response({"admin": admin, "nodes": out})


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
