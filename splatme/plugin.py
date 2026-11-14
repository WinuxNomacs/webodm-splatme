from app.plugins import Menu, MountPoint, PluginBase, signals
from django.contrib.auth.decorators import login_required
from django.dispatch import receiver
from django.shortcuts import render

from . import training
from .api import Cancel, Check, Log, NodeSettings, Status, Train


class Plugin(PluginBase):
    def main_menu(self):
        # WebODM shows a plugin's menu item to every user: the page gives administrators the node's settings and
        # everyone else only its state
        return [Menu("SplatMe", self.public_url(""), "fa fa-splat fa-fw")]

    def include_js_files(self):
        return ["main.js"]

    def build_jsx_components(self):
        return ["TrainSplats.jsx"]

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
            MountPoint("node$", NodeSettings.as_view()),
        ]


@receiver(signals.task_removing, dispatch_uid="splatme_task_removing")
def stop_training_of_removed_task(sender, task_id, **kwargs):
    training.removed(task_id)
