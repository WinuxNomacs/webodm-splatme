import hashlib
import os

from app.plugins import Menu, MountPoint, PluginBase, signals
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.dispatch import receiver
from django.http import JsonResponse
from django.shortcuts import render

from . import training
from .api import (
    Apply,
    Auto,
    Automation,
    Cancel,
    Check,
    Download,
    Edits,
    Floaters,
    Log,
    Model,
    ModelApply,
    ModelEdits,
    ModelOriginal,
    Nodes,
    NodeSettings,
    OneNode,
    Revive,
    SharedAutomation,
    Snap,
    Status,
    Tasks,
    Thumbnail,
    Train,
    Volume,
)

# The server gives the files in public/ no Cache-Control, and a browser then keeps one for about a tenth of its age
# without asking again: hours, after an upgrade, of a page's old script against the new API. So the URLs of the
# scripts that change carry a version made from their files, which an upgrade or a rebuild changes.
PUBLIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
# The editor's plain ES modules (not built by webpack)
EDITOR_MODULES = ("editor/viewer.js", "editor/modelWorker.js", "meshEdits.js", "editShapes.js", "measure.js")
# The pages' bundles that WebODM's webpack builds into public/build, each a .js and a .css
BUNDLES = ("Tasks", "Dashboard", "Editor")


def file_version(*names):
    """A version of these files of public/ (their times and sizes): "0" for a file that is missing."""
    parts = []
    for name in names:
        try:
            info = os.stat(os.path.join(PUBLIC, name))
            parts.append(f"{info.st_mtime_ns}:{info.st_size}")
        except OSError:
            parts.append("0")
    return hashlib.sha256(";".join(parts).encode()).hexdigest()[:12]


def editor_modules():
    """The editor's modules as the page's import map gives them: {published path: path with its version}."""
    return {f"/plugins/splatme/{name}": f"/plugins/splatme/{name}?v={file_version(name)}" for name in EDITOR_MODULES}


def bundle_version(name):
    return file_version(f"build/{name}.js", f"build/{name}.css")


class Plugin(PluginBase):
    def main_menu(self):
        # WebODM shows a plugin's menu item to every user: Tasks, where splats are trained, and Settings, with the
        # node's state and address and the user's own options for a new task. Administration, which WebODM shows
        # only to staff, has the node's settings (main.js)
        return [Menu("SplatMe", "#", "fa fa-splat fa-fw", [
            Menu("Tasks", self.public_url(""), "fa fa-tasks fa-fw"),
            Menu("Settings", self.public_url("settings/"), "fa fa-cog fa-fw"),
        ])]

    def include_js_files(self):
        return ["main.js"]

    def build_jsx_components(self):
        return ["Tasks.jsx", "Dashboard.jsx", "Editor.jsx"]

    def app_mount_points(self):
        parts = {"node_part": self.template_path("node.html"), "options_part": self.template_path("options.html")}

        @login_required
        def tasks_page(request):
            return render(request, self.template_path("tasks.html"), {"title": "SplatMe Tasks", "bundle": bundle_version("Tasks")})

        @login_required
        def settings_page(request):
            return render(request, self.template_path("settings.html"), {"title": "SplatMe Settings", **parts})

        # Staff accounts see Administration and so its SplatMe item; only superusers change what is on it
        @login_required
        def admin_page(request):
            if not request.user.is_staff:
                raise PermissionDenied()
            return render(request, self.template_path("admin.html"), {"title": "SplatMe", **parts})

        # Edit Splats: the API answers whether the user may see and change the task
        @login_required
        def editor_page(request, task_id):
            return render(request, self.template_path("editor.html"), {
                "title": "Edit Splats", "task_id": task_id, "modules": editor_modules(), "bundle": bundle_version("Editor"),
            })

        # The bundles' versions, for main.js, a script WebODM gives a version only from 4.0.1 on: asked each time
        def bundles(request):
            response = JsonResponse({name: bundle_version(name) for name in BUNDLES})
            response["Cache-Control"] = "no-cache"
            return response

        return [
            MountPoint("$", tasks_page), MountPoint("settings/$", settings_page), MountPoint("admin/$", admin_page),
            MountPoint("edit/(?P<task_id>[0-9a-f-]+)/$", editor_page), MountPoint("bundles$", bundles),
        ]

    def api_mount_points(self):
        return [
            MountPoint("task/(?P<pk>[^/.]+)/train$", Train.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/status$", Status.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/check$", Check.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/cancel$", Cancel.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/log$", Log.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/auto$", Auto.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/edits$", Edits.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/apply$", Apply.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/floaters$", Floaters.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/model$", Model.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/download$", Download.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/thumbnail$", Thumbnail.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/model-edits$", ModelEdits.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/model-original$", ModelOriginal.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/model-apply$", ModelApply.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/snap$", Snap.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/volume$", Volume.as_view()),
            MountPoint("node$", NodeSettings.as_view()),
            MountPoint("nodes$", Nodes.as_view()),
            MountPoint("nodes/(?P<node_id>[0-9a-z_-]{1,32})$", OneNode.as_view()),
            MountPoint("automation$", Automation.as_view()),
            MountPoint("automation/shared$", SharedAutomation.as_view()),
            MountPoint("tasks$", Tasks.as_view()),
            MountPoint("revive$", Revive.as_view()),
        ]


# WebODM's worker, where a task completes and is deleted, imports this module when it starts without calling
# register(): the receivers are connected here, at the module's top level


@receiver(signals.task_completed, dispatch_uid="splatme_task_completed")
def train_completed_task(sender, task_id, **kwargs):
    try:
        training.completed(task_id)
    finally:
        training.task_ended()


@receiver(signals.task_failed, dispatch_uid="splatme_task_failed")
def look_for_lost_trainings(sender, task_id, **kwargs):
    training.task_ended()


@receiver(signals.task_removing, dispatch_uid="splatme_task_removing")
def stop_training_of_removed_task(sender, task_id, **kwargs):
    training.removed(task_id)
