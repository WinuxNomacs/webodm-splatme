from app.plugins import Menu, MountPoint, PluginBase, signals
from django.contrib.auth.decorators import login_required
from django.dispatch import receiver
from django.shortcuts import render

from . import training
from .api import Auto, Automation, Cancel, Check, FindTask, Log, NodeSettings, Status, Train


class Plugin(PluginBase):
    def main_menu(self):
        # WebODM shows a plugin's menu item to every user: the page gives administrators the node's settings and
        # everyone else only its state
        return [Menu("SplatMe", self.public_url(""), "fa fa-splat fa-fw")]

    def include_js_files(self):
        return ["main.js"]

    def build_jsx_components(self):
        return ["TrainSplats.jsx", "Dashboard.jsx"]

    def app_mount_points(self):
        @login_required
        def settings_page(request):
            return render(request, self.template_path("settings.html"), {"title": "SplatMe"})

        return [MountPoint("$", settings_page)]

    def api_mount_points(self):
        return [
            MountPoint("task/(?P<pk>[^/.]+)/train$", Train.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/status$", Status.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/check$", Check.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/cancel$", Cancel.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/log$", Log.as_view()),
            MountPoint("task/(?P<pk>[^/.]+)/auto$", Auto.as_view()),
            MountPoint("node$", NodeSettings.as_view()),
            MountPoint("automation$", Automation.as_view()),
            MountPoint("find-task$", FindTask.as_view()),
        ]


# WebODM's worker, where a task completes and is deleted, imports this module when it starts without calling
# register(): the receivers are connected here, at the module's top level


@receiver(signals.task_completed, dispatch_uid="splatme_task_completed")
def train_completed_task(sender, task_id, **kwargs):
    training.completed(task_id)


@receiver(signals.task_removing, dispatch_uid="splatme_task_removing")
def stop_training_of_removed_task(sender, task_id, **kwargs):
    training.removed(task_id)
