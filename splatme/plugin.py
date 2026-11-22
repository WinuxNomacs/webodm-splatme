import hashlib
import os

from app.plugins import Menu, MountPoint, PluginBase, signals
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.dispatch import receiver
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
    NodeSettings,
    Revive,
    SharedAutomation,
    Status,
    Tasks,
    Thumbnail,
    Train,
)

# The editor's plain ES modules (not built by webpack): their URLs carry a version made from their files, so that a
# browser fetches them again once they change (the server gives them no Cache-Control)
EDITOR_MODULES = ("editor/viewer.js", "meshEdits.js", "editShapes.js")


def editor_modules():
    """The editor's modules as the page's import map gives them: {published path: path with its version}."""
    public = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
    out = {}
    for name in EDITOR_MODULES:
        try:
            info = os.stat(os.path.join(public, name))
            version = hashlib.sha256(f"{info.st_mtime_ns}:{info.st_size}".encode()).hexdigest()[:12]
        except OSError:
            version = "0"
        out[f"/plugins/splatme/{name}"] = f"/plugins/splatme/{name}?v={version}"
    return out


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
            return render(request, self.template_path("tasks.html"), {"title": "SplatMe Tasks"})

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
            return render(request, self.template_path("editor.html"), {"title": "Edit Splats", "task_id": task_id, "modules": editor_modules()})

        return [
            MountPoint("$", tasks_page), MountPoint("settings/$", settings_page), MountPoint("admin/$", admin_page),
            MountPoint("edit/(?P<task_id>[0-9a-f-]+)/$", editor_page),
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
            MountPoint("node$", NodeSettings.as_view()),
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
